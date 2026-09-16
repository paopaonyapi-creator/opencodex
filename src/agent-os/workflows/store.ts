// Phase 20.29 — Workflow persistence: additive wf_* tables on the shared
// Agent OS handle (store convention from Phases 20.16/20.27/20.28). Inline
// static literals; check-then-insert writes; runs persist after every step
// (doc §15).

import { openAgentOsDb } from "../db";
import { newWorkflowId } from "./types";
import type {
  CompiledWorkflow,
  ParsedWorkflow,
  RunState,
  StepState,
  WorkflowAuditEntry,
  WorkflowRun,
  WorkflowStepRun,
} from "./types";

export class WorkflowStore {
  private initialized = false;

  private ensure(): void {
    if (this.initialized) return;
    const db = openAgentOsDb();
    db.query("CREATE TABLE IF NOT EXISTS wf_workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', category TEXT, enabled INTEGER NOT NULL DEFAULT 0, current_version TEXT NOT NULL, checksum TEXT NOT NULL, approved_checksum TEXT, risk_level TEXT, source TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS wf_versions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version TEXT NOT NULL, checksum TEXT NOT NULL, raw_md TEXT NOT NULL, approved_checksum TEXT, created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_wf_versions_wf ON wf_versions(workflow_id)").run();
    db.query("CREATE TABLE IF NOT EXISTS wf_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version TEXT NOT NULL, checksum TEXT NOT NULL, state TEXT NOT NULL, dry_run INTEGER NOT NULL DEFAULT 0, safe_mode INTEGER NOT NULL DEFAULT 0, current_step_index INTEGER NOT NULL DEFAULT 0, retry_count INTEGER NOT NULL DEFAULT 0, risk_level TEXT, approval_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_wf_runs_wf ON wf_runs(workflow_id, created_at DESC)").run();
    db.query("CREATE TABLE IF NOT EXISTS wf_step_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_index INTEGER NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', output_summary TEXT, error TEXT, retry_count INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_wf_steps_run ON wf_step_runs(run_id, step_index)").run();
    db.query("CREATE TABLE IF NOT EXISTS wf_audit_logs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version TEXT NOT NULL, run_id TEXT, step_index INTEGER, event_type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_wf_audit_run ON wf_audit_logs(run_id)").run();
    db.query("CREATE TABLE IF NOT EXISTS wf_schedules (workflow_id TEXT PRIMARY KEY, cron TEXT, interval_seconds INTEGER, last_run_at TEXT, next_run_at TEXT, timezone TEXT)").run();
    this.initialized = true;
  }

  // --- Registry ----------------------------------------------------------------

