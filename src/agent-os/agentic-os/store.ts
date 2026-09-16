// Phase 20.37 — Agentic OS persistence over the shared agent-os SQLite store
// (spec §7-§8 translated to the repo's SQLite conventions: TEXT ids, ISO
// timestamps, JSON-as-text with bounded payloads, additive migration).
// Static single-line SQL, bound parameters, check-then-insert.

import { openAgentOsDb } from "../db";
import type {
  AgentManifest,
  HookPolicy,
  MemoryRecord,
  MemoryType,
  RunRecord,
  RunStatus,
  SkillManifest,
  WorktreeRecord,
  WorktreeStatus,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class AgenticOsStore {
  // --- registries ---------------------------------------------------------------

  replaceAgents(agents: AgentManifest[]): void {
    const db = openAgentOsDb();
    const keepEnabled = new Map(
      (db.query("SELECT slug, enabled FROM orch_agents").all() as Array<{ slug: string; enabled: number }>).map((row) => [row.slug, row.enabled === 1]),
    );
    db.query("DELETE FROM orch_agents").run();
    for (const agent of agents) {
      const hash = "sha256:" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      db.query("INSERT INTO orch_agents (id, slug, name, description, version, runtime_kind, risk_ceiling, enabled, capabilities_json, tools_allow_json, tools_deny_json, skills_json, routing_json, limits_json, manifest_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("oag"), agent.slug, agent.name, agent.description, agent.version, agent.runtime.preferred, agent.riskCeiling, (keepEnabled.get(agent.slug) ?? agent.enabled) ? 1 : 0, JSON.stringify(agent.capabilities), JSON.stringify(agent.tools.allow), JSON.stringify(agent.tools.deny), JSON.stringify(agent.skills), JSON.stringify(agent.routing), JSON.stringify(agent.limits), hash, nowIso(), nowIso());
    }
  }

  listAgents(): AgentManifest[] {
    const rows = openAgentOsDb().query("SELECT * FROM orch_agents ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapAgentRow);
  }

  getAgent(idOrSlug: string): AgentManifest | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_agents WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as Record<string, unknown> | null;
    return row ? mapAgentRow(row) : null;
  }

  setAgentEnabled(idOrSlug: string, enabled: boolean): boolean {
    const result = openAgentOsDb().query("UPDATE orch_agents SET enabled = ?, updated_at = ? WHERE id = ? OR slug = ?").run(enabled ? 1 : 0, nowIso(), idOrSlug, idOrSlug);
    return Number(result.changes) > 0;
  }

  replaceSkills(skills: SkillManifest[]): void {
    const db = openAgentOsDb();
    const keepEnabled = new Map(
      (db.query("SELECT slug, enabled FROM orch_skills").all() as Array<{ slug: string; enabled: number }>).map((row) => [row.slug, row.enabled === 1]),
    );
    db.query("DELETE FROM orch_skills").run();
    for (const skill of skills) {
      const hash = "sha256:" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      db.query("INSERT INTO orch_skills (id, slug, name, description, version, enabled, risk_level, trigger_terms_json, capabilities_json, required_tools_json, optional_tools_json, workflow_json, manifest_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("osk"), skill.slug, skill.name, skill.description, skill.version, (keepEnabled.get(skill.slug) ?? skill.enabled) ? 1 : 0, skill.riskLevel, JSON.stringify(skill.triggerTerms), JSON.stringify(skill.capabilities), JSON.stringify(skill.tools.required), JSON.stringify(skill.tools.optional), JSON.stringify(skill.workflow), hash, nowIso(), nowIso());
    }
  }

  listSkills(): SkillManifest[] {
    const rows = openAgentOsDb().query("SELECT * FROM orch_skills ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapSkillRow);
  }

  getSkill(idOrSlug: string): SkillManifest | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_skills WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as Record<string, unknown> | null;
    return row ? mapSkillRow(row) : null;
  }

  setSkillEnabled(idOrSlug: string, enabled: boolean): boolean {
    const result = openAgentOsDb().query("UPDATE orch_skills SET enabled = ?, updated_at = ? WHERE id = ? OR slug = ?").run(enabled ? 1 : 0, nowIso(), idOrSlug, idOrSlug);
    return Number(result.changes) > 0;
  }

  replaceHookPolicies(policies: HookPolicy[]): void {
    const db = openAgentOsDb();
    db.query("DELETE FROM orch_hook_policies").run();
    for (const policy of policies) {
      db.query("INSERT INTO orch_hook_policies (id, slug, event, priority, mode, action, enabled, when_json, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("ohp"), policy.id, policy.event, policy.priority, policy.mode, policy.action, 1, JSON.stringify(policy.when), policy.message, nowIso(), nowIso());
    }
  }

  listHookPolicies(): HookPolicy[] {
    const rows = openAgentOsDb().query("SELECT * FROM orch_hook_policies ORDER BY priority ASC, rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.slug),
      event: String(row.event) as HookPolicy["event"],
      priority: Number(row.priority),
      mode: String(row.mode) as HookPolicy["mode"],
      action: String(row.action) as HookPolicy["action"],
      when: JSON.parse(String(row.when_json ?? "{}")) as HookPolicy["when"],
      message: String(row.message ?? ""),
    }));
  }

  // --- runs -------------------------------------------------------------------------

  insertRun(run: RunRecord): void {
    openAgentOsDb()
      .query("INSERT INTO orch_runs (id, workflow_slug, requested_by, source, status, risk_level, route_json, input_summary, output_summary, concern_summary, approval_id, worktree_id, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, run.workflowSlug, run.requestedBy, run.source, run.status, run.riskLevel, run.routeJson, run.inputSummary, run.outputSummary, run.concernSummary, run.approvalId, run.worktreeId, run.createdAt, run.updatedAt, run.completedAt);
  }

  getRun(id: string): RunRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRunRow(row) : null;
  }

  listRuns(status?: string, limit = 50): RunRecord[] {
    const db = openAgentOsDb();
    const rows = status
      ? db.query("SELECT * FROM orch_runs WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(status, Math.min(limit, 200)) as Array<Record<string, unknown>>
      : db.query("SELECT * FROM orch_runs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map(mapRunRow);
  }

  updateRun(id: string, patch: Partial<Pick<RunRecord, "status" | "riskLevel" | "routeJson" | "outputSummary" | "concernSummary" | "approvalId" | "worktreeId" | "completedAt">>): RunRecord | null {
    const run = this.getRun(id);
    if (!run) return null;
    const next: RunRecord = { ...run, ...patch, updatedAt: nowIso() };
    openAgentOsDb()
      .query("UPDATE orch_runs SET status = ?, risk_level = ?, route_json = ?, output_summary = ?, concern_summary = ?, approval_id = ?, worktree_id = ?, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(next.status, next.riskLevel, next.routeJson, next.outputSummary, next.concernSummary, next.approvalId, next.worktreeId, next.updatedAt, next.completedAt, id);
    return next;
  }

  // --- tool calls / approvals / audit -----------------------------------------------------

  insertToolCall(entry: { runId: string; agentSlug: string; toolName: string; toolKind: string; riskLevel: number; policyDecision: string; requestSummary: string; responseSummary: string | null; durationMs: number }): void {
    openAgentOsDb()
      .query("INSERT INTO orch_tool_calls (id, run_id, agent_slug, tool_name, tool_kind, risk_level, policy_decision, request_summary, response_summary, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("otc"), entry.runId, entry.agentSlug, entry.toolName.slice(0, 200), entry.toolKind, entry.riskLevel, entry.policyDecision, entry.requestSummary.slice(0, 500), entry.responseSummary, entry.durationMs, nowIso());
  }

  listToolCalls(runId: string): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM orch_tool_calls WHERE run_id = ? ORDER BY created_at ASC, rowid ASC").all(runId) as Array<Record<string, unknown>>;
  }

  insertApproval(entry: { runId: string; title: string; reason: string; actionSummary: string; riskLevel: number; requestedBy: string }): string {
    const id = newId("oapr");
    openAgentOsDb()
      .query("INSERT INTO orch_approvals (id, run_id, approval_type, risk_level, title, reason, action_summary, status, requested_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
      .run(id, entry.runId, "tool_execution", entry.riskLevel, entry.title.slice(0, 240), entry.reason, entry.actionSummary.slice(0, 500), entry.requestedBy, new Date(Date.now() + 60 * 60 * 1000).toISOString(), nowIso());
    return id;
  }

  getApproval(id: string): { id: string; runId: string; status: string; riskLevel: number } | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_approvals WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return { id: String(row.id), runId: String(row.run_id), status: String(row.status), riskLevel: Number(row.risk_level) };
  }

  resolveApproval(id: string, decision: "approved" | "rejected", decidedBy: string): boolean {
    const result = openAgentOsDb()
      .query("UPDATE orch_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(decision, decidedBy, nowIso(), id);
    return Number(result.changes) > 0;
  }

  listApprovals(status?: string, limit = 50): Array<Record<string, unknown>> {
    const db = openAgentOsDb();
    const rows = status
      ? db.query("SELECT * FROM orch_approvals WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(status, Math.min(limit, 200)) as Array<Record<string, unknown>>
      : db.query("SELECT * FROM orch_approvals ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows;
  }

  appendAuditEvent(entry: { runId: string | null; eventType: string; severity: string; actorRef: string; targetType?: string; targetRef?: string; summary: string; metadata?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO orch_audit_events (id, run_id, event_type, severity, actor_ref, target_type, target_ref, summary, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("oae"), entry.runId, entry.eventType.slice(0, 120), entry.severity, entry.actorRef.slice(0, 200), entry.targetType ?? null, entry.targetRef?.slice(0, 500) ?? null, entry.summary.slice(0, 500), JSON.stringify(entry.metadata ?? {}).slice(0, 4000), nowIso());
  }

  listAuditEvents(filters: { runId?: string; eventType?: string; severity?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    const db = openAgentOsDb();
    const limit = Math.min(filters.limit ?? 50, 200);
    if (filters.runId && filters.eventType) {
      return db.query("SELECT * FROM orch_audit_events WHERE run_id = ? AND event_type = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(filters.runId, filters.eventType, limit) as Array<Record<string, unknown>>;
    }
    if (filters.runId) {
      return db.query("SELECT * FROM orch_audit_events WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(filters.runId, limit) as Array<Record<string, unknown>>;
    }
    if (filters.eventType) {
      return db.query("SELECT * FROM orch_audit_events WHERE event_type = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(filters.eventType, limit) as Array<Record<string, unknown>>;
    }
    if (filters.severity) {
      return db.query("SELECT * FROM orch_audit_events WHERE severity = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(filters.severity, limit) as Array<Record<string, unknown>>;
    }
    return db.query("SELECT * FROM orch_audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  }

  // --- worktrees ---------------------------------------------------------------------------

  insertWorktree(record: WorktreeRecord): void {
    openAgentOsDb()
      .query("INSERT INTO orch_worktrees (id, run_id, repo_root, worktree_path, branch_name, base_revision, status, is_dirty, created_at, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.runId, record.repoRoot, record.worktreePath, record.branchName, record.baseRevision, record.status, record.isDirty ? 1 : 0, record.createdAt, record.releasedAt);
  }

  getWorktree(id: string): WorktreeRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_worktrees WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapWorktreeRow(row) : null;
  }

  listWorktrees(status?: WorktreeStatus): WorktreeRecord[] {
    const rows = status
      ? openAgentOsDb().query("SELECT * FROM orch_worktrees WHERE status = ? ORDER BY created_at DESC, rowid DESC").all(status) as Array<Record<string, unknown>>
      : openAgentOsDb().query("SELECT * FROM orch_worktrees ORDER BY created_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
    return rows.map(mapWorktreeRow);
  }

  updateWorktree(id: string, patch: { status?: WorktreeStatus; isDirty?: boolean; releasedAt?: string | null; runId?: string | null }): WorktreeRecord | null {
    const record = this.getWorktree(id);
    if (!record) return null;
    const next: WorktreeRecord = { ...record, ...patch };
    openAgentOsDb()
      .query("UPDATE orch_worktrees SET status = ?, is_dirty = ?, released_at = ?, run_id = ? WHERE id = ?")
      .run(next.status, next.isDirty ? 1 : 0, next.releasedAt, next.runId, id);
    return next;
  }

  // --- memories ------------------------------------------------------------------------------

  upsertMemory(entry: { runId: string | null; memoryType: MemoryType; scope: string; key: string; summary: string; confidence: number | null; sourceRef: string | null }): MemoryRecord {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM orch_memories WHERE scope = ? AND key = ?").get(entry.scope, entry.key) as { id: string } | null;
    if (existing) {
      db.query("UPDATE orch_memories SET summary = ?, confidence = ?, source_ref = ?, run_id = ?, updated_at = ? WHERE id = ?")
        .run(entry.summary.slice(0, 500), entry.confidence, entry.sourceRef, entry.runId, nowIso(), existing.id);
      return this.getMemory(existing.id)!;
    }
    const id = newId("omem");
    db.query("INSERT INTO orch_memories (id, run_id, memory_type, scope, key, summary, confidence, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, entry.runId, entry.memoryType, entry.scope, entry.key, entry.summary.slice(0, 500), entry.confidence, entry.sourceRef, nowIso(), nowIso());
    return this.getMemory(id)!;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM orch_memories WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapMemoryRow(row) : null;
  }

  listMemories(scope?: string, limit = 50): MemoryRecord[] {
    const db = openAgentOsDb();
    const rows = scope
      ? db.query("SELECT * FROM orch_memories WHERE scope = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(scope, Math.min(limit, 200)) as Array<Record<string, unknown>>
      : db.query("SELECT * FROM orch_memories ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map(mapMemoryRow);
  }
}

// --- row mappers ---------------------------------------------------------------

function mapAgentRow(row: Record<string, unknown>): AgentManifest {
  return {
    slug: String(row.slug) as AgentManifest["slug"],
    name: String(row.name),
    description: String(row.description),
    version: String(row.version),
    enabled: Number(row.enabled ?? 1) === 1,
    runtime: { preferred: String(row.runtime_kind) as AgentManifest["runtime"]["preferred"], fallbacks: [] },
    riskCeiling: Number(row.risk_ceiling ?? 1) as AgentManifest["riskCeiling"],
    capabilities: JSON.parse(String(row.capabilities_json ?? "[]")) as string[],
    tools: { allow: JSON.parse(String(row.tools_allow_json ?? "[]")) as string[], deny: JSON.parse(String(row.tools_deny_json ?? "[]")) as string[] },
    skills: JSON.parse(String(row.skills_json ?? "[]")) as string[],
    routing: JSON.parse(String(row.routing_json ?? "{}")) as AgentManifest["routing"],
    limits: JSON.parse(String(row.limits_json ?? "{}")) as AgentManifest["limits"],
  };
}

function mapSkillRow(row: Record<string, unknown>): SkillManifest {
  return {
    slug: String(row.slug) as SkillManifest["slug"],
    name: String(row.name),
    description: String(row.description),
    version: String(row.version),
    enabled: Number(row.enabled ?? 1) === 1,
    riskLevel: Number(row.risk_level ?? 0) as SkillManifest["riskLevel"],
    triggerTerms: JSON.parse(String(row.trigger_terms_json ?? "[]")) as string[],
    capabilities: JSON.parse(String(row.capabilities_json ?? "[]")) as string[],
    tools: { required: JSON.parse(String(row.required_tools_json ?? "[]")) as string[], optional: JSON.parse(String(row.optional_tools_json ?? "[]")) as string[] },
    workflow: JSON.parse(String(row.workflow_json ?? "{}")) as SkillManifest["workflow"],
  };
}

function mapRunRow(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    workflowSlug: String(row.workflow_slug),
    requestedBy: String(row.requested_by ?? ""),
    source: String(row.source ?? "internal"),
    status: String(row.status) as RunStatus,
    riskLevel: Number(row.risk_level ?? 0),
    routeJson: row.route_json ? String(row.route_json) : null,
    inputSummary: String(row.input_summary ?? ""),
    outputSummary: row.output_summary ? String(row.output_summary) : null,
    concernSummary: row.concern_summary ? String(row.concern_summary) : null,
    approvalId: row.approval_id ? String(row.approval_id) : null,
    worktreeId: row.worktree_id ? String(row.worktree_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapWorktreeRow(row: Record<string, unknown>): WorktreeRecord {
  return {
    id: String(row.id),
    runId: row.run_id ? String(row.run_id) : null,
    repoRoot: String(row.repo_root),
    worktreePath: String(row.worktree_path),
    branchName: row.branch_name ? String(row.branch_name) : null,
    baseRevision: row.base_revision ? String(row.base_revision) : null,
    status: String(row.status) as WorktreeStatus,
    isDirty: Number(row.is_dirty ?? 0) === 1,
    createdAt: String(row.created_at),
    releasedAt: row.released_at ? String(row.released_at) : null,
  };
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    runId: row.run_id ? String(row.run_id) : null,
    memoryType: String(row.memory_type) as MemoryType,
    scope: String(row.scope),
    key: String(row.key),
    summary: String(row.summary),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    sourceRef: row.source_ref ? String(row.source_ref) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export { newId as newOrchId };
