// Similarity & Near-Duplicate Gate for Video Factory
import { openAgentOsDb } from "../../db";
import { type VideoProductionJob } from "../domain/types";
import {
  evaluateSimilarity,
  type AssetSignature,
  type SimilarityCategory,
} from "../../similarity/similarity-engine";

export interface VideoSimilarityEvaluation {
  category: SimilarityCategory;
  similarityFlag: "LOW" | "MEDIUM" | "HIGH" | "NEAR_DUPLICATE";
  score: number; // 0..100
  reason: string;
  matchedSiblingId?: string;
}

export class VideoSimilarityGate {
  /**
   * Evaluate candidate video job against existing jobs in the same project or recent jobs.
   */
  evaluateJob(
    job: VideoProductionJob,
    explicitSiblings?: AssetSignature[],
  ): VideoSimilarityEvaluation {
    const candidateSig: AssetSignature = {
      id: job.id,
      title: job.prompt.slice(0, 60),
      promptText: job.prompt,
      conceptDescription: job.script || undefined,
    };

    let siblings: AssetSignature[] = explicitSiblings ?? [];

    if (!explicitSiblings) {
      const db = openAgentOsDb();
      let query = "SELECT id, prompt, script FROM video_production_jobs WHERE id != ?";
      const params: any[] = [job.id];
      if (job.projectId) {
        query += " AND project_id = ?";
        params.push(job.projectId);
      }
      query += " ORDER BY created_at DESC LIMIT 50";

      const rows = db.query(query).all(...params) as Array<{
        id: string;
        prompt: string;
        script?: string;
      }>;

      siblings = rows.map((r) => ({
        id: r.id,
        title: r.prompt.slice(0, 60),
        promptText: r.prompt,
        conceptDescription: r.script || undefined,
      }));
    }

    const simResult = evaluateSimilarity(candidateSig, siblings);

    let similarityFlag: "LOW" | "MEDIUM" | "HIGH" | "NEAR_DUPLICATE" = "LOW";
    if (simResult.category === "DUPLICATE") {
      similarityFlag = "NEAR_DUPLICATE";
    } else if (simResult.category === "TOO_SIMILAR") {
      similarityFlag = "HIGH";
    } else if (simResult.category === "RELATED_BUT_DISTINCT") {
      similarityFlag = "MEDIUM";
    }

    return {
      category: simResult.category,
      similarityFlag,
      score: Math.round(simResult.score * 100),
      reason: simResult.reason,
      matchedSiblingId: simResult.matchedSiblingId,
    };
  }
}