  registerWorkflow(parsed: ParsedWorkflow, compiled: CompiledWorkflow, source: string, enabled: boolean): void {
    this.ensure();
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const existing = db.query("SELECT id, checksum, approved_checksum AS approvedChecksum FROM wf_workflows WHERE id = ?").get(parsed.frontMatter.id) as
      | { id: string; checksum: string; approvedChecksum: string | null }
      | undefined;
    if (existing) {
      // Checksum semantics (doc §56): the approved reference is retained so a
      // changed checksum BLOCKS execution until re-approval. Same content
      // keeps the approval intact.
      const approved = existing.approvedChecksum ?? null;
      const stmt = db.query("UPDATE wf_workflows SET name = ?, description = ?, category = ?, current_version = ?, checksum = ?, approved_checksum = ?, risk_level = ?, updated_at = ? WHERE id = ?");
      stmt.run(parsed.frontMatter.name, parsed.frontMatter.description ?? "", parsed.frontMatter.category ?? "", parsed.frontMatter.version, parsed.checksum, approved, compiled.riskLevel, now, parsed.frontMatter.id);
    } else {
      const stmt = db.query("INSERT INTO wf_workflows (id, name, description, category, enabled, current_version, checksum, approved_checksum, risk_level, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      stmt.run(parsed.frontMatter.id, parsed.frontMatter.name, parsed.frontMatter.description ?? "", parsed.frontMatter.category ?? "", enabled ? 1 : 0, parsed.frontMatter.version, parsed.checksum, null, compiled.riskLevel, source, now, now);
    }
    const versionId = newWorkflowId("wfver");
    const stmtV = db.query("INSERT INTO wf_versions (id, workflow_id, version, checksum, raw_md, approved_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    stmtV.run(versionId, parsed.frontMatter.id, parsed.frontMatter.version, parsed.checksum, JSON.stringify(parsed), enabled && existing ? parsed.checksum : null, now);
  }

  listWorkflows(): Array<Record<string, unknown>> {
    this.ensure();
    return openAgentOsDb()
      .query("SELECT id, name, description, category, enabled, current_version AS currentVersion, checksum, risk_level AS riskLevel, source, created_at AS createdAt, updated_at AS updatedAt FROM wf_workflows ORDER BY name")
      .all() as Array<Record<string, unknown>>;
  }

  getWorkflowMeta(id: string): { id: string; name: string; enabled: boolean; checksum: string; currentVersion: string; riskLevel: string; source: string } | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT id, name, enabled, checksum, current_version AS currentVersion, risk_level AS riskLevel, source FROM wf_workflows WHERE id = ?")
      .get(id) as { id: string; name: string; enabled: number; checksum: string; currentVersion: string; riskLevel: string; source: string } | undefined;
    if (!row) return null;
    return { ...row, enabled: row.enabled === 1 };
  }

  setEnabled(id: string, enabled: boolean): boolean {
    this.ensure();
    const stmt = openAgentOsDb().query("UPDATE wf_workflows SET enabled = ?, updated_at = ? WHERE id = ?");
    return stmt.run(enabled ? 1 : 0, new Date().toISOString(), id).changes > 0;
  }

  getLatestRaw(id: string): { raw: ParsedWorkflow; compiled: CompiledWorkflow; approvedChecksum: string | null } | null {
    this.ensure();
    const wfRow = openAgentOsDb()
      .query("SELECT approved_checksum AS approvedChecksum FROM wf_workflows WHERE id = ?")
      .get(id) as { approvedChecksum: string | null } | undefined;
    const row = openAgentOsDb()
      .query("SELECT raw_md AS raw FROM wf_versions WHERE workflow_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(id) as { raw: string } | undefined;
    if (!row) return null;
    return { raw: JSON.parse(row.raw) as ParsedWorkflow, compiled: null as unknown as CompiledWorkflow, approvedChecksum: wfRow?.approvedChecksum ?? null };
  }

  setApprovedChecksum(id: string, checksum: string): boolean {
    this.ensure();
    const stmt = openAgentOsDb().query("UPDATE wf_workflows SET approved_checksum = ? WHERE id = ?");
    return stmt.run(checksum, id).changes > 0;
  }

  // --- Runs -----------------------------------------------------------------------

  createRun(run: WorkflowRun): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO wf_runs (id, workflow_id, version, checksum, state, dry_run, safe_mode, current_step_index, retry_count, risk_level, approval_id, error, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      run.id, run.workflowId, run.version, run.checksum, run.state, run.dryRun ? 1 : 0,
      run.mode === "safe" ? 1 : 0, run.currentStepIndex, run.retryCount, run.riskLevel,
      run.approvalId ?? null, run.error ?? null, run.createdAt, run.updatedAt, run.completedAt ?? null,
    );
  }

  updateRunState(id: string, state: RunState, extra: { error?: string; approvalId?: string; currentStepIndex?: number } = {}): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("UPDATE wf_runs SET state = ?, updated_at = ?, error = COALESCE(?, error), approval_id = COALESCE(?, approval_id), current_step_index = COALESCE(?, current_step_index), completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE completed_at END WHERE id = ?");
    const now = new Date().toISOString();
    stmt.run(state, now, extra.error ?? null, extra.approvalId ?? null, extra.currentStepIndex ?? null, state, now, id);
  }

