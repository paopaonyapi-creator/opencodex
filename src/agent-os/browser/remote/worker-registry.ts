// Phase 20.14 — Pao-hubPro Browser Remote Worker Node Registry
//
// Persistent registry for distributed remote browser worker nodes.
// Manages registration, token authentication, heartbeat leases, status transitions,
// and fleet health tracking.

import { createHash, randomBytes } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { FleetStatus, RemoteWorker, WorkerCapabilities, WorkerStatus } from "./types";

export class RemoteWorkerRegistry {
  /**
   * Hashes an auth token using SHA-256 for secure storage.
   */
  public hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Registers a new remote browser worker node.
   */
  public registerWorker(options: {
    id?: string;
    name: string;
    endpointUrl: string;
    authToken?: string;
    geoRegion?: string;
    maxConcurrentJobs?: number;
    capabilities?: Partial<WorkerCapabilities>;
  }): { worker: RemoteWorker; rawToken: string } {
    const id = options.id || `worker_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const rawToken = options.authToken || `pao_wtoken_${randomBytes(24).toString("hex")}`;
    const authTokenHash = this.hashToken(rawToken);
    const now = Date.now();

    const capabilities: WorkerCapabilities = {
      headless: options.capabilities?.headless ?? true,
      headed: options.capabilities?.headed ?? false,
      os: options.capabilities?.os || process.platform,
      proxy: options.capabilities?.proxy,
      tags: options.capabilities?.tags || [],
      browserVersion: options.capabilities?.browserVersion || "1.0.0",
      platform: options.capabilities?.platform || "pao-browser-node",
    };

    const worker: RemoteWorker = {
      id,
      name: options.name,
      endpointUrl: options.endpointUrl.replace(/\/$/, ""),
      authTokenHash,
      status: "online",
      geoRegion: options.geoRegion || "global",
      maxConcurrentJobs: options.maxConcurrentJobs || 3,
      activeJobs: 0,
      capabilities,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_remote_workers (
        id, name, endpoint_url, auth_token_hash, status,
        geo_region, max_concurrent_jobs, active_jobs,
        capabilities_json, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        endpoint_url = excluded.endpoint_url,
        auth_token_hash = excluded.auth_token_hash,
        status = 'online',
        geo_region = excluded.geo_region,
        max_concurrent_jobs = excluded.max_concurrent_jobs,
        capabilities_json = excluded.capabilities_json,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at
    `).run(
      worker.id,
      worker.name,
      worker.endpointUrl,
      worker.authTokenHash,
      worker.status,
      worker.geoRegion,
      worker.maxConcurrentJobs,
      worker.activeJobs,
      JSON.stringify(worker.capabilities),
      worker.lastHeartbeatAt,
      worker.createdAt,
      worker.updatedAt,
    );

