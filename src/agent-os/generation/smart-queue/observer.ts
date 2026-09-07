// Phase 20.1 — ComfyUI Native Queue Observer
//
// Observes ComfyUI native execution queue (/queue, /history) without mutative side effects.
// Identifies Pao-owned jobs versus external/unknown prompts and computes normalized queue snapshots.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { ComfyUiClient } from "../comfyui-client";
import type {
  BacklogMetrics,
  QueueItem,
  QueueOwnershipState,
  QueueSnapshot,
} from "./types";

export interface ObserverTarget {
  providerId: string;
  instanceId?: string | null;
  baseUrl: string;
}

export class ComfyUiQueueObserver {
  private readonly clientCache = new Map<string, ComfyUiClient>();
  private readonly historyTimestamps = new Map<string, number[]>(); // providerId -> array of completion timestamps
  private readonly arrivalTimestamps = new Map<string, number[]>(); // providerId -> array of arrival timestamps

  private getClient(target: ObserverTarget): ComfyUiClient {
    let client = this.clientCache.get(target.baseUrl);
    if (!client) {
      client = new ComfyUiClient({ baseUrl: target.baseUrl, timeoutMs: 5_000 });
      this.clientCache.set(target.baseUrl, client);
    }
    return client;
  }

  /**
   * Fetches and normalizes a queue snapshot for a single ComfyUI provider.
   */
  async captureSnapshot(target: ObserverTarget): Promise<QueueSnapshot> {
    const client = this.getClient(target);
    const capturedAt = new Date().toISOString();
    const snapshotId = `snap_${randomUUID().slice(0, 12)}`;

    let providerHealth: "healthy" | "degraded" | "offline" = "healthy";
    let rawQueue: { queue_running?: unknown[]; queue_pending?: unknown[]; running?: unknown[]; pending?: unknown[] } = {};

    try {
      rawQueue = (await client.getQueue()) as typeof rawQueue;
    } catch {
      providerHealth = "offline";
    }

    const rawRunning = rawQueue.queue_running ?? rawQueue.running ?? [];
    const rawPending = rawQueue.queue_pending ?? rawQueue.pending ?? [];

    const runningItems = this.normalizeQueueItems(target.providerId, rawRunning, "running");
    const queuedItems = this.normalizeQueueItems(target.providerId, rawPending, "pending");

    const totalActive = runningItems.length + queuedItems.length;

    // Track arrival and completion rates
    const nowMs = Date.now();
    this.recordActivity(target.providerId, queuedItems.length, nowMs);

    // Oldest and newest queue timestamps
    let oldestQueuedAt: string | null = null;
    let newestQueuedAt: string | null = null;

    if (queuedItems.length > 0) {
      oldestQueuedAt = queuedItems[0].submittedAt;
      newestQueuedAt = queuedItems[queuedItems.length - 1].submittedAt;
    }

    // Estimate backlog and drain time (rough initial pass, refined by runtime predictor)
    const estimatedBacklogSeconds = queuedItems.reduce((acc, it) => acc + it.estimatedRuntimeSeconds, 0);
    const estimatedDrainSeconds = runningItems.length > 0
      ? estimatedBacklogSeconds / Math.max(runningItems.length, 1)
      : estimatedBacklogSeconds;

    const snapshot: QueueSnapshot = {
      id: snapshotId,
      providerId: target.providerId,
      instanceId: target.instanceId ?? null,
      capturedAt,
      runningCount: runningItems.length,
      queuedCount: queuedItems.length,
      totalActive,
      runningItems,
      queuedItems,
      oldestQueuedAt,
      newestQueuedAt,
      estimatedBacklogSeconds,
      estimatedDrainSeconds,
      providerHealth,
      details: {
        rawRunningCount: rawRunning.length,
        rawPendingCount: rawPending.length,
      },
    };

    this.persistSnapshot(snapshot);
    return snapshot;
  }

  /**
   * Normalizes raw ComfyUI queue arrays:
   * [number, prompt_id, prompt_graph, extra_data, outputs]
   */
  normalizeQueueItems(
    providerId: string,
    rawItems: unknown[],
    status: "running" | "pending",
  ): QueueItem[] {
    const db = openAgentOsDb();
    const items: QueueItem[] = [];

    for (const raw of rawItems) {
      if (!raw) continue;
      let promptId = "";
      let promptData: Record<string, unknown> = {};
      let extraData: Record<string, unknown> = {};

      if (Array.isArray(raw)) {
        promptId = String(raw[1] ?? "");
        promptData = (raw[2] as Record<string, unknown>) ?? {};
        extraData = (raw[3] as Record<string, unknown>) ?? {};
      } else if (typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        promptId = String(obj.prompt_id ?? obj.id ?? "");
        promptData = (obj.prompt ?? {}) as Record<string, unknown>;
        extraData = (obj.extra_data ?? {}) as Record<string, unknown>;
      }

      if (!promptId) continue;

      // Extract inner extra_data if nested
      const innerExtra = (extraData.extra_data as Record<string, unknown>) ?? extraData;
      const combinedExtra = { ...extraData, ...innerExtra };

      // Ownership classification
      const ownership = this.classifyOwnership(db, promptId, combinedExtra);

      // Extract metadata if available
      const paoJobId = ownership.paoJobId;
      let workflowId: string | null = null;
      let modelId: string | null = null;
      let priority = 5;
      let submittedAt = new Date().toISOString();

      if (paoJobId) {
        const jobRow = db.query("SELECT * FROM gen_jobs WHERE id = ?").get(paoJobId) as {
          workflow_id?: string;
          model_id?: string;
          priority?: number;
          created_at?: string;
        } | undefined;
        if (jobRow) {
          workflowId = jobRow.workflow_id ?? null;
          modelId = jobRow.model_id ?? null;
          priority = jobRow.priority ?? 5;
          submittedAt = jobRow.created_at ?? submittedAt;
        }
      }

      items.push({
        nativeQueueId: promptId,
        paoJobId,
        executionAttemptId: ownership.attemptId,
        providerId,
        workflowId,
        modelId,
        status,
        submittedAt,
        startedAt: status === "running" ? submittedAt : null,
        priority,
        promptHash: null,
        ownershipState: ownership.state,
        estimatedRuntimeSeconds: 30, // Default 30s baseline before predictor
        metadata: {
          client_id: extraData.client_id,
          prompt_keys: Object.keys(promptData),
        },
      });
    }

    return items;
  }

