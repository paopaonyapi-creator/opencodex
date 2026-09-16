// Phase 20.27 — Cockpit persistence: additive cockpit_* tables on the shared
// Agent OS handle, following the Phase 20.16 control-plane store convention
// (no second database, no migration tool). Every statement is an inline static
// string literal; writes are explicit check-then-insert/update.

import { openAgentOsDb } from "../db";
import { newCockpitId } from "./cockpit-types";
import type {
  AccessMode,
  AgentEvent,
  AgentEventType,
  AgentSession,
  AgentType,
  CockpitApproval,
  CockpitTask,
  ControlRisk,
  ContextSnapshot,
  EvidenceRecord,
  EvidenceType,
  GateFinding,
  GateProfile,
  GateRun,
  GateVerdict,
  ProviderState,
  ReleaseMark,
  ReviewRun,
} from "./cockpit-types";

export class CockpitStore {
  private initialized = false;

  private ensure(): void {
    if (this.initialized) return;
    const db = openAgentOsDb();
    // Each DDL statement is applied as its own inline literal (additive CREATE
    // IF NOT EXISTS), mirroring the Phase 20.16 store convention.
    db.query("CREATE TABLE IF NOT EXISTS cockpit_agents (id TEXT PRIMARY KEY, type TEXT NOT NULL, display_name TEXT NOT NULL, access_mode TEXT NOT NULL DEFAULT 'ask', policy_profile TEXT NOT NULL DEFAULT 'coding-safe', workspace_scope TEXT NOT NULL DEFAULT 'repo', updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, agent_type TEXT NOT NULL, access_mode TEXT NOT NULL, policy_profile TEXT NOT NULL, workspace_scope TEXT NOT NULL, task_id TEXT, context_snapshot_id TEXT, status TEXT NOT NULL DEFAULT 'running', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, error TEXT)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL, payload_summary TEXT NOT NULL DEFAULT '', risk TEXT, created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_cockpit_events_session ON cockpit_events(session_id, sequence)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_approvals (id TEXT PRIMARY KEY, action TEXT NOT NULL, agent_id TEXT, session_id TEXT, resource TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT 'once', status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, decided_at TEXT, decided_by TEXT)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_cockpit_approvals_status ON cockpit_approvals(status, created_at DESC)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_gate_runs (id TEXT PRIMARY KEY, profile TEXT NOT NULL, verdict TEXT NOT NULL, exit_code INTEGER NOT NULL, git_sha TEXT, overridden_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_gate_findings (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, rule_id TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', evidence_json TEXT NOT NULL DEFAULT '[]', suggested_json TEXT NOT NULL DEFAULT '[]', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_evidence (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', git_sha TEXT, context_snapshot_id TEXT, created_at TEXT NOT NULL, expires_at TEXT)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_context_snapshots (id TEXT PRIMARY KEY, git_sha TEXT, branch TEXT, policy_hash TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_release_marks (sha TEXT PRIMARY KEY, state TEXT NOT NULL, marked_by TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'not_detected', detection_evidence TEXT NOT NULL DEFAULT '', credential_configured INTEGER NOT NULL DEFAULT 0, runtime_verified INTEGER NOT NULL DEFAULT 0, last_verified_at TEXT, verification_expires_at TEXT, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_agent_id TEXT, workspace_scope TEXT NOT NULL DEFAULT 'repo', risk TEXT NOT NULL DEFAULT 'R1', status TEXT NOT NULL DEFAULT 'planned', required_gate_profile TEXT NOT NULL DEFAULT 'dev', context_snapshot_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS cockpit_review_runs (id TEXT PRIMARY KEY, context_snapshot_id TEXT, diff_summary TEXT NOT NULL DEFAULT '', findings_json TEXT NOT NULL DEFAULT '[]', disagreements_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)").run();
    this.initialized = true;
  }

  // --- Agents ------------------------------------------------------------------

