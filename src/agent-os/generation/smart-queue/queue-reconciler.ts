// Phase 20.1 — Queue Reconciliation Engine
//
// Detects and resolves state drift between native ComfyUI queues and Pao's persistent SQLite database.
// Strict Invariant: External / unknown prompts are NEVER deleted or mutated automatically.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { ComfyUiClient } from "../comfyui-client";
import type { QueueSnapshot, ReconciliationMismatchType, ReconciliationRecord } from "./types";

export interface ReconcileResult {
  discrepanciesFound: number;
  autoResolved: number;
  records: ReconciliationRecord[];
}

export class QueueReconciler {
  /**
   * Reconciles a live QueueSnapshot against Pao SQLite records.
   */
  async reconcile(snapshot: QueueSnapshot, comfyClient: ComfyUiClient): Promise<ReconcileResult> {
    const db = openAgentOsDb();
    const records: ReconciliationRecord[] = [];
    let autoResolved = 0;

    // 1. Check all running items in ComfyUI
    for (const item of snapshot.runningItems) {
      if (item.ownershipState === "EXTERNAL" || item.ownershipState === "UNKNOWN") {
        // Record observation only — DO NOT MUTATE
        const rec = this.recordMismatch(
          item.nativeQueueId,
          null,
          snapshot.providerId,
          "untracked_prompt",
          "ignored",
          { details: "External user prompt running in ComfyUI; observed read-only" },
        );
        records.push(rec);
      } else if (item.paoJobId) {
        // Ensure Pao job is marked generating
        const jobRow = db.query("SELECT status, stage FROM gen_jobs WHERE id = ?").get(item.paoJobId) as { status: string; stage: string } | undefined;
        if (jobRow && jobRow.status !== "generating" && jobRow.status !== "preparing") {
          db.query("UPDATE gen_jobs SET status = 'generating', stage = 'generating' WHERE id = ?").run(item.paoJobId);
          autoResolved++;
        }
      }
    }

    // 2. Check jobs that Pao believes are running on this provider
    const claimedJobs = db.query(`
      SELECT id, status, stage, parameters_json FROM gen_jobs
      WHERE provider_id = ? AND status IN ('validating', 'preparing', 'generating')
    `).all(snapshot.providerId) as Array<{ id: string; status: string; stage: string; parameters_json: string }>;

    for (const job of claimedJobs) {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(job.parameters_json); } catch { /* ignore */ }
      const promptId = String(params.comfy_prompt_id ?? "");

      if (!promptId) continue;

      const inRunning = snapshot.runningItems.some(it => it.nativeQueueId === promptId);
      const inQueued = snapshot.queuedItems.some(it => it.nativeQueueId === promptId);

      if (!inRunning && !inQueued) {
        // Prompt is missing from both queue and running items. Check ComfyUI history!
        const history = await comfyClient.getHistory(promptId).catch(() => null);

        if (history && history.status?.completed && history.outputs && Object.keys(history.outputs).length > 0) {
          // Output was completed but Pao missed the webhook/polling tick!
          const rec = this.recordMismatch(
            promptId,
            job.id,
            snapshot.providerId,
            "history_unrecorded",
            "resolved",
            { outputsFound: Object.keys(history.outputs).length },
          );
          records.push(rec);
          autoResolved++;
        } else {
          // Prompt completely disappeared with no output — provider crashed or prompt interrupted
          const rec = this.recordMismatch(
            promptId,
            job.id,
            snapshot.providerId,
            "prompt_missing",
            "pending",
            { note: "Prompt missing from active queue and history" },
          );
          records.push(rec);
        }
      }
    }

    return {
      discrepanciesFound: records.length,
      autoResolved,
      records,
    };
  }

  recordMismatch(
    nativePromptId: string,
    paoJobId: string | null,
    providerId: string,
    mismatchType: ReconciliationMismatchType,
    resolutionStatus: "pending" | "resolved" | "ignored",
    details: Record<string, unknown> = {},
  ): ReconciliationRecord {
    const db = openAgentOsDb();
    const id = `rec_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    db.query(`
      INSERT INTO gen_queue_reconciliations
        (id, native_prompt_id, pao_job_id, provider_id, mismatch_type, resolution_status, details_json, detected_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      nativePromptId,
      paoJobId,
      providerId,
      mismatchType,
      resolutionStatus,
      JSON.stringify(details),
      now,
      resolutionStatus === "resolved" ? now : null,
    );

    return {
      id,
      nativePromptId,
      paoJobId,
      providerId,
      mismatchType,
      resolutionStatus,
      details,
      detectedAt: now,
      resolvedAt: resolutionStatus === "resolved" ? now : null,
    };
  }

  listDiscrepancies(options: { providerId?: string; status?: "pending" | "resolved" | "ignored" } = {}): ReconciliationRecord[] {
    const db = openAgentOsDb();
    const where: string[] = [];
    const params: string[] = [];

    if (options.providerId) { where.push("provider_id = ?"); params.push(options.providerId); }
    if (options.status) { where.push("resolution_status = ?"); params.push(options.status); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db.query(`
      SELECT id, native_prompt_id, pao_job_id, provider_id, mismatch_type, resolution_status, details_json, detected_at, resolved_at
      FROM gen_queue_reconciliations ${whereSql}
      ORDER BY detected_at DESC LIMIT 100
    `).all(...params) as Array<{
      id: string;
      native_prompt_id: string;
      pao_job_id: string | null;
      provider_id: string;
      mismatch_type: ReconciliationMismatchType;
      resolution_status: "pending" | "resolved" | "ignored";
      details_json: string;
      detected_at: string;
      resolved_at: string | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      nativePromptId: r.native_prompt_id,
      paoJobId: r.pao_job_id,
      providerId: r.provider_id,
      mismatchType: r.mismatch_type,
      resolutionStatus: r.resolution_status,
      details: JSON.parse(r.details_json || "{}"),
      detectedAt: r.detected_at,
      resolvedAt: r.resolved_at,
    }));
  }
}
