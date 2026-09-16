/**
 * Pao Context Control Plane — governance persistence (Phase 20.53 §48-60).
 *
 * Stores INTEGRATION AND GOVERNANCE metadata only — never a duplicate of
 * OpenViking content. Query-safety rules for this file: every SQL string is
 * a compile-time constant kept deliberately short (upserts are expressed as
 * an INSERT-or-ignore followed by a targeted UPDATE), caller-controlled
 * values bind exclusively to `?` placeholders, and DDL is a fixed statement
 * list.
 */

import { openAgentOsDb } from "../db";
import type {
  AgentHandoffPackage,
  ContextAuditEvent,
  ContextSessionBinding,
  ExperienceGovernanceRecord,
  MemoryGovernanceRecord,
  MemoryReviewRecord,
  SuppressionRule,
} from "./types";

const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS context_backends (
    id TEXT PRIMARY KEY,
    backend_type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    server_version TEXT,
    compatibility TEXT NOT NULL DEFAULT 'unknown',
    capabilities_json TEXT,
    last_health_at TEXT,
    last_health_state TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_locator TEXT NOT NULL,
    source_revision TEXT,
    context_class TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    target_uri TEXT NOT NULL,
    workspace_id TEXT,
    owner_user_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    current_checksum TEXT,
    last_ingested_at TEXT,
    last_verified_at TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_context_source_identity
    ON context_sources(source_type, source_locator, target_uri)`,
  `CREATE TABLE IF NOT EXISTS context_ingest_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_revision TEXT,
    checksum TEXT,
    status TEXT NOT NULL,
    openviking_task_id TEXT,
    target_uri TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    error_message TEXT,
    correlation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_job_source ON context_ingest_jobs(source_id)`,
  `CREATE TABLE IF NOT EXISTS context_retrieval_runs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    agent_id TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    query_preview TEXT,
    budget_profile TEXT,
    status TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    l2_count INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    trace_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_retrieval_hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retrieval_run_id TEXT NOT NULL,
    uri TEXT NOT NULL,
    context_class TEXT,
    level TEXT,
    score REAL,
    rank INTEGER,
    allowed INTEGER NOT NULL,
    exclusion_reason TEXT,
    reason_code TEXT,
    estimated_tokens INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_hits_run ON context_retrieval_hits(retrieval_run_id)`,
  `CREATE TABLE IF NOT EXISTS context_session_bindings (
    id TEXT PRIMARY KEY,
    pao_conversation_id TEXT NOT NULL,
    pao_run_id TEXT,
    openviking_session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    agent_id TEXT NOT NULL,
    peer_id TEXT,
    memory_policy_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_memory_governance (
    id TEXT PRIMARY KEY,
    memory_uri TEXT NOT NULL,
    memory_type TEXT,
    owner_user_id TEXT,
    workspace_id TEXT,
    peer_id TEXT,
    review_state TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    suppressed INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'normal',
    source_session_id TEXT,
    content_preview TEXT,
    last_verified_at TEXT,
    expires_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_context_memory_uri
    ON context_memory_governance(memory_uri)`,
  `CREATE TABLE IF NOT EXISTS context_memory_reviews (
    id TEXT PRIMARY KEY,
    governance_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reviewer_type TEXT NOT NULL,
    reviewer_id TEXT,
    reason TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_memory_suppressions (
    id TEXT PRIMARY KEY,
    field TEXT NOT NULL,
    pattern TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_experience_governance (
    id TEXT PRIMARY KEY,
    experience_uri TEXT NOT NULL,
    workspace_id TEXT,
    reuse_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    human_approved INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    last_used_at TEXT,
    last_validated_at TEXT,
    status TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_handoffs (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    summary TEXT NOT NULL,
    context_refs_json TEXT NOT NULL,
    pending_actions_json TEXT,
    constraints_json TEXT,
    provenance_json TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    user_id TEXT,
    workspace_id TEXT,
    agent_id TEXT,
    resource_uri TEXT,
    reason_code TEXT,
    metadata_json TEXT,
    correlation_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_audit_corr ON context_audit_events(correlation_id)`,
  `CREATE TABLE IF NOT EXISTS context_backup_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    artifact_hash TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL
  )`,
];

export interface SourceRow {
  id: string;
  sourceType: string;
  sourceLocator: string;
  sourceRevision?: string;
  contextClass: string;
  sensitivity: string;
  targetUri: string;
  workspaceId?: string;
  ownerUserId?: string;
  enabled: boolean;
  currentChecksum?: string;
  lastIngestedAt?: string;
}

export type IngestJobStatus =
  | "queued"
  | "sanitizing"
  | "blocked"
  | "submitted"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

const ACTIVE_JOB_STATUSES: readonly string[] = ["queued", "sanitizing", "submitted", "processing", "ready"];
const TERMINAL_JOB_STATUSES: readonly string[] = ["ready", "failed", "cancelled", "blocked"];

export interface IngestJobRow {
  id: string;
  sourceId: string;
  checksum?: string;
  status: IngestJobStatus;
  openVikingTaskId?: string;
  targetUri?: string;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
  createdAt: string;
}

export class ContextDbStore {
  private initialized = false;

  init(): boolean {
    if (this.initialized) return true;
    try {
      const db = openAgentOsDb();
      for (const statement of DDL_STATEMENTS) {
        db.run(statement);
      }
      this.initialized = true;
    } catch {
      this.initialized = false;
    }
    return this.initialized;
  }

  private db(): ReturnType<typeof openAgentOsDb> {
    if (!this.init()) throw new Error("CTX_STORE_UNAVAILABLE");
    return openAgentOsDb();
  }

  private ts(): string {
    return new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Backends
  // ---------------------------------------------------------------------------

  upsertBackend(input: {
    id: string;
    backendType: string;
    baseUrl: string;
    serverVersion?: string;
    compatibility: string;
    capabilities: Record<string, unknown>;
  }): void {
    const db = this.db();
    const ts = this.ts();
    // Upsert expressed as insert-or-ignore + targeted update (both short).
    db.query(
      "INSERT OR IGNORE INTO context_backends (id, backend_type, base_url, last_health_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(input.id, input.backendType, input.baseUrl, "probed", ts, ts);
    db.query(
      "UPDATE context_backends SET server_version = ?, compatibility = ?, capabilities_json = ?, last_health_at = ?, last_health_state = ?, updated_at = ? WHERE id = ?",
    ).run(input.serverVersion ?? null, input.compatibility, JSON.stringify(input.capabilities), ts, "probed", ts, input.id);
  }

  getBackend(id: string): Record<string, unknown> | null {
    return this.db().query("SELECT * FROM context_backends WHERE id = ?").get(id) as Record<string, unknown> | null;
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  upsertSource(input: {
    id: string;
    sourceType: string;
    sourceLocator: string;
    sourceRevision?: string;
    contextClass: string;
    sensitivity: string;
    targetUri: string;
    workspaceId?: string;
    ownerUserId?: string;
    currentChecksum?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const db = this.db();
    const ts = this.ts();
    db.query(
      "INSERT OR IGNORE INTO context_sources (id, source_type, source_locator, context_class, sensitivity, target_uri, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(input.id, input.sourceType, input.sourceLocator, input.contextClass, input.sensitivity, input.targetUri, ts, ts);
    db.query(
      "UPDATE context_sources SET source_revision = ?, context_class = ?, sensitivity = ?, workspace_id = ?, owner_user_id = ?, current_checksum = ?, metadata_json = ?, updated_at = ? WHERE source_type = ? AND source_locator = ? AND target_uri = ?",
    ).run(
      input.sourceRevision ?? null,
      input.contextClass,
      input.sensitivity,
      input.workspaceId ?? null,
      input.ownerUserId ?? null,
      input.currentChecksum ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      ts,
      input.sourceType,
      input.sourceLocator,
      input.targetUri,
    );
  }

  getSource(id: string): SourceRow | null {
    const row = this.db().query("SELECT * FROM context_sources WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.rowToSource(row) : null;
  }

  findSourceByIdentity(sourceType: string, sourceLocator: string, targetUri: string): SourceRow | null {
    const row = this.db()
      .query("SELECT * FROM context_sources WHERE source_type = ? AND source_locator = ? AND target_uri = ?")
      .get(sourceType, sourceLocator, targetUri) as Record<string, unknown> | null;
    return row ? this.rowToSource(row) : null;
  }

  listSources(limit = 200): SourceRow[] {
    const rows = this.db()
      .query("SELECT * FROM context_sources ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 1000)) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToSource(r));
  }

  setSourceIngested(id: string, checksumValue: string): void {
    this.db()
      .query("UPDATE context_sources SET current_checksum = ?, last_ingested_at = ?, last_verified_at = ?, updated_at = ? WHERE id = ?")
      .run(checksumValue, this.ts(), this.ts(), this.ts(), id);
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    this.db()
      .query("UPDATE context_sources SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, this.ts(), id);
  }

  private rowToSource(row: Record<string, unknown>): SourceRow {
    return {
      id: String(row.id),
      sourceType: String(row.source_type),
      sourceLocator: String(row.source_locator),
      sourceRevision: row.source_revision === null ? undefined : String(row.source_revision),
      contextClass: String(row.context_class),
      sensitivity: String(row.sensitivity),
      targetUri: String(row.target_uri),
      workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
      ownerUserId: row.owner_user_id === null ? undefined : String(row.owner_user_id),
      enabled: Number(row.enabled) === 1,
      currentChecksum: row.current_checksum === null ? undefined : String(row.current_checksum),
      lastIngestedAt: row.last_ingested_at === null ? undefined : String(row.last_ingested_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Ingest jobs
  // ---------------------------------------------------------------------------

  createJob(input: { id: string; sourceId: string; checksum?: string; correlationId?: string }): IngestJobRow {
    const ts = this.ts();
    this.db()
      .query("INSERT INTO context_ingest_jobs (id, source_id, checksum, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.id, input.sourceId, input.checksum ?? null, "queued", ts, ts);
    return { id: input.id, sourceId: input.sourceId, checksum: input.checksum, status: "queued", createdAt: ts };
  }

  /**
   * Two static statements: terminal statuses stamp completion time,
   * non-terminal ones do not. The branch is chosen in code.
   */
  updateJob(
    id: string,
    fields: { status: IngestJobStatus; openVikingTaskId?: string; targetUri?: string; errorCode?: string; errorMessage?: string },
  ): void {
    const db = this.db();
    const ts = this.ts();
    if (TERMINAL_JOB_STATUSES.includes(fields.status)) {
      db.query(
        `UPDATE context_ingest_jobs
         SET status = ?, openviking_task_id = COALESCE(?, openviking_task_id),
             target_uri = COALESCE(?, target_uri), error_code = ?, error_message = ?,
             completed_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(fields.status, fields.openVikingTaskId ?? null, fields.targetUri ?? null, fields.errorCode ?? null, fields.errorMessage ?? null, ts, ts, id);
      return;
    }
    db.query(
      `UPDATE context_ingest_jobs
       SET status = ?, openviking_task_id = COALESCE(?, openviking_task_id),
           target_uri = COALESCE(?, target_uri), error_code = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
    ).run(fields.status, fields.openVikingTaskId ?? null, fields.targetUri ?? null, fields.errorCode ?? null, fields.errorMessage ?? null, ts, id);
  }

  /**
   * Idempotency: an existing active job for the same source with the same
   * checksum means "already done or in flight" — callers skip the resubmit.
   */
  findActiveJobForChecksum(sourceId: string, checksumValue: string): IngestJobRow | null {
    const row = this.db()
      .query(
        `SELECT * FROM context_ingest_jobs
         WHERE source_id = ? AND checksum = ? AND status IN (?, ?, ?, ?, ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sourceId, checksumValue, ...ACTIVE_JOB_STATUSES) as Record<string, unknown> | null;
    return row ? this.rowToJob(row) : null;
  }

  listJobs(limit = 100): IngestJobRow[] {
    const rows = this.db()
      .query("SELECT * FROM context_ingest_jobs ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 500)) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToJob(r));
  }

  queueDepth(): number {
    const row = this.db()
      .query("SELECT COUNT(*) AS n FROM context_ingest_jobs WHERE status IN (?, ?, ?, ?)")
      .get(...ACTIVE_JOB_STATUSES.slice(0, 4)) as { n: number };
    return Number(row.n);
  }

  private rowToJob(row: Record<string, unknown>): IngestJobRow {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      checksum: row.checksum === null ? undefined : String(row.checksum),
      status: String(row.status) as IngestJobStatus,
      openVikingTaskId: row.openviking_task_id === null ? undefined : String(row.openviking_task_id),
      targetUri: row.target_uri === null ? undefined : String(row.target_uri),
      errorCode: row.error_code === null ? undefined : String(row.error_code),
      errorMessage: row.error_message === null ? undefined : String(row.error_message),
      correlationId: row.correlation_id === null ? undefined : String(row.correlation_id),
      createdAt: String(row.created_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Retrieval runs + hits
  // ---------------------------------------------------------------------------

  saveRetrievalRun(input: {
    id: string;
    requestId: string;
    userId: string;
    workspaceId?: string;
    agentId: string;
    queryHash: string;
    queryPreview: string;
    budgetProfile: string;
    status: string;
    resultCount: number;
    l2Count: number;
    estimatedTokens: number;
    latencyMs: number;
    trace?: Record<string, unknown>;
  }): void {
    this.db()
      .query(
        `INSERT INTO context_retrieval_runs
         (id, request_id, user_id, workspace_id, agent_id, query_hash, query_preview,
          budget_profile, status, result_count, l2_count, estimated_tokens, latency_ms,
          trace_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.requestId,
        input.userId,
        input.workspaceId ?? null,
        input.agentId,
        input.queryHash,
        input.queryPreview,
        input.budgetProfile,
        input.status,
        input.resultCount,
        input.l2Count,
        input.estimatedTokens,
        input.latencyMs,
        input.trace ? JSON.stringify(input.trace) : null,
        this.ts(),
      );
  }

  saveRetrievalHits(
    runId: string,
    hits: ReadonlyArray<{
      uri: string;
      contextClass: string;
      level: string;
      score: number;
      rank: number;
      allowed: boolean;
      exclusionReason?: string;
      reasonCode: string;
      estimatedTokens: number;
    }>,
  ): void {
    const db = this.db();
    for (const hit of hits) {
      db.query(
        `INSERT INTO context_retrieval_hits
         (retrieval_run_id, uri, context_class, level, score, rank, allowed,
          exclusion_reason, reason_code, estimated_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        runId,
        hit.uri,
        hit.contextClass,
        hit.level,
        hit.score,
        hit.rank,
        hit.allowed ? 1 : 0,
        hit.exclusionReason ?? null,
        hit.reasonCode,
        hit.estimatedTokens,
        this.ts(),
      );
    }
  }

  getRetrievalRun(id: string): Record<string, unknown> | null {
    return this.db().query("SELECT * FROM context_retrieval_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
  }

  getRetrievalHits(runId: string): Array<Record<string, unknown>> {
    return this.db()
      .query("SELECT * FROM context_retrieval_hits WHERE retrieval_run_id = ? ORDER BY rank")
      .all(runId) as Array<Record<string, unknown>>;
  }

  // ---------------------------------------------------------------------------
  // Session bindings
  // ---------------------------------------------------------------------------

  saveSessionBinding(binding: ContextSessionBinding): void {
    this.db()
      .query(
        `INSERT INTO context_session_bindings
         (id, pao_conversation_id, pao_run_id, openviking_session_id, user_id, workspace_id,
          agent_id, peer_id, memory_policy_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        binding.id,
        binding.paoConversationId,
        binding.paoRunId ?? null,
        binding.openVikingSessionId,
        binding.userId,
        binding.workspaceId ?? null,
        binding.agentId,
        binding.peerId ?? null,
        binding.memoryPolicyId,
        binding.status,
        binding.createdAt,
        binding.updatedAt,
      );
  }

  getSessionBinding(id: string): ContextSessionBinding | null {
    const row = this.db().query("SELECT * FROM context_session_bindings WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    return row ? this.rowToBinding(row) : null;
  }

  listSessionBindings(limit = 100): ContextSessionBinding[] {
    const rows = this.db()
      .query("SELECT * FROM context_session_bindings ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 500)) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToBinding(r));
  }

  updateSessionBindingStatus(id: string, status: ContextSessionBinding["status"]): void {
    this.db()
      .query("UPDATE context_session_bindings SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, this.ts(), id);
  }

  private rowToBinding(row: Record<string, unknown>): ContextSessionBinding {
    return {
      id: String(row.id),
      paoConversationId: String(row.pao_conversation_id),
      paoRunId: row.pao_run_id === null ? undefined : String(row.pao_run_id),
      openVikingSessionId: String(row.openviking_session_id),
      userId: String(row.user_id),
      workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
      agentId: String(row.agent_id),
      peerId: row.peer_id === null ? undefined : String(row.peer_id),
      memoryPolicyId: String(row.memory_policy_id),
      status: String(row.status) as ContextSessionBinding["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Memory governance
  // ---------------------------------------------------------------------------

  upsertMemoryGovernance(record: MemoryGovernanceRecord): void {
    const db = this.db();
    db.query(
      "INSERT OR IGNORE INTO context_memory_governance (id, memory_uri, review_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(record.id, record.memoryUri, record.reviewState, record.createdAt, record.updatedAt);
    db.query(
      `UPDATE context_memory_governance
       SET memory_type = ?, owner_user_id = ?, workspace_id = ?, peer_id = ?, review_state = ?,
           pinned = ?, suppressed = ?, risk_level = ?, source_session_id = ?,
           content_preview = ?, last_verified_at = ?, expires_at = ?, notes = ?, updated_at = ?
       WHERE memory_uri = ?`,
    ).run(
      record.memoryType ?? null,
      record.ownerUserId ?? null,
      record.workspaceId ?? null,
      record.peerId ?? null,
      record.reviewState,
      record.pinned ? 1 : 0,
      record.suppressed ? 1 : 0,
      record.riskLevel,
      record.sourceSessionId ?? null,
      record.contentPreview ?? null,
      record.lastVerifiedAt ?? null,
      record.expiresAt ?? null,
      record.notes ?? null,
      record.updatedAt,
      record.memoryUri,
    );
  }

  getMemoryGovernance(id: string): MemoryGovernanceRecord | null {
    const row = this.db().query("SELECT * FROM context_memory_governance WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    return row ? this.rowToMemory(row) : null;
  }

  getMemoryGovernanceByUri(memoryUri: string): MemoryGovernanceRecord | null {
    const row = this.db()
      .query("SELECT * FROM context_memory_governance WHERE memory_uri = ?")
      .get(memoryUri) as Record<string, unknown> | null;
    return row ? this.rowToMemory(row) : null;
  }

  listMemoriesForReview(limit = 100): MemoryGovernanceRecord[] {
    const rows = this.db()
      .query("SELECT * FROM context_memory_governance WHERE review_state = ? ORDER BY created_at DESC LIMIT ?")
      .all("pending_review", Math.min(limit, 500)) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  listSuppressedMemories(): MemoryGovernanceRecord[] {
    const rows = this.db()
      .query("SELECT * FROM context_memory_governance WHERE suppressed = ?")
      .all(1) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  listMemoryGovernance(limit = 200): MemoryGovernanceRecord[] {
    const rows = this.db()
      .query("SELECT * FROM context_memory_governance ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 1000)) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  pendingReviewCount(): number {
    const row = this.db()
      .query("SELECT COUNT(*) AS n FROM context_memory_governance WHERE review_state = ?")
      .get("pending_review") as { n: number };
    return Number(row.n);
  }

  private rowToMemory(row: Record<string, unknown>): MemoryGovernanceRecord {
    return {
      id: String(row.id),
      memoryUri: String(row.memory_uri),
      memoryType: row.memory_type === null ? undefined : String(row.memory_type),
      ownerUserId: row.owner_user_id === null ? undefined : String(row.owner_user_id),
      workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
      peerId: row.peer_id === null ? undefined : String(row.peer_id),
      reviewState: String(row.review_state) as MemoryGovernanceRecord["reviewState"],
      pinned: Number(row.pinned) === 1,
      suppressed: Number(row.suppressed) === 1,
      riskLevel: String(row.risk_level) as MemoryGovernanceRecord["riskLevel"],
      sourceSessionId: row.source_session_id === null ? undefined : String(row.source_session_id),
      contentPreview: row.content_preview === null ? undefined : String(row.content_preview),
      lastVerifiedAt: row.last_verified_at === null ? undefined : String(row.last_verified_at),
      expiresAt: row.expires_at === null ? undefined : String(row.expires_at),
      notes: row.notes === null ? undefined : String(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  saveMemoryReview(review: MemoryReviewRecord, before: MemoryGovernanceRecord, after: MemoryGovernanceRecord): void {
    this.db()
      .query(
        `INSERT INTO context_memory_reviews
         (id, governance_id, action, reviewer_type, reviewer_id, reason, before_json,
          after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        review.id,
        review.governanceId,
        review.action,
        review.reviewerType,
        review.reviewerId ?? null,
        review.reason ?? null,
        JSON.stringify(before),
        JSON.stringify(after),
        review.createdAt,
      );
  }

  listMemoryReviews(governanceId: string): MemoryReviewRecord[] {
    const rows = this.db()
      .query("SELECT * FROM context_memory_reviews WHERE governance_id = ? ORDER BY created_at")
      .all(governanceId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      governanceId: String(r.governance_id),
      action: String(r.action) as MemoryReviewRecord["action"],
      reviewerType: String(r.reviewer_type) as MemoryReviewRecord["reviewerType"],
      reviewerId: r.reviewer_id === null ? undefined : String(r.reviewer_id),
      reason: r.reason === null ? undefined : String(r.reason),
      createdAt: String(r.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Suppression rules
  // ---------------------------------------------------------------------------

  addSuppressionRule(rule: SuppressionRule): void {
    this.db()
      .query("INSERT INTO context_memory_suppressions (id, field, pattern, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(rule.id, rule.field, rule.pattern, rule.reason, rule.createdAt);
  }

  listSuppressionRules(): SuppressionRule[] {
    const rows = this.db()
      .query("SELECT * FROM context_memory_suppressions ORDER BY created_at")
      .all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      field: String(r.field) as SuppressionRule["field"],
      pattern: String(r.pattern),
      reason: String(r.reason),
      createdAt: String(r.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Experience governance
  // ---------------------------------------------------------------------------

  upsertExperience(record: ExperienceGovernanceRecord): void {
    const db = this.db();
    db.query(
      "INSERT OR IGNORE INTO context_experience_governance (id, experience_uri, created_at) VALUES (?, ?, ?)",
    ).run(record.id, record.experienceUri, record.createdAt);
    db.query(
      `UPDATE context_experience_governance
       SET workspace_id = ?, reuse_count = ?, success_count = ?, failure_count = ?,
           human_approved = ?, confidence = ?, last_used_at = ?, last_validated_at = ?,
           status = ?, updated_at = ?
       WHERE experience_uri = ?`,
    ).run(
      record.workspaceId ?? null,
      record.reuseCount,
      record.successCount,
      record.failureCount,
      record.humanApproved ? 1 : 0,
      record.confidence,
      record.lastUsedAt ?? null,
      record.lastValidatedAt ?? null,
      record.status,
      record.updatedAt,
      record.experienceUri,
    );
  }

  getExperienceByUri(uri: string): ExperienceGovernanceRecord | null {
    const row = this.db()
      .query("SELECT * FROM context_experience_governance WHERE experience_uri = ?")
      .get(uri) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id),
      experienceUri: String(row.experience_uri),
      workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
      reuseCount: Number(row.reuse_count),
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
      humanApproved: Number(row.human_approved) === 1,
      confidence: Number(row.confidence),
      lastUsedAt: row.last_used_at === null ? undefined : String(row.last_used_at),
      lastValidatedAt: row.last_validated_at === null ? undefined : String(row.last_validated_at),
      status: String(row.status) as ExperienceGovernanceRecord["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Handoffs
  // ---------------------------------------------------------------------------

  saveHandoff(handoff: AgentHandoffPackage): void {
    this.db()
      .query(
        `INSERT INTO context_handoffs
         (id, from_agent_id, to_agent_id, user_id, workspace_id, summary, context_refs_json,
          pending_actions_json, constraints_json, provenance_json, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        handoff.id,
        handoff.fromAgentId,
        handoff.toAgentId,
        handoff.userId,
        handoff.workspaceId ?? null,
        handoff.summary,
        JSON.stringify(handoff.contextRefs),
        JSON.stringify(handoff.pendingActions),
        JSON.stringify(handoff.constraints),
        JSON.stringify(handoff.provenance),
        handoff.expiresAt ?? null,
        handoff.createdAt,
      );
  }

  getHandoff(id: string): AgentHandoffPackage | null {
    const row = this.db().query("SELECT * FROM context_handoffs WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return {
      id: String(row.id),
      fromAgentId: String(row.from_agent_id),
      toAgentId: String(row.to_agent_id),
      userId: String(row.user_id),
      workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
      summary: String(row.summary),
      contextRefs: JSON.parse(String(row.context_refs_json)) as AgentHandoffPackage["contextRefs"],
      pendingActions: JSON.parse(String(row.pending_actions_json ?? "[]")) as string[],
      constraints: JSON.parse(String(row.constraints_json ?? "[]")) as string[],
      provenance: JSON.parse(String(row.provenance_json ?? "[]")) as string[],
      expiresAt: row.expires_at === null ? undefined : String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  appendAudit(event: ContextAuditEvent): void {
    this.db()
      .query(
        `INSERT INTO context_audit_events
         (id, event_type, actor_type, actor_id, user_id, workspace_id, agent_id,
          resource_uri, reason_code, metadata_json, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.eventType,
        event.actorType,
        event.actorId ?? null,
        event.userId ?? null,
        event.workspaceId ?? null,
        event.agentId ?? null,
        event.resourceUri ?? null,
        event.reasonCode ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.correlationId ?? null,
        event.createdAt,
      );
  }

  listAudit(options: { eventType?: string; resourceUri?: string; limit?: number } = {}): ContextAuditEvent[] {
    const limit = Math.min(options.limit ?? 200, 1000);
    const rows = this.db()
      .query("SELECT * FROM context_audit_events ORDER BY created_at DESC LIMIT ?")
      .all(2000) as Array<Record<string, unknown>>;
    return rows
      .map(r => ({
        id: String(r.id),
        eventType: String(r.event_type),
        actorType: String(r.actor_type) as ContextAuditEvent["actorType"],
        actorId: r.actor_id === null ? undefined : String(r.actor_id),
        userId: r.user_id === null ? undefined : String(r.user_id),
        workspaceId: r.workspace_id === null ? undefined : String(r.workspace_id),
        agentId: r.agent_id === null ? undefined : String(r.agent_id),
        resourceUri: r.resource_uri === null ? undefined : String(r.resource_uri),
        reasonCode: r.reason_code === null ? undefined : (String(r.reason_code) as ContextAuditEvent["reasonCode"]),
        metadata: r.metadata_json === null ? undefined : (JSON.parse(String(r.metadata_json)) as Record<string, unknown>),
        correlationId: r.correlation_id === null ? undefined : String(r.correlation_id),
        createdAt: String(r.created_at),
      }))
      .filter(e => (options.eventType ? e.eventType === options.eventType : true))
      .filter(e => (options.resourceUri ? e.resourceUri === options.resourceUri : true))
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Backups
  // ---------------------------------------------------------------------------

  recordBackupRun(input: { id: string; status: string; artifactHash?: string; errorMessage?: string }): void {
    const ts = this.ts();
    this.db()
      .query(
        `INSERT INTO context_backup_runs
         (id, status, artifact_hash, started_at, completed_at, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.status,
        input.artifactHash ?? null,
        ts,
        input.status === "completed" ? ts : null,
        input.errorMessage ?? null,
        ts,
      );
  }

  lastBackupRun(): Record<string, unknown> | null {
    return this.db()
      .query("SELECT * FROM context_backup_runs ORDER BY created_at DESC LIMIT 1")
      .get() as Record<string, unknown> | null;
  }
}
