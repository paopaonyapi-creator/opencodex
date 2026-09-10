// Phase 20.16 — Multi-AI Control Plane store.
//
// Additive tables on the existing Agent OS handle, matching the convention every
// other phase subsystem in this repository uses: no second database, no migration
// tool, no container.

import { openAgentOsDb } from "../db";
import {
  type AgentIdentity,
  type AgentRunEnvelope,
  type ArtifactRecord,
  type CreateTaskInput,
  type ReviewSubmission,
  type TaskEnvelope,
  type TaskStatus,
  type ToolCallRecord,
  type ToolCallOutcome,
  nowIso,
  newRunId,
  newTaskId,
} from "./types";

export class ControlPlaneStore {
  private initialized = false;

  /** Shared Agent OS handle. Exposed so the service can run its own approval SQL. */
  getDb(): ReturnType<typeof openAgentOsDb> {
    this.init();
    return openAgentOsDb();
  }

  /** Create this phase's tables. Idempotent and additive. */
  init(): void {
    if (this.initialized) return;
    openAgentOsDb().exec(`
      CREATE TABLE IF NOT EXISTS cp_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        goal TEXT NOT NULL,
        task_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        forbidden_tools_json TEXT NOT NULL DEFAULT '[]',
        inputs_json TEXT NOT NULL DEFAULT '[]',
        expected_outputs_json TEXT NOT NULL DEFAULT '[]',
        requires_review INTEGER NOT NULL DEFAULT 1,
        requires_user_approval INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_tasks_status ON cp_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_cp_tasks_project ON cp_tasks(project_id);

      CREATE TABLE IF NOT EXISTS cp_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        input_refs_json TEXT NOT NULL DEFAULT '[]',
        output_refs_json TEXT NOT NULL DEFAULT '[]',
        token_usage_json TEXT NOT NULL DEFAULT '{}',
        cost_json TEXT NOT NULL DEFAULT '{}',
        verdict TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cp_runs_task ON cp_runs(task_id);

      -- Append-only by convention: no code path updates or deletes these rows.
      CREATE TABLE IF NOT EXISTS cp_tool_calls (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        arguments_redacted_json TEXT NOT NULL DEFAULT '{}',
        risk TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT,
        approval_id TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_tool_calls_task ON cp_tool_calls(task_id);
      CREATE INDEX IF NOT EXISTS idx_cp_tool_calls_tool ON cp_tool_calls(tool);

      CREATE TABLE IF NOT EXISTS cp_reviews (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        role TEXT NOT NULL,
        verdict TEXT NOT NULL,
        severity TEXT NOT NULL,
        issues_json TEXT NOT NULL DEFAULT '[]',
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_reviews_task ON cp_reviews(task_id);

      CREATE TABLE IF NOT EXISTS cp_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT,
        artifact_type TEXT NOT NULL,
        name TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT '',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_artifacts_task ON cp_artifacts(task_id);
      CREATE INDEX IF NOT EXISTS idx_cp_artifacts_hash ON cp_artifacts(content_hash);

      CREATE TABLE IF NOT EXISTS cp_approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT,
        tool TEXT NOT NULL,
        risk TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cp_approvals_status ON cp_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_cp_approvals_task ON cp_approvals(task_id);

      CREATE TABLE IF NOT EXISTS cp_provider_usage (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        task_id TEXT,
        calls INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_usage_provider ON cp_provider_usage(provider);
    `);
    this.initialized = true;
  }

  // -- Tasks ---------------------------------------------------------------

