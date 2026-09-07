// Phase 20.3 — Desktop Agent Session Manager
//
// Manages lifecycle of desktop automation sessions. Sessions own goals,
// track foreground windows, and enforce emergency stop.

import { openAgentOsDb } from "../db";
import { transitionSession, isSessionTerminal } from "./state-machine";
import type { DesktopSession, SessionStatus, ExecutionMode } from "./types";
import { DESKTOP_AGENT_VERSION } from "./types";

function generateId(): string {
  return `dsess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDesktopSession(input: {
  ownerUserId?: string;
  machineId?: string;
  mode?: ExecutionMode;
  dryRun?: boolean;
  policyProfile?: string;
  metadata?: Record<string, unknown>;
}): DesktopSession {
  const db = openAgentOsDb();
  const id = generateId();
  const now = new Date().toISOString();

  const session: DesktopSession = {
    id,
    ownerUserId: input.ownerUserId ?? "local",
    machineId: input.machineId ?? "local",
    status: "CREATED",
    mode: input.mode ?? "ASSISTED",
    createdAt: now,
    startedAt: null,
    pausedAt: null,
    endedAt: null,
    currentGoalId: null,
    currentAppProfileId: null,
    foregroundWindowId: null,
    emergencyStopped: false,
    dryRun: input.dryRun ?? false,
    policyProfile: input.policyProfile ?? "default",
    lastHeartbeatAt: null,
    metadata: input.metadata ?? {},
  };

  db.query(`INSERT INTO desktop_sessions
    (id, owner_user_id, machine_id, status, mode, created_at, dry_run, policy_profile, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    session.id,
    session.ownerUserId,
    session.machineId,
    session.status,
    session.mode,
    session.createdAt,
    session.dryRun ? 1 : 0,
    session.policyProfile,
    JSON.stringify(session.metadata),
  );

  recordDesktopEvent(id, "desktop.session.created", { mode: session.mode, dryRun: session.dryRun });
  return session;
}

export function getDesktopSession(id: string): DesktopSession | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM desktop_sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToSession(row);
}

export function listDesktopSessions(statusFilter?: SessionStatus): DesktopSession[] {
  const db = openAgentOsDb();
  const query = statusFilter
    ? "SELECT * FROM desktop_sessions WHERE status = ? ORDER BY created_at DESC"
    : "SELECT * FROM desktop_sessions ORDER BY created_at DESC";
  const rows = (statusFilter
    ? db.query(query).all(statusFilter)
    : db.query(query).all()) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function updateSessionStatus(id: string, newStatus: SessionStatus): DesktopSession {
  const session = getDesktopSession(id);
  if (!session) throw new Error(`Session not found: ${id}`);

  const validated = transitionSession(session.status, newStatus);
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { status: validated, updated_at: now };
  if (validated === "RUNNING" && !session.startedAt) updates.started_at = now;
  if (validated === "PAUSED") updates.paused_at = now;
  if (isSessionTerminal(validated)) updates.ended_at = now;
  if (validated === "EMERGENCY_STOPPED") updates.emergency_stopped = 1;

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates) as (string | number | null)[];
  openAgentOsDb().query(`UPDATE desktop_sessions SET ${setClauses} WHERE id = ?`).run(...values, id);

  return { ...session, status: validated };
}

export function startSession(id: string): DesktopSession {
  updateSessionStatus(id, "STARTING");
  const started = updateSessionStatus(id, "RUNNING");
  recordDesktopEvent(id, "desktop.session.started", {});
  return started;
}

export function pauseSession(id: string): DesktopSession {
  const result = updateSessionStatus(id, "PAUSED");
  recordDesktopEvent(id, "desktop.session.paused", {});
  return result;
}

export function resumeSession(id: string): DesktopSession {
  const result = updateSessionStatus(id, "RUNNING");
  recordDesktopEvent(id, "desktop.session.resumed", {});
  return result;
}

export function stopSession(id: string): DesktopSession {
  updateSessionStatus(id, "STOPPING");
  const result = updateSessionStatus(id, "STOPPED");
  recordDesktopEvent(id, "desktop.session.stopped", {});
  return result;
}

export function emergencyStopSession(id: string): DesktopSession {
  const result = updateSessionStatus(id, "EMERGENCY_STOPPED");
  recordDesktopEvent(id, "desktop.emergency_stop", { sessionId: id });
  return result;
}

