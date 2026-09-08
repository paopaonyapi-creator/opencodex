// Phase 20.3 — Desktop Agent Goal & Step Manager
//
// Manages the high-level goals and sequential execution steps of Desktop Sessions.
// Connects to SQLite tables `desktop_goals` and `desktop_steps`.

import { openAgentOsDb } from "../db";
import { transitionGoal, isGoalTerminal } from "./state-machine";
import { recordDesktopEvent } from "./session";
import type { DesktopGoal, DesktopStep, GoalStatus, DesktopRiskLevel, ActionType, ActionResultStatus, DesktopErrorCode } from "./types";

function generateGoalId(): string {
  return `dgoal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateStepId(): string {
  return `dstep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJson(str: unknown): Record<string, unknown> {
  if (typeof str !== "string") return {};
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToGoal(row: Record<string, unknown>): DesktopGoal {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    goalType: String(row.goal_type),
    title: String(row.title),
    description: String(row.description ?? ""),
    argumentsJson: parseJson(row.arguments_json),
    constraintsJson: parseJson(row.constraints_json),
    riskLevel: (row.risk_level ?? "MEDIUM") as DesktopRiskLevel,
    status: (row.status ?? "PENDING") as GoalStatus,
    createdBy: String(row.created_by ?? "operator"),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
  };
}

function rowToStep(row: Record<string, unknown>): DesktopStep {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    sessionId: String(row.session_id),
    stepIndex: Number(row.step_index),
    skillRunId: row.skill_run_id ? String(row.skill_run_id) : null,
    actionType: String(row.action_type) as ActionType,
    target: row.target ? String(row.target) : null,
    status: (row.status ?? "PENDING") as ActionResultStatus,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorCode: (row.error_code ? String(row.error_code) : null) as DesktopErrorCode | null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

export function createDesktopGoal(input: {
  sessionId: string;
  goalType: string;
  title: string;
  description?: string;
  arguments?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  riskLevel?: DesktopRiskLevel;
  createdBy?: string;
}): DesktopGoal {
  const db = openAgentOsDb();
  const id = generateGoalId();
  const now = new Date().toISOString();

  const goal: DesktopGoal = {
    id,
    sessionId: input.sessionId,
    goalType: input.goalType,
    title: input.title,
    description: input.description ?? "",
    argumentsJson: input.arguments ?? {},
    constraintsJson: input.constraints ?? {},
    riskLevel: input.riskLevel ?? "MEDIUM",
    status: "PENDING",
    createdBy: input.createdBy ?? "operator",
    createdAt: now,
    startedAt: null,
    completedAt: null,
    failureReason: null,
  };

  db.query(`INSERT INTO desktop_goals
    (id, session_id, goal_type, title, description, arguments_json, constraints_json, risk_level, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    goal.id,
    goal.sessionId,
    goal.goalType,
    goal.title,
    goal.description,
    JSON.stringify(goal.argumentsJson),
    JSON.stringify(goal.constraintsJson),
    goal.riskLevel,
    goal.status,
    goal.createdBy,
    goal.createdAt,
  );

  recordDesktopEvent(input.sessionId, "desktop.goal.created", { goalId: id, title: goal.title });
  return goal;
}

export function getDesktopGoal(id: string): DesktopGoal | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM desktop_goals WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToGoal(row);
}

export function listDesktopGoals(sessionId?: string, statusFilter?: GoalStatus): DesktopGoal[] {
  const db = openAgentOsDb();
  let query = "SELECT * FROM desktop_goals";
  const params: (string | number | boolean | null)[] = [];
  const where: string[] = [];

  if (sessionId) {
    where.push("session_id = ?");
    params.push(sessionId);
  }
  if (statusFilter) {
    where.push("status = ?");
    params.push(statusFilter);
  }

  if (where.length > 0) {
    query += " WHERE " + where.join(" AND ");
  }
  query += " ORDER BY created_at DESC";

  const rows = db.query(query).all(...params) as Record<string, unknown>[];
  return rows.map(rowToGoal);
}

export function updateGoalStatus(id: string, newStatus: GoalStatus, failureReason?: string): DesktopGoal {
  const goal = getDesktopGoal(id);
  if (!goal) throw new Error(`Goal not found: ${id}`);

  const validated = transitionGoal(goal.status, newStatus);
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { status: validated };
  if (validated === "RUNNING" && !goal.startedAt) updates.started_at = now;
  if (isGoalTerminal(validated)) updates.completed_at = now;
  if (failureReason) updates.failure_reason = failureReason;

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates) as (string | number | null)[];
  openAgentOsDb().query(`UPDATE desktop_goals SET ${setClauses} WHERE id = ?`).run(...values, id);

  const eventKind = validated === "RUNNING"
    ? "desktop.goal.started"
    : validated === "SUCCEEDED"
    ? "desktop.goal.completed"
    : validated === "FAILED"
    ? "desktop.goal.failed"
    : undefined;

  if (eventKind) {
    recordDesktopEvent(goal.sessionId, eventKind, { goalId: id, status: validated, failureReason });
  }

  return {
    ...goal,
    status: validated,
    startedAt: updates.started_at ? String(updates.started_at) : goal.startedAt,
    completedAt: updates.completed_at ? String(updates.completed_at) : goal.completedAt,
    failureReason: failureReason ?? goal.failureReason,
  };
}

export function cancelGoal(id: string, reason?: string): DesktopGoal {
  return updateGoalStatus(id, "CANCELLED", reason ?? "Cancelled by operator");
}

export function addGoalStep(input: {
  goalId: string;
  sessionId: string;
  actionType: ActionType;
  target?: string | null;
  stepIndex?: number;
  skillRunId?: string | null;
}): DesktopStep {
  const db = openAgentOsDb();
  const id = generateStepId();

  let index = input.stepIndex;
  if (index === undefined) {
    const last = db.query("SELECT MAX(step_index) as max_idx FROM desktop_steps WHERE goal_id = ?").get(input.goalId) as { max_idx: number | null } | null;
    index = (last?.max_idx ?? -1) + 1;
  }

  const step: DesktopStep = {
    id,
    goalId: input.goalId,
    sessionId: input.sessionId,
    stepIndex: index,
    skillRunId: input.skillRunId ?? null,
    actionType: input.actionType,
    target: input.target ?? null,
    status: "RETRYABLE",
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
  };

  db.query(`INSERT INTO desktop_steps
    (id, goal_id, session_id, step_index, skill_run_id, action_type, target, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    step.id,
    step.goalId,
    step.sessionId,
    step.stepIndex,
    step.skillRunId,
    step.actionType,
    step.target,
    step.status,
  );

  return step;
}

export function getGoalSteps(goalId: string): DesktopStep[] {
  const db = openAgentOsDb();
  const rows = db.query("SELECT * FROM desktop_steps WHERE goal_id = ? ORDER BY step_index ASC").all(goalId) as Record<string, unknown>[];
  return rows.map(rowToStep);
}

export function updateStepStatus(
  id: string,
  status: ActionResultStatus,
  errorCode?: DesktopErrorCode,
  errorMessage?: string,
): DesktopStep {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM desktop_steps WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!row) throw new Error(`Step not found: ${id}`);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status };
  if (status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") {
    updates.completed_at = now;
  }
  if (errorCode) updates.error_code = errorCode;
  if (errorMessage) updates.error_message = errorMessage;

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates) as (string | number | null)[];
  db.query(`UPDATE desktop_steps SET ${setClauses} WHERE id = ?`).run(...values, id);

  return {
    ...rowToStep(row),
    status,
    completedAt: updates.completed_at ? String(updates.completed_at) : null,
    errorCode: errorCode ?? null,
    errorMessage: errorMessage ?? null,
  };
}
