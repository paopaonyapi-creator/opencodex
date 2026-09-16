// Phase 20.25 — Universal Registry persistence over the shared Agent OS store.
//
// Same rules as every other Agent OS subsystem: local SQLite under
// OPENCODEX_HOME, one handle per process, no external database, no new process.
// Statements are static literals with `?` placeholders; statement text is never
// built from input. Writes are explicit check-then-insert/update so every write
// path stays obvious and auditable.

import { randomUUID } from "node:crypto";
import type { SQLQueryBindings } from "bun:sqlite";
import { openAgentOsDb } from "../db";
import type {
  ApprovalRecord,
  AuditEventInput,
  IngestedToolInput,
  PermissionClass,
  RegistryHealth,
  RegistryRiskLevel,
  RegistryToolStatus,
  RegistryToolType,
  RunRecord,
  RunStatus,
  RunStepRecord,
  StepStatus,
  ToolMetrics,
  ToolRecord,
  ToolchainPlan,
} from "./types";
import { permissionClassFor, requiresApprovalFor, riskLevelFor } from "./risk";
import { slugify } from "./util";

interface ToolRow {
  id: string;
  name: string;
  slug: string;
  provider: string;
  type: string;
  description: string;
  status: string;
  capabilities_json: string;
  input_types_json: string;
  output_types_json: string;
  auth_json: string;
  auth_status: string;
  runtime_json: string;
  risk_level: number;
  permission_class: string;
  requires_approval: number;
  cost_json: string;
  limits_json: string;
  quality_json: string;
  source_json: string;
  tags_json: string;
  executable: number;
  health: string;
  metrics_json: string;
  created_at: string;
  updated_at: string;
}

function rowToTool(row: ToolRow): ToolRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    provider: row.provider,
    type: row.type as RegistryToolType,
    description: row.description,
    status: row.status as RegistryToolStatus,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    inputTypes: JSON.parse(row.input_types_json) as string[],
    outputTypes: JSON.parse(row.output_types_json) as string[],
    auth: JSON.parse(row.auth_json) as ToolRecord["auth"],
    authStatus: row.auth_status as ToolRecord["authStatus"],
    runtime: JSON.parse(row.runtime_json) as ToolRecord["runtime"],
    risk: {
      level: row.risk_level as RegistryRiskLevel,
      permissionClass: row.permission_class as PermissionClass,
      requiresApproval: row.requires_approval === 1,
    },
    cost: JSON.parse(row.cost_json) as ToolRecord["cost"],
    limits: JSON.parse(row.limits_json) as ToolRecord["limits"],
    quality: JSON.parse(row.quality_json) as ToolRecord["quality"],
    source: JSON.parse(row.source_json) as ToolRecord["source"],
    tags: JSON.parse(row.tags_json) as string[],
    executable: row.executable === 1,
    health: row.health as RegistryHealth,
    metrics: JSON.parse(row.metrics_json) as ToolMetrics,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolWriteArgs(input: IngestedToolInput, riskLevel: RegistryRiskLevel, permissionClass: PermissionClass, requiresApproval: boolean): SQLQueryBindings[] {
  const capabilities = input.capabilities ?? [];
  return [
    input.name,
    slugify(input.slug ?? input.name),
    input.provider,
    input.type,
    input.description ?? "",
    input.status ?? "active",
    JSON.stringify(capabilities),
    JSON.stringify(input.inputTypes ?? []),
    JSON.stringify(input.outputTypes ?? []),
    JSON.stringify(input.auth ?? { type: "none" }),
    input.authStatus ?? "none",
    JSON.stringify(input.runtime ?? { execution: "remote", protocol: "https" }),
    riskLevel,
    permissionClass,
    requiresApproval ? 1 : 0,
    JSON.stringify(input.cost ?? { model: "unknown" }),
    JSON.stringify(input.limits ?? {}),
    JSON.stringify(input.quality ?? {}),
    JSON.stringify(input.source),
    JSON.stringify(input.tags ?? []),
    input.executable ? 1 : 0,
  ];
}