export function emergencyStopAll(): number {
  const db = openAgentOsDb();
  const active = db.query(
    "SELECT id FROM desktop_sessions WHERE status IN ('RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'BLOCKED', 'STARTING')",
  ).all() as { id: string }[];

  for (const { id } of active) {
    try {
      emergencyStopSession(id);
    } catch {
      // Force-update even if transition fails (e.g. from STARTING)
      db.query("UPDATE desktop_sessions SET status = 'EMERGENCY_STOPPED', emergency_stopped = 1, ended_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
    }
  }
  return active.length;
}

export function updateSessionHeartbeat(id: string): void {
  openAgentOsDb()
    .query("UPDATE desktop_sessions SET last_heartbeat_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function setSessionForeground(id: string, windowId: string | null, profileId: string | null): void {
  openAgentOsDb()
    .query("UPDATE desktop_sessions SET foreground_window_id = ?, current_app_profile_id = ? WHERE id = ?")
    .run(windowId, profileId, id);
}

export function setSessionGoal(id: string, goalId: string | null): void {
  openAgentOsDb()
    .query("UPDATE desktop_sessions SET current_goal_id = ? WHERE id = ?")
    .run(goalId, id);
}

// ─── Desktop Event Recording ────────────────────────────────────────

export function recordDesktopEvent(
  sessionId: string,
  kind: string,
  payload: Record<string, unknown>,
): void {
  openAgentOsDb()
    .query("INSERT INTO desktop_events (id, session_id, kind, ts_ms, payload_json) VALUES (?, ?, ?, ?, ?)")
    .run(
      `devt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      kind,
      Date.now(),
      JSON.stringify(payload),
    );
}

export function listDesktopEvents(sessionId: string, limit = 100): Array<{ id: string; kind: string; tsMs: number; payload: Record<string, unknown> }> {
  const rows = openAgentOsDb()
    .query("SELECT * FROM desktop_events WHERE session_id = ? ORDER BY ts_ms DESC LIMIT ?")
    .all(sessionId, limit) as Array<{ id: string; session_id: string; kind: string; ts_ms: number; payload_json: string }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    tsMs: r.ts_ms,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
  }));
}

// ─── Goal Management ────────────────────────────────────────────────

export function createDesktopGoal(input: {
  sessionId: string;
  goalType: string;
  title: string;
  description?: string;
  arguments?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  riskLevel?: string;
  createdBy?: string;
}): { id: string; status: string } {
  const db = openAgentOsDb();
  const id = `dgoal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  db.query(`INSERT INTO desktop_goals
    (id, session_id, goal_type, title, description, arguments_json, constraints_json, risk_level, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.sessionId,
    input.goalType,
    input.title,
    input.description ?? "",
    JSON.stringify(input.arguments ?? {}),
    JSON.stringify(input.constraints ?? {}),
    input.riskLevel ?? "MEDIUM",
    "PENDING",
    input.createdBy ?? "operator",
    now,
  );

  recordDesktopEvent(input.sessionId, "desktop.goal.created", { goalId: id, title: input.title });
  return { id, status: "PENDING" };
}

export function getDesktopGoal(id: string): Record<string, unknown> | null {
  return openAgentOsDb().query("SELECT * FROM desktop_goals WHERE id = ?").get(id) as Record<string, unknown> | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): DesktopSession {
  return {
    id: row.id as string,
    ownerUserId: row.owner_user_id as string,
    machineId: row.machine_id as string,
    status: row.status as SessionStatus,
    mode: row.mode as ExecutionMode,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) || null,
    pausedAt: (row.paused_at as string) || null,
    endedAt: (row.ended_at as string) || null,
    currentGoalId: (row.current_goal_id as string) || null,
    currentAppProfileId: (row.current_app_profile_id as string) || null,
    foregroundWindowId: (row.foreground_window_id as string) || null,
    emergencyStopped: row.emergency_stopped === 1,
    dryRun: row.dry_run === 1,
    policyProfile: row.policy_profile as string,
    lastHeartbeatAt: (row.last_heartbeat_at as string) || null,
    metadata: JSON.parse((row.metadata_json as string) || "{}") as Record<string, unknown>,
  };
}
