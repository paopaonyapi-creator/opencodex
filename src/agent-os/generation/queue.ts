// Phase 19 — Persistent job queue and state machine.
//
// SQLite is the queue of record (DatabaseQueueAdapter role from spec section 7).
// Claiming is a single atomic conditional UPDATE, so multiple processes cannot
// take the same job (spec section 99). There is no global busy flag anywhere.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import {
  JOB_TRANSITIONS,
  RETRYABLE_ERROR_CODES,
  RETRYABLE_STAGES,
  type GenerationAuditEntry,
  type GenerationJob,
  type GenerationJobEvent,
  type JobErrorCode,
  type JobStage,
  type JobStatus,
} from "./types";

interface JobRow {
  id: string;
  parent_job_id: string | null;
  project_id: string | null;
  user_id: string;
  idempotency_key: string | null;
  job_type: string;
  status: string;
  stage: string | null;
  priority: number;
  provider_id: string | null;
  workflow_id: string | null;
  workflow_version: number | null;
  model_id: string | null;
  prompt: string;
  negative_prompt: string;
  seed: number;
  resolved_seed: number | null;
  width: number;
  height: number;
  batch_size: number;
  input_asset_ids_json: string;
  loras_json: string;
  parameters_json: string;
  stock_mode: number;
  auto_review: number;
  auto_metadata: number;
  auto_export: number;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  run_after_ms: number;
  claimed_by: string | null;
  heartbeat_ms: number | null;
  cancel_requested: number;
  cancel_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

function rowToJob(row: JobRow): GenerationJob {
  return {
    id: row.id,
    parentJobId: row.parent_job_id,
    projectId: row.project_id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    jobType: row.job_type as GenerationJob["jobType"],
    status: row.status as JobStatus,
    stage: row.stage as JobStage | null,
    priority: row.priority,
    providerId: row.provider_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    modelId: row.model_id,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    seed: row.seed,
    resolvedSeed: row.resolved_seed,
    width: row.width,
    height: row.height,
    batchSize: row.batch_size,
    inputAssetIds: JSON.parse(row.input_asset_ids_json) as string[],
    loras: JSON.parse(row.loras_json) as Array<{ id: string; strength: number }>,
    parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
    stockMode: row.stock_mode === 1,
    autoReview: row.auto_review === 1,
    autoMetadata: row.auto_metadata === 1,
    autoExport: row.auto_export === 1,
    progress: row.progress,
    errorCode: row.error_code as JobErrorCode | null,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    runAfterMs: row.run_after_ms,
    claimedBy: row.claimed_by,
    heartbeatMs: row.heartbeat_ms,
    cancelRequested: row.cancel_requested === 1,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!(JOB_TRANSITIONS[from] as readonly JobStatus[]).includes(to)) {
    throw new Error(`invalid job transition: ${from} -> ${to}`);
  }
}

export interface CreateJobInput {
  projectId?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  jobType: GenerationJob["jobType"];
  priority?: number;
  providerId?: string | null;
  workflowId?: string | null;
  workflowVersion?: number | null;
  modelId?: string | null;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  batchSize?: number;
  inputAssetIds?: string[];
  loras?: Array<{ id: string; strength: number }>;
  parameters?: Record<string, unknown>;
  stockMode?: boolean;
  autoReview?: boolean;
  autoMetadata?: boolean;
  autoExport?: boolean;
  maxRetries?: number;
  parentJobId?: string | null;
}

export function createJob(input: CreateJobInput): { job: GenerationJob; duplicateOf?: GenerationJob } {
  const db = openAgentOsDb();
  // Idempotency (spec section 52): replay returns the ORIGINAL job.
  if (input.idempotencyKey) {
    const existing = db.query("SELECT * FROM gen_jobs WHERE idempotency_key = ?").get(input.idempotencyKey) as JobRow | undefined;
    if (existing) return { job: rowToJob(existing), duplicateOf: rowToJob(existing) };
  }
  const id = `job_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_jobs
      (id, parent_job_id, project_id, user_id, idempotency_key, job_type, status, stage,
       priority, provider_id, workflow_id, workflow_version, model_id, prompt, negative_prompt,
       seed, width, height, batch_size, input_asset_ids_json, loras_json, parameters_json,
       stock_mode, auto_review, auto_metadata, auto_export, progress, retry_count, max_retries,
       run_after_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)
  `).run(
    id, input.parentJobId ?? null, input.projectId ?? null, input.userId ?? "local",
    input.idempotencyKey ?? null, input.jobType, input.priority ?? 5,
    input.providerId ?? null, input.workflowId ?? null, input.workflowVersion ?? null,
    input.modelId ?? null, input.prompt ?? "", input.negativePrompt ?? "",
    input.seed ?? -1, input.width ?? 1024, input.height ?? 1024, input.batchSize ?? 1,
    JSON.stringify(input.inputAssetIds ?? []), JSON.stringify(input.loras ?? []),
    JSON.stringify(input.parameters ?? {}), (input.stockMode ?? false) ? 1 : 0,
    (input.autoReview ?? true) ? 1 : 0, (input.autoMetadata ?? false) ? 1 : 0,
    (input.autoExport ?? false) ? 1 : 0, input.maxRetries ?? 2, now,
  );
  const job = getJob(id)!;
  recordJobEvent(id, "queued", null, 0, `job queued (${input.jobType})`);
  return { job };
}

