// Phase 20.82 — Sensorimotor Runtime Service Facade (CortexKit AFT contract).
//
// Single public entry point for management routes, CLI, and MCP tools.
// Coordinates sessions, perception, and transactional actions; exposes
// health (liveness + counters) and readiness (component matrix) diagnostics
// used by the dashboard, smoke tests, and the operational runbook.
//
// Dependency policy: external optional dependencies (OmniRoute daemon,
// TypeSafe Jev) report DEGRADED with structured reasons — they never crash
// the runtime and never flip the core sensorimotor readiness to false.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { openAgentOsDb } from "../db";
import { evaluateCapability } from "../policy";
import { createSession, closeSession, getSession, executeAction, getActionOutcome } from "./actions";
import { createPerception, getPerception } from "./perception";
import { describeJevIntegration } from "../decision/provider-mode";
import { getModelGateway } from "../model-gateway/gateway";
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

export interface ReadinessComponent {
  status: "ok" | "degraded" | "unavailable";
  detail: string;
  /** Structured, secret-free metadata for dashboards and runbooks. */
  meta?: Record<string, unknown>;
}

export interface AftReadiness {
  ok: boolean;
  degraded: boolean;
  phase: string;
  policyVersion: string;
  checkedAt: string;
  traceId: string;
  components: {
    sensorimotorRuntime: ReadinessComponent;
    workspace: ReadinessComponent;
    policyEngine: ReadinessComponent;
    checkpointStore: ReadinessComponent;
    auditTrail: ReadinessComponent;
    omniroute: ReadinessComponent;
    typesafeJev: ReadinessComponent;
  };
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
        idempotencyKey: input.idempotencyKey,
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

  /** Liveness + runtime counters (cheap, synchronous). */
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

  /**
   * Component readiness matrix. Core components (runtime, policy, checkpoint
   * store, audit) drive `ok`; optional external dependencies (OmniRoute,
   * TypeSafe Jev) report degraded/unavailable WITHOUT flipping `ok` — the
   * runtime executes local-only while they are down, by design.
   */
  async readiness(): Promise<AftReadiness> {
    const traceId = `aft_rdy_${randomUUID().slice(0, 16)}`;
    const checkedAt = new Date().toISOString();
    const components = {} as AftReadiness["components"];

    // Core: sensorimotor runtime counters
    const health = this.health();
    components.sensorimotorRuntime = health.ok
      ? { status: "ok", detail: `policy ${health.policyVersion}`, meta: { activeSessions: health.activeSessions, recentActions24h: health.recentActions24h, recentFailures24h: health.recentFailures24h } }
      : { status: "unavailable", detail: "runtime counters unavailable (agent-os database not reachable)" };

    // Core: agent-os database / workspace state
    try {
      const db = openAgentOsDb();
      const latest = db.query("SELECT workspace_root FROM sm_sessions ORDER BY created_at DESC LIMIT 1").get() as { workspace_root: string } | undefined;
      if (latest?.workspace_root) {
        const exists = existsSync(latest.workspace_root);
        components.workspace = exists
          ? { status: "ok", detail: "latest session workspace root accessible" }
          : { status: "degraded", detail: "latest session workspace root no longer exists on disk; sessions targeting it will fail" };
      } else {
        components.workspace = { status: "ok", detail: "no sessions recorded yet" };
      }
    } catch {
      components.workspace = { status: "unavailable", detail: "workspace state unreadable (database not reachable)" };
    }

    // Core: policy engine (deny-by-default capability evaluation)
    try {
      const rows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM policies").get() as { n: number };
      components.policyEngine = {
        status: "ok",
        detail: "deny-by-default policy engine reachable",
        meta: { activePolicies: rows.n },
      };
    } catch {
      components.policyEngine = { status: "unavailable", detail: "policy engine unreachable; mutation would fail closed" };
    }

    // Core: checkpoint store
    try {
      const rows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM sm_checkpoints").get() as { n: number };
      components.checkpointStore = {
        status: "ok",
        detail: "checkpoint store reachable (rollback capable)",
        meta: { checkpoints: rows.n },
      };
    } catch {
      components.checkpointStore = { status: "unavailable", detail: "checkpoint store unreachable; mutations cannot be made rollback-safe" };
    }

    // Core: audit trail
    try {
      const rows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM sm_audit").get() as { n: number };
      components.auditTrail = {
        status: "ok",
        detail: "audit trail reachable (secret-redacted)",
        meta: { events: rows.n },
      };
    } catch {
      components.auditTrail = { status: "unavailable", detail: "audit trail unreachable; actions cannot be governed" };
    }

    // Optional dependency: Phase 20.85 OmniRoute (ONE shared health system —
    // the model gateway's own probe, not a duplicate).
    try {
      const gatewayHealth = await getModelGateway().health();
      const omni = gatewayHealth.omniroute;
      if (!omni || omni.status === "disabled") {
        components.omniroute = { status: "degraded", detail: "OmniRoute routing disabled; local/direct adapter serves inference", meta: { activeAdapter: gatewayHealth.activeAdapter } };
      } else if (omni.status === "connected") {
        components.omniroute = { status: "ok", detail: "OmniRoute daemon reachable", meta: { baseUrl: omni.baseUrl, latencyMs: omni.latencyMs } };
      } else {
        components.omniroute = { status: "degraded", detail: "OmniRoute daemon unreachable; AFT planning degrades to local-only execution", meta: { baseUrl: omni.baseUrl, error: omni.error } };
      }
    } catch (err) {
      components.omniroute = { status: "degraded", detail: `OmniRoute health probe failed: ${err instanceof Error ? err.message : "unknown"}; runtime continues local-only` };
    }

    // Optional dependency: Phase 20.84 TypeSafe Jev
    const jev = describeJevIntegration();
    components.typesafeJev = {
      status: jev.status === "ready" ? "ok" : jev.status,
      detail: jev.note,
      meta: {
        mode: jev.mode,
        backend: jev.backend,
        realAvailable: jev.realAvailable,
        unavailableReasons: jev.unavailableReasons,
      },
    };

    const coreUnhealthy = (["sensorimotorRuntime", "policyEngine", "checkpointStore", "auditTrail"] as const)
      .some((k) => components[k].status === "unavailable");
    const anyDegraded = Object.values(components).some((c) => c.status !== "ok");

    return {
      ok: !coreUnhealthy,
      degraded: !coreUnhealthy && anyDegraded,
      phase: "20.82",
      policyVersion: SENSORIMOTOR_POLICY_VERSION,
      checkedAt,
      traceId,
      components,
    };
  }

  /** Policy snapshot for dashboards: current allow/deny capability rows. */
  policySnapshot(): { capabilities: string[]; policyCount: number } {
    try {
      const db = openAgentOsDb();
      const count = (db.query("SELECT COUNT(*) AS n FROM policies").get() as { n: number }).n;
      const rows = db.query("SELECT DISTINCT capability FROM policies").all() as Array<{ capability: string }>;
      return { capabilities: rows.map((r) => r.capability), policyCount: count };
    } catch {
      return { capabilities: [], policyCount: 0 };
    }
  }

  /** Exposed for parity checks: the single authoritative policy evaluator. */
  evaluatePolicy(actorId: string, capability: Parameters<typeof evaluateCapability>[2]) {
    return evaluateCapability("agent", actorId, capability);
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