    return { worker, rawToken };
  }

  /**
   * Verifies worker credentials against stored SHA-256 hash.
   */
  public verifyWorkerAuth(workerId: string, providedToken: string): boolean {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT auth_token_hash FROM browser_remote_workers WHERE id = ? LIMIT 1")
      .get(workerId) as { auth_token_hash: string } | null;

    if (!row) return false;
    const providedHash = this.hashToken(providedToken);
    return row.auth_token_hash === providedHash;
  }

  /**
   * Records a heartbeat from a remote worker node.
   */
  public heartbeat(workerId: string, status?: WorkerStatus, activeJobs?: number): boolean {
    const db = openAgentOsDb();
    const now = Date.now();

    const existing = db
      .query("SELECT status, active_jobs FROM browser_remote_workers WHERE id = ? LIMIT 1")
      .get(workerId) as { status: string; active_jobs: number } | null;

    if (!existing) return false;

    // Preserve draining status if set
    let targetStatus = status || (existing.status === "draining" ? "draining" : "online");
    const targetJobs = typeof activeJobs === "number" ? activeJobs : existing.active_jobs;

    db.query(`
      UPDATE browser_remote_workers
      SET last_heartbeat_at = ?, status = ?, active_jobs = ?, updated_at = ?
      WHERE id = ?
    `).run(now, targetStatus, targetJobs, now, workerId);

    return true;
  }

  /**
   * Fetches worker by ID.
   */
  public getWorker(id: string): RemoteWorker | null {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM browser_remote_workers WHERE id = ? LIMIT 1")
      .get(id) as Record<string, unknown> | null;

    if (!row) return null;

    let capabilities: WorkerCapabilities = { headless: true, headed: false };
    try {
      capabilities = JSON.parse(String(row.capabilities_json || "{}"));
    } catch {
      capabilities = { headless: true, headed: false };
    }

    return {
      id: String(row.id),
      name: String(row.name),
      endpointUrl: String(row.endpoint_url),
      authTokenHash: String(row.auth_token_hash),
      status: row.status as WorkerStatus,
      geoRegion: String(row.geo_region),
      maxConcurrentJobs: Number(row.max_concurrent_jobs),
      activeJobs: Number(row.active_jobs),
      capabilities,
      lastHeartbeatAt: Number(row.last_heartbeat_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  /**
   * Lists remote workers with optional filters.
   */
  public listWorkers(filter?: { status?: WorkerStatus; geoRegion?: string }): RemoteWorker[] {
    const db = openAgentOsDb();
    let query = "SELECT * FROM browser_remote_workers WHERE 1=1";
    const params: string[] = [];

    if (filter?.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.geoRegion) {
      query += " AND geo_region = ?";
      params.push(filter.geoRegion);
    }

    query += " ORDER BY updated_at DESC";
    const rows = db.query(query).all(...params) as Record<string, unknown>[];

    return rows.map((row) => {
      let capabilities: WorkerCapabilities = { headless: true, headed: false };
      try {
        capabilities = JSON.parse(String(row.capabilities_json || "{}"));
      } catch {
        capabilities = { headless: true, headed: false };
      }

      return {
        id: String(row.id),
        name: String(row.name),
        endpointUrl: String(row.endpoint_url),
        authTokenHash: String(row.auth_token_hash),
        status: row.status as WorkerStatus,
        geoRegion: String(row.geo_region),
        maxConcurrentJobs: Number(row.max_concurrent_jobs),
        activeJobs: Number(row.active_jobs),
        capabilities,
        lastHeartbeatAt: Number(row.last_heartbeat_at),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    });
  }

  /**
   * Updates worker status.
   */
  public updateWorkerStatus(id: string, status: WorkerStatus): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const res = db
      .query("UPDATE browser_remote_workers SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    return (res as any).changes > 0;
  }

  /**
   * Modifies active jobs count on a worker.
   */
  public updateActiveJobs(id: string, delta: number): void {
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      UPDATE browser_remote_workers
      SET active_jobs = MAX(0, active_jobs + ?), updated_at = ?
      WHERE id = ?
    `).run(delta, now, id);
  }

  /**
   * Puts a worker into draining mode.
   */
  public drainWorker(id: string): boolean {
    return this.updateWorkerStatus(id, "draining");
  }

  /**
   * Deletes a worker from the registry.
   */
  public deleteWorker(id: string): boolean {
    const db = openAgentOsDb();
    const res = db.query("DELETE FROM browser_remote_workers WHERE id = ?").run(id);
    return (res as any).changes > 0;
  }

  /**
   * Detects stale workers and marks them offline.
   */
  public cullStaleWorkers(timeoutMs = 60000): number {
    const threshold = Date.now() - timeoutMs;
    const db = openAgentOsDb();
    const res = db.query(`
      UPDATE browser_remote_workers
      SET status = 'offline', updated_at = ?
      WHERE status IN ('online', 'busy') AND last_heartbeat_at < ?
    `).run(Date.now(), threshold);
    return (res as any).changes || 0;
  }

  /**
   * Computes high-level fleet statistics.
   */
  public getFleetStatus(): FleetStatus {
    const workers = this.listWorkers();
    let online = 0;
    let busy = 0;
    let offline = 0;
    let totalActiveJobs = 0;
    const regions: Record<string, number> = {};

    for (const w of workers) {
      if (w.status === "online") online++;
      else if (w.status === "busy") busy++;
      else if (w.status === "offline") offline++;

      totalActiveJobs += w.activeJobs;
      regions[w.geoRegion] = (regions[w.geoRegion] || 0) + 1;
    }

    return {
      totalWorkers: workers.length,
      onlineWorkers: online,
      busyWorkers: busy,
      offlineWorkers: offline,
      activeJobs: totalActiveJobs,
      regions,
    };
  }
}

let registryInstance: RemoteWorkerRegistry | null = null;
export function getRemoteWorkerRegistry(): RemoteWorkerRegistry {
  if (!registryInstance) {
    registryInstance = new RemoteWorkerRegistry();
  }
  return registryInstance;
}
