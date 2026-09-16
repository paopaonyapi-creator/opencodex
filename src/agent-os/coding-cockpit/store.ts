// Phase 20.39 — CockpitStore: persistence for the unified coding workspace on
// the shared agent-os SQLite store (schema v39, additive). Literal single-line
// SQL with positional parameters only; upserts are read-then-write against
// unique indexes. Secrets never reach these columns unredacted — callers use
// ./redaction first.

import { openAgentOsDb } from "../db";
import {
  CockpitError,
  type AgentEventEnvelope,
  type AgentRun,
  type ApprovalRequest,
  type AuditEvent,
  type ContextReference,
  type NormalizedAgentEvent,
  type ProviderInstanceRecord,
  type ProviderRecord,
  type RunArtifact,
  type ToolExecution,
  type UnifiedSession,
  type UsageRecord,
  type Workspace,
  type WorkspaceWriterLock,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export class CockpitStore {
  private db = openAgentOsDb();

  // --- Workspaces -----------------------------------------------------------------

  insertWorkspace(ws: Omit<Workspace, "id" | "createdAt" | "updatedAt" | "status" | "lastOpenedAt"> & { status?: Workspace["status"]; lastOpenedAt?: string | null }): Workspace {
    const record: Workspace = {
      ...ws,
      id: shortId("ws"),
      status: ws.status ?? "ACTIVE",
      lastOpenedAt: ws.lastOpenedAt ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.db
      .query("INSERT INTO cc_workspaces (id, name, slug, root_path, normalized_root_path, git_remote_url, git_branch, git_head_sha, trust_level, status, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.name, record.slug, record.rootPath, record.normalizedRootPath, record.gitRemoteUrl, record.gitBranch, record.gitHeadSha, record.trustLevel, record.status, record.createdAt, record.updatedAt, record.lastOpenedAt);
    return record;
  }

  findWorkspaceByNormalizedRoot(normalizedRootPath: string): Workspace | null {
    const row = this.db.query("SELECT * FROM cc_workspaces WHERE normalized_root_path = ? AND status = 'ACTIVE'").get(normalizedRootPath) as Record<string, unknown> | null;
    return row ? mapWorkspace(row) : null;
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.query("SELECT * FROM cc_workspaces WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapWorkspace(row) : null;
  }

  requireWorkspace(id: string): Workspace {
    const ws = this.getWorkspace(id);
    if (!ws) throw new CockpitError("WORKSPACE_NOT_FOUND", "workspace not found: " + id);
    return ws;
  }

  listWorkspaces(): Workspace[] {
    const rows = this.db.query("SELECT * FROM cc_workspaces WHERE status = 'ACTIVE' ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map(mapWorkspace);
  }

  updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "trustLevel" | "status" | "gitRemoteUrl" | "gitBranch" | "gitHeadSha" | "lastOpenedAt">>): void {
    const existing = this.requireWorkspace(id);
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .query("UPDATE cc_workspaces SET name = ?, trust_level = ?, status = ?, git_remote_url = ?, git_branch = ?, git_head_sha = ?, last_opened_at = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.trustLevel, next.status, next.gitRemoteUrl, next.gitBranch, next.gitHeadSha, next.lastOpenedAt, next.updatedAt, id);
  }

  // --- Providers ---------------------------------------------------------------------

  upsertProvider(provider: Pick<ProviderRecord, "id" | "displayName" | "adapterType"> & { enabled?: boolean; configJson?: string }): ProviderRecord {
    const existing = this.db.query("SELECT * FROM cc_providers WHERE id = ?").get(provider.id) as Record<string, unknown> | null;
    if (existing) {
      this.db
        .query("UPDATE cc_providers SET display_name = ?, adapter_type = ?, enabled = ?, updated_at = ? WHERE id = ?")
        .run(provider.displayName, provider.adapterType, provider.enabled === false ? 0 : 1, nowIso(), provider.id);
    } else {
      this.db
        .query("INSERT INTO cc_providers (id, display_name, adapter_type, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(provider.id, provider.displayName, provider.adapterType, provider.enabled === false ? 0 : 1, provider.configJson ?? "{}", nowIso(), nowIso());
    }
    return this.getProvider(provider.id) as ProviderRecord;
  }

  getProvider(id: string): ProviderRecord | null {
    const row = this.db.query("SELECT * FROM cc_providers WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapProvider(row) : null;
  }

  listProviders(): ProviderRecord[] {
    const rows = this.db.query("SELECT * FROM cc_providers ORDER BY id").all() as Array<Record<string, unknown>>;
    return rows.map(mapProvider);
  }

  saveProviderInstance(instance: Omit<ProviderInstanceRecord, "id">): ProviderInstanceRecord {
    const existing = this.db.query("SELECT * FROM cc_provider_instances WHERE provider_id = ? AND instance_key = ?").get(instance.providerId, instance.instanceKey) as Record<string, unknown> | null;
    if (existing) {
      this.db
        .query("UPDATE cc_provider_instances SET version = ?, status = ?, capabilities_json = ?, last_probe_at = ?, metadata_json = ? WHERE id = ?")
        .run(instance.version, instance.status, instance.capabilitiesJson, instance.lastProbeAt, instance.metadataJson, String(existing.id));
      return this.getProviderInstance(String(existing.id)) as ProviderInstanceRecord;
    }
    const id = shortId("cpi");
    this.db
      .query("INSERT INTO cc_provider_instances (id, provider_id, instance_key, version, status, capabilities_json, last_probe_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, instance.providerId, instance.instanceKey, instance.version, instance.status, instance.capabilitiesJson, instance.lastProbeAt, instance.metadataJson);
    return this.getProviderInstance(id) as ProviderInstanceRecord;
  }

  getProviderInstance(id: string): ProviderInstanceRecord | null {
    const row = this.db.query("SELECT * FROM cc_provider_instances WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapProviderInstance(row) : null;
  }

  listProviderInstances(providerId?: string): ProviderInstanceRecord[] {
    const rows = providerId
      ? (this.db.query("SELECT * FROM cc_provider_instances WHERE provider_id = ? ORDER BY instance_key").all(providerId) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM cc_provider_instances ORDER BY provider_id, instance_key").all() as Array<Record<string, unknown>>);
    return rows.map(mapProviderInstance);
  }

  // --- Sessions -------------------------------------------------------------------------

  insertSession(session: Omit<UnifiedSession, "id" | "createdAt" | "updatedAt"> & { id?: string }): UnifiedSession {
    const record: UnifiedSession = {
      ...session,
      id: session.id ?? shortId("phs"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.db
      .query("INSERT INTO cc_sessions (id, workspace_id, provider_id, native_session_id, parent_session_id, title, status, mode, writer_state, started_at, ended_at, last_activity_at, native_metadata_json, capabilities_json, resume_token_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.workspaceId, record.providerId, record.nativeSessionId, record.parentSessionId, record.title, record.status, record.mode, record.writerState, record.startedAt, record.endedAt, record.lastActivityAt, record.nativeMetadataJson, record.capabilitiesJson, record.resumeTokenRef, record.createdAt, record.updatedAt);
    return record;
  }

  getSession(id: string): UnifiedSession | null {
    const row = this.db.query("SELECT * FROM cc_sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapSession(row) : null;
  }

  requireSession(id: string): UnifiedSession {
    const session = this.getSession(id);
    if (!session) throw new CockpitError("SESSION_NOT_FOUND", "session not found: " + id);
    return session;
  }

  findSessionByNativeId(providerId: string, nativeSessionId: string, workspaceId: string): UnifiedSession | null {
    const row = this.db.query("SELECT * FROM cc_sessions WHERE provider_id = ? AND native_session_id = ? AND workspace_id = ? LIMIT 1").get(providerId, nativeSessionId, workspaceId) as Record<string, unknown> | null;
    return row ? mapSession(row) : null;
  }

  listSessions(filter: { workspaceId?: string; providerId?: string; statuses?: string[]; limit?: number } = {}): UnifiedSession[] {
    const limit = filter.limit ?? 200;
    let rows: Array<Record<string, unknown>>;
    if (filter.workspaceId) {
      rows = this.db.query("SELECT * FROM cc_sessions WHERE workspace_id = ? ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?").all(filter.workspaceId, limit) as Array<Record<string, unknown>>;
    } else if (filter.providerId) {
      rows = this.db.query("SELECT * FROM cc_sessions WHERE provider_id = ? ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?").all(filter.providerId, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.query("SELECT * FROM cc_sessions ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    let mapped = rows.map(mapSession);
    // Status sets come from the closed SessionStatus union; filter in JS so no
    // SQL fragment is ever assembled from caller input.
    if (filter.statuses && filter.statuses.length > 0) {
      const allowed = new Set(filter.statuses);
      mapped = mapped.filter((session) => allowed.has(session.status));
    }
    return mapped;
  }

  updateSession(id: string, patch: Partial<Omit<UnifiedSession, "id" | "createdAt">>): UnifiedSession {
    const existing = this.requireSession(id);
    const next: UnifiedSession = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .query("UPDATE cc_sessions SET native_session_id = ?, parent_session_id = ?, title = ?, status = ?, mode = ?, writer_state = ?, started_at = ?, ended_at = ?, last_activity_at = ?, native_metadata_json = ?, capabilities_json = ?, resume_token_ref = ?, updated_at = ? WHERE id = ?")
      .run(next.nativeSessionId, next.parentSessionId, next.title, next.status, next.mode, next.writerState, next.startedAt, next.endedAt, next.lastActivityAt, next.nativeMetadataJson, next.capabilitiesJson, next.resumeTokenRef, next.updatedAt, id);
    return next;
  }

  countDuplicateNativeIds(): number {
    const row = this.db.query("SELECT COUNT(*) AS n FROM (SELECT provider_id, native_session_id FROM cc_sessions WHERE native_session_id IS NOT NULL GROUP BY provider_id, native_session_id HAVING COUNT(*) > 1)").get() as { n: number };
    return row.n;
  }

  // --- Session events (idempotent on (session_id, sequence)) -------------------------------

  insertEvent(envelope: Omit<AgentEventEnvelope, "id" | "timestamp" | "workspaceId" | "providerId"> & { id?: string; timestamp?: string }): AgentEventEnvelope {
    const id = envelope.id ?? shortId("cev");
    const timestamp = envelope.timestamp ?? nowIso();
    this.db
      .query("INSERT INTO cc_session_events (id, session_id, run_id, sequence, type, payload_json, raw_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, envelope.sessionId, envelope.runId, envelope.sequence, envelope.type, JSON.stringify(envelope.payload), envelope.rawRef, timestamp);
    return {
      ...envelope,
      id,
      timestamp,
      workspaceId: "",
      providerId: "",
    };
  }

  findEventBySequence(sessionId: string, sequence: number): AgentEventEnvelope | null {
    const row = this.db.query("SELECT * FROM cc_session_events WHERE session_id = ? AND sequence = ?").get(sessionId, sequence) as Record<string, unknown> | null;
    return row ? mapEvent(row) : null;
  }

  maxSequence(sessionId: string): number {
    const row = this.db.query("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM cc_session_events WHERE session_id = ?").get(sessionId) as { max_seq: number };
    return Number(row.max_seq) || 0;
  }

  listEvents(sessionId: string, afterSequence = 0, limit = 500): AgentEventEnvelope[] {
    const rows = this.db.query("SELECT * FROM cc_session_events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?").all(sessionId, afterSequence, limit) as Array<Record<string, unknown>>;
    return rows.map(mapEvent);
  }

  // --- Runs ----------------------------------------------------------------------------------

  insertRun(run: Omit<AgentRun, "id" | "startedAt" | "completedAt"> & { id?: string; startedAt?: string; completedAt?: string | null }): AgentRun {
    const record: AgentRun = { ...run, id: run.id ?? shortId("run"), startedAt: run.startedAt ?? nowIso(), completedAt: run.completedAt ?? null };
    this.db
      .query("INSERT INTO cc_runs (id, session_id, workspace_id, provider_id, status, started_at, completed_at, error_code, error_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.sessionId, record.workspaceId, record.providerId, record.status, record.startedAt, record.completedAt, record.errorCode, record.errorSummary);
    return record;
  }

  getRun(id: string): AgentRun | null {
    const row = this.db.query("SELECT * FROM cc_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRun(row) : null;
  }

  updateRun(id: string, patch: Partial<Pick<AgentRun, "status" | "completedAt" | "errorCode" | "errorSummary">>): void {
    const existing = this.getRun(id);
    if (!existing) throw new CockpitError("NOT_FOUND", "run not found: " + id);
    const next = { ...existing, ...patch };
    this.db
      .query("UPDATE cc_runs SET status = ?, completed_at = ?, error_code = ?, error_summary = ? WHERE id = ?")
      .run(next.status, next.completedAt, next.errorCode, next.errorSummary, id);
  }

  listRuns(filter: { sessionId?: string; workspaceId?: string; limit?: number } = {}): AgentRun[] {
    const limit = filter.limit ?? 100;
    const rows = filter.sessionId
      ? (this.db.query("SELECT * FROM cc_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT ?").all(filter.sessionId, limit) as Array<Record<string, unknown>>)
      : filter.workspaceId
        ? (this.db.query("SELECT * FROM cc_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?").all(filter.workspaceId, limit) as Array<Record<string, unknown>>)
        : (this.db.query("SELECT * FROM cc_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    return rows.map(mapRun);
  }

  // --- Tool executions --------------------------------------------------------------------------

  insertToolExecution(execution: Omit<ToolExecution, "id" | "startedAt" | "completedAt"> & { id?: string; startedAt?: string; completedAt?: string | null }): ToolExecution {
    const record: ToolExecution = { ...execution, id: execution.id ?? shortId("tool"), startedAt: execution.startedAt ?? nowIso(), completedAt: execution.completedAt ?? null };
    this.db
      .query("INSERT INTO cc_tool_executions (id, run_id, session_id, tool_name, action_type, status, risk_score, approval_request_id, input_json, output_summary, exit_code, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.runId, record.sessionId, record.toolName, record.actionType, record.status, record.riskScore, record.approvalRequestId, record.inputJson, record.outputSummary, record.exitCode, record.startedAt, record.completedAt);
    return record;
  }

  updateToolExecution(id: string, patch: Partial<Pick<ToolExecution, "status" | "riskScore" | "approvalRequestId" | "outputSummary" | "exitCode" | "completedAt">>): void {
    const existing = this.db.query("SELECT * FROM cc_tool_executions WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!existing) throw new CockpitError("NOT_FOUND", "tool execution not found: " + id);
    const merged = { ...mapToolExecution(existing), ...patch };
    this.db
      .query("UPDATE cc_tool_executions SET status = ?, risk_score = ?, approval_request_id = ?, output_summary = ?, exit_code = ?, completed_at = ? WHERE id = ?")
      .run(merged.status, merged.riskScore, merged.approvalRequestId, merged.outputSummary, merged.exitCode, merged.completedAt, id);
  }

  getToolExecution(id: string): ToolExecution | null {
    const row = this.db.query("SELECT * FROM cc_tool_executions WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapToolExecution(row) : null;
  }

  listToolExecutions(filter: { sessionId?: string; runId?: string; limit?: number } = {}): ToolExecution[] {
    const limit = filter.limit ?? 200;
    const rows = filter.runId
      ? (this.db.query("SELECT * FROM cc_tool_executions WHERE run_id = ? ORDER BY started_at ASC LIMIT ?").all(filter.runId, limit) as Array<Record<string, unknown>>)
      : filter.sessionId
        ? (this.db.query("SELECT * FROM cc_tool_executions WHERE session_id = ? ORDER BY started_at ASC LIMIT ?").all(filter.sessionId, limit) as Array<Record<string, unknown>>)
        : (this.db.query("SELECT * FROM cc_tool_executions ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    return rows.map(mapToolExecution);
  }

  // --- Approvals -----------------------------------------------------------------------------------

  insertApproval(approval: Omit<ApprovalRequest, "id" | "requestedAt"> & { id?: string; requestedAt?: string }): ApprovalRequest {
    const record: ApprovalRequest = { ...approval, id: approval.id ?? shortId("apr"), requestedAt: approval.requestedAt ?? nowIso() };
    this.db
      .query("INSERT INTO cc_approvals (id, session_id, workspace_id, action_type, summary, normalized_input_json, input_hash, risk_score, reasons_json, status, requested_at, expires_at, decided_at, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.sessionId, record.workspaceId, record.actionType, record.summary, record.normalizedInputJson, record.inputHash, record.riskScore, record.reasonsJson, record.status, record.requestedAt, record.expiresAt, record.decidedAt, record.decidedBy);
    return record;
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db.query("SELECT * FROM cc_approvals WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapApproval(row) : null;
  }

  updateApprovalStatus(id: string, status: ApprovalRequest["status"], decidedBy: string | null): ApprovalRequest {
    const existing = this.getApproval(id);
    if (!existing) throw new CockpitError("NOT_FOUND", "approval not found: " + id);
    this.db
      .query("UPDATE cc_approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?")
      .run(status, nowIso(), decidedBy, id);
    return { ...existing, status, decidedAt: nowIso(), decidedBy };
  }

  listApprovals(filter: { status?: string; sessionId?: string; workspaceId?: string; limit?: number } = {}): ApprovalRequest[] {
    const limit = filter.limit ?? 100;
    const rows = filter.status
      ? (this.db.query("SELECT * FROM cc_approvals WHERE status = ? ORDER BY requested_at DESC LIMIT ?").all(filter.status, limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM cc_approvals ORDER BY requested_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    let mapped = rows.map(mapApproval);
    if (filter.sessionId) mapped = mapped.filter((a) => a.sessionId === filter.sessionId);
    if (filter.workspaceId) mapped = mapped.filter((a) => a.workspaceId === filter.workspaceId);
    return mapped;
  }

  expireStaleApprovals(nowMs: number): number {
    const pending = this.listApprovals({ status: "PENDING", limit: 1000 });
    let expired = 0;
    for (const approval of pending) {
      if (approval.expiresAt && Date.parse(approval.expiresAt) < nowMs) {
        this.updateApprovalStatus(approval.id, "EXPIRED", null);
        expired += 1;
      }
    }
    return expired;
  }

  // --- Writer locks -----------------------------------------------------------------------------------

  insertLock(lock: Omit<WorkspaceWriterLock, "id" | "acquiredAt" | "heartbeatAt"> & { id?: string }): WorkspaceWriterLock {
    const record: WorkspaceWriterLock = {
      ...lock,
      id: lock.id ?? shortId("cwl"),
      acquiredAt: nowIso(),
      heartbeatAt: nowIso(),
    };
    this.db
      .query("INSERT INTO cc_locks (id, workspace_id, session_id, owner_instance_id, status, acquired_at, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.workspaceId, record.sessionId, record.ownerInstanceId, record.status, record.acquiredAt, record.heartbeatAt, record.expiresAt);
    return record;
  }

  getActiveLock(workspaceId: string): WorkspaceWriterLock | null {
    const row = this.db.query("SELECT * FROM cc_locks WHERE workspace_id = ? AND status = 'ACTIVE' LIMIT 1").get(workspaceId) as Record<string, unknown> | null;
    return row ? mapLock(row) : null;
  }

  getLock(id: string): WorkspaceWriterLock | null {
    const row = this.db.query("SELECT * FROM cc_locks WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapLock(row) : null;
  }

  updateLockStatus(id: string, status: WorkspaceWriterLock["status"]): void {
    this.db.query("UPDATE cc_locks SET status = ? WHERE id = ?").run(status, id);
  }

  heartbeatLock(id: string, expiresAt: string): void {
    this.db.query("UPDATE cc_locks SET heartbeat_at = ?, expires_at = ? WHERE id = ? AND status = 'ACTIVE'").run(nowIso(), expiresAt, id);
  }

  /** Reclaim every lease whose expiry has passed. Returns reclaimed count. */
  expireLocks(nowMs: number): number {
    const rows = this.db.query("SELECT * FROM cc_locks WHERE status = 'ACTIVE'").all() as Array<Record<string, unknown>>;
    let expired = 0;
    for (const row of rows) {
      const lock = mapLock(row);
      if (Date.parse(lock.expiresAt) < nowMs) {
        this.updateLockStatus(lock.id, "EXPIRED");
        expired += 1;
      }
    }
    return expired;
  }

  // --- Usage ---------------------------------------------------------------------------------------------

  insertUsage(record: Omit<UsageRecord, "id" | "recordedAt"> & { id?: string; recordedAt?: string }): UsageRecord {
    const full: UsageRecord = { ...record, id: record.id ?? shortId("usg"), recordedAt: record.recordedAt ?? nowIso() };
    this.db
      .query("INSERT INTO cc_usage (id, session_id, provider_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, reported_cost_usd, estimated_cost_usd, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(full.id, full.sessionId, full.providerId, full.model, full.inputTokens, full.outputTokens, full.cacheReadTokens, full.cacheWriteTokens, full.reasoningTokens, full.reportedCostUsd, full.estimatedCostUsd, full.source, full.recordedAt);
    return full;
  }

  listUsage(filter: { sessionId?: string; providerId?: string; sinceIso?: string; limit?: number } = {}): UsageRecord[] {
    const limit = filter.limit ?? 1000;
    const rows = filter.sessionId
      ? (this.db.query("SELECT * FROM cc_usage WHERE session_id = ? ORDER BY recorded_at DESC LIMIT ?").all(filter.sessionId, limit) as Array<Record<string, unknown>>)
      : filter.sinceIso
        ? (this.db.query("SELECT * FROM cc_usage WHERE recorded_at >= ? ORDER BY recorded_at DESC LIMIT ?").all(filter.sinceIso, limit) as Array<Record<string, unknown>>)
        : (this.db.query("SELECT * FROM cc_usage ORDER BY recorded_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    let mapped = rows.map(mapUsage);
    if (filter.providerId) mapped = mapped.filter((u) => u.providerId === filter.providerId);
    return mapped;
  }

  // --- Artifacts --------------------------------------------------------------------------------------------

  insertArtifact(artifact: Omit<RunArtifact, "id" | "createdAt"> & { id?: string; createdAt?: string }): RunArtifact {
    const record: RunArtifact = { ...artifact, id: artifact.id ?? shortId("art"), createdAt: artifact.createdAt ?? nowIso() };
    this.db
      .query("INSERT INTO cc_artifacts (id, run_id, workspace_id, type, label, relative_path, mime_type, size_bytes, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.runId, record.workspaceId, record.type, record.label, record.relativePath, record.mimeType, record.sizeBytes, record.metadataJson, record.createdAt);
    return record;
  }

  listArtifacts(filter: { runId?: string; workspaceId?: string; limit?: number } = {}): RunArtifact[] {
    const limit = filter.limit ?? 200;
    const rows = filter.runId
      ? (this.db.query("SELECT * FROM cc_artifacts WHERE run_id = ? ORDER BY created_at DESC LIMIT ?").all(filter.runId, limit) as Array<Record<string, unknown>>)
      : filter.workspaceId
        ? (this.db.query("SELECT * FROM cc_artifacts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(filter.workspaceId, limit) as Array<Record<string, unknown>>)
        : (this.db.query("SELECT * FROM cc_artifacts ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    return rows.map(mapArtifact);
  }

  // --- Context references --------------------------------------------------------------------------------------

  insertContextRef(ref: Omit<ContextReference, "id"> & { id?: string }): ContextReference {
    const id = ref.id ?? shortId("ctx");
    const record: ContextReference = { ...ref, id };
    this.db
      .query("INSERT INTO cc_context_refs (id, type, label, workspace_id, target_id, path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, record.type, record.label, record.workspaceId ?? null, record.targetId ?? null, record.path ?? null, record.metadata ? JSON.stringify(record.metadata) : null, nowIso());
    return record;
  }

  listContextRefs(filter: { type?: string; workspaceId?: string; limit?: number } = {}): ContextReference[] {
    const limit = filter.limit ?? 200;
    const rows = filter.type
      ? (this.db.query("SELECT * FROM cc_context_refs WHERE type = ? ORDER BY created_at DESC LIMIT ?").all(filter.type, limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM cc_context_refs ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    let mapped = rows.map(mapContextRef);
    if (filter.workspaceId) mapped = mapped.filter((r) => r.workspaceId === filter.workspaceId);
    return mapped;
  }

  // --- Audit ------------------------------------------------------------------------------------------------------

  insertAudit(event: Omit<AuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): AuditEvent {
    const record: AuditEvent = { ...event, id: event.id ?? shortId("aud"), createdAt: event.createdAt ?? nowIso() };
    this.db
      .query("INSERT INTO cc_audit (id, actor_id, workspace_id, session_id, run_id, provider_id, event_type, severity, action, decision, risk_score, summary, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.actorId, record.workspaceId, record.sessionId, record.runId, record.providerId, record.eventType, record.severity, record.action, record.decision, record.riskScore, record.summary, record.metadataJson, record.createdAt);
    return record;
  }

  listAudit(filter: { sessionId?: string; workspaceId?: string; eventType?: string; limit?: number } = {}): AuditEvent[] {
    const limit = filter.limit ?? 200;
    const rows = filter.eventType
      ? (this.db.query("SELECT * FROM cc_audit WHERE event_type = ? ORDER BY created_at DESC LIMIT ?").all(filter.eventType, limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM cc_audit ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    let mapped = rows.map(mapAudit);
    if (filter.sessionId) mapped = mapped.filter((a) => a.sessionId === filter.sessionId);
    if (filter.workspaceId) mapped = mapped.filter((a) => a.workspaceId === filter.workspaceId);
    return mapped;
  }
}

// --- Row mappers (snake_case → camelCase) ---------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value);
}
function num(value: unknown): number | null {
  return typeof value === "number" ? value : value == null ? null : Number(value);
}

function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    rootPath: String(row.root_path),
    normalizedRootPath: String(row.normalized_root_path),
    gitRemoteUrl: str(row.git_remote_url),
    gitBranch: str(row.git_branch),
    gitHeadSha: str(row.git_head_sha),
    trustLevel: String(row.trust_level) as Workspace["trustLevel"],
    status: String(row.status) as Workspace["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: str(row.last_opened_at),
  };
}

function mapProvider(row: Record<string, unknown>): ProviderRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    adapterType: String(row.adapter_type) as ProviderRecord["adapterType"],
    enabled: Number(row.enabled) === 1,
    configJson: String(row.config_json ?? "{}"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProviderInstance(row: Record<string, unknown>): ProviderInstanceRecord {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    instanceKey: String(row.instance_key),
    version: str(row.version),
    status: String(row.status) as ProviderInstanceRecord["status"],
    capabilitiesJson: String(row.capabilities_json ?? "{}"),
    lastProbeAt: str(row.last_probe_at),
    metadataJson: str(row.metadata_json),
  };
}

function mapSession(row: Record<string, unknown>): UnifiedSession {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    providerId: String(row.provider_id),
    nativeSessionId: str(row.native_session_id),
    parentSessionId: str(row.parent_session_id),
    title: String(row.title),
    status: String(row.status) as UnifiedSession["status"],
    mode: String(row.mode) as UnifiedSession["mode"],
    writerState: String(row.writer_state) as UnifiedSession["writerState"],
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
    lastActivityAt: str(row.last_activity_at),
    nativeMetadataJson: str(row.native_metadata_json),
    capabilitiesJson: str(row.capabilities_json),
    resumeTokenRef: str(row.resume_token_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEvent(row: Record<string, unknown>): AgentEventEnvelope {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runId: str(row.run_id),
    sequence: Number(row.sequence),
    type: String(row.type) as NormalizedAgentEvent["type"],
    payload: JSON.parse(String(row.payload_json)) as NormalizedAgentEvent,
    rawRef: str(row.raw_ref),
    workspaceId: "",
    providerId: "",
    timestamp: String(row.created_at),
  };
}

function mapRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    workspaceId: String(row.workspace_id),
    providerId: String(row.provider_id),
    status: String(row.status) as AgentRun["status"],
    startedAt: String(row.started_at),
    completedAt: str(row.completed_at),
    errorCode: str(row.error_code),
    errorSummary: str(row.error_summary),
  };
}

function mapToolExecution(row: Record<string, unknown>): ToolExecution {
  return {
    id: String(row.id),
    runId: str(row.run_id),
    sessionId: String(row.session_id),
    toolName: String(row.tool_name),
    actionType: String(row.action_type) as ToolExecution["actionType"],
    status: String(row.status) as ToolExecution["status"],
    riskScore: num(row.risk_score),
    approvalRequestId: str(row.approval_request_id),
    inputJson: str(row.input_json),
    outputSummary: str(row.output_summary),
    exitCode: num(row.exit_code),
    startedAt: String(row.started_at),
    completedAt: str(row.completed_at),
  };
}

function mapApproval(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    workspaceId: String(row.workspace_id),
    actionType: String(row.action_type) as ApprovalRequest["actionType"],
    summary: String(row.summary),
    normalizedInputJson: String(row.normalized_input_json),
    inputHash: String(row.input_hash),
    riskScore: Number(row.risk_score),
    reasonsJson: String(row.reasons_json),
    status: String(row.status) as ApprovalRequest["status"],
    requestedAt: String(row.requested_at),
    expiresAt: str(row.expires_at),
    decidedAt: str(row.decided_at),
    decidedBy: str(row.decided_by),
  };
}

function mapLock(row: Record<string, unknown>): WorkspaceWriterLock {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    ownerInstanceId: String(row.owner_instance_id),
    status: String(row.status) as WorkspaceWriterLock["status"],
    acquiredAt: String(row.acquired_at),
    heartbeatAt: String(row.heartbeat_at),
    expiresAt: String(row.expires_at),
  };
}

function mapUsage(row: Record<string, unknown>): UsageRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    providerId: String(row.provider_id),
    model: str(row.model),
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    cacheReadTokens: num(row.cache_read_tokens),
    cacheWriteTokens: num(row.cache_write_tokens),
    reasoningTokens: num(row.reasoning_tokens),
    reportedCostUsd: num(row.reported_cost_usd),
    estimatedCostUsd: num(row.estimated_cost_usd),
    source: String(row.source) as UsageRecord["source"],
    recordedAt: String(row.recorded_at),
  };
}

function mapArtifact(row: Record<string, unknown>): RunArtifact {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    workspaceId: String(row.workspace_id),
    type: String(row.type) as RunArtifact["type"],
    label: String(row.label),
    relativePath: str(row.relative_path),
    mimeType: str(row.mime_type),
    sizeBytes: num(row.size_bytes),
    metadataJson: str(row.metadata_json),
    createdAt: String(row.created_at),
  };
}

function mapContextRef(row: Record<string, unknown>): ContextReference {
  return {
    id: String(row.id),
    type: String(row.type) as ContextReference["type"],
    label: String(row.label),
    workspaceId: str(row.workspace_id),
    targetId: str(row.target_id),
    path: str(row.path),
    metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : null,
  };
}

function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    actorId: str(row.actor_id),
    workspaceId: str(row.workspace_id),
    sessionId: str(row.session_id),
    runId: str(row.run_id),
    providerId: str(row.provider_id),
    eventType: String(row.event_type),
    severity: String(row.severity) as AuditEvent["severity"],
    action: String(row.action),
    decision: str(row.decision),
    riskScore: num(row.risk_score),
    summary: String(row.summary),
    metadataJson: str(row.metadata_json),
    createdAt: String(row.created_at),
  };
}
