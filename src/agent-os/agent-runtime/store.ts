// Phase 20.61 — Agent Runtime store (ar_* tables).
//
// Canonical Pao-hubPro state; the amux database is never authoritative
// (spec §1). Static SQL literals with bound parameters only — no dynamic SQL
// construction, no SQL string concatenation. Wide rows insert in two short
// statements.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  AgentRuntimeEvent,
  AgentRuntimeEventType,
  AgentTask,
  AgentWorkerConfig,
  ApprovalRequest,
  TaskCheckpoint,
  TaskEvidence,
  TaskStatus,
  WorkerRole,
} from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

function numOrNull(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return Number(value);
}

function json<T>(row: Row, key: string, fallback: T): T {
  const raw = row[key];
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function emptyCheckpoint(): TaskCheckpoint {
  return { status: "running", summary: "", completedSteps: [], nextStep: null, changedFiles: [], commandsRun: [], evidenceIds: [], blockers: [], updatedAt: nowIso() };
}

function rowToTask(row: Row): AgentTask {
  return {
    id: str(row, "id"),
    parentTaskId: strOrNull(row, "parent_task_id"),
    title: str(row, "title"),
    description: str(row, "description"),
    acceptanceCriteria: json<string[]>(row, "acceptance_json", []),
    status: str(row, "status") as TaskStatus,
    priority: Number(row["priority"] ?? 50),
    role: str(row, "role") as WorkerRole,
    claimOwner: strOrNull(row, "claim_owner"),
    claimToken: strOrNull(row, "claim_token"),
    claimVersion: Number(row["claim_version"] ?? 0),
    claimedAt: strOrNull(row, "claimed_at"),
    leaseExpiresAt: strOrNull(row, "lease_expires_at"),
    heartbeatAt: strOrNull(row, "heartbeat_at"),
    attempt: Number(row["attempt"] ?? 0),
    maxAttempts: Number(row["max_attempts"] ?? 3),
    runtimeProvider: strOrNull(row, "runtime_provider"),
    runtimeTaskId: strOrNull(row, "runtime_task_id"),
    runtimeSessionId: strOrNull(row, "runtime_session_id"),
    policyProfile: str(row, "policy_profile"),
    requiresHumanApproval: Number(row["requires_human_approval"] ?? 1) === 1,
    repoRoot: strOrNull(row, "repo_root"),
    worktreePath: strOrNull(row, "worktree_path"),
    branch: strOrNull(row, "branch"),
    checkpoint: json<TaskCheckpoint>(row, "checkpoint_json", emptyCheckpoint()),
    createdByType: str(row, "created_by_type") as AgentTask["createdByType"],
    createdById: str(row, "created_by_id"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToWorker(row: Row): AgentWorkerConfig {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    provider: str(row, "provider"),
    roles: json<WorkerRole[]>(row, "roles_json", []),
    capabilities: json<AgentWorkerConfig["capabilities"]>(row, "capabilities_json", []),
    maxConcurrency: Number(row["max_concurrency"] ?? 1),
    status: str(row, "status") as AgentWorkerConfig["status"],
    runtimeWorkerId: strOrNull(row, "runtime_worker_id"),
    lastSeenAt: strOrNull(row, "last_seen_at"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToEvidence(row: Row): TaskEvidence {
  return {
    id: str(row, "id"),
    taskId: str(row, "task_id"),
    evidenceType: str(row, "evidence_type") as TaskEvidence["evidenceType"],
    uri: strOrNull(row, "uri"),
    sha256: strOrNull(row, "sha256"),
    metadata: json<Record<string, unknown>>(row, "metadata_json", {}),
    createdBy: str(row, "created_by"),
    createdAt: str(row, "created_at"),
  };
}

function rowToApproval(row: Row): ApprovalRequest {
  return {
    id: str(row, "id"),
    taskId: str(row, "task_id"),
    action: str(row, "action"),
    riskLevel: str(row, "risk_level") as ApprovalRequest["riskLevel"],
    status: str(row, "status") as ApprovalRequest["status"],
    requestedBy: str(row, "requested_by"),
    requestedAt: str(row, "requested_at"),
    decidedBy: strOrNull(row, "decided_by"),
    decidedAt: strOrNull(row, "decided_at"),
    decisionReason: strOrNull(row, "decision_reason"),
    payloadHash: str(row, "payload_hash"),
  };
}

function rowToEvent(row: Row): AgentRuntimeEvent {
  return {
    id: str(row, "id"),
    eventType: str(row, "event_type") as AgentRuntimeEventType,
    taskId: strOrNull(row, "task_id"),
    sessionId: strOrNull(row, "session_id"),
    source: str(row, "source"),
    idempotencyKey: str(row, "idempotency_key"),
    payload: json<Record<string, unknown>>(row, "payload_json", {}),
    occurredAt: str(row, "occurred_at"),
  };
}

export class AgentRuntimeStore {
  // --- tasks ---

  insertTask(task: AgentTask): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_tasks (id, parent_task_id, title, description, acceptance_json, status, priority, role, attempt, max_attempts, policy_profile, requires_human_approval, repo_root, created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        task.id, task.parentTaskId, task.title, task.description, JSON.stringify(task.acceptanceCriteria),
        task.status, task.priority, task.role, task.attempt, task.maxAttempts, task.policyProfile,
        task.requiresHumanApproval ? 1 : 0, task.repoRoot, task.createdByType, task.createdById,
        task.createdAt, task.updatedAt,
      );
  }

  getTask(id: string): AgentTask | null {
    const row = openAgentOsDb().query("SELECT * FROM ar_tasks WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToTask(row);
  }

  listTasks(filter?: { status?: string }): AgentTask[] {
    if (filter?.status) {
      const scoped = openAgentOsDb().query("SELECT * FROM ar_tasks WHERE status = ? ORDER BY priority, created_at").all(filter.status);
      return (scoped as Row[]).map(rowToTask);
    }
    const rows = openAgentOsDb().query("SELECT * FROM ar_tasks ORDER BY created_at DESC LIMIT 500").all();
    return (rows as Row[]).map(rowToTask);
  }

  /** Atomic claim: exactly one affected row means exactly one owner. */
  claimTaskAtomic(input: {
    taskId: string;
    workerId: string;
    claimToken: string;
    leaseExpiresAt: string;
  }): { claimed: boolean; task: AgentTask | null } {
    const db = openAgentOsDb();
    const result = db
      .query(
        "UPDATE ar_tasks SET status = 'claimed', claim_owner = ?, claim_token = ?, claim_version = claim_version + 1, claimed_at = ?, lease_expires_at = ?, attempt = attempt + 1, updated_at = ? WHERE id = ? AND status = 'queued' AND claim_owner IS NULL",
      )
      .run(input.workerId, input.claimToken, nowIso(), input.leaseExpiresAt, nowIso(), input.taskId);
    if (Number(result.changes) !== 1) {
      return { claimed: false, task: this.getTask(input.taskId) };
    }
    return { claimed: true, task: this.getTask(input.taskId) };
  }

  /** Lease reclaim by the recovery controller only (spec §3). */
  reclaimExpiredLease(input: { taskId: string; nowIso: string }): AgentTask | null {
    const db = openAgentOsDb();
    const result = db
      .query(
        "UPDATE ar_tasks SET status = 'queued', claim_owner = NULL, claim_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status IN ('claimed', 'running') AND lease_expires_at <= ?",
      )
      .run(input.nowIso, input.taskId, input.nowIso);
    if (Number(result.changes) !== 1) return null;
    return this.getTask(input.taskId);
  }

  heartbeat(taskId: string, workerId: string, claimToken: string, leaseExpiresAt: string): boolean {
    const result = openAgentOsDb()
      .query(
        "UPDATE ar_tasks SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND claim_owner = ? AND claim_token = ? AND status = 'running'",
      )
      .run(nowIso(), leaseExpiresAt, nowIso(), taskId, workerId, claimToken);
    return Number(result.changes) === 1;
  }

  /** Guarded status mutation; stale claim tokens cannot overwrite newer state. */
  updateTaskStatus(input: { taskId: string; status: TaskStatus; expectClaimToken?: string | null; expectVersion?: number }): AgentTask {
    const task = this.getTask(input.taskId);
    if (!task) throw new Error("task not found: " + input.taskId);
    if (input.expectVersion !== undefined && task.claimVersion !== input.expectVersion) {
      throw new Error("stale claim version");
    }
    if (input.expectClaimToken !== undefined && input.expectClaimToken !== null && task.claimToken !== input.expectClaimToken) {
      throw new Error("stale claim token");
    }
    openAgentOsDb().query("UPDATE ar_tasks SET status = ?, updated_at = ? WHERE id = ?").run(input.status, nowIso(), input.taskId);
    return this.getTask(input.taskId)!;
  }

  updateTask(id: string, patch: Partial<Pick<AgentTask, "status" | "runtimeProvider" | "runtimeTaskId" | "runtimeSessionId" | "worktreePath" | "branch" | "checkpoint" | "priority">>): void {
    const task = this.getTask(id);
    if (!task) return;
    const status = patch.status ?? task.status;
    const runtimeProvider = patch.runtimeProvider !== undefined ? patch.runtimeProvider : task.runtimeProvider;
    const runtimeTaskId = patch.runtimeTaskId !== undefined ? patch.runtimeTaskId : task.runtimeTaskId;
    const runtimeSessionId = patch.runtimeSessionId !== undefined ? patch.runtimeSessionId : task.runtimeSessionId;
    const worktreePath = patch.worktreePath !== undefined ? patch.worktreePath : task.worktreePath;
    const branch = patch.branch !== undefined ? patch.branch : task.branch;
    const checkpointJson = JSON.stringify(patch.checkpoint ?? task.checkpoint);
    const priority = patch.priority ?? task.priority;
    openAgentOsDb()
      .query(
        "UPDATE ar_tasks SET status = ?, runtime_provider = ?, runtime_task_id = ?, runtime_session_id = ?, worktree_path = ?, branch = ?, checkpoint_json = ?, priority = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, runtimeProvider, runtimeTaskId, runtimeSessionId, worktreePath, branch, checkpointJson, priority, nowIso(), id);
  }

  // --- workers ---

  insertWorker(worker: AgentWorkerConfig): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_workers (id, name, provider, roles_json, capabilities_json, max_concurrency, status, runtime_worker_id, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        worker.id, worker.name, worker.provider, JSON.stringify(worker.roles), JSON.stringify(worker.capabilities),
        worker.maxConcurrency, worker.status, worker.runtimeWorkerId, worker.lastSeenAt, worker.createdAt, worker.updatedAt,
      );
  }

  getWorker(id: string): AgentWorkerConfig | null {
    const row = openAgentOsDb().query("SELECT * FROM ar_workers WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToWorker(row);
  }

  findWorkerByName(name: string): AgentWorkerConfig | null {
    const row = openAgentOsDb().query("SELECT * FROM ar_workers WHERE name = ?").get(name) as Row | null;
    if (!row) return null;
    return rowToWorker(row);
  }

  listWorkers(): AgentWorkerConfig[] {
    const rows = openAgentOsDb().query("SELECT * FROM ar_workers ORDER BY name").all();
    return (rows as Row[]).map(rowToWorker);
  }

  updateWorkerRuntime(id: string, patch: { status?: string; runtimeWorkerId?: string | null; lastSeenAt?: string | null }): void {
    const worker = this.getWorker(id);
    if (!worker) return;
    const status = patch.status ?? worker.status;
    const runtimeWorkerId = patch.runtimeWorkerId !== undefined ? patch.runtimeWorkerId : worker.runtimeWorkerId;
    const lastSeenAt = patch.lastSeenAt !== undefined ? patch.lastSeenAt : worker.lastSeenAt;
    openAgentOsDb().query("UPDATE ar_workers SET status = ?, runtime_worker_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run(status, runtimeWorkerId, lastSeenAt, nowIso(), id);
  }

  // --- sessions ---

  insertSession(session: { id: string; taskId: string; workerId: string; runtimeSessionId: string; status: string; attempt: number }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_sessions (id, task_id, worker_id, runtime_session_id, status, attempt, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(session.id, session.taskId, session.workerId, session.runtimeSessionId, session.status, session.attempt, nowIso());
  }

  getSession(id: string): Row | null {
    return openAgentOsDb().query("SELECT * FROM ar_sessions WHERE id = ?").get(id) as Row | null;
  }

  listSessions(filter?: { taskId?: string; status?: string }): Array<Record<string, unknown>> {
    if (filter?.taskId) {
      return (openAgentOsDb().query("SELECT * FROM ar_sessions WHERE task_id = ? ORDER BY started_at DESC").all(filter.taskId) as Row[]);
    }
    if (filter?.status) {
      return (openAgentOsDb().query("SELECT * FROM ar_sessions WHERE status = ? ORDER BY started_at DESC").all(filter.status) as Row[]);
    }
    return (openAgentOsDb().query("SELECT * FROM ar_sessions ORDER BY started_at DESC LIMIT 500").all() as Row[]);
  }

  updateSessionStatus(id: string, status: string, exitReason?: string | null): void {
    openAgentOsDb().query("UPDATE ar_sessions SET status = ?, ended_at = ?, exit_reason = ? WHERE id = ?")
      .run(status, nowIso(), exitReason ?? null, id);
  }

  updateSessionRuntime(id: string, runtimeSessionId: string, status: string): void {
    openAgentOsDb().query("UPDATE ar_sessions SET runtime_session_id = ?, status = ? WHERE id = ?").run(runtimeSessionId, status, id);
  }

  // --- evidence ---

  insertEvidence(evidence: TaskEvidence): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_task_evidence (id, task_id, evidence_type, uri, sha256, metadata_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        evidence.id, evidence.taskId, evidence.evidenceType, evidence.uri, evidence.sha256,
        JSON.stringify(evidence.metadata), evidence.createdBy, evidence.createdAt,
      );
  }

  listEvidence(taskId: string): TaskEvidence[] {
    const rows = openAgentOsDb().query("SELECT * FROM ar_task_evidence WHERE task_id = ? ORDER BY created_at").all(taskId);
    return (rows as Row[]).map(rowToEvidence);
  }

  // --- approvals ---

  insertApproval(approval: ApprovalRequest): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_approval_requests (id, task_id, action, risk_level, status, requested_by, requested_at, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approval.id, approval.taskId, approval.action, approval.riskLevel, approval.status,
        approval.requestedBy, approval.requestedAt, approval.payloadHash,
      );
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = openAgentOsDb().query("SELECT * FROM ar_approval_requests WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToApproval(row);
  }

  latestApprovalForPayload(taskId: string, action: string, payloadHash: string): ApprovalRequest | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM ar_approval_requests WHERE task_id = ? AND action = ? AND payload_hash = ? ORDER BY requested_at DESC LIMIT 1")
      .get(taskId, action, payloadHash) as Row | null;
    if (!row) return null;
    return rowToApproval(row);
  }

  decideApproval(id: string, status: "approved" | "rejected" | "stale", decidedBy: string, reason: string | null): void {
    openAgentOsDb().query("UPDATE ar_approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?")
      .run(status, decidedBy, nowIso(), reason, id);
  }

  listApprovals(filter?: { status?: string }): ApprovalRequest[] {
    if (filter?.status) {
      const scoped = openAgentOsDb().query("SELECT * FROM ar_approval_requests WHERE status = ? ORDER BY requested_at DESC").all(filter.status);
      return (scoped as Row[]).map(rowToApproval);
    }
    const rows = openAgentOsDb().query("SELECT * FROM ar_approval_requests ORDER BY requested_at DESC LIMIT 200").all();
    return (rows as Row[]).map(rowToApproval);
  }

  // --- events (stored before broadcast; idempotent by key) ---

  insertEvent(event: AgentRuntimeEvent): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO ar_events (id, event_type, task_id, session_id, source, idempotency_key, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.id, event.eventType, event.taskId, event.sessionId, event.source,
        event.idempotencyKey, JSON.stringify(event.payload), event.occurredAt,
      );
    return Number(result.changes) > 0;
  }

  listEvents(filter?: { taskId?: string; limit?: number }): AgentRuntimeEvent[] {
    const limit = filter?.limit ?? 200;
    if (filter?.taskId) {
      const scoped = openAgentOsDb().query("SELECT * FROM ar_events WHERE task_id = ? ORDER BY occurred_at DESC LIMIT ?").all(filter.taskId, limit);
      return (scoped as Row[]).map(rowToEvent);
    }
    const rows = openAgentOsDb().query("SELECT * FROM ar_events ORDER BY occurred_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map(rowToEvent);
  }

  // --- idempotency ---

  findIdempotentResponse<T>(key: string): T | null {
    const row = openAgentOsDb().query("SELECT * FROM ar_idempotency_keys WHERE key = ?").get(key) as Row | null;
    if (!row) return null;
    return json<T | null>(row, "response_json", null);
  }

  recordIdempotentResponse(key: string, operation: string, requestHash: string, response: unknown): void {
    openAgentOsDb()
      .query(
        "INSERT OR REPLACE INTO ar_idempotency_keys (key, operation, request_hash, response_json, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'completed', ?, ?)",
      )
      .run(key, operation, requestHash, JSON.stringify(response ?? null), new Date(Date.now() + 24 * 3600_000).toISOString(), nowIso());
  }

  // --- audit ---

  appendAudit(entry: {
    taskId?: string | null;
    sessionId?: string | null;
    actorType: string;
    actorId: string;
    action: string;
    decision: string;
    requestHash?: string | null;
    details?: Record<string, unknown>;
  }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ar_execution_audit (id, task_id, session_id, actor_type, actor_id, action, decision, request_hash, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newId("ara"), entry.taskId ?? null, entry.sessionId ?? null, entry.actorType, entry.actorId,
        entry.action, entry.decision, entry.requestHash ?? null, JSON.stringify(entry.details ?? {}), nowIso(),
      );
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM ar_execution_audit ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      taskId: strOrNull(row, "task_id"),
      sessionId: strOrNull(row, "session_id"),
      actorType: str(row, "actor_type"),
      actorId: str(row, "actor_id"),
      action: str(row, "action"),
      decision: str(row, "decision"),
      requestHash: strOrNull(row, "request_hash"),
      details: json<Record<string, unknown>>(row, "details_json", {}),
      createdAt: str(row, "created_at"),
    }));
  }
}
