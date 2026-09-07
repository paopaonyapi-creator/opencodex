// Phase 20.1 — Batch Affinity & Locality Planner
//
// Groups jobs by model, workflow family, and LoRA stack to maximize GPU model cache reuse,
// avoid cold reloads, and chunk large multi-scene batches into balanced units.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { GenerationJob } from "../types";
import type { AffinityKey, BatchGroup } from "./types";

export class BatchAffinityPlanner {
  private readonly defaultChunkSize: number;

  constructor(options: { defaultChunkSize?: number } = {}) {
    this.defaultChunkSize = options.defaultChunkSize ?? 5;
  }

  /**
   * Generates a deterministic hash for affinity grouping based on model & workflow components.
   */
  computeAffinityKey(job: GenerationJob): string {
    const modelId = job.modelId ?? "default";
    const workflowFamily = job.workflowId?.split("-")[0] ?? "general";
    const isVideo = job.workflowId?.toLowerCase().includes("video") ? "video" : "image";
    const lorasSorted = (job.loras ?? []).map(l => `${l.id}:${l.strength}`).sort().join(",");

    const raw = `${modelId}|${workflowFamily}|${isVideo}|${lorasSorted}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  /**
   * Groups an array of pending/queued jobs by their computed affinity keys.
   */
  groupJobsByAffinity(jobs: GenerationJob[]): Map<string, GenerationJob[]> {
    const groups = new Map<string, GenerationJob[]>();
    for (const job of jobs) {
      const key = this.computeAffinityKey(job);
      const list = groups.get(key) ?? [];
      list.push(job);
      groups.set(key, list);
    }
    return groups;
  }

  /**
   * Chunks large homogeneous batches (e.g. 50 scene jobs) into chunks of chunkSize
   * to balance fairness across competing projects/users.
   */
  chunkBatch(jobs: GenerationJob[], chunkSize = this.defaultChunkSize): GenerationJob[][] {
    const chunks: GenerationJob[][] = [];
    for (let i = 0; i < jobs.length; i += chunkSize) {
      chunks.push(jobs.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Records or updates a batch group in the database for tracking.
   */
  upsertBatchGroup(
    projectId: string | null,
    affinityKey: string,
    jobs: GenerationJob[],
    preferredProvider?: string | null,
  ): BatchGroup {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    const queuedCount = jobs.filter(j => j.status === "queued").length;
    const runningCount = jobs.filter(j => j.status === "generating" || j.status === "preparing").length;
    const completedCount = jobs.filter(j => j.status === "completed").length;

    // Check if an existing group with this affinityKey and projectId is active
    const existing = db.query(`
      SELECT id, created_at FROM gen_batch_groups
      WHERE affinity_key = ? AND (project_id = ? OR (project_id IS NULL AND ? IS NULL))
      ORDER BY created_at DESC LIMIT 1
    `).get(affinityKey, projectId, projectId) as { id: string; created_at: string } | undefined;

    const id = existing?.id ?? `batch_${randomUUID().slice(0, 12)}`;
    const createdAt = existing?.created_at ?? now;

    db.query(`
      INSERT INTO gen_batch_groups
        (id, project_id, affinity_key, total_jobs, queued_jobs, running_jobs, completed_jobs, preferred_provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_jobs = excluded.total_jobs,
        queued_jobs = excluded.queued_jobs,
        running_jobs = excluded.running_jobs,
        completed_jobs = excluded.completed_jobs,
        preferred_provider = COALESCE(excluded.preferred_provider, gen_batch_groups.preferred_provider),
        updated_at = excluded.updated_at
    `).run(
      id,
      projectId,
      affinityKey,
      jobs.length,
      queuedCount,
      runningCount,
      completedCount,
      preferredProvider ?? null,
      createdAt,
      now,
    );

    return {
      id,
      projectId,
      affinityKey,
      totalJobs: jobs.length,
      queuedJobs: queuedCount,
      runningJobs: runningCount,
      completedJobs: completedCount,
      preferredProvider: preferredProvider ?? null,
      estimatedTotalRuntime: 0,
      createdAt,
      updatedAt: now,
    };
  }

  /**
   * Calculates an affinity bonus score (0 to 10) for dispatching a job to a specific provider.
   * Providers that recently completed jobs with the exact same affinityKey receive maximum bonus.
   */
  calculateAffinityBonus(job: GenerationJob, providerId: string, warmAffinityMap: Map<string, string>): number {
    const jobKey = this.computeAffinityKey(job);
    const warmKey = warmAffinityMap.get(providerId);

    if (warmKey && warmKey === jobKey) {
      return 10.0; // Perfect model locality bonus
    }
    return 0.0;
  }
}