  getRun(id: string): WorkflowRun | null {
    this.ensure();
    const row = openAgentOsDb().query("SELECT * FROM wf_runs WHERE id = ?").get(id) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      workflowId: row.workflow_id as string,
      version: row.version as string,
      checksum: row.checksum as string,
      state: row.state as RunState,
      dryRun: row.dry_run === 1,
      mode: (row.safe_mode === 1 ? "safe" : "normal") as WorkflowRun["mode"],
      currentStepIndex: row.current_step_index as number,
      retryCount: row.retry_count as number,
      riskLevel: row.risk_level as WorkflowRun["riskLevel"],
      approvalId: (row.approval_id as string) ?? undefined,
      error: (row.error as string) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
    };
  }

  listRuns(workflowId?: string, limit = 50): WorkflowRun[] {
    this.ensure();
    const db = openAgentOsDb();
    if (workflowId) {
      const rows = db.query("SELECT id FROM wf_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?").all(workflowId, limit) as Array<{ id: string }>;
      return rows.map((r) => this.getRun(r.id)!).filter(Boolean);
    }
    const rows = db.query("SELECT id FROM wf_runs ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: string }>;
    return rows.map((r) => this.getRun(r.id)!).filter(Boolean);
  }

  /** Duplicate-run protection for scheduled dispatch (doc §22). */
  hasActiveRun(workflowId: string): boolean {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT id FROM wf_runs WHERE workflow_id = ? AND state IN ('queued','planning','running','retrying','awaiting_approval') LIMIT 1")
      .get(workflowId);
    return Boolean(row);
  }

  // --- Step runs ----------------------------------------------------------------------

  saveStepRun(step: WorkflowStepRun): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM wf_step_runs WHERE id = ?").get(step.id);
    if (existing) {
      const stmt = db.query("UPDATE wf_step_runs SET state = ?, output_summary = ?, error = ?, retry_count = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE id = ?");
      stmt.run(step.state, step.outputSummary ?? null, step.error ?? null, step.retryCount, step.startedAt ?? null, step.completedAt ?? null, step.id);
      return;
    }
    const stmt = db.query("INSERT INTO wf_step_runs (id, run_id, step_index, title, state, output_summary, error, retry_count, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(step.id, step.runId, step.stepIndex, step.title, step.state, step.outputSummary ?? null, step.error ?? null, step.retryCount, step.startedAt ?? null, step.completedAt ?? null);
  }

  listStepRuns(runId: string): WorkflowStepRun[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT id, run_id AS runId, step_index AS stepIndex, title, state, output_summary AS outputSummary, error, retry_count AS retryCount, started_at AS startedAt, completed_at AS completedAt FROM wf_step_runs WHERE run_id = ? ORDER BY step_index")
      .all(runId) as unknown as WorkflowStepRun[];
    return rows;
  }

  // --- Audit -----------------------------------------------------------------------------

  appendAudit(entry: WorkflowAuditEntry): void {
    this.ensure();
    const stmt = openAgentOsDb()
      .query("INSERT INTO wf_audit_logs (id, workflow_id, version, run_id, step_index, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(entry.id, entry.workflowId, entry.version, entry.runId ?? null, entry.stepIndex ?? null, entry.eventType, entry.detail, entry.timestamp);
  }

  listAudit(limit = 100, runId?: string): WorkflowAuditEntry[] {
    this.ensure();
    const db = openAgentOsDb();
    if (runId) {
      return db.query("SELECT id, workflow_id AS workflowId, version, run_id AS runId, step_index AS stepIndex, event_type AS eventType, detail, created_at AS timestamp FROM wf_audit_logs WHERE run_id = ? ORDER BY created_at, rowid LIMIT ?").all(runId, limit) as unknown as WorkflowAuditEntry[];
    }
    return db.query("SELECT id, workflow_id AS workflowId, version, run_id AS runId, step_index AS stepIndex, event_type AS eventType, detail, created_at AS timestamp FROM wf_audit_logs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as unknown as WorkflowAuditEntry[];
  }

  // --- Scheduler ----------------------------------------------------------------------------

  upsertSchedule(workflowId: string, cron?: string, intervalSeconds?: number, timezone?: string): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT workflow_id FROM wf_schedules WHERE workflow_id = ?").get(workflowId);
    if (existing) {
      const stmt = db.query("UPDATE wf_schedules SET cron = ?, interval_seconds = ?, timezone = ? WHERE workflow_id = ?");
      stmt.run(cron ?? null, intervalSeconds ?? null, timezone ?? null, workflowId);
      return;
    }
    const stmt = db.query("INSERT INTO wf_schedules (workflow_id, cron, interval_seconds, last_run_at, next_run_at, timezone) VALUES (?, ?, ?, NULL, NULL, ?)");
    stmt.run(workflowId, cron ?? null, intervalSeconds ?? null, timezone ?? null);
  }

  dueScheduledWorkflows(nowMs: number): Array<{ workflowId: string; intervalSeconds?: number }> {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT s.workflow_id AS workflowId, s.interval_seconds AS intervalSeconds, s.last_run_at AS lastRunAt, w.enabled AS enabled FROM wf_schedules s JOIN wf_workflows w ON w.id = s.workflow_id WHERE s.interval_seconds IS NOT NULL")
      .all() as Array<{ workflowId: string; intervalSeconds: number; lastRunAt: string | null; enabled: number }>;
    return rows
      .filter((row) => row.enabled === 1)
      .filter((row) => {
        if (!row.lastRunAt) return true;
        return new Date(row.lastRunAt).getTime() + row.intervalSeconds * 1000 <= nowMs;
      })
      .map((row) => ({ workflowId: row.workflowId, intervalSeconds: row.intervalSeconds }));
  }

  markScheduledRun(workflowId: string): void {
    this.ensure();
    const stmt = openAgentOsDb().query("UPDATE wf_schedules SET last_run_at = ? WHERE workflow_id = ?");
    stmt.run(new Date().toISOString(), workflowId);
  }
}

export { newWorkflowId };