  /**
   * Safe ownership resolution:
   * 1. Check if promptId matches comfy_prompt_id stored in gen_jobs parameters
   * 2. Check if promptId matches gen_execution_attempts
   * 3. Check if extraData contains pao_job_id or Pao client_id pattern
   */
  classifyOwnership(
    db: ReturnType<typeof openAgentOsDb>,
    promptId: string,
    extraData: Record<string, unknown>,
  ): { state: QueueOwnershipState; paoJobId: string | null; attemptId: string | null } {
    // 1. Direct match in gen_jobs parameters_json
    const matchingJob = db.query(
      "SELECT id FROM gen_jobs WHERE parameters_json LIKE ? LIMIT 1",
    ).get(`%${promptId}%`) as { id: string } | undefined;

    if (matchingJob) {
      return { state: "PAO_OWNED", paoJobId: matchingJob.id, attemptId: null };
    }

    // 2. Extra data marker check
    const markerJobId = extraData.pao_job_id ?? extraData.paoJobId;
    if (typeof markerJobId === "string" && (markerJobId.startsWith("job_") || markerJobId.startsWith("job-"))) {
      return { state: "PAO_OWNED", paoJobId: markerJobId, attemptId: null };
    }

    const clientId = String(extraData.client_id ?? "");
    if (clientId.toLowerCase().includes("pao")) {
      return { state: "PAO_OWNED", paoJobId: null, attemptId: null };
    }

    // 3. Known imported prompt check
    const reconciliation = db.query(
      "SELECT pao_job_id FROM gen_queue_reconciliations WHERE native_prompt_id = ? AND resolution_status = 'resolved' LIMIT 1",
    ).get(promptId) as { pao_job_id: string | null } | undefined;

    if (reconciliation?.pao_job_id) {
      return { state: "IMPORTED", paoJobId: reconciliation.pao_job_id, attemptId: null };
    }

    return { state: "EXTERNAL", paoJobId: null, attemptId: null };
  }

  private persistSnapshot(snapshot: QueueSnapshot): void {
    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO gen_queue_snapshots
          (id, provider_id, instance_id, captured_at, running_count, queued_count,
           total_active, oldest_queued_at, newest_queued_at, estimated_backlog_seconds,
           estimated_drain_seconds, provider_health, gpu_utilization, vram_used, vram_total, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.id,
        snapshot.providerId,
        snapshot.instanceId,
        snapshot.capturedAt,
        snapshot.runningCount,
        snapshot.queuedCount,
        snapshot.totalActive,
        snapshot.oldestQueuedAt,
        snapshot.newestQueuedAt,
        snapshot.estimatedBacklogSeconds,
        snapshot.estimatedDrainSeconds,
        snapshot.providerHealth,
        snapshot.gpuUtilization ?? null,
        snapshot.vramUsed ?? null,
        snapshot.vramTotal ?? null,
        JSON.stringify(snapshot.details),
      );
    } catch {
      // Snapshot telemetry persistence is non-blocking
    }
  }

  private recordActivity(providerId: string, currentQueued: number, nowMs: number): void {
    // Maintain sliding window for arrival / drain rates
    const arrivals = this.arrivalTimestamps.get(providerId) ?? [];
    arrivals.push(nowMs);
    // Keep last 10 minutes
    const tenMinsAgo = nowMs - 600_000;
    const filtered = arrivals.filter(t => t >= tenMinsAgo);
    this.arrivalTimestamps.set(providerId, filtered);
  }

  computeBacklogMetrics(snapshot: QueueSnapshot): BacklogMetrics {
    const now = Date.now();
    let oldestWaitSeconds = 0;
    if (snapshot.oldestQueuedAt) {
      const oldestMs = new Date(snapshot.oldestQueuedAt).getTime();
      oldestWaitSeconds = Math.max(0, Math.round((now - oldestMs) / 1000));
    }

    const arrivals = this.arrivalTimestamps.get(snapshot.providerId) ?? [];
    const arrivalRate = arrivals.length > 0 ? (arrivals.length / 10) : 0; // per minute over 10 min window

    return {
      queuedCount: snapshot.queuedCount,
      runningCount: snapshot.runningCount,
      queueAgeSeconds: oldestWaitSeconds,
      oldestWaitSeconds,
      estimatedDrainSeconds: snapshot.estimatedDrainSeconds,
      arrivalRate,
      completionRate: snapshot.runningCount > 0 ? 1 : 0,
    };
  }
}
