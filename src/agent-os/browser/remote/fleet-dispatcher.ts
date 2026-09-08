// Phase 20.14 — Pao-hubPro Fleet Dispatcher & Load Balancer
//
// Selects optimal remote browser workers based on load, geo-locality,
// and capabilities; manages job dispatches and execution records in SQLite.

import { openAgentOsDb } from "../../db";
import { getRemoteRpcClient, RemoteRpcClient } from "./rpc-client";
import { getRemoteWorkerRegistry, RemoteWorkerRegistry } from "./worker-registry";
import type {
  JobStatus,
  JobType,
  RemoteJobDispatch,
  RemoteRpcResponse,
  RemoteWorker,
} from "./types";

export class FleetDispatcher {
  private registry: RemoteWorkerRegistry;
  private rpcClient: RemoteRpcClient;
  // Local cache of raw worker auth tokens for dispatching
  private workerTokens = new Map<string, string>();

  constructor(registry?: RemoteWorkerRegistry, rpcClient?: RemoteRpcClient) {
    this.registry = registry || getRemoteWorkerRegistry();
    this.rpcClient = rpcClient || getRemoteRpcClient();
  }

  /**
   * Caches an auth token in-memory for a registered worker.
   */
  public registerWorkerToken(workerId: string, token: string): void {
    this.workerTokens.set(workerId, token);
  }

  /**
   * Selects the most optimal available remote worker node.
   */
  public selectWorker(options?: {
    geoRegion?: string;
    requiredTags?: string[];
    targetWorkerId?: string;
  }): RemoteWorker {
    // 1. Direct worker selection if requested
    if (options?.targetWorkerId) {
      const direct = this.registry.getWorker(options.targetWorkerId);
      if (!direct) {
        throw new Error(`WORKER_NOT_FOUND: Worker '${options.targetWorkerId}' does not exist.`);
      }
      if (direct.status === "offline") {
        throw new Error(`WORKER_OFFLINE: Worker '${options.targetWorkerId}' is currently offline.`);
      }
      return direct;
    }

    // Refresh staleness check first
    this.registry.cullStaleWorkers(60000);

    const workers = this.registry.listWorkers();
    const candidates = workers.filter((w) => {
      if (w.status !== "online") return false;
      if (w.activeJobs >= w.maxConcurrentJobs) return false;
      if (options?.geoRegion && options.geoRegion !== "global" && w.geoRegion !== options.geoRegion && w.geoRegion !== "global") {
        return false;
      }
      if (options?.requiredTags && options.requiredTags.length > 0) {
        const workerTags = new Set(w.capabilities.tags || []);
        for (const t of options.requiredTags) {
          if (!workerTags.has(t)) return false;
        }
      }
      return true;
    });

    if (candidates.length === 0) {
      throw new Error(
        `NO_AVAILABLE_WORKERS: No healthy browser worker found for region: ${options?.geoRegion || "any"}.`,
      );
    }

    // Pick candidate with lowest load ratio (activeJobs / maxConcurrentJobs)
    candidates.sort((a, b) => {
      const loadA = a.activeJobs / a.maxConcurrentJobs;
      const loadB = b.activeJobs / b.maxConcurrentJobs;
      return loadA - loadB;
    });

    return candidates[0];
  }

