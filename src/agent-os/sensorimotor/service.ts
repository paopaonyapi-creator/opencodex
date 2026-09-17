// Phase 20.82 — Sensorimotor Runtime Service Facade (CortexKit AFT contract).
//
// Single public entry point for management routes, CLI, and MCP tools.
// Coordinates sessions, perception, and transactional actions; exposes
// health/readiness diagnostics used by the dashboard and smoke tests.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { createSession, closeSession, getSession, executeAction, getActionOutcome } from "./actions";
import { createPerception, getPerception } from "./perception";
import { SensorimotorError, type ActionOutcome, type ActionRequest, type PerceptionResult, type SensorimotorSession } from "./types";
import { SENSORIMOTOR_POLICY_VERSION } from "./types";

export interface CreateSessionInput {
  workspaceRoot: string;
  actorId: string;
  goal?: string;
}

export interface ExecuteActionInput extends Omit<ActionRequest, "sessionId"> {
  sessionId?: string;
  /** Convenience: creates an ephemeral session when no sessionId is supplied. */
  workspaceRoot?: string;
  actorId?: string;
}

export class SensorimotorService {
  createSession(input: CreateSessionInput): SensorimotorSession {
    if (!input.workspaceRoot || !input.actorId) {
      throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 400, "workspaceRoot and actorId are required");
    }
    const session = createSession({
      workspaceRoot: input.workspaceRoot,
      actorId: input.actorId,
      goal: input.goal,
    });
    this.audit(session.id, null, input.actorId, "session_created", "ok", { workspaceRoot: input.workspaceRoot });
    return session;
  }

  getSession(sessionId: string): SensorimotorSession {
    const session = getSession(sessionId);
    if (!session) {
      throw new SensorimotorError("SENSORIMOTOR_SESSION_NOT_FOUND", 404, `session not found: ${sessionId}`);
    }
    return session;
  }

  closeSession(sessionId: string, status: "closed" | "aborted" = "closed"): SensorimotorSession {
    const session = closeSession(sessionId, status);
    this.audit(sessionId, null, session.actorId, "session_closed", status, {});
    return session;
  }

  perceive(sessionId: string, kind?: "tree" | "symbols", maxFiles?: number): PerceptionResult {
    const session = this.getSession(sessionId);
    return createPerception({
      sessionId: session.id,
      workspaceRoot: session.workspaceRoot,
      kind,
      maxFiles,
    });
  }

  getPerception(perceptionId: string): PerceptionResult {
    const p = getPerception(perceptionId);
    if (!p) {
      throw new SensorimotorError("SENSORIMOTOR_ACTION_NOT_FOUND", 404, `perception not found: ${perceptionId}`);
    }
    return p;
  }

  async executeAction(input: ExecuteActionInput, signal?: AbortSignal): Promise<ActionOutcome> {
    let sessionId = input.sessionId;
    if (!sessionId) {
      if (!input.workspaceRoot) {
        throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 400, "sessionId or workspaceRoot is required");
      }
      const session = this.createSession({
        workspaceRoot: input.workspaceRoot,
        actorId: input.actorId ?? "operator",
        goal: "ephemeral action session",
      });
      sessionId = session.id;
    }
    return executeAction(
      {
        sessionId,
        kind: input.kind,
        target: input.target,
        content: input.content,
        destination: input.destination,
        timeoutMs: input.timeoutMs,
        maxAttempts: input.maxAttempts,
      },
      { signal },
    );
  }

  getActionOutcome(actionId: string): ActionOutcome {
    const outcome = getActionOutcome(actionId);
    if (!outcome) {
      throw new SensorimotorError("SENSORIMOTOR_ACTION_NOT_FOUND", 404, `action not found: ${actionId}`);
    }
    return outcome;
  }

  listSessions(limit = 20): SensorimotorSession[] {
    const db = openAgentOsDb();
    const rows = db
      .query("SELECT * FROM sm_sessions ORDER BY created_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 100))) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      workspaceRoot: r.workspace_root as string,
      actorId: r.actor_id as string,
      status: r.status as SensorimotorSession["status"],
      goal: (r.goal as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  listActions(sessionId: string, limit = 50): Array<Pick<ActionOutcome, "actionId" | "kind" | "target" | "status" | "attempt">> {
    this.getSession(sessionId);
    const db = openAgentOsDb();
    const rows = db
      .query("SELECT id, kind, target, status, attempt FROM sm_actions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(sessionId, Math.max(1, Math.min(limit, 200))) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      actionId: r.id as string,
      kind: r.kind as ActionOutcome["kind"],
      target: r.target as string,
      status: r.status as ActionOutcome["status"],
      attempt: r.attempt as number,
    }));
  }

  health(): {
    ok: boolean;
    policyVersion: string;
    activeSessions: number;
    recentActions24h: number;
    recentFailures24h: number;
  } {
    try {
      const db = openAgentOsDb();
      const active = db.query("SELECT COUNT(*) AS n FROM sm_sessions WHERE status = 'active'").get() as { n: number };
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const recent = db.query("SELECT COUNT(*) AS n FROM sm_actions WHERE created_at >= ?").get(since) as { n: number };
      const failures = db
        .query("SELECT COUNT(*) AS n FROM sm_actions WHERE created_at >= ? AND status IN ('failed', 'rolled_back', 'timed_out')")
        .get(since) as { n: number };
      return {
        ok: true,
        policyVersion: SENSORIMOTOR_POLICY_VERSION,
        activeSessions: active.n,
        recentActions24h: recent.n,
        recentFailures24h: failures.n,
      };
    } catch {
      return { ok: false, policyVersion: SENSORIMOTOR_POLICY_VERSION, activeSessions: 0, recentActions24h: 0, recentFailures24h: 0 };
    }
  }

  private audit(sessionId: string | null, actionId: string | null, actorId: string, event: string, decision: string, details: Record<string, unknown>): void {
    try {
      openAgentOsDb().run(
        "INSERT INTO sm_audit (id, session_id, action_id, actor_id, event, decision, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [`sma_${randomUUID().slice(0, 16)}`, sessionId, actionId, actorId, event, decision, JSON.stringify(details), new Date().toISOString()],
      );
    } catch {
      // audit best-effort
    }
  }
}

let defaultService: SensorimotorService | null = null;

export function getSensorimotorService(): SensorimotorService {
  if (!defaultService) {
    defaultService = new SensorimotorService();
  }
  return defaultService;
}
