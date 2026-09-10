// Phase 20.18 — Pao Grok Production Bridge: persistence and restart recovery.
//
// Additive tables on the existing Agent OS SQLite handle, matching every other
// phase subsystem in this repository.
//
// RECONCILIATION IS THE POINT OF THIS FILE. When Chrome closes, or the extension
// reloads, or the bridge restarts mid-generation, the system cannot know whether a
// generation completed. The spec is explicit that it must never resubmit in that
// state, and it must never guess. So an in-flight job is moved to `needs_review`
// and a human looks at it. That is slower than guessing and it is the only choice
// that cannot silently duplicate work or silently lose it.

import { openAgentOsDb } from "../db";
import {
  type BrowserJobState,
  type ExecutionMode,
  type GenerationJobRecord,
  type GenerationRequest,
  type GenerationResultRecord,
  type GrokErrorCode,
  type MediaType,
  type ProviderCapabilities,
  type GrokPageType,
  assertBrowserTransition,
  isInFlight,
  newJobId,
  nowIso,
} from "./types";

export interface ProviderSessionRecord {
  readonly provider: string;
  readonly status: "connected" | "disconnected";
  readonly extensionVersion: string | null;
  readonly pageType: GrokPageType;
  readonly lastHeartbeat: string | null;
  readonly capabilities: ProviderCapabilities | null;
}

export interface ReconcileOutcome {
  readonly resumed: readonly string[];
  readonly needsReview: readonly string[];
  readonly detail: string;
}