export class UniversalRegistryStore {
  upsertTool(input: IngestedToolInput): ToolRecord {
    const db = openAgentOsDb();
    const id = input.id ?? `tool_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const existing = db.query("SELECT created_at FROM registry_tools WHERE id = ?").get(id) as
      | { created_at: string }
      | undefined;
    const capabilities = input.capabilities ?? [];
    const permissionClass = input.permissionClass
      ?? (capabilities.length > 0 ? permissionClassFor(capabilities[0]) : "read_only");
    const riskLevel = (input.riskLevel
      ?? (capabilities.length > 0 ? riskLevelFor(capabilities[0]) : 0)) as RegistryRiskLevel;
    const requiresApproval = input.requiresApproval ?? requiresApprovalFor(riskLevel);
    const args = toolWriteArgs(input, riskLevel, permissionClass, requiresApproval);

    if (existing) {
      const stmt = db.query(`
        UPDATE registry_tools SET
          name = ?, slug = ?, provider = ?, type = ?, description = ?, status = ?,
          capabilities_json = ?, input_types_json = ?, output_types_json = ?,
          auth_json = ?, auth_status = ?, runtime_json = ?,
          risk_level = ?, permission_class = ?, requires_approval = ?,
          cost_json = ?, limits_json = ?, quality_json = ?, source_json = ?, tags_json = ?,
          executable = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(...args, now, id);
    } else {
      const stmt = db.query(`
        INSERT INTO registry_tools (
          id, name, slug, provider, type, description, status,
          capabilities_json, input_types_json, output_types_json,
          auth_json, auth_status, runtime_json,
          risk_level, permission_class, requires_approval,
          cost_json, limits_json, quality_json, source_json, tags_json,
          executable, health, metrics_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, ...args, "unknown", "{}", now, now);
    }
    return this.getTool(id)!;
  }

  getTool(id: string): ToolRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM registry_tools WHERE id = ?").get(id) as ToolRow | undefined;
    return row ? rowToTool(row) : null;
  }

  getToolBySlug(slug: string, provider?: string): ToolRecord | null {
    if (provider) {
      const scoped = openAgentOsDb()
        .query("SELECT * FROM registry_tools WHERE slug = ? AND provider = ?")
        .get(slug, provider) as ToolRow | undefined;
      return scoped ? rowToTool(scoped) : null;
    }
    const row = openAgentOsDb()
      .query("SELECT * FROM registry_tools WHERE slug = ?")
      .get(slug) as ToolRow | undefined;
    return row ? rowToTool(row) : null;
  }

  listTools(filter: { status?: RegistryToolStatus; sourceKind?: string } = {}): ToolRecord[] {
    const db = openAgentOsDb();
    if (filter.status) {
      const rows = db
        .query("SELECT * FROM registry_tools WHERE status = ? ORDER BY name")
        .all(filter.status) as ToolRow[];
      return rows.map(rowToTool);
    }
    if (filter.sourceKind) {
      const rows = db
        .query("SELECT * FROM registry_tools WHERE json_extract(source_json, '$.kind') = ? ORDER BY name")
        .all(filter.sourceKind) as ToolRow[];
      return rows.map(rowToTool);
    }
    const rows = db.query("SELECT * FROM registry_tools ORDER BY name").all() as ToolRow[];
    return rows.map(rowToTool);
  }

  countByType(): Record<string, number> {
    const rows = openAgentOsDb()
      .query("SELECT type, COUNT(*) AS n FROM registry_tools GROUP BY type ORDER BY n DESC")
      .all() as { type: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }

  countByHealth(): Record<string, number> {
    const rows = openAgentOsDb()
      .query("SELECT health, COUNT(*) AS n FROM registry_tools GROUP BY health")
      .all() as { health: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.health, r.n]));
  }

  setToolStatus(id: string, status: RegistryToolStatus): boolean {
    const stmt = openAgentOsDb()
      .query("UPDATE registry_tools SET status = ?, health = CASE WHEN ? = 'disabled' THEN 'disabled' ELSE health END, updated_at = ? WHERE id = ?");
    const result = stmt.run(status, status, new Date().toISOString(), id);
    return result.changes > 0;
  }

  setToolHealth(id: string, health: RegistryHealth): boolean {
    const stmt = openAgentOsDb().query("UPDATE registry_tools SET health = ?, updated_at = ? WHERE id = ?");
    const result = stmt.run(health, new Date().toISOString(), id);
    return result.changes > 0;
  }

  recordToolRun(id: string, ok: boolean, latencyMs: number, error?: string): void {
    const db = openAgentOsDb();
    const row = db.query("SELECT metrics_json FROM registry_tools WHERE id = ?").get(id) as { metrics_json: string } | undefined;
    if (!row) return;
    const metrics = JSON.parse(row.metrics_json) as ToolMetrics;
    metrics.runs += 1;
    if (ok) metrics.successes += 1;
    else metrics.failures += 1;
    metrics.avgLatencyMs = Math.round(((metrics.avgLatencyMs * (metrics.runs - 1)) + latencyMs) / metrics.runs);
    metrics.lastRunAt = new Date().toISOString();
    metrics.lastError = error;
    const errorRate = metrics.runs > 0 ? metrics.failures / metrics.runs : 0;
    const health: RegistryHealth = metrics.runs < 3
      ? "unknown"
      : errorRate >= 0.5 ? "offline" : errorRate >= 0.2 ? "degraded" : "healthy";
    const stmt = db.query("UPDATE registry_tools SET metrics_json = ?, health = ?, updated_at = ? WHERE id = ?");
    stmt.run(JSON.stringify(metrics), health, new Date().toISOString(), id);
  }

  addHealthSample(sample: { toolId: string; status: RegistryHealth; latencyMs?: number; error?: string }): void {
    const existing = openAgentOsDb()
      .query("SELECT tool_id FROM registry_tool_health WHERE tool_id = ? AND checked_at = ?")
      .get(sample.toolId, new Date().toISOString());
    if (existing) return;
    const stmt = openAgentOsDb()
      .query("INSERT INTO registry_tool_health (tool_id, status, latency_ms, checked_at, error) VALUES (?, ?, ?, ?, ?)");
    stmt.run(sample.toolId, sample.status, sample.latencyMs ?? null, new Date().toISOString(), sample.error ?? null);
  }

  listHealthSamples(toolId: string, limit = 20): Array<{ toolId: string; status: RegistryHealth; latencyMs?: number; checkedAt: string; error?: string }> {
    const rows = openAgentOsDb()
      .query("SELECT tool_id AS toolId, status, latency_ms AS latencyMs, checked_at AS checkedAt, error FROM registry_tool_health WHERE tool_id = ? ORDER BY checked_at DESC LIMIT ?")
      .all(toolId, limit) as Array<{ toolId: string; status: RegistryHealth; latencyMs?: number; checkedAt: string; error?: string }>;
    return rows;
  }

  // --- Runs ---------------------------------------------------------------

  saveRun(run: RunRecord): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM registry_runs WHERE id = ?").get(run.id);
    if (existing) {
      const stmt = db.query(`
        UPDATE registry_runs SET
          status = ?, plan_json = ?, risk_level = ?, approval_required = ?,
          estimated_cost = ?, error = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `);
      stmt.run(
        run.status,
        JSON.stringify(run.plan),
        run.riskLevel,
        run.approvalRequired ? 1 : 0,
        run.estimatedCost,
        run.error ?? null,
        run.updatedAt,
        run.completedAt ?? null,
        run.id,
      );
      return;
    }
    const stmt = db.query(`
      INSERT INTO registry_runs (
        id, goal, profile, mode, status, plan_json, risk_level,
        approval_required, estimated_cost, error, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.goal,
      run.profile,
      run.mode,
      run.status,
      JSON.stringify(run.plan),
      run.riskLevel,
      run.approvalRequired ? 1 : 0,
      run.estimatedCost,
      run.error ?? null,
      run.createdAt,
      run.updatedAt,
      run.completedAt ?? null,
    );
  }

  getRun(id: string): RunRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM registry_runs WHERE id = ?").get(id) as
      | { id: string; goal: string; profile: string; mode: string; status: string; plan_json: string; risk_level: number; approval_required: number; estimated_cost: string; error: string | null; created_at: string; updated_at: string; completed_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      goal: row.goal,
      profile: row.profile as RunRecord["profile"],
      mode: row.mode as RunRecord["mode"],
      status: row.status as RunStatus,
      plan: JSON.parse(row.plan_json) as ToolchainPlan,
      riskLevel: row.risk_level as RegistryRiskLevel,
      approvalRequired: row.approval_required === 1,
      estimatedCost: row.estimated_cost,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  listRuns(limit = 50): RunRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT id FROM registry_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as { id: string }[];
    return rows.map((r) => this.getRun(r.id)!).filter(Boolean);
  }

  saveStep(step: RunStepRecord): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM registry_run_steps WHERE id = ?").get(step.id);
    if (existing) {
      const stmt = db.query(`
        UPDATE registry_run_steps SET
          tool_id = ?, tool_name = ?, status = ?, input_summary = ?,
          output_summary = ?, error_code = ?, started_at = ?, finished_at = ?, latency_ms = ?
        WHERE id = ?
      `);
      stmt.run(
        step.toolId ?? null,
        step.toolName ?? null,
        step.status,
        step.inputSummary,
        step.outputSummary ?? null,
        step.errorCode ?? null,
        step.startedAt ?? null,
        step.finishedAt ?? null,
        step.latencyMs ?? null,
        step.id,
      );
      return;
    }
    const stmt = db.query(`
      INSERT INTO registry_run_steps (
        id, run_id, step_index, capability, tool_id, tool_name, status,
        input_summary, output_summary, error_code, started_at, finished_at, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      step.id,
      step.runId,
      step.stepIndex,
      step.capability,
      step.toolId ?? null,
      step.toolName ?? null,
      step.status,
      step.inputSummary,
      step.outputSummary ?? null,
      step.errorCode ?? null,
      step.startedAt ?? null,
      step.finishedAt ?? null,
      step.latencyMs ?? null,
    );
  }

  listSteps(runId: string): RunStepRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM registry_run_steps WHERE run_id = ? ORDER BY step_index")
      .all(runId) as Array<{
        id: string; run_id: string; step_index: number; capability: string; tool_id: string | null;
        tool_name: string | null; status: string; input_summary: string; output_summary: string | null;
        error_code: string | null; started_at: string | null; finished_at: string | null; latency_ms: number | null;
      }>;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      stepIndex: row.step_index,
      capability: row.capability,
      toolId: row.tool_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      status: row.status as StepStatus,
      inputSummary: row.input_summary,
      outputSummary: row.output_summary ?? undefined,
      errorCode: row.error_code ?? undefined,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      latencyMs: row.latency_ms ?? undefined,
    }));
  }

  // --- Approvals -----------------------------------------------------------

  createApproval(input: {
    runId?: string;
    stepId?: string;
    toolId: string;
    toolName?: string;
    action: string;
    riskLevel: RegistryRiskLevel;
    reason: string;
    preview: string;
    scope: "once" | "session";
  }): ApprovalRecord {
    const db = openAgentOsDb();
    const id = `appr_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    // "Approve for session" grants last 8h; there is deliberately no "forever".
    const expiresAt = input.scope === "session"
      ? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
      : undefined;
    const stmt = db.query(`
      INSERT INTO registry_approvals (
        id, run_id, step_id, tool_id, tool_name, action, risk_level,
        reason, preview, scope, status, requested_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.runId ?? null, input.stepId ?? null, input.toolId, input.toolName ?? null, input.action, input.riskLevel, input.reason, input.preview, input.scope, "pending", now, expiresAt ?? null);
    return this.getApproval(id)!;
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM registry_approvals WHERE id = ?").get(id) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      runId: (row.run_id as string) ?? undefined,
      stepId: (row.step_id as string) ?? undefined,
      toolId: row.tool_id as string,
      toolName: (row.tool_name as string) ?? undefined,
      action: row.action as string,
      riskLevel: row.risk_level as RegistryRiskLevel,
      reason: row.reason as string,
      preview: row.preview as string,
      scope: row.scope as "once" | "session",
      status: row.status as ApprovalRecord["status"],
      requestedAt: row.requested_at as string,
      decidedAt: (row.decided_at as string) ?? undefined,
      decidedBy: (row.decided_by as string) ?? undefined,
      expiresAt: (row.expires_at as string) ?? undefined,
    };
  }

  listApprovals(status?: ApprovalRecord["status"], limit = 50): ApprovalRecord[] {
    const db = openAgentOsDb();
    if (status) {
      const rows = db
        .query("SELECT id FROM registry_approvals WHERE status = ? ORDER BY requested_at DESC LIMIT ?")
        .all(status, limit) as { id: string }[];
      return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
    }
    const rows = db
      .query("SELECT id FROM registry_approvals ORDER BY requested_at DESC LIMIT ?")
      .all(limit) as { id: string }[];
    return rows.map((r) => this.getApproval(r.id)!).filter(Boolean);
  }

  resolveApproval(id: string, decision: "approved" | "rejected", decidedBy: string): ApprovalRecord | null {
    const stmt = openAgentOsDb()
      .query("UPDATE registry_approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'");
    const result = stmt.run(decision, new Date().toISOString(), decidedBy, id);
    return result.changes > 0 ? this.getApproval(id) : null;
  }

  /** Active "approve for session" grant for a tool, if any is still valid. */
  findSessionGrant(toolId: string): ApprovalRecord | null {
    const row = openAgentOsDb()
      .query("SELECT id FROM registry_approvals WHERE tool_id = ? AND scope = 'session' AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) ORDER BY decided_at DESC LIMIT 1")
      .get(toolId, new Date().toISOString()) as { id: string } | undefined;
    return row ? this.getApproval(row.id) : null;
  }

  // --- Audit ----------------------------------------------------------------

  appendAudit(input: AuditEventInput): void {
    const stmt = openAgentOsDb().query(`
      INSERT INTO registry_audit_events (
        ts_ms, run_id, step_id, tool_id, actor, action, status,
        input_summary, output_summary, error_code, permission_class,
        risk_level, approval_id, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      Date.now(),
      input.runId ?? null,
      input.stepId ?? null,
      input.toolId ?? null,
      input.actor ?? "agent",
      input.action,
      input.status ?? "ok",
      input.inputSummary ?? "",
      input.outputSummary ?? "",
      input.errorCode ?? null,
      input.permissionClass ?? null,
      input.riskLevel ?? null,
      input.approvalId ?? null,
      input.latencyMs ?? null,
    );
  }

  listAudit(limit = 100, runId?: string): Array<Record<string, unknown>> {
    const db = openAgentOsDb();
    if (runId) {
      return db
        .query("SELECT * FROM registry_audit_events WHERE run_id = ? ORDER BY ts_ms DESC LIMIT ?")
        .all(runId, limit) as Array<Record<string, unknown>>;
    }
    return db
      .query("SELECT * FROM registry_audit_events ORDER BY ts_ms DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
  }

  // --- Preferences / learning ----------------------------------------------

  setPreference(toolId: string, weight: number, reason: string, userId = "local"): void {
    const db = openAgentOsDb();
    const existing = db
      .query("SELECT tool_id FROM registry_preferences WHERE user_id = ? AND tool_id = ?")
      .get(userId, toolId);
    if (existing) {
      const stmt = db.query("UPDATE registry_preferences SET weight = ?, reason = ?, updated_at = ? WHERE user_id = ? AND tool_id = ?");
      stmt.run(weight, reason, new Date().toISOString(), userId, toolId);
      return;
    }
    const stmt = db.query("INSERT INTO registry_preferences (user_id, tool_id, weight, reason, updated_at) VALUES (?, ?, ?, ?, ?)");
    stmt.run(userId, toolId, weight, reason, new Date().toISOString());
  }

  getPreferenceWeight(toolId: string, userId = "local"): number {
    const row = openAgentOsDb()
      .query("SELECT weight FROM registry_preferences WHERE user_id = ? AND tool_id = ?")
      .get(userId, toolId) as { weight: number } | undefined;
    return row?.weight ?? 0;
  }
}
