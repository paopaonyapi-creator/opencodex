// Phase 20.28 — Governance persistence: additive gov_* tables on the shared
// Agent OS handle (Phase 20.16/20.27 store convention). Every statement is an
// inline static literal; writes are explicit check-then-insert/update; audit
// is append-only with a lightweight hash chain.

import { openAgentOsDb } from "../db";
import { newGovId } from "./types";
import type {
  ActionRequest,
  AuditEvent,
  CapabilityGrant,
  GovernanceApproval,
  GovernanceMode,
  GovernancePolicy,
  PolicyDecision,
  RiskLevel,
} from "./types";

const EFFECT_CEILING_ORDER: Record<string, number> = {
  read: 0, write: 1, execute: 2, external_write: 3, destructive: 4, credential: 4, admin: 4, unknown: 2,
};

export class GovernanceStore {
  private initialized = false;

  private ensure(): void {
    if (this.initialized) return;
    const db = openAgentOsDb();
    db.query("CREATE TABLE IF NOT EXISTS gov_capability_grants (id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, provider TEXT NOT NULL, capability TEXT NOT NULL, resource_pattern TEXT, effect_ceiling TEXT, expires_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_grants_subject ON gov_capability_grants(subject_type, subject_id)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_grants_provider ON gov_capability_grants(provider, capability)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_action_requests (id TEXT PRIMARY KEY, run_id TEXT, session_id TEXT, actor_id TEXT, agent_id TEXT, source TEXT, provider TEXT, tool TEXT, effect TEXT, risk TEXT, resource_summary TEXT, argument_fingerprint TEXT, created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_actions_run ON gov_action_requests(run_id)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_policy_decisions (id TEXT PRIMARY KEY, action_id TEXT NOT NULL, decision TEXT NOT NULL, risk TEXT NOT NULL, reason_code TEXT NOT NULL, reason TEXT NOT NULL, matched_policy_ids TEXT NOT NULL DEFAULT '[]', matched_rule_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_decisions_action ON gov_policy_decisions(action_id)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_approvals (id TEXT PRIMARY KEY, action_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', risk TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', requested_by_agent_id TEXT NOT NULL, argument_preview TEXT, expires_at TEXT, created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, resolution_reason TEXT)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_approvals_status ON gov_approvals(status, created_at)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_audit_events (id TEXT PRIMARY KEY, action_id TEXT, run_id TEXT, session_id TEXT, actor_id TEXT, agent_id TEXT, event_type TEXT NOT NULL, provider TEXT, tool TEXT, risk TEXT, decision TEXT, resource_summary TEXT, metadata TEXT NOT NULL DEFAULT '{}', redacted INTEGER NOT NULL DEFAULT 1, prev_event_hash TEXT, event_hash TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_audit_action ON gov_audit_events(action_id)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_gov_audit_created ON gov_audit_events(created_at DESC)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_action_payloads (action_id TEXT PRIMARY KEY, action_json TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS gov_policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, policy_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    this.initialized = true;
  }

  // --- Policy persistence (doc §42; never silently replace with allow-all) ----

  savePolicy(policy: GovernancePolicy, createdBy: string): void {
    this.ensure();
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const existing = db.query("SELECT id FROM gov_policies WHERE id = ?").get(policy.id);
    if (existing) {
      const stmt = db.query("UPDATE gov_policies SET name = ?, version = version + 1, enabled = ?, policy_json = ?, updated_at = ? WHERE id = ?");
      stmt.run(policy.name, policy.enabled ? 1 : 0, JSON.stringify(policy), now, policy.id);
      return;
    }
    const stmt = db.query("INSERT INTO gov_policies (id, name, version, enabled, policy_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(policy.id, policy.name, policy.version ?? 1, policy.enabled ? 1 : 0, JSON.stringify(policy), createdBy, now, now);
  }

  listPolicies(): GovernancePolicy[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT policy_json AS json FROM gov_policies ORDER BY name")
      .all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as GovernancePolicy);
  }

  deletePolicy(id: string): boolean {
    this.ensure();
    const stmt = openAgentOsDb().query("DELETE FROM gov_policies WHERE id = ?");
    return stmt.run(id).changes > 0;
  }

  saveActionPayload(actionId: string, action: ActionRequest): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT action_id FROM gov_action_payloads WHERE action_id = ?").get(actionId);
    if (existing) return;
    const stmt = db.query("INSERT INTO gov_action_payloads (action_id, action_json, created_at) VALUES (?, ?, ?)");
    stmt.run(actionId, JSON.stringify(action), new Date().toISOString());
  }