  createTask(input: CreateTaskInput): TaskEnvelope {
    this.init();
    const now = nowIso();
    const task: TaskEnvelope = {
      task_id: newTaskId(),
      project_id: input.project_id,
      created_by: input.created_by ?? "user",
      goal: input.goal,
      task_type: input.task_type,
      risk_level: input.risk_level ?? "L1",
      workspace_root: input.workspace_root,
      allowed_tools: input.allowed_tools ?? [],
      forbidden_tools: input.forbidden_tools ?? [],
      inputs: input.inputs ?? [],
      expected_outputs: input.expected_outputs ?? [],
      requires_review: input.requires_review ?? true,
      requires_user_approval: input.requires_user_approval ?? false,
      status: "queued",
      created_at: now,
      updated_at: now,
    };
    openAgentOsDb().query(
      `INSERT INTO cp_tasks (id, project_id, created_by, goal, task_type, risk_level, workspace_root,
        allowed_tools_json, forbidden_tools_json, inputs_json, expected_outputs_json,
        requires_review, requires_user_approval, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.task_id,
      task.project_id,
      task.created_by,
      task.goal,
      task.task_type,
      task.risk_level,
      task.workspace_root,
      JSON.stringify(task.allowed_tools),
      JSON.stringify(task.forbidden_tools),
      JSON.stringify(task.inputs),
      JSON.stringify(task.expected_outputs),
      task.requires_review ? 1 : 0,
      task.requires_user_approval ? 1 : 0,
      task.status,
      task.created_at,
      task.updated_at,
    );
    return task;
  }

  getTask(taskId: string): TaskEnvelope | null {
    this.init();
    const row = openAgentOsDb().query("SELECT * FROM cp_tasks WHERE id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;
    return row ? mapTask(row) : null;
  }

  listTasks(status?: TaskStatus, limit = 100): TaskEnvelope[] {
    this.init();
    const db = openAgentOsDb();
    const rows = status
      ? (db.query("SELECT * FROM cp_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit) as Record<string, unknown>[])
      : (db.query("SELECT * FROM cp_tasks ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map(mapTask);
  }

  setTaskStatus(taskId: string, status: TaskStatus): boolean {
    this.init();
    const result = openAgentOsDb()
      .query("UPDATE cp_tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), taskId);
    return Number(result.changes ?? 0) > 0;
  }

  // -- Runs ----------------------------------------------------------------

  startRun(input: {
    taskId: string;
    agent: AgentIdentity;
    role: AgentRunEnvelope["role"];
    model?: string;
    inputRefs?: readonly string[];
  }): AgentRunEnvelope {
    this.init();
    const run: AgentRunEnvelope = {
      run_id: newRunId(),
      task_id: input.taskId,
      agent: input.agent,
      role: input.role,
      model: input.model ?? "",
      started_at: nowIso(),
      finished_at: null,
      status: "running",
      input_refs: input.inputRefs ?? [],
      output_refs: [],
      token_usage: {},
      cost: {},
      verdict: null,
      error: null,
    };
    openAgentOsDb().query(
      `INSERT INTO cp_runs (id, task_id, agent, role, model, status, input_refs_json, output_refs_json,
        token_usage_json, cost_json, verdict, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.run_id,
      run.task_id,
      run.agent,
      run.role,
      run.model,
      run.status,
      JSON.stringify(run.input_refs),
      JSON.stringify(run.output_refs),
      JSON.stringify(run.token_usage),
      JSON.stringify(run.cost),
      null,
      null,
      run.started_at,
      null,
    );
    return run;
  }

  finishRun(input: {
    runId: string;
    status: AgentRunEnvelope["status"];
    outputRefs?: readonly string[];
    verdict?: string;
    error?: string;
    tokenUsage?: Record<string, number>;
    cost?: Record<string, number>;
  }): boolean {
    this.init();
    const result = openAgentOsDb().query(
      `UPDATE cp_runs SET status = ?, finished_at = ?, output_refs_json = ?, verdict = ?, error = ?,
        token_usage_json = ?, cost_json = ? WHERE id = ?`,
    ).run(
      input.status,
      nowIso(),
      JSON.stringify(input.outputRefs ?? []),
      input.verdict ?? null,
      input.error ?? null,
      JSON.stringify(input.tokenUsage ?? {}),
      JSON.stringify(input.cost ?? {}),
      input.runId,
    );
    return Number(result.changes ?? 0) > 0;
  }

  listRuns(taskId: string): AgentRunEnvelope[] {
    this.init();
    const rows = openAgentOsDb()
      .query("SELECT * FROM cp_runs WHERE task_id = ? ORDER BY started_at")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  // -- Tool calls ----------------------------------------------------------

  recordToolCall(input: {
    taskId: string;
    runId: string;
    tool: string;
    argumentsRedacted: Record<string, unknown>;
    risk: string;
    outcome: ToolCallOutcome;
    reason?: string | null;
    approvalId?: string | null;
    durationMs?: number | null;
  }): ToolCallRecord {
    this.init();
    const record: ToolCallRecord = {
      id: `tcl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      run_id: input.runId,
      task_id: input.taskId,
      tool: input.tool,
      arguments_redacted: input.argumentsRedacted,
      risk: input.risk as ToolCallRecord["risk"],
      outcome: input.outcome,
      reason: input.reason ?? null,
      approval_id: input.approvalId ?? null,
      duration_ms: input.durationMs ?? null,
      created_at: nowIso(),
    };
    openAgentOsDb().query(
      `INSERT INTO cp_tool_calls (id, task_id, run_id, tool, arguments_redacted_json, risk, outcome, reason, approval_id, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.task_id,
      record.run_id,
      record.tool,
      JSON.stringify(record.arguments_redacted),
      record.risk,
      record.outcome,
      record.reason,
      record.approval_id,
      record.duration_ms,
      record.created_at,
    );
    return record;
  }

  listToolCalls(taskId?: string, limit = 200): ToolCallRecord[] {
    this.init();
    const db = openAgentOsDb();
    const rows = taskId
      ? (db.query("SELECT * FROM cp_tool_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT ?").all(taskId, limit) as Record<string, unknown>[])
      : (db.query("SELECT * FROM cp_tool_calls ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map(mapToolCall);
  }

  // -- Reviews -------------------------------------------------------------

  submitReview(review: ReviewSubmission): ReviewSubmission {
    this.init();
    openAgentOsDb().query(
      `INSERT INTO cp_reviews (id, task_id, reviewer, role, verdict, severity, issues_json, suggestions_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      review.id,
      review.task_id,
      review.reviewer,
      review.role,
      review.verdict,
      review.severity,
      JSON.stringify(review.issues),
      JSON.stringify(review.suggestions),
      review.confidence,
      review.created_at,
    );
    return review;
  }

  listReviews(taskId: string): ReviewSubmission[] {
    this.init();
    const rows = openAgentOsDb()
      .query("SELECT * FROM cp_reviews WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapReview);
  }

  // -- Artifacts -----------------------------------------------------------

  registerArtifact(artifact: ArtifactRecord): ArtifactRecord {
    this.init();
    openAgentOsDb().query(
      `INSERT INTO cp_artifacts (id, task_id, run_id, artifact_type, name, project, provenance_json, content_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      artifact.id,
      artifact.task_id,
      artifact.run_id,
      artifact.artifact_type,
      artifact.name,
      artifact.project,
      JSON.stringify(artifact.provenance),
      artifact.content_hash,
      artifact.status,
      artifact.created_at,
    );
    return artifact;
  }

  listArtifacts(taskId?: string, limit = 200): ArtifactRecord[] {
    this.init();
    const db = openAgentOsDb();
    const rows = taskId
      ? (db.query("SELECT * FROM cp_artifacts WHERE task_id = ? ORDER BY created_at DESC LIMIT ?").all(taskId, limit) as Record<string, unknown>[])
      : (db.query("SELECT * FROM cp_artifacts ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map(mapArtifact);
  }

  getArtifact(id: string): ArtifactRecord | null {
    this.init();
    const row = openAgentOsDb().query("SELECT * FROM cp_artifacts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapArtifact(row) : null;
  }

  // -- Test seam -----------------------------------------------------------

  reset(): void {
    this.init();
    openAgentOsDb().exec(
      "DELETE FROM cp_tasks; DELETE FROM cp_runs; DELETE FROM cp_tool_calls; DELETE FROM cp_reviews;" +
        "DELETE FROM cp_artifacts; DELETE FROM cp_approvals; DELETE FROM cp_provider_usage;",
    );
  }
}

function mapTask(row: Record<string, unknown>): TaskEnvelope {
  return {
    task_id: String(row.id),
    project_id: String(row.project_id),
    created_by: String(row.created_by) as TaskEnvelope["created_by"],
    goal: String(row.goal),
    task_type: String(row.task_type) as TaskEnvelope["task_type"],
    risk_level: String(row.risk_level) as TaskEnvelope["risk_level"],
    workspace_root: String(row.workspace_root),
    allowed_tools: JSON.parse(String(row.allowed_tools_json ?? "[]")),
    forbidden_tools: JSON.parse(String(row.forbidden_tools_json ?? "[]")),
    inputs: JSON.parse(String(row.inputs_json ?? "[]")),
    expected_outputs: JSON.parse(String(row.expected_outputs_json ?? "[]")),
    requires_review: Number(row.requires_review) === 1,
    requires_user_approval: Number(row.requires_user_approval) === 1,
    status: String(row.status) as TaskStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): AgentRunEnvelope {
  return {
    run_id: String(row.id),
    task_id: String(row.task_id),
    agent: String(row.agent) as AgentIdentity,
    role: String(row.role) as AgentRunEnvelope["role"],
    model: String(row.model ?? ""),
    started_at: String(row.started_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
    status: String(row.status) as AgentRunEnvelope["status"],
    input_refs: JSON.parse(String(row.input_refs_json ?? "[]")),
    output_refs: JSON.parse(String(row.output_refs_json ?? "[]")),
    token_usage: JSON.parse(String(row.token_usage_json ?? "{}")),
    cost: JSON.parse(String(row.cost_json ?? "{}")),
    verdict: row.verdict ? String(row.verdict) : null,
    error: row.error ? String(row.error) : null,
  };
}

function mapToolCall(row: Record<string, unknown>): ToolCallRecord {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    task_id: String(row.task_id),
    tool: String(row.tool),
    arguments_redacted: JSON.parse(String(row.arguments_redacted_json ?? "{}")),
    risk: String(row.risk) as ToolCallRecord["risk"],
    outcome: String(row.outcome) as ToolCallOutcome,
    reason: row.reason ? String(row.reason) : null,
    approval_id: row.approval_id ? String(row.approval_id) : null,
    duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    created_at: String(row.created_at),
  };
}

function mapReview(row: Record<string, unknown>): ReviewSubmission {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    reviewer: String(row.reviewer) as AgentIdentity,
    role: String(row.role) as ReviewSubmission["role"],
    verdict: String(row.verdict) as ReviewSubmission["verdict"],
    severity: String(row.severity) as ReviewSubmission["severity"],
    issues: JSON.parse(String(row.issues_json ?? "[]")),
    suggestions: JSON.parse(String(row.suggestions_json ?? "[]")),
    confidence: Number(row.confidence ?? 0),
    created_at: String(row.created_at),
  };
}

function mapArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    run_id: row.run_id ? String(row.run_id) : null,
    artifact_type: String(row.artifact_type) as ArtifactRecord["artifact_type"],
    name: String(row.name),
    project: String(row.project ?? ""),
    provenance: JSON.parse(String(row.provenance_json ?? "{}")),
    content_hash: String(row.content_hash),
    status: String(row.status) as ArtifactRecord["status"],
    created_at: String(row.created_at),
  };
}

let defaultStore: ControlPlaneStore | null = null;
export function getControlPlaneStore(): ControlPlaneStore {
  if (!defaultStore) defaultStore = new ControlPlaneStore();
  return defaultStore;
}

export function resetControlPlaneStore(): void {
  if (defaultStore) defaultStore.reset();
  defaultStore = null;
}