  /**
   * Dispatches a job to a selected or optimal remote worker node.
   */
  public async dispatchJob(options: {
    jobType: JobType;
    method: string;
    params: Record<string, unknown>;
    targetDomain?: string;
    geoRegion?: string;
    targetWorkerId?: string;
    authToken?: string;
  }): Promise<{ dispatch: RemoteJobDispatch; response: RemoteRpcResponse }> {
    const worker = this.selectWorker({
      geoRegion: options.geoRegion,
      targetWorkerId: options.targetWorkerId,
    });

    const token = options.authToken || this.workerTokens.get(worker.id) || "";
    if (!token) {
      throw new Error(
        `MISSING_WORKER_AUTH_TOKEN: No auth token provided or cached for worker '${worker.id}'.`,
      );
    }

    const dispatchId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const dispatch: RemoteJobDispatch = {
      id: dispatchId,
      workerId: worker.id,
      jobType: options.jobType,
      targetDomain: options.targetDomain,
      status: "running",
      payload: options.params,
      result: {},
      durationMs: 0,
      createdAt: now,
    };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_remote_job_dispatches (
        id, worker_id, job_type, target_domain, status,
        payload_json, result_json, error, duration_ms, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dispatch.id,
      dispatch.workerId,
      dispatch.jobType,
      dispatch.targetDomain || null,
      dispatch.status,
      JSON.stringify(dispatch.payload),
      JSON.stringify(dispatch.result),
      null,
      0,
      dispatch.createdAt,
      null,
    );

    this.registry.updateActiveJobs(worker.id, 1);

    try {
      const response = await this.rpcClient.call(
        worker.endpointUrl,
        token,
        options.method,
        options.params,
      );

      const completedAt = Date.now();
      const status: JobStatus = response.success ? "completed" : "failed";
      const result = (response.data as Record<string, unknown>) || {};
      const error = response.error;

      db.query(`
        UPDATE browser_remote_job_dispatches
        SET status = ?, result_json = ?, error = ?, duration_ms = ?, completed_at = ?
        WHERE id = ?
      `).run(
        status,
        JSON.stringify(result),
        error || null,
        response.durationMs,
        completedAt,
        dispatch.id,
      );

      return {
        dispatch: {
          ...dispatch,
          status,
          result,
          error,
          durationMs: response.durationMs,
          completedAt,
        },
        response,
      };
    } finally {
      this.registry.updateActiveJobs(worker.id, -1);
    }
  }

  /**
   * Retrieves a job dispatch record by ID.
   */
  public getJob(id: string): RemoteJobDispatch | null {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM browser_remote_job_dispatches WHERE id = ? LIMIT 1")
      .get(id) as Record<string, unknown> | null;

    if (!row) return null;

    let payload: Record<string, unknown> = {};
    let result: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(row.payload_json || "{}"));
    } catch {
      payload = {};
    }
    try {
      result = JSON.parse(String(row.result_json || "{}"));
    } catch {
      result = {};
    }

    return {
      id: String(row.id),
      workerId: String(row.worker_id),
      jobType: row.job_type as JobType,
      targetDomain: row.target_domain ? String(row.target_domain) : undefined,
      status: row.status as JobStatus,
      payload,
      result,
      error: row.error ? String(row.error) : undefined,
      durationMs: Number(row.duration_ms || 0),
      createdAt: Number(row.created_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }

  /**
   * Lists job dispatches with optional filtering.
   */
  public listJobs(filter?: {
    workerId?: string;
    status?: JobStatus;
    limit?: number;
  }): RemoteJobDispatch[] {
    const db = openAgentOsDb();
    const limit = filter?.limit || 50;
    let query = "SELECT * FROM browser_remote_job_dispatches WHERE 1=1";
    const params: (string | number)[] = [];

    if (filter?.workerId) {
      query += " AND worker_id = ?";
      params.push(filter.workerId);
    }
    if (filter?.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...params) as Record<string, unknown>[];

    return rows.map((r) => {
      let payload: Record<string, unknown> = {};
      let result: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(r.payload_json || "{}"));
      } catch {
        payload = {};
      }
      try {
        result = JSON.parse(String(r.result_json || "{}"));
      } catch {
        result = {};
      }

      return {
        id: String(r.id),
        workerId: String(r.worker_id),
        jobType: r.job_type as JobType,
        targetDomain: r.target_domain ? String(r.target_domain) : undefined,
        status: r.status as JobStatus,
        payload,
        result,
        error: r.error ? String(r.error) : undefined,
        durationMs: Number(r.duration_ms || 0),
        createdAt: Number(r.created_at),
        completedAt: r.completed_at ? Number(r.completed_at) : undefined,
      };
    });
  }

  /**
   * Cancels a job dispatch.
   */
  public cancelJob(id: string, reason = "Cancelled by operator"): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const res = db.query(`
      UPDATE browser_remote_job_dispatches
      SET status = 'cancelled', error = ?, completed_at = ?
      WHERE id = ? AND status IN ('pending', 'running')
    `).run(reason, now, id);
    return (res as any).changes > 0;
  }
}

let dispatcherInstance: FleetDispatcher | null = null;
export function getFleetDispatcher(): FleetDispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = new FleetDispatcher();
  }
  return dispatcherInstance;
}
