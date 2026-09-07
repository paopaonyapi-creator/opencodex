// Phase 20 — Cloud Lifecycle Manager.
//
// Manages the complete lifecycle of RunPod compute resources:
// provision, readiness probe, job assignment, idle auto-stop, safe terminate,
// emergency kill, orphan leak detection, and restart reconciliation.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { RunPodClient } from "./runpod/client";
import type { RunPodPod } from "./runpod/api-types";
import type { CostGuard } from "../cost/cost-guard";
import { LeaseManager } from "./leases";
import type { RunPodPodRecord, ComputeInstance } from "../types";

export interface LifecycleManagerOptions {
  client: RunPodClient;
  costGuard: CostGuard;
  environment?: string;
  defaultTemplateId?: string;
  idleStopMinutes?: number;
  autoStop?: boolean;
}

export class CloudLifecycleManager {
  readonly client: RunPodClient;
  readonly costGuard: CostGuard;
  readonly environment: string;
  readonly defaultTemplateId: string;
  readonly idleStopMinutes: number;
  readonly autoStop: boolean;
  readonly leases = new LeaseManager();

  constructor(options: LifecycleManagerOptions) {
    this.client = options.client;
    this.costGuard = options.costGuard;
    this.environment = options.environment ?? "prod";
    this.defaultTemplateId = options.defaultTemplateId ?? "hs44di56w7";
    this.idleStopMinutes = options.idleStopMinutes ?? 10;
    this.autoStop = options.autoStop ?? true;
  }

  generatePodName(shortJobId: string): string {
    const ts = Date.now();
    return `pao-gen-${this.environment}-${shortJobId.replace(/[^a-z0-9]/gi, "").slice(0, 8)}-${ts}`;
  }

