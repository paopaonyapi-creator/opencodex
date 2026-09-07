// Reviewer Council Gate for Video Factory (5-Agent Evaluation & Human Review Gate)
import { openAgentOsDb } from "../../db";
import {
  type CouncilDecision,
  type CouncilEvaluationSummary,
  type VideoProductionJob,
  type VideoProductionArtifact,
  type TechnicalVideoQCResult,
} from "../domain/types";
import { VideoSimilarityGate } from "./similarity-gate";
import { evaluateStockFootageRights } from "../policy/rights-policy";

export class ReviewerCouncilGate {
  private similarityGate = new VideoSimilarityGate();

  evaluate(
    job: VideoProductionJob,
    artifact?: VideoProductionArtifact,
    technicalQc?: TechnicalVideoQCResult,
  ): CouncilEvaluationSummary {
    const db = openAgentOsDb();
    const id = "vcouncil-" + Math.random().toString(36).slice(2, 10);
    const evaluatedAt = new Date().toISOString();

    // 1. Technical Score
    let technicalScore = 90.0;
    if (technicalQc) {
      technicalScore = technicalQc.passed ? 95.0 : 40.0;
    }

    // 2. Similarity Score
    const similarityEval = this.similarityGate.evaluateJob(job);
    const similarityScore = Math.max(0, 100 - similarityEval.score);

    // 3. Commercial Score
    let commercialScore = 85.0;
    if (job.prompt.trim().length < 10) {
      commercialScore = 45.0;
    }

    // 4. Visual Artifact Score
    const visualScore = technicalQc?.passed ? 90.0 : 60.0;

    // 5. Compliance & Rights Score
    let complianceScore = 95.0;
    let rightsStatus: "VERIFIED" | "UNKNOWN" | "HOLD" = "VERIFIED";

    // Check rights if stock footage mode
    if (job.mode === "adobe_stock") {
      const metadata = (job.requestJson?.metadata || {}) as Record<string, unknown>;
      const stockSource = metadata.stockSource as string | undefined;
      const license = metadata.stockLicenseType as string | undefined;

      if (stockSource) {
        const rightsCheck = evaluateStockFootageRights(stockSource, license, metadata.redistributionPermitted === true);
        if (!rightsCheck.permitted) {
          rightsStatus = "HOLD";
          complianceScore = 30.0;
        }
      }
    }

    // Trademark check in prompt
    const restrictedKeywords = ["nike", "apple", "disney", "coca-cola", "gucci", "adidas", "microsoft"];
    const promptLower = job.prompt.toLowerCase();
    const hasRestricted = restrictedKeywords.some((kw) => promptLower.includes(kw));
    if (hasRestricted) {
      complianceScore = 20.0;
      rightsStatus = "HOLD";
    }

    // Weighted composite score
    // Technical: 25%, Visual: 20%, Commercial: 20%, Similarity: 15%, Compliance: 20%
    const compositeScore = Number((
      technicalScore * 0.25 +
      visualScore * 0.20 +
      commercialScore * 0.20 +
      similarityScore * 0.15 +
      complianceScore * 0.20
    ).toFixed(1));

    // Decision synthesis
    let decision: CouncilDecision = "READY_FOR_HUMAN_SUBMISSION_REVIEW";
    let notes = "All 5 Council evaluation dimensions satisfied. Ready for mandatory human review.";

    if (rightsStatus === "HOLD" || complianceScore < 50) {
      decision = "HOLD_FOR_COMPLIANCE_REVIEW";
      notes = hasRestricted
        ? "Potential trademark or brand infringement detected in prompt."
        : "Stock footage redistribution rights unverified; held for legal clearance.";
    } else if (similarityEval.category === "DUPLICATE") {
      decision = "REJECT_INTERNALLY";
      notes = `Rejected: near duplicate of existing clip (${similarityEval.reason})`;
    } else if (technicalScore < 70) {
      decision = "NEEDS_FIXES";
      notes = `Technical QC issues detected: ${technicalQc?.failures.join("; ") || "Codec or duration invalid"}`;
    } else if (compositeScore < 70) {
      decision = "NEEDS_FIXES";
      notes = "Overall quality below threshold (requires refinement).";
    }

    // Insert into video_reviewer_council
    db.query(`
      INSERT INTO video_reviewer_council (
        id, job_id, artifact_id, decision, composite_score,
        technical_score, commercial_score, visual_score,
        similarity_score, compliance_score, similarity_flag,
        rights_status, notes, evaluated_by, evaluated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      id,
      job.id,
      artifact?.id || null,
      decision,
      compositeScore,
      technicalScore,
      commercialScore,
      visualScore,
      similarityScore,
      complianceScore,
      similarityEval.similarityFlag,
      rightsStatus,
      notes,
      "pao_reviewer_council_v1",
      evaluatedAt,
    );

    // If job state allows, update job status
    if (decision === "READY_FOR_HUMAN_SUBMISSION_REVIEW") {
      db.query("UPDATE video_production_jobs SET status = 'HUMAN_REVIEW', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        job.id,
      );
    } else if (decision === "HOLD_FOR_COMPLIANCE_REVIEW") {
      db.query("UPDATE video_production_jobs SET status = 'HOLD_COMPLIANCE', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        job.id,
      );
    } else if (decision === "REJECT_INTERNALLY") {
      db.query("UPDATE video_production_jobs SET status = 'REJECT_INTERNAL', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        job.id,
      );
    } else if (decision === "NEEDS_FIXES") {
      db.query("UPDATE video_production_jobs SET status = 'NEEDS_FIXES', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        job.id,
      );
    }

    return {
      id,
      jobId: job.id,
      artifactId: artifact?.id,
      decision,
      compositeScore,
      technicalScore,
      commercialScore,
      visualScore,
      similarityScore,
      complianceScore,
      similarityFlag: similarityEval.similarityFlag,
      rightsStatus,
      notes,
      evaluatedBy: "pao_reviewer_council_v1",
      evaluatedAt,
    };
  }

  approveHumanReview(councilId: string, approvedBy: string): CouncilEvaluationSummary {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM video_reviewer_council WHERE id = ?").get(councilId) as any;
    if (!row) throw new Error(`Council review ${councilId} not found`);

    const now = new Date().toISOString();
    db.query(`
      UPDATE video_reviewer_council
      SET human_approved_by = ?, human_approved_at = ?
      WHERE id = ?
    `).run(approvedBy, now, councilId);

    // Move job to READY_FOR_EXPORT
    db.query("UPDATE video_production_jobs SET status = 'READY_FOR_EXPORT', updated_at = ? WHERE id = ?").run(
      now,
      row.job_id,
    );

    return this.getCouncilEvaluationById(councilId)!;
  }

  getCouncilEvaluation(jobId: string): CouncilEvaluationSummary | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM video_reviewer_council WHERE job_id = ? ORDER BY evaluated_at DESC LIMIT 1").get(jobId) as any;
    return row ? this.mapCouncilRow(row) : null;
  }

  getCouncilEvaluationById(id: string): CouncilEvaluationSummary | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM video_reviewer_council WHERE id = ?").get(id) as any;
    return row ? this.mapCouncilRow(row) : null;
  }

  private mapCouncilRow(row: any): CouncilEvaluationSummary {
    return {
      id: row.id,
      jobId: row.job_id,
      artifactId: row.artifact_id || undefined,
      decision: row.decision,
      compositeScore: Number(row.composite_score),
      technicalScore: Number(row.technical_score),
      commercialScore: Number(row.commercial_score),
      visualScore: Number(row.visual_score),
      similarityScore: Number(row.similarity_score),
      complianceScore: Number(row.compliance_score),
      similarityFlag: row.similarity_flag,
      rightsStatus: row.rights_status,
      notes: row.notes,
      evaluatedBy: row.evaluated_by,
      evaluatedAt: row.evaluated_at,
      humanApprovedBy: row.human_approved_by || undefined,
      humanApprovedAt: row.human_approved_at || undefined,
    };
  }
}