export class GrokBridgeStore {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    openAgentOsDb().exec(`
      CREATE TABLE IF NOT EXISTS br_jobs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        media_type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        requested_count INTEGER NOT NULL DEFAULT 1,
        aspect_ratio TEXT,
        project TEXT,
        reference_paths_json TEXT NOT NULL DEFAULT '[]',
        auto_download INTEGER NOT NULL DEFAULT 1,
        execution_mode TEXT NOT NULL DEFAULT 'assisted',
        priority INTEGER NOT NULL DEFAULT 5,
        state TEXT NOT NULL DEFAULT 'queued',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_br_jobs_state ON br_jobs(state);
      CREATE INDEX IF NOT EXISTS idx_br_jobs_priority ON br_jobs(priority, created_at);

      CREATE TABLE IF NOT EXISTS br_results (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        media_type TEXT NOT NULL,
        result_index INTEGER NOT NULL DEFAULT 0,
        source_url TEXT,
        local_path TEXT,
        width INTEGER,
        height INTEGER,
        duration_sec REAL,
        prompt TEXT NOT NULL DEFAULT '',
        sha256 TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_br_results_job ON br_results(job_id);

      CREATE TABLE IF NOT EXISTS br_provider_sessions (
        provider TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'disconnected',
        extension_version TEXT,
        page_type TEXT NOT NULL DEFAULT 'unknown',
        last_heartbeat TEXT,
        capabilities_json TEXT
      );

      CREATE TABLE IF NOT EXISTS br_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        job_id TEXT,
        action TEXT NOT NULL,
        provider TEXT,
        extension_version TEXT,
        page_type TEXT,
        status_before TEXT,
        status_after TEXT,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_br_audit_job ON br_audit(job_id);
      CREATE INDEX IF NOT EXISTS idx_br_audit_ts ON br_audit(ts_ms);
    `);
    this.initialized = true;
  }

  getDb(): ReturnType<typeof openAgentOsDb> {
    this.init();
    return openAgentOsDb();
  }

  // -- Jobs ----------------------------------------------------------------

  createJob(request: GenerationRequest): GenerationJobRecord {
    this.init();
    const now = nowIso();
    const id = newJobId();
    openAgentOsDb().query(
      `INSERT INTO br_jobs (id, provider, media_type, prompt, negative_prompt, requested_count,
         aspect_ratio, project, reference_paths_json, auto_download, execution_mode, priority,
         state, attempt, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 3, ?, ?)`,
    ).run(
      id,
      request.provider,
      request.mediaType,
      request.prompt,
      request.negativePrompt ?? "",
      request.count,
      request.aspectRatio ?? null,
      request.project ?? null,
      JSON.stringify(request.referencePaths ?? []),
      request.autoDownload === false ? 0 : 1,
      request.executionMode ?? "assisted",
      request.priority ?? 5,
      now,
      now,
    );
    return this.getJob(id)!;
  }

  getJob(id: string): GenerationJobRecord | null {
    this.init();
    const row = openAgentOsDb().query("SELECT * FROM br_jobs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapJob(row) : null;
  }

  listJobs(state?: BrowserJobState, limit = 200): GenerationJobRecord[] {
    this.init();
    const db = openAgentOsDb();
    const rows = state
      ? (db.query("SELECT * FROM br_jobs WHERE state = ? ORDER BY priority ASC, created_at ASC LIMIT ?").all(state, limit) as Record<string, unknown>[])
      : (db.query("SELECT * FROM br_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map(mapJob);
  }

  /**
   * Move a job to a new state, refusing an illegal transition.
   *
   * The transition table is enforced here rather than trusted to callers: a state
   * machine that callers may skip is documentation, not a control.
   */
  setState(id: string, state: BrowserJobState, patch: { errorCode?: GrokErrorCode | null; errorMessage?: string | null } = {}): GenerationJobRecord {
    this.init();
    const current = this.getJob(id);
    if (!current) throw new Error(`Unknown job ${id}`);
    if (current.state !== state) assertBrowserTransition(current.state, state);

    const now = nowIso();
    const startedAt = state === "preparing" && !current.startedAt ? now : current.startedAt;
    const completedAt = state === "completed" || state === "cancelled" ? now : current.completedAt;
    openAgentOsDb().query(
      `UPDATE br_jobs SET state = ?, error_code = ?, error_message = ?, updated_at = ?,
         started_at = ?, completed_at = ? WHERE id = ?`,
    ).run(
      state,
      patch.errorCode === undefined ? current.errorCode : patch.errorCode,
      patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
      now,
      startedAt,
      completedAt,
      id,
    );
    this.audit({ jobId: id, action: "state_change", statusBefore: current.state, statusAfter: state, errorCode: patch.errorCode ?? null });
    return this.getJob(id)!;
  }

  incrementAttempt(id: string): GenerationJobRecord {
    this.init();
    openAgentOsDb().query("UPDATE br_jobs SET attempt = attempt + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
    return this.getJob(id)!;
  }

  // -- Results -------------------------------------------------------------

  addResult(result: GenerationResultRecord): GenerationResultRecord {
    this.init();
    openAgentOsDb().query(
      `INSERT INTO br_results (id, job_id, provider, media_type, result_index, source_url, local_path,
         width, height, duration_sec, prompt, sha256, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      result.id,
      result.jobId,
      result.provider,
      result.mediaType,
      result.index,
      result.sourceUrl,
      result.localPath,
      result.width,
      result.height,
      result.durationSec,
      result.prompt,
      result.sha256,
      JSON.stringify(result.metadata),
      result.createdAt,
    );
    return result;
  }

  listResults(jobId: string): GenerationResultRecord[] {
    this.init();
    const rows = openAgentOsDb()
      .query("SELECT * FROM br_results WHERE job_id = ? ORDER BY result_index ASC")
      .all(jobId) as Record<string, unknown>[];
    return rows.map(mapResult);
  }

  // -- Sessions ------------------------------------------------------------

  upsertSession(session: ProviderSessionRecord): void {
    this.init();
    openAgentOsDb().query(
      `INSERT INTO br_provider_sessions (provider, status, extension_version, page_type, last_heartbeat, capabilities_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         status = excluded.status,
         extension_version = excluded.extension_version,
         page_type = excluded.page_type,
         last_heartbeat = excluded.last_heartbeat,
         capabilities_json = excluded.capabilities_json`,
    ).run(
      session.provider,
      session.status,
      session.extensionVersion,
      session.pageType,
      session.lastHeartbeat,
      session.capabilities ? JSON.stringify(session.capabilities) : null,
    );
  }

  getSession(provider: string): ProviderSessionRecord | null {
    this.init();
    const row = openAgentOsDb()
      .query("SELECT * FROM br_provider_sessions WHERE provider = ?")
      .get(provider) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      provider: String(row.provider),
      status: String(row.status) as "connected" | "disconnected",
      extensionVersion: row.extension_version ? String(row.extension_version) : null,
      pageType: String(row.page_type) as GrokPageType,
      lastHeartbeat: row.last_heartbeat ? String(row.last_heartbeat) : null,
      capabilities: row.capabilities_json ? (JSON.parse(String(row.capabilities_json)) as ProviderCapabilities) : null,
    };
  }

  // -- Audit ---------------------------------------------------------------

  audit(input: {
    jobId?: string | null;
    action: string;
    provider?: string | null;
    extensionVersion?: string | null;
    pageType?: string | null;
    statusBefore?: string | null;
    statusAfter?: string | null;
    errorCode?: string | null;
  }): void {
    this.init();
    openAgentOsDb().query(
      `INSERT INTO br_audit (ts_ms, job_id, action, provider, extension_version, page_type, status_before, status_after, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      Date.now(),
      input.jobId ?? null,
      input.action,
      input.provider ?? null,
      input.extensionVersion ?? null,
      input.pageType ?? null,
      input.statusBefore ?? null,
      input.statusAfter ?? null,
      input.errorCode ?? null,
    );
  }

  listAudit(limit = 200): Record<string, unknown>[] {
    this.init();
    return openAgentOsDb()
      .query("SELECT * FROM br_audit ORDER BY ts_ms DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
  }

  // -- Restart recovery ----------------------------------------------------

  /**
   * Reconcile after a restart.
   *
   * Three groups, and the middle one is the reason this function exists:
   *
   *  - `queued` and `waiting_browser` jobs are safe to resume. Nothing was sent to
   *    the browser, so there is no ambiguity.
   *  - IN-FLIGHT jobs move to `needs_review`. The system genuinely does not know
   *    whether the generation completed, and the spec forbids resubmitting in that
   *    state. A human resolves it.
   *  - Blocked and waiting_user jobs stay where they are; a restart does not clear
   *    a CAPTCHA.
   */
  reconcileAfterRestart(): ReconcileOutcome {
    this.init();
    const resumed: string[] = [];
    const needsReview: string[] = [];

    for (const job of this.listJobs(undefined, 500)) {
      if (job.state === "queued" || job.state === "waiting_browser") {
        if (job.state === "waiting_browser") resumed.push(job.id);
        continue;
      }
      if (isInFlight(job.state)) {
        // Straight to needs_review, NOT to failed. A failed job is retryable by the
        // queue, and retrying something that may already have generated is exactly
        // the duplicate the spec forbids.
        const before = job.state;
        openAgentOsDb().query(
          "UPDATE br_jobs SET state = 'needs_review', error_message = ?, updated_at = ? WHERE id = ?",
        ).run(
          `Interrupted during '${before}' by a restart; the outcome is unknown and must be checked before any retry.`,
          nowIso(),
          job.id,
        );
        this.audit({ jobId: job.id, action: "reconcile", statusBefore: before, statusAfter: "needs_review" });
        needsReview.push(job.id);
      }
    }

    return {
      resumed,
      needsReview,
      detail: `${resumed.length} job(s) resume safely; ${needsReview.length} moved to needs_review because their outcome is unknown.`,
    };
  }

  /** Test seam. */
  reset(): void {
    this.init();
    openAgentOsDb().exec("DELETE FROM br_jobs; DELETE FROM br_results; DELETE FROM br_provider_sessions; DELETE FROM br_audit;");
  }
}

function mapJob(row: Record<string, unknown>): GenerationJobRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    mediaType: String(row.media_type) as MediaType,
    prompt: String(row.prompt),
    negativePrompt: String(row.negative_prompt ?? ""),
    count: Number(row.requested_count ?? 1),
    aspectRatio: row.aspect_ratio ? String(row.aspect_ratio) : null,
    project: row.project ? String(row.project) : null,
    referencePaths: JSON.parse(String(row.reference_paths_json ?? "[]")),
    autoDownload: Number(row.auto_download) === 1,
    executionMode: String(row.execution_mode ?? "assisted") as ExecutionMode,
    priority: Number(row.priority ?? 5),
    state: String(row.state) as BrowserJobState,
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    errorCode: row.error_code ? (String(row.error_code) as GrokErrorCode) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapResult(row: Record<string, unknown>): GenerationResultRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    provider: String(row.provider),
    mediaType: String(row.media_type) as MediaType,
    index: Number(row.result_index ?? 0),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    localPath: row.local_path ? String(row.local_path) : null,
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    durationSec: row.duration_sec === null || row.duration_sec === undefined ? null : Number(row.duration_sec),
    prompt: String(row.prompt ?? ""),
    sha256: row.sha256 ? String(row.sha256) : null,
    createdAt: String(row.created_at),
    metadata: JSON.parse(String(row.metadata_json ?? "{}")),
  };
}

let defaultStore: GrokBridgeStore | null = null;

export function getGrokBridgeStore(): GrokBridgeStore {
  if (!defaultStore) defaultStore = new GrokBridgeStore();
  return defaultStore;
}

export function resetGrokBridgeStore(): void {
  defaultStore = null;
}