  setAccessMode(agentId: string, mode: AccessMode, displayName: string, type: AgentType): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_agents WHERE id = ?").get(agentId);
    const now = new Date().toISOString();
    if (existing) {
      const stmt = db.query("UPDATE cockpit_agents SET access_mode = ?, updated_at = ? WHERE id = ?");
      stmt.run(mode, now, agentId);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_agents (id, type, display_name, access_mode, policy_profile, workspace_scope, updated_at) VALUES (?, ?, ?, ?, 'coding-safe', 'repo', ?)");
    stmt.run(agentId, type, displayName, mode, now);
  }

  getAccessMode(agentId: string, fallback: AccessMode): AccessMode {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT access_mode AS mode FROM cockpit_agents WHERE id = ?")
      .get(agentId) as { mode: AccessMode } | undefined;
    return row?.mode ?? fallback;
  }

  listAccessModes(): Array<{ id: string; type: string; displayName: string; accessMode: AccessMode }> {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, type, display_name AS displayName, access_mode AS accessMode FROM cockpit_agents ORDER BY id")
      .all() as Array<{ id: string; type: string; displayName: string; accessMode: AccessMode }>;
    return rows;
  }

  // --- Sessions & events -----------------------------------------------------------

  saveSession(session: AgentSession): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_sessions WHERE id = ?").get(session.id);
    if (existing) {
      const stmt = db.query("UPDATE cockpit_sessions SET status = ?, updated_at = ?, completed_at = ?, error = ?, context_snapshot_id = ? WHERE id = ?");
      stmt.run(session.status, session.updatedAt, session.completedAt ?? null, session.error ?? null, session.contextSnapshotId ?? null, session.id);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_sessions (id, agent_id, agent_type, access_mode, policy_profile, workspace_scope, task_id, context_snapshot_id, status, created_at, updated_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      session.id, session.agentId, session.agentType, session.accessMode, session.policyProfile,
      session.workspaceScope, session.taskId ?? null, session.contextSnapshotId ?? null,
      session.status, session.createdAt, session.updatedAt, session.completedAt ?? null, session.error ?? null,
    );
  }

  getSession(id: string): AgentSession | null {
    this.ensure();
    const row = openAgentOsDb().query("SELECT * FROM cockpit_sessions WHERE id = ?").get(id) as
      | Record<string, string | null>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      agentType: row.agent_type as AgentType,
      accessMode: row.access_mode as AccessMode,
      policyProfile: row.policy_profile as string,
      workspaceScope: row.workspace_scope as string,
      taskId: (row.task_id as string) ?? undefined,
      contextSnapshotId: (row.context_snapshot_id as string) ?? undefined,
      status: row.status as AgentSession["status"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
      error: (row.error as string) ?? undefined,
    };
  }