  async provisionPod(params: {
    jobId: string;
    gpuType: string;
    hourlyPrice: number;
    estimatedCost: number;
    templateId?: string;
    networkVolumeId?: string;
    overrideActive?: boolean;
  }): Promise<RunPodPodRecord> {
    const { jobId, gpuType, hourlyPrice, estimatedCost, templateId, networkVolumeId, overrideActive } = params;

    // 1. Cost Guard check
    const budget = this.costGuard.evaluate({
      hourlyPrice,
      estimatedCost,
      overrideActive,
    });

    if (!budget.allowed) {
      throw new Error(`Cost Guard blocked provisioning: ${budget.reasons.join("; ")}`);
    }

    // 2. Acquire lock
    const lease = this.leases.acquireLease("provisioning", jobId, "cloud-lifecycle", 90);
    if (!lease) {
      throw new Error(`Concurrent provisioning in progress for job ${jobId}`);
    }

    try {
      const shortId = jobId.slice(0, 8);
      const name = this.generatePodName(shortId);
      const ownershipMarker = randomUUID();

      // 3. Call RunPod REST API
      const createdPod = await this.client.createPod({
        name,
        templateId: templateId ?? this.defaultTemplateId,
        gpuTypeIds: [gpuType],
        gpuCount: 1,
        networkVolumeId,
      });

      const now = new Date().toISOString();
      const db = openAgentOsDb();

      const record: RunPodPodRecord = {
        id: `pod_rec_${randomUUID().slice(0, 10)}`,
        runpodPodId: createdPod.id,
        templateId: templateId ?? this.defaultTemplateId,
        gpuType,
        gpuCount: 1,
        datacenterId: createdPod.dataCenterId ?? null,
        networkVolumeId: networkVolumeId ?? null,
        desiredState: "running",
        actualState: "provisioned",
        costPerHour: createdPod.costPerHour || hourlyPrice,
        createdByPao: true,
        ownershipMarker,
        currentJobId: jobId,
        lastActiveAt: now,
        idleSince: null,
        createdAt: now,
        updatedAt: now,
      };

      // 4. Persist in database
      db.query(`
        INSERT INTO gen_runpod_pods
          (id, runpod_pod_id, template_id, gpu_type, gpu_count, datacenter_id,
           network_volume_id, desired_state, actual_state, cost_per_hour,
           created_by_pao, ownership_marker, current_job_id, last_active_at,
           idle_since, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.runpodPodId,
        record.templateId,
        record.gpuType,
        record.gpuCount,
        record.datacenterId,
        record.networkVolumeId,
        record.desiredState,
        record.actualState,
        record.costPerHour,
        record.createdByPao ? 1 : 0,
        record.ownershipMarker,
        record.currentJobId,
        record.lastActiveAt,
        record.idleSince,
        record.createdAt,
        record.updatedAt,
      );

      // Also register in gen_compute_instances
      db.query(`
        INSERT INTO gen_compute_instances
          (id, provider_id, provider_type, external_id, name, lifecycle_state,
           health_state, gpu_type, gpu_count, datacenter_id, template_id,
           network_volume_id, ownership_token, created_at)
        VALUES (?, 'runpod', 'runpod', ?, ?, 'provisioned', 'unknown', ?, 1, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.runpodPodId,
        name,
        gpuType,
        record.datacenterId,
        record.templateId,
        record.networkVolumeId,
        ownershipMarker,
        now,
      );

      return record;
    } finally {
      this.leases.releaseLease("provisioning", jobId, lease.token);
    }
  }

  resolveComfyUiEndpoint(pod: RunPodPod): string | null {
    if (pod.port) return `http://127.0.0.1:${pod.port}`;

    const ports = pod.runtime?.ports ?? [];
    const comfyPort = ports.find(p => p.privatePort === 8188 || p.type === "http");

    if (comfyPort?.publicPort && comfyPort?.ip) {
      return `http://${comfyPort.ip}:${comfyPort.publicPort}`;
    }

    // Fallback: RunPod HTTP Proxy URL pattern
    if (pod.id) {
      return `https://${pod.id}-8188.proxy.runpod.net`;
    }

    return null;
  }

  async waitForPodReady(
    runpodPodId: string,
    maxWaitSeconds = 180,
    pollIntervalMs = 2000,
  ): Promise<{ pod: RunPodPod; baseUrl: string }> {
    const started = Date.now();
    const deadline = started + maxWaitSeconds * 1000;

    while (Date.now() < deadline) {
      const pod = await this.client.getPod(runpodPodId);

      if (pod.desiredStatus === "RUNNING") {
        const endpoint = this.resolveComfyUiEndpoint(pod);
        if (endpoint) {
          // Probe ComfyUI HTTP endpoint readiness
          const ready = await this.probeHttpEndpoint(endpoint).catch(() => false);
          if (ready) {
            const now = new Date().toISOString();
            const db = openAgentOsDb();
            db.query(`
              UPDATE gen_runpod_pods
              SET actual_state = 'ready', updated_at = ?
              WHERE runpod_pod_id = ?
            `).run(now, runpodPodId);

            db.query(`
              UPDATE gen_compute_instances
              SET lifecycle_state = 'ready', health_state = 'healthy', base_url = ?, ready_at = ?
              WHERE external_id = ?
            `).run(endpoint, now, runpodPodId);

            return { pod, baseUrl: endpoint };
          }
        }
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`Pod ${runpodPodId} readiness timed out after ${maxWaitSeconds}s`);
  }

  private async probeHttpEndpoint(baseUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    timer.unref?.();

    try {
      const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok || res.status === 404 || res.status === 401; // HTTP server is responding
    } catch {
      clearTimeout(timer);
      return false;
    }
  }


  listTrackedPods(): RunPodPodRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM gen_runpod_pods ORDER BY created_at ASC").all() as Record<string, unknown>[];
    return rows.map(rowToPodRecord);
  }

  getLease(podId: string): { comfyEndpoint?: string } | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT endpoint_url FROM gen_compute_instances WHERE id = ? OR external_id = ?").get(podId, podId) as {
      endpoint_url?: string;
    } | undefined;
    return row?.endpoint_url ? { comfyEndpoint: row.endpoint_url } : null;
  }

  assignJobToPod(runpodPodId: string, jobId: string): void {
    const now = new Date().toISOString();
    openAgentOsDb().query(`
      UPDATE gen_runpod_pods
      SET current_job_id = ?, actual_state = 'busy', last_active_at = ?, idle_since = NULL, updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(jobId, now, now, runpodPodId);
  }

  unassignJobFromPod(runpodPodId: string): void {
    const now = new Date().toISOString();
    const db = openAgentOsDb();
    db.query(`
      UPDATE gen_runpod_pods
      SET current_job_id = NULL, actual_state = 'ready', last_active_at = ?, idle_since = ?, updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(now, now, now, runpodPodId);

    const pod = db.query("SELECT desired_state FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as { desired_state?: string } | undefined;
    if (pod?.desired_state === "draining" || pod?.desired_state === "stopped") {
      void this.stopPod(runpodPodId).catch(() => {});
    }
  }

  async startPod(runpodPodId: string): Promise<RunPodPodRecord> {
    await this.client.startPod(runpodPodId);
    const now = new Date().toISOString();
    const db = openAgentOsDb();
    db.query(`
      UPDATE gen_runpod_pods
      SET desired_state = 'running', actual_state = 'ready', idle_since = ?, updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(now, now, runpodPodId);

    db.query(`
      UPDATE gen_compute_instances
      SET lifecycle_state = 'ready', ready_at = ?, last_seen_at = ?
      WHERE external_id = ?
    `).run(now, now, runpodPodId);

    const row = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as Record<string, unknown>;
    return rowToPodRecord(row);
  }

  async stopPod(runpodPodId: string): Promise<RunPodPodRecord> {
    await this.client.stopPod(runpodPodId);
    const now = new Date().toISOString();
    const db = openAgentOsDb();
    db.query(`
      UPDATE gen_runpod_pods
      SET desired_state = 'stopped', actual_state = 'stopped', current_job_id = NULL, updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(now, runpodPodId);

    db.query(`
      UPDATE gen_compute_instances
      SET lifecycle_state = 'stopped', stopped_at = ?, last_seen_at = ?
      WHERE external_id = ?
    `).run(now, now, runpodPodId);

    const row = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as Record<string, unknown>;
    return rowToPodRecord(row);
  }

  async drainPod(runpodPodId: string): Promise<RunPodPodRecord> {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Pod ${runpodPodId} not found`);
    }

    const now = new Date().toISOString();
    db.query(`
      UPDATE gen_runpod_pods
      SET desired_state = 'draining', updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(now, runpodPodId);

    if (!row.current_job_id) {
      return this.stopPod(runpodPodId);
    }

    const updated = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as Record<string, unknown>;
    return rowToPodRecord(updated);
  }

  async checkIdleAndStopPods(thresholdMinutes = this.idleStopMinutes): Promise<string[]> {
    if (!this.autoStop) return [];
    const db = openAgentOsDb();
    const thresholdMs = thresholdMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();

    const idlePods = db.query(`
      SELECT runpod_pod_id FROM gen_runpod_pods
      WHERE actual_state = 'ready'
        AND current_job_id IS NULL
        AND idle_since IS NOT NULL
        AND idle_since <= ?
        AND created_by_pao = 1
    `).all(cutoff) as Array<{ runpod_pod_id: string }>;

    const stopped: string[] = [];
    for (const { runpod_pod_id } of idlePods) {
      try {
        await this.client.stopPod(runpod_pod_id);
        const now = new Date().toISOString();
        db.query(`
          UPDATE gen_runpod_pods
          SET actual_state = 'stopped', updated_at = ?
          WHERE runpod_pod_id = ?
        `).run(now, runpod_pod_id);

        db.query(`
          UPDATE gen_compute_instances
          SET lifecycle_state = 'stopped', stopped_at = ?
          WHERE external_id = ?
        `).run(now, runpod_pod_id);

        stopped.push(runpod_pod_id);
      } catch (err) {
        console.warn(`[runpod] failed to stop idle pod ${runpod_pod_id}:`, err);
      }
    }

    return stopped;
  }

  async safeTerminatePod(runpodPodId: string, options: { force?: boolean } = {}): Promise<boolean> {
    const db = openAgentOsDb();
    const record = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(runpodPodId) as Record<string, unknown> | undefined;

    if (!record) {
      throw new Error(`Pod ${runpodPodId} not registered in Pao-hubPro`);
    }

    if (record.created_by_pao !== 1 && !options.force) {
      throw new Error(`Safe terminate denied: Pod ${runpodPodId} was imported, not created by Pao`);
    }

    if (record.current_job_id && !options.force) {
      throw new Error(`Cannot terminate Pod ${runpodPodId}: actively running job ${record.current_job_id as string}`);
    }

    await this.client.deletePod(runpodPodId);

    const now = new Date().toISOString();
    db.query(`
      UPDATE gen_runpod_pods
      SET actual_state = 'terminated', current_job_id = NULL, updated_at = ?
      WHERE runpod_pod_id = ?
    `).run(now, runpodPodId);

    db.query(`
      UPDATE gen_compute_instances
      SET lifecycle_state = 'terminated', terminated_at = ?
      WHERE external_id = ?
    `).run(now, runpodPodId);

    return true;
  }

  async stopAllManagedPods(): Promise<{ stoppedCount: number; podIds: string[] }> {
    const db = openAgentOsDb();
    const active = db.query(`
      SELECT runpod_pod_id FROM gen_runpod_pods
      WHERE created_by_pao = 1 AND actual_state NOT IN ('stopped', 'terminated')
    `).all() as Array<{ runpod_pod_id: string }>;

    const podIds = active.map(p => p.runpod_pod_id);
    let stoppedCount = 0;

    for (const id of podIds) {
      try {
        await this.client.stopPod(id);
        stoppedCount++;
        const now = new Date().toISOString();
        db.query(`
          UPDATE gen_runpod_pods SET actual_state = 'stopped', updated_at = ? WHERE runpod_pod_id = ?
        `).run(now, id);
        db.query(`
          UPDATE gen_compute_instances SET lifecycle_state = 'stopped', stopped_at = ? WHERE external_id = ?
        `).run(now, id);
      } catch (err) {
        console.warn(`[runpod] emergency stop failed for ${id}:`, err);
      }
    }

    return { stoppedCount, podIds };
  }

  async emergencyStopAll(): Promise<{ stoppedCount: number; podIds: string[] }> {
    return this.stopAllManagedPods();
  }

  async detectOrphanPods(): Promise<Array<{ podId: string; name: string }>> {
    const pods = await this.client.listPods();
    const db = openAgentOsDb();
    const orphans: Array<{ podId: string; name: string }> = [];

    for (const pod of pods) {
      if (pod.name.startsWith("pao-gen-")) {
        const row = db.query("SELECT id FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(pod.id);
        if (!row) {
          orphans.push({ podId: pod.id, name: pod.name });
        }
      }
    }

    return orphans;
  }

  async reconcileWithRunPod(): Promise<{ updated: number }> {
    const pods = await this.client.listPods().catch(() => []);
    if (pods.length === 0) return { updated: 0 };

    const db = openAgentOsDb();
    let updated = 0;

    for (const pod of pods) {
      const row = db.query("SELECT id, actual_state FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(pod.id) as {
        id: string;
        actual_state: string;
      } | undefined;

      if (row) {
        let normalizedState = row.actual_state;
        if (pod.desiredStatus === "PAUSED") normalizedState = "stopped";
        else if (pod.desiredStatus === "TERMINATED") normalizedState = "terminated";
        else if (pod.desiredStatus === "RUNNING") {
          normalizedState = row.actual_state === "provisioned" ? "booting" : row.actual_state;
        }

        if (normalizedState !== row.actual_state) {
          db.query("UPDATE gen_runpod_pods SET actual_state = ?, updated_at = datetime('now') WHERE runpod_pod_id = ?").run(
            normalizedState,
            pod.id,
          );
          updated++;
        }
      }
    }

    return { updated };
  }
}

export function rowToPodRecord(row: Record<string, unknown>): RunPodPodRecord {
  return {
    id: row.id as string,
    runpodPodId: row.runpod_pod_id as string,
    templateId: row.template_id as string | null,
    gpuType: row.gpu_type as string,
    gpuCount: Number(row.gpu_count ?? 1),
    datacenterId: row.datacenter_id as string | null,
    networkVolumeId: row.network_volume_id as string | null,
    desiredState: row.desired_state as RunPodPodRecord["desiredState"],
    actualState: row.actual_state as RunPodPodRecord["actualState"],
    costPerHour: Number(row.cost_per_hour ?? 0),
    createdByPao: Boolean(row.created_by_pao),
    ownershipMarker: (row.ownership_marker as string) || "pao-managed",
    currentJobId: row.current_job_id as string | null,
    lastActiveAt: row.last_active_at as string | null,
    idleSince: row.idle_since as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