export function getJob(id: string): GenerationJob | null {
  const row = openAgentOsDb().query("SELECT * FROM gen_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function getJobByIdempotencyKey(key: string): GenerationJob | null {
  const row = openAgentOsDb().query("SELECT * FROM gen_jobs WHERE idempotency_key = ?").get(key) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export interface ListJobsOptions {
  projectId?: string;
  status?: JobStatus;
  jobType?: string;
  parentId?: string;
  limit?: number;
  offset?: number;
}

export function listJobs(options: ListJobsOptions = {}): { jobs: GenerationJob[]; total: number } {
  const db = openAgentOsDb();
  const where: string[] = [];
  const params: SQLBinding[] = [];
  if (options.projectId) { where.push("project_id = ?"); params.push(options.projectId); }
  if (options.status) { where.push("status = ?"); params.push(options.status); }
  if (options.jobType) { where.push("job_type = ?"); params.push(options.jobType); }
  if (options.parentId) { where.push("parent_job_id = ?"); params.push(options.parentId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.query(`SELECT COUNT(*) AS c FROM gen_jobs ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db.query(`
    SELECT * FROM gen_jobs ${whereSql}
    ORDER BY priority DESC, created_at ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as JobRow[];
  return { jobs: rows.map(rowToJob), total };
}

type SQLBinding = string | number | bigint | boolean | null | Uint8Array;

/** Atomic claim: status flip and claim stamp happen in one conditional UPDATE. */
export function claimNextJob(workerId: string): GenerationJob | null {
  const db = openAgentOsDb();
  const now = Date.now();
  const candidate = db.query(`
    SELECT id FROM gen_jobs
    WHERE status = 'queued' AND run_after_ms <= ? AND cancel_requested = 0
    ORDER BY priority DESC, run_after_ms ASC, created_at ASC, id ASC
    LIMIT 1
  `).get(now) as { id: string } | undefined;
  if (!candidate) return null;
  const result = db.query(`
    UPDATE gen_jobs SET status = 'validating', stage = 'validating',
      claimed_by = ?, heartbeat_ms = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ? AND status = 'queued'
  `).run(workerId, now, new Date().toISOString(), candidate.id);
  if (result.changes === 0) return null; // another worker won the race
  const job = getJob(candidate.id)!;
  recordJobEvent(job.id, "started", "validating", 0, `claimed by ${workerId}`);
  return job;
}

/** Atomic claim of a specific queued job (used by Smart Queue affinity scheduling). */
export function claimSpecificJob(jobId: string, workerId: string): GenerationJob | null {
  const db = openAgentOsDb();
  const now = Date.now();
  const result = db.query(`
    UPDATE gen_jobs SET status = 'validating', stage = 'validating',
      claimed_by = ?, heartbeat_ms = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ? AND status = 'queued' AND cancel_requested = 0
  `).run(workerId, now, new Date().toISOString(), jobId);
  if (result.changes === 0) return null;
  const job = getJob(jobId)!;
  recordJobEvent(job.id, "started", "validating", 0, `claimed by ${workerId}`);
  return job;
}

export interface JobUpdatePatch {
  status?: JobStatus;
  stage?: JobStage | null;
  progress?: number;
  providerId?: string | null;
  resolvedSeed?: number | null;
  errorCode?: JobErrorCode | null;
  errorMessage?: string | null;
  runAfterMs?: number;
  retryCount?: number;
  parameters?: Record<string, unknown>;
}

/**
 * Applies a guarded transition. Enforces the explicit state machine for status
 * changes; non-status fields patch freely so progress can stream without
 * violating transition rules.
 */
export function updateJob(id: string, patch: JobUpdatePatch, options: { enforceTransition?: boolean } = {}): GenerationJob {
  const db = openAgentOsDb();
  const current = getJob(id);
  if (!current) throw new Error(`job not found: ${id}`);
  if (patch.status && patch.status !== current.status && options.enforceTransition !== false) {
    assertTransition(current.status, patch.status);
  }
  const sets: string[] = [];
  const params: Array<string | number | bigint | boolean | null | Uint8Array> = [];
  if (patch.status !== undefined) { sets.push("status = ?"); params.push(patch.status); }
  if (patch.stage !== undefined) { sets.push("stage = ?"); params.push(patch.stage); }
  if (patch.progress !== undefined) { sets.push("progress = ?"); params.push(Math.min(Math.max(patch.progress, 0), 1)); }
  if (patch.providerId !== undefined) { sets.push("provider_id = ?"); params.push(patch.providerId); }
  if (patch.resolvedSeed !== undefined) { sets.push("resolved_seed = ?"); params.push(patch.resolvedSeed); }
  if (patch.errorCode !== undefined) { sets.push("error_code = ?"); params.push(patch.errorCode); }
  if (patch.errorMessage !== undefined) { sets.push("error_message = ?"); params.push(patch.errorMessage); }
  if (patch.runAfterMs !== undefined) { sets.push("run_after_ms = ?"); params.push(patch.runAfterMs); }
  if (patch.retryCount !== undefined) { sets.push("retry_count = ?"); params.push(patch.retryCount); }
  if (patch.parameters !== undefined) { sets.push("parameters_json = ?"); params.push(JSON.stringify(patch.parameters)); }
  if (patch.status === "completed") { sets.push("completed_at = ?"); params.push(new Date().toISOString()); }
  if (patch.status === "failed") { sets.push("completed_at = ?"); params.push(new Date().toISOString()); }
  if (patch.status === "cancelled") { sets.push("cancelled_at = ?"); params.push(new Date().toISOString()); }
  if (sets.length > 0) {
    db.query(`UPDATE gen_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  }
  return getJob(id)!;
}

export function requestCancel(id: string, reason: string): GenerationJob | null {
  const db = openAgentOsDb();
  const current = getJob(id);
  if (!current) return null;
  const terminal = current.status === "completed" || current.status === "cancelled" || current.status === "failed";
  if (terminal) return current;
  if (current.status === "queued" || current.status === "draft" || current.status === "paused") {
    // Never started: cancel outright.
    assertTransition(current.status, "cancelled");
    db.query("UPDATE gen_jobs SET status = 'cancelled', cancel_requested = 1, cancel_reason = ?, cancelled_at = ? WHERE id = ?")
      .run(reason, new Date().toISOString(), id);
    recordJobEvent(id, "cancelled", null, current.progress, reason);
    return getJob(id);
  }
  db.query("UPDATE gen_jobs SET cancel_requested = 1, cancel_reason = ? WHERE id = ?").run(reason, id);
  recordJobEvent(id, "cancelled", current.stage, current.progress, `cancellation requested: ${reason}`);
  return getJob(id);
}

/** Returns null when the failure is not retryable or retries are exhausted. */
export function retryFailedJob(id: string, errorCode: JobErrorCode, message: string): GenerationJob | null {
  const db = openAgentOsDb();
  const current = getJob(id);
  if (!current) return null;
  if (current.cancelRequested) return null;
  const retryable = (RETRYABLE_ERROR_CODES as readonly string[]).includes(errorCode);
  if (!retryable || current.retryCount >= current.maxRetries) {
    assertTransition(current.status, "failed");
    db.query("UPDATE gen_jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?")
      .run(errorCode, message, new Date().toISOString(), id);
    recordJobEvent(id, "failed", current.stage, current.progress, `${errorCode}: ${message}`);
    return getJob(id);
  }
  // Spec section 6: failure path is stage -> failed -> retry -> same stage.
  // Both hops are explicit transitions; the retry row then re-enters the queue.
  assertTransition(current.status, "failed");
  db.query("UPDATE gen_jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?")
    .run(errorCode, message, new Date().toISOString(), id);
  recordJobEvent(id, "failed", current.stage, current.progress, `${errorCode}: ${message} (retry scheduled)`);
  // Exponential backoff: 2s, 4s, 8s...
  const backoffMs = 2_000 * 2 ** current.retryCount;
  const retryStage = current.stage && (RETRYABLE_STAGES as readonly string[]).includes(current.stage) ? current.stage : "preparing";
  assertTransition("failed", "queued");
  db.query(`
    UPDATE gen_jobs SET status = 'queued', stage = ?, error_code = NULL, error_message = NULL,
      retry_count = retry_count + 1, run_after_ms = ? WHERE id = ?
  `).run(retryStage, Date.now() + backoffMs, id);
  recordJobEvent(id, "queued", retryStage, current.progress, `retry ${current.retryCount + 1}/${current.maxRetries} after ${errorCode}`);
  return getJob(id);
}

export function heartbeatJob(id: string, workerId: string): boolean {
  const result = openAgentOsDb()
    .query("UPDATE gen_jobs SET heartbeat_ms = ? WHERE id = ? AND claimed_by = ? AND status NOT IN ('completed', 'failed', 'cancelled')")
    .run(Date.now(), id, workerId);
  return result.changes > 0;
}

/** Recovery sweep: stale claims (dead worker) go back to queued for retry. */
export function recoverStaleJobs(staleThresholdMs = 120_000): number {
  const cutoff = Date.now() - staleThresholdMs;
  const rows = openAgentOsDb().query(`
    SELECT id, retry_count, max_retries, stage, error_code, error_message FROM gen_jobs
    WHERE status IN ('validating', 'preparing', 'generating', 'post_processing', 'reviewing', 'qc', 'metadata', 'exporting')
      AND (heartbeat_ms IS NULL OR heartbeat_ms < ?)
  `).all(cutoff) as Array<{ id: string; retry_count: number; max_retries: number; stage: string | null; error_code: string | null; error_message: string | null }>;
  let recovered = 0;
  for (const row of rows) {
    const result = retryFailedJob(
      row.id,
      (row.error_code as JobErrorCode) ?? "provider_timeout",
      row.error_message ?? "worker heartbeat lost — recovered by restart sweep",
    );
    if (result && result.status === "queued") recovered++;
  }
  return recovered;
}

export function listChildren(parentId: string): GenerationJob[] {
  return listJobs({ parentId, limit: 100 }).jobs;
}

// ---------------------------------------------------------------- events

export function recordJobEvent(jobId: string, type: string, stage: string | null, progress: number | null, message: string): void {
  openAgentOsDb()
    .query("INSERT INTO gen_job_events (job_id, ts_ms, type, stage, progress, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(jobId, Date.now(), type, stage, progress, message.slice(0, 500));
}

export function listJobEvents(jobId: string, afterId = 0): GenerationJobEvent[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM gen_job_events WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT 500")
    .all(jobId, afterId) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: row.id as number,
    jobId: row.job_id as string,
    tsMs: row.ts_ms as number,
    type: row.type as string,
    stage: (row.stage as string | null) ?? null,
    progress: (row.progress as number | null) ?? null,
    message: row.message as string,
  }));
}

export function listEventsForJobs(jobIds: string[], afterId = 0): GenerationJobEvent[] {
  if (jobIds.length === 0) return [];
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = openAgentOsDb()
    .query(`SELECT * FROM gen_job_events WHERE job_id IN (${placeholders}) AND id > ? ORDER BY id ASC LIMIT 1000`)
    .all(...jobIds, afterId) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: row.id as number,
    jobId: row.job_id as string,
    tsMs: row.ts_ms as number,
    type: row.type as string,
    stage: (row.stage as string | null) ?? null,
    progress: (row.progress as number | null) ?? null,
    message: row.message as string,
  }));
}

export function trimOldJobEvents(retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = openAgentOsDb().query("DELETE FROM gen_job_events WHERE ts_ms < ?").run(cutoff);
  return result.changes;
}

// ---------------------------------------------------------------- audit

export function recordGenerationAudit(input: {
  actor: string;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  details?: Record<string, unknown>;
}): void {
  openAgentOsDb()
    .query("INSERT INTO gen_audit_log (ts_ms, actor, action, subject_type, subject_id, details_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Date.now(), input.actor, input.action, input.subjectType ?? null, input.subjectId ?? null, JSON.stringify(input.details ?? {}));
}

export function listGenerationAudit(limit = 100): GenerationAuditEntry[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM gen_audit_log ORDER BY ts_ms DESC, id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: row.id as number,
    tsMs: row.ts_ms as number,
    actor: row.actor as string,
    action: row.action as string,
    subjectType: (row.subject_type as string | null) ?? null,
    subjectId: (row.subject_id as string | null) ?? null,
    details: JSON.parse(row.details_json as string) as Record<string, unknown>,
  }));
}