  listSessions(limit = 50): AgentSession[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id FROM cockpit_sessions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string }>;
    return rows.map((r) => this.getSession(r.id)!).filter(Boolean);
  }

  appendEvent(sessionId: string, eventType: AgentEventType, payloadSummary: string, risk?: ControlRisk): AgentEvent {
    this.ensure();
    const db = openAgentOsDb();
    const seqRow = db
      .query("SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM cockpit_events WHERE session_id = ?")
      .get(sessionId) as { maxSeq: number };
    const event: AgentEvent = {
      id: newCockpitId("cevt"),
      sessionId,
      sequence: seqRow.maxSeq + 1,
      eventType,
      payloadSummary,
      risk,
      createdAt: new Date().toISOString(),
    };
    const stmt = db.query("INSERT INTO cockpit_events (id, session_id, sequence, event_type, payload_summary, risk, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    stmt.run(event.id, event.sessionId, event.sequence, event.eventType, event.payloadSummary, event.risk ?? null, event.createdAt);
    return event;
  }

  listEvents(sessionId: string, limit = 200): AgentEvent[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, session_id AS sessionId, sequence, event_type AS eventType, payload_summary AS payloadSummary, risk, created_at AS createdAt FROM cockpit_events WHERE session_id = ? ORDER BY sequence LIMIT ?")
      .all(sessionId, limit) as unknown as AgentEvent[];
    return rows;
  }

  // --- Approvals -----------------------------------------------------------------------

  saveApproval(approval: CockpitApproval): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_approvals WHERE id = ?").get(approval.id);
    if (existing) {
      const stmt = db.query("UPDATE cockpit_approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?");
      stmt.run(approval.status, approval.decidedAt ?? null, approval.decidedBy ?? null, approval.id);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_approvals (id, action, agent_id, session_id, resource, risk, reason, preview, scope, status, requested_by, created_at, expires_at, decided_at, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      approval.id, approval.action, approval.agentId ?? null, approval.sessionId ?? null,
      approval.resource, approval.risk, approval.reason, approval.preview, approval.scope,
      approval.status, approval.requestedBy, approval.createdAt, approval.expiresAt ?? null,
      approval.decidedAt ?? null, approval.decidedBy ?? null,
    );
  }

  getApproval(id: string): CockpitApproval | null {
    this.ensure();
    const row = openAgentOsDb().query("SELECT * FROM cockpit_approvals WHERE id = ?").get(id) as
      | Record<string, string | null>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      action: row.action as string,
      agentId: (row.agent_id as string) ?? undefined,
      sessionId: (row.session_id as string) ?? undefined,
      resource: (row.resource as string) ?? "",
      risk: row.risk as ControlRisk,
      reason: (row.reason as string) ?? "",
      preview: (row.preview as string) ?? "",
      scope: (row.scope as CockpitApproval["scope"]) ?? "once",
      status: row.status as CockpitApproval["status"],
      requestedBy: (row.requested_by as string) ?? "",
      createdAt: row.created_at as string,
      expiresAt: (row.expires_at as string) ?? undefined,
      decidedAt: (row.decided_at as string) ?? undefined,
      decidedBy: (row.decided_by as string) ?? undefined,
    };
  }

  listApprovals(status?: CockpitApproval["status"], limit = 50): CockpitApproval[] {
    this.ensure();
    const db = openAgentOsDb();
    if (status) {
      const rows = db
        .query("SELECT id FROM cockpit_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(status, limit) as Array<{ id: string }>;
      return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
    }
    const rows = db
      .query("SELECT id FROM cockpit_approvals ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string }>;
    return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
  }

  // --- Gate runs -------------------------------------------------------------------------

  saveGateRun(run: GateRun): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_gate_runs WHERE id = ?").get(run.id);
    if (!existing) {
      const stmt = db.query("INSERT INTO cockpit_gate_runs (id, profile, verdict, exit_code, git_sha, overridden_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      stmt.run(run.id, run.profile, run.verdict, run.exitCode, run.gitSha ?? null, JSON.stringify(run.overriddenFindingIds), run.createdAt);
      return;
    }
    const stmt = db.query("UPDATE cockpit_gate_runs SET verdict = ?, exit_code = ?, overridden_ids_json = ? WHERE id = ?");
    stmt.run(run.verdict, run.exitCode, JSON.stringify(run.overriddenFindingIds), run.id);
  }

  latestGateRun(): GateRun | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT * FROM cockpit_gate_runs ORDER BY created_at DESC LIMIT 1")
      .get() as Record<string, string | number> | undefined;
    if (!row) return null;
    const findings = openAgentOsDb()
      .query("SELECT id, rule_id AS ruleId, severity, title, status, evidence_json AS evidenceJson, suggested_json AS suggestedJson, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM cockpit_gate_findings WHERE run_id = ? ORDER BY rowid")
      .all(row.id as string) as unknown as GateFinding[];
    return {
      id: row.id as string,
      profile: row.profile as GateProfile,
      verdict: row.verdict as GateVerdict,
      exitCode: row.exit_code as GateRun["exitCode"],
      gitSha: (row.git_sha as string) ?? undefined,
      overriddenFindingIds: JSON.parse(row.overridden_ids_json as string) as string[],
      findings,
      createdAt: row.created_at as string,
    };
  }

  saveFindings(runId: string, findings: GateFinding[]): void {
    this.ensure();
    const db = openAgentOsDb();
    for (const finding of findings) {
      const stmt = db.query("INSERT INTO cockpit_gate_findings (id, run_id, rule_id, severity, title, status, evidence_json, suggested_json, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      stmt.run(
        finding.id, runId, finding.ruleId, finding.severity, finding.title,
        finding.status, JSON.stringify(finding.evidence), JSON.stringify(finding.suggestedActions),
        finding.firstSeenAt, finding.lastSeenAt,
      );
    }
  }

  // --- Evidence ----------------------------------------------------------------------------

  saveEvidence(record: EvidenceRecord): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO cockpit_evidence (id, type, source, hash, summary, git_sha, context_snapshot_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      record.id, record.type, record.source, record.hash, record.summary,
      record.gitSha ?? null, record.contextSnapshotId ?? null, record.createdAt, record.expiresAt ?? null,
    );
  }

  listEvidence(limit = 100): EvidenceRecord[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, type, source, hash, summary, git_sha AS gitSha, context_snapshot_id AS contextSnapshotId, created_at AS createdAt, expires_at AS expiresAt FROM cockpit_evidence ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
        id: string; type: EvidenceType; source: string; hash: string; summary: string;
        gitSha?: string; contextSnapshotId?: string; createdAt: string; expiresAt?: string;
      }>;
    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      expired: row.expiresAt ? new Date(row.expiresAt).getTime() < now : undefined,
    }));
  }

  // --- Context snapshots -------------------------------------------------------------------------

  saveContextSnapshot(snapshot: ContextSnapshot): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO cockpit_context_snapshots (id, git_sha, branch, policy_hash, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(snapshot.id, snapshot.gitSha ?? null, snapshot.branch ?? null, snapshot.policyHash, JSON.stringify(snapshot.attachments), snapshot.createdAt);
  }

  getContextSnapshot(id: string): ContextSnapshot | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT id, git_sha AS gitSha, branch, policy_hash AS policyHash, attachments_json AS attachmentsJson, created_at AS createdAt FROM cockpit_context_snapshots WHERE id = ?")
      .get(id) as
      | { id: string; gitSha?: string; branch?: string; policyHash: string; attachmentsJson: string; createdAt: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      schemaVersion: 1,
      gitSha: row.gitSha,
      branch: row.branch,
      policyHash: row.policyHash,
      attachments: JSON.parse(row.attachmentsJson) as ContextSnapshot["attachments"],
      createdAt: row.createdAt,
      fresh: Date.now() - new Date(row.createdAt).getTime() < 24 * 60 * 60 * 1000,
    };
  }

  // --- Release marks --------------------------------------------------------------------------------

  saveReleaseMark(mark: ReleaseMark): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT sha FROM cockpit_release_marks WHERE sha = ?").get(mark.sha);
    if (existing) {
      const stmt = db.query("UPDATE cockpit_release_marks SET state = ?, marked_by = ?, reason = ?, created_at = ? WHERE sha = ?");
      stmt.run(mark.state, mark.markedBy, mark.reason ?? null, mark.createdAt, mark.sha);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_release_marks (sha, state, marked_by, reason, created_at) VALUES (?, ?, ?, ?, ?)");
    stmt.run(mark.sha, mark.state, mark.markedBy, mark.reason ?? null, mark.createdAt);
  }

  getReleaseMark(sha: string): ReleaseMark | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT sha, state, marked_by AS markedBy, reason, created_at AS createdAt FROM cockpit_release_marks WHERE sha = ?")
      .get(sha) as ReleaseMark | undefined;
    return row ?? null;
  }

  latestKnownGood(): ReleaseMark | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT sha, state, marked_by AS markedBy, reason, created_at AS createdAt FROM cockpit_release_marks WHERE state = 'known_good' ORDER BY created_at DESC LIMIT 1")
      .get() as ReleaseMark | undefined;
    return row ?? null;
  }

  // --- Providers ----------------------------------------------------------------------------------------

  upsertProvider(provider: ProviderState): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_providers WHERE id = ?").get(provider.id);
    const now = new Date().toISOString();
    if (existing) {
      const stmt = db.query("UPDATE cockpit_providers SET name = ?, status = ?, detection_evidence = ?, credential_configured = ?, runtime_verified = ?, last_verified_at = ?, verification_expires_at = ?, updated_at = ? WHERE id = ?");
      stmt.run(provider.name, provider.status, provider.detectionEvidence, provider.credentialConfigured ? 1 : 0, provider.runtimeVerified ? 1 : 0, provider.lastVerifiedAt ?? null, provider.verificationExpiresAt ?? null, now, provider.id);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_providers (id, name, status, detection_evidence, credential_configured, runtime_verified, last_verified_at, verification_expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(provider.id, provider.name, provider.status, provider.detectionEvidence, provider.credentialConfigured ? 1 : 0, provider.runtimeVerified ? 1 : 0, provider.lastVerifiedAt ?? null, provider.verificationExpiresAt ?? null, now);
  }

  listProviders(): ProviderState[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, name, status, detection_evidence AS detectionEvidence, credential_configured AS credentialConfigured, runtime_verified AS runtimeVerified, last_verified_at AS lastVerifiedAt, verification_expires_at AS verificationExpiresAt FROM cockpit_providers ORDER BY name")
      .all() as Array<{
        id: string; name: string; status: ProviderState["status"]; detectionEvidence: string;
        credentialConfigured: number; runtimeVerified: number; lastVerifiedAt?: string; verificationExpiresAt?: string;
      }>;
    return rows.map((row) => ({
      ...row,
      credentialConfigured: row.credentialConfigured === 1,
      runtimeVerified: row.runtimeVerified === 1,
    }));
  }

  // --- Tasks & reviews ---------------------------------------------------------------------------------------

  saveTask(task: CockpitTask): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM cockpit_tasks WHERE id = ?").get(task.id);
    if (existing) {
      const stmt = db.query("UPDATE cockpit_tasks SET title = ?, status = ?, owner_agent_id = ?, risk = ?, context_snapshot_id = ?, updated_at = ? WHERE id = ?");
      stmt.run(task.title, task.status, task.ownerAgentId ?? null, task.risk, task.contextSnapshotId ?? null, task.updatedAt, task.id);
      return;
    }
    const stmt = db.query("INSERT INTO cockpit_tasks (id, title, owner_agent_id, workspace_scope, risk, status, required_gate_profile, context_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(task.id, task.title, task.ownerAgentId ?? null, task.workspaceScope, task.risk, task.status, task.requiredGateProfile, task.contextSnapshotId ?? null, task.createdAt, task.updatedAt);
  }

  listTasks(status?: CockpitTask["status"], limit = 50): CockpitTask[] {
    this.ensure();
    const db = openAgentOsDb();
    if (status) {
      return db
        .query("SELECT id, title, owner_agent_id AS ownerAgentId, workspace_scope AS workspaceScope, risk, status, required_gate_profile AS requiredGateProfile, context_snapshot_id AS contextSnapshotId, created_at AS createdAt, updated_at AS updatedAt FROM cockpit_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(status, limit) as unknown as CockpitTask[];
    }
    return db
      .query("SELECT id, title, owner_agent_id AS ownerAgentId, workspace_scope AS workspaceScope, risk, status, required_gate_profile AS requiredGateProfile, context_snapshot_id AS contextSnapshotId, created_at AS createdAt, updated_at AS updatedAt FROM cockpit_tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as unknown as CockpitTask[];
  }

  saveReviewRun(run: ReviewRun): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO cockpit_review_runs (id, context_snapshot_id, diff_summary, findings_json, disagreements_json, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(run.id, run.contextSnapshotId ?? null, run.diffSummary, JSON.stringify(run.findings), JSON.stringify(run.disagreements), run.createdAt);
  }

  listReviewRuns(limit = 20): ReviewRun[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, context_snapshot_id AS contextSnapshotId, diff_summary AS diffSummary, findings_json AS findingsJson, disagreements_json AS disagreementsJson, created_at AS createdAt FROM cockpit_review_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
        id: string; contextSnapshotId?: string; diffSummary: string; findingsJson: string; disagreementsJson: string; createdAt: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      contextSnapshotId: row.contextSnapshotId,
      diffSummary: row.diffSummary,
      findings: JSON.parse(row.findingsJson) as ReviewRun["findings"],
      disagreements: JSON.parse(row.disagreementsJson) as string[],
      createdAt: row.createdAt,
    }));
  }
}