  getActionPayload(actionId: string): ActionRequest | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT action_json AS json FROM gov_action_payloads WHERE action_id = ?")
      .get(actionId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as ActionRequest) : null;
  }

  // --- Grants ----------------------------------------------------------------

  saveGrant(grant: CapabilityGrant): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM gov_capability_grants WHERE id = ?").get(grant.id);
    if (existing) {
      const stmt = db.query("UPDATE gov_capability_grants SET provider = ?, capability = ?, resource_pattern = ?, effect_ceiling = ?, expires_at = ?, enabled = ?, updated_at = ? WHERE id = ?");
      stmt.run(grant.provider, grant.capability, grant.resourcePattern ?? null, grant.effectCeiling ?? null, grant.expiresAt ?? null, grant.enabled ? 1 : 0, grant.updatedAt, grant.id);
      return;
    }
    const stmt = db.query("INSERT INTO gov_capability_grants (id, subject_type, subject_id, provider, capability, resource_pattern, effect_ceiling, expires_at, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(grant.id, grant.subjectType, grant.subjectId, grant.provider, grant.capability, grant.resourcePattern ?? null, grant.effectCeiling ?? null, grant.expiresAt ?? null, grant.enabled ? 1 : 0, grant.createdBy, grant.createdAt, grant.updatedAt);
  }

  deleteGrant(id: string): boolean {
    this.ensure();
    const stmt = openAgentOsDb().query("DELETE FROM gov_capability_grants WHERE id = ?");
    return stmt.run(id).changes > 0;
  }

  listGrants(filter: { subjectId?: string; provider?: string } = {}): CapabilityGrant[] {
    this.ensure();
    const db = openAgentOsDb();
    if (filter.subjectId) {
      return db.query("SELECT * FROM gov_capability_grants WHERE subject_id = ? ORDER BY created_at DESC").all(filter.subjectId) as unknown as CapabilityGrant[];
    }
    if (filter.provider) {
      return db.query("SELECT * FROM gov_capability_grants WHERE provider = ? ORDER BY created_at DESC").all(filter.provider) as unknown as CapabilityGrant[];
    }
    return db.query("SELECT * FROM gov_capability_grants ORDER BY created_at DESC").all() as unknown as CapabilityGrant[];
  }

  /**
   * Resolve the active grant for a subject/provider. Fail closed: expired or
   * disabled grants do not count; the effect ceiling must cover the request.
   */
  resolveGrant(subjectId: string, provider: string, capability: string, effect: string): CapabilityGrant | null {
    this.ensure();
    const grants = openAgentOsDb()
      .query("SELECT * FROM gov_capability_grants WHERE subject_id = ? AND provider = ? AND capability = ? AND enabled = 1")
      .all(subjectId, provider, capability) as unknown as CapabilityGrant[];
    const now = Date.now();
    for (const grant of grants) {
      if (grant.expiresAt && new Date(grant.expiresAt).getTime() < now) continue;
      const ceiling = grant.effectCeiling ? EFFECT_CEILING_ORDER[grant.effectCeiling] ?? 99 : 99;
      if (effect && (EFFECT_CEILING_ORDER[effect] ?? 99) > ceiling) continue;
      return grant;
    }
    return null;
  }

  resourceMatches(pattern: string | undefined, path: string | undefined): boolean {
    if (!pattern) return true;
    if (!path) return false;
    const normalized = pattern.replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*");
    return new RegExp("^" + normalized + "$", "i").test(path.replace(/\\/g, "/"));
  }

  // --- Actions & decisions -------------------------------------------------------

  saveActionRequest(action: ActionRequest, fingerprint: string, risk: RiskLevel, effect: string): void {
    this.ensure();
    const db = openAgentOsDb();
    // Idempotent per actionId (doc §50): the approved re-dispatch of the same
    // action updates the request row instead of duplicating it.
    const existing = db.query("SELECT id FROM gov_action_requests WHERE id = ?").get(action.actionId);
    if (existing) return;
    const stmt = db.query("INSERT INTO gov_action_requests (id, run_id, session_id, actor_id, agent_id, source, provider, tool, effect, risk, resource_summary, argument_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      action.actionId, action.run.runId, action.run.sessionId ?? null, action.actor.id,
      action.agent.id, action.source.surface, action.tool.provider, action.tool.name,
      effect, risk, (action.resource.path ?? action.resource.host ?? action.resource.id ?? action.resource.kind).slice(0, 200),
      fingerprint, action.requestedAt,
    );
  }

  saveDecision(decision: PolicyDecision): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO gov_policy_decisions (id, action_id, decision, risk, reason_code, reason, matched_policy_ids, matched_rule_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(decision.decisionId, decision.actionId, decision.decision, decision.risk, decision.reasonCode, decision.reason, JSON.stringify(decision.matchedPolicyIds), JSON.stringify(decision.matchedRuleIds), decision.decidedAt);
  }

  // --- Approvals ---------------------------------------------------------------------

  saveApproval(approval: GovernanceApproval): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM gov_approvals WHERE id = ?").get(approval.id);
    if (existing) {
      const stmt = db.query("UPDATE gov_approvals SET status = ?, resolved_at = ?, resolved_by = ?, resolution_reason = ? WHERE id = ?");
      stmt.run(approval.status, approval.resolvedAt ?? null, approval.resolvedBy ?? null, approval.resolutionReason ?? null, approval.id);
      return;
    }
    const stmt = db.query("INSERT INTO gov_approvals (id, action_id, status, risk, summary, requested_by_agent_id, argument_preview, expires_at, created_at, resolved_at, resolved_by, resolution_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(approval.id, approval.actionId, approval.status, approval.risk, approval.summary, approval.requestedByAgentId, JSON.stringify(approval.argumentPreview ?? null), approval.expiresAt ?? null, approval.createdAt, approval.resolvedAt ?? null, approval.resolvedBy ?? null, approval.resolutionReason ?? null);
  }

  getApproval(id: string): GovernanceApproval | null {
    this.ensure();
    const row = openAgentOsDb().query("SELECT * FROM gov_approvals WHERE id = ?").get(id) as
      | Record<string, string | null>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      actionId: row.action_id as string,
      status: row.status as GovernanceApproval["status"],
      risk: row.risk as RiskLevel,
      summary: (row.summary as string) ?? "",
      requestedByAgentId: (row.requested_by_agent_id as string) ?? "",
      argumentPreview: row.argument_preview ? JSON.parse(row.argument_preview) : undefined,
      createdAt: row.created_at as string,
      expiresAt: (row.expires_at as string) ?? undefined,
      resolvedAt: (row.resolved_at as string) ?? undefined,
      resolvedBy: (row.resolved_by as string) ?? undefined,
      resolutionReason: (row.resolution_reason as string) ?? undefined,
    };
  }

  listApprovals(status?: GovernanceApproval["status"], limit = 50): GovernanceApproval[] {
    this.ensure();
    const db = openAgentOsDb();
    if (status) {
      const rows = db.query("SELECT id FROM gov_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit) as Array<{ id: string }>;
      return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
    }
    const rows = db.query("SELECT id FROM gov_approvals ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: string }>;
    return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
  }

  // --- Audit (append-only, hash-chained) -------------------------------------------------

  appendAudit(event: AuditEvent): void {
    this.ensure();
    const db = openAgentOsDb();
    const prev = db.query("SELECT event_hash AS hash FROM gov_audit_events ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { hash: string } | undefined;
    event.prevEventHash = prev?.hash;
    event.eventHash = "sha256:" + Buffer.from(JSON.stringify([event.prevEventHash ?? "", event.actionId ?? "", event.eventType, event.timestamp])).toString("hex").slice(0, 32);
    const stmt = db.query("INSERT INTO gov_audit_events (id, action_id, run_id, session_id, actor_id, agent_id, event_type, provider, tool, risk, decision, resource_summary, metadata, redacted, prev_event_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      event.id, event.actionId ?? null, event.runId ?? null, event.sessionId ?? null,
      event.actorId ?? null, event.agentId ?? null, event.eventType, event.provider ?? null,
      event.tool ?? null, event.risk ?? null, event.decision ?? null, event.resourceSummary ?? null,
      JSON.stringify(event.metadata ?? {}), event.redacted ? 1 : 0, event.prevEventHash ?? null, event.eventHash, event.timestamp,
    );
  }

  listAudit(limit = 100, actionId?: string): AuditEvent[] {
    this.ensure();
    const db = openAgentOsDb();
    if (actionId) {
      return db.query("SELECT id, action_id AS actionId, run_id AS runId, session_id AS sessionId, actor_id AS actorId, agent_id AS agentId, event_type AS eventType, provider, tool, risk, decision, resource_summary AS resourceSummary, metadata, redacted, prev_event_hash AS prevEventHash, event_hash AS eventHash, created_at AS timestamp FROM gov_audit_events WHERE action_id = ? ORDER BY created_at, rowid LIMIT ?").all(actionId, limit) as unknown as AuditEvent[];
    }
    return db.query("SELECT id, action_id AS actionId, run_id AS runId, session_id AS sessionId, actor_id AS actorId, agent_id AS agentId, event_type AS eventType, provider, tool, risk, decision, resource_summary AS resourceSummary, metadata, redacted, prev_event_hash AS prevEventHash, event_hash AS eventHash, created_at AS timestamp FROM gov_audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as unknown as AuditEvent[];
  }

  // --- Global state (kill switch) ------------------------------------------------------------

  getState(key: string): string | undefined {
    this.ensure();
    const row = openAgentOsDb().query("SELECT value FROM gov_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setState(key: string, value: string): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT key FROM gov_state WHERE key = ?").get(key);
    if (existing) {
      const stmt = db.query("UPDATE gov_state SET value = ? WHERE key = ?");
      stmt.run(value, key);
      return;
    }
    const stmt = db.query("INSERT INTO gov_state (key, value) VALUES (?, ?)");
    stmt.run(key, value);
  }

  getMode(): GovernanceMode {
    return (this.getState("mode") as GovernanceMode) ?? "normal";
  }

  setMode(mode: GovernanceMode): void {
    this.setState("mode", mode);
  }
}

export { newGovId };
