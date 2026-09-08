// Phase 20.3 — Desktop Management REST API Routes
//
// Endpoints mounted under /api/desktop/* and /api/agent-os/desktop/*
// Exposes sessions, goals, skills, profiles, observation, and emergency stop.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  createDesktopSession,
  getDesktopSession,
  listDesktopSessions,
  updateSessionStatus,
  triggerEmergencyStop,
} from "../../agent-os/desktop/session";
import {
  createDesktopGoal,
  getDesktopGoal,
  listDesktopGoals,
  cancelGoal,
  getGoalSteps,
} from "../../agent-os/desktop/goals";
import { getProfileRegistry } from "../../agent-os/desktop/profiles";
import { getSkillRegistry, getSkillRunner } from "../../agent-os/desktop/skills";
import { getObservationEngine } from "../../agent-os/desktop/observation";
import { getEmergencyStop } from "../../agent-os/desktop/safety";
import { openAgentOsDb } from "../../agent-os/db";
import { DESKTOP_AGENT_VERSION, DESKTOP_PROTOCOL_VERSION } from "../../agent-os/desktop/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleDesktopRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/desktop/")) {
    path = url.pathname.slice("/api/desktop/".length);
  } else if (url.pathname === "/api/desktop") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/desktop/")) {
    path = url.pathname.slice("/api/agent-os/desktop/".length);
  } else if (url.pathname === "/api/agent-os/desktop") {
    path = "";
  } else {
    return null;
  }

  // 1. GET /api/desktop/agent
  if ((path === "agent" || path === "") && req.method === "GET") {
    const stopInfo = getEmergencyStop().getStopInfo();
    const fg = getObservationEngine().getForeground();
    const profile = fg ? getProfileRegistry().matchWindow(fg) : null;

    return jsonResponse(
      {
        success: true,
        version: DESKTOP_AGENT_VERSION,
        protocol: DESKTOP_PROTOCOL_VERSION,
        status: stopInfo.stopped ? "EMERGENCY_STOPPED" : "HEALTHY",
        emergencyStopped: stopInfo.stopped,
        emergencyStopReason: stopInfo.reason,
        foregroundWindow: fg,
        matchedProfile: profile,
      },
      200,
      req,
      {},
    );
  }

  // 2. GET /api/desktop/profiles
  if (path === "profiles" && req.method === "GET") {
    return jsonResponse({ success: true, profiles: getProfileRegistry().list() }, 200, req, {});
  }

  // 3. GET /api/desktop/skills
  if (path === "skills" && req.method === "GET") {
    const profileId = url.searchParams.get("profileId") ?? undefined;
    return jsonResponse({ success: true, skills: getSkillRegistry().list(profileId) }, 200, req, {});
  }

  // 4. /api/desktop/sessions
  if (path === "sessions") {
    if (req.method === "GET") {
      const statusFilter = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ success: true, sessions: listDesktopSessions(statusFilter as never) }, 200, req, {});
    }
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // empty body
      }
      const session = createDesktopSession(body as never);
      return jsonResponse({ success: true, session }, 201, req, {});
    }
  }

  // 5. /api/desktop/sessions/:id/*
  if (path.startsWith("sessions/")) {
    const rest = path.slice("sessions/".length).split("/");
    const id = rest[0];
    const action = rest[1];

    if (!action && req.method === "GET") {
      const session = getDesktopSession(id);
      if (!session) return notFound(req, `Session not found: ${id}`);
      return jsonResponse({ success: true, session }, 200, req, {});
    }

    if (action === "start" && req.method === "POST") {
      updateSessionStatus(id, "STARTING");
      const session = updateSessionStatus(id, "RUNNING");
      return jsonResponse({ success: true, session }, 200, req, {});
    }

    if (action === "pause" && req.method === "POST") {
      const session = updateSessionStatus(id, "PAUSED");
      return jsonResponse({ success: true, session }, 200, req, {});
    }

    if (action === "resume" && req.method === "POST") {
      const session = updateSessionStatus(id, "RUNNING");
      return jsonResponse({ success: true, session }, 200, req, {});
    }

    if (action === "stop" && req.method === "POST") {
      updateSessionStatus(id, "STOPPING");
      const session = updateSessionStatus(id, "STOPPED");
      return jsonResponse({ success: true, session }, 200, req, {});
    }
  }

  // 6. POST /api/desktop/emergency-stop
  if (path === "emergency-stop" && req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      // empty
    }
    const reason = String(body.reason ?? "REST API Emergency Stop");
    triggerEmergencyStop(reason);
    return jsonResponse({ success: true, emergencyStopped: true, reason }, 200, req, {});
  }

  // 7. GET /api/desktop/windows
  if (path === "windows" && req.method === "GET") {
    return jsonResponse({ success: true, windows: getObservationEngine().listWindows() }, 200, req, {});
  }

  // 8. GET /api/desktop/foreground
  if (path === "foreground" && req.method === "GET") {
    const fg = getObservationEngine().getForeground();
    const profile = fg ? getProfileRegistry().matchWindow(fg) : null;
    return jsonResponse({ success: true, foreground: fg, profile }, 200, req, {});
  }

  // 9. /api/desktop/goals
  if (path === "goals") {
    if (req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") ?? undefined;
      return jsonResponse({ success: true, goals: listDesktopGoals(sessionId) }, 200, req, {});
    }
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.sessionId || !body.title) {
        return badRequest(req, "sessionId and title are required");
      }
      const goal = createDesktopGoal(body as never);
      return jsonResponse({ success: true, goal }, 201, req, {});
    }
  }

  // 10. /api/desktop/goals/:id/*
  if (path.startsWith("goals/")) {
    const rest = path.slice("goals/".length).split("/");
    const id = rest[0];
    const action = rest[1];

    if (!action && req.method === "GET") {
      const goal = getDesktopGoal(id);
      if (!goal) return notFound(req, `Goal not found: ${id}`);
      const steps = getGoalSteps(id);
      return jsonResponse({ success: true, goal, steps }, 200, req, {});
    }

    if (action === "cancel" && req.method === "POST") {
      const goal = cancelGoal(id);
      return jsonResponse({ success: true, goal }, 200, req, {});
    }
  }

  // 11. POST /api/desktop/skills/:id/run
  if (path.startsWith("skills/") && path.endsWith("/run") && req.method === "POST") {
    const skillId = path.slice("skills/".length, -"/run".length);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      // empty
    }
    const sessionId = String(body.sessionId ?? "");
    if (!sessionId) {
      return badRequest(req, "sessionId is required");
    }

    const runner = getSkillRunner();
    const result = await runner.execute({
      sessionId,
      skillId,
      arguments: (body.arguments as Record<string, unknown>) ?? {},
      mode: body.mode as never,
      dryRun: Boolean(body.dryRun),
    });

    return jsonResponse({ success: result.status === "SUCCEEDED", result }, 200, req, {});
  }

  // 12. GET /api/desktop/skill-runs/:id
  if (path.startsWith("skill-runs/") && req.method === "GET") {
    const runId = path.slice("skill-runs/".length);
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM desktop_skill_runs WHERE id = ?").get(runId);
    if (!row) return notFound(req, `Skill run not found: ${runId}`);
    return jsonResponse({ success: true, skillRun: row }, 200, req, {});
  }

  // 13. GET /api/desktop/actions
  if (path === "actions" && req.method === "GET") {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM desktop_actions ORDER BY created_at DESC LIMIT 50").all();
    return jsonResponse({ success: true, actions: rows }, 200, req, {});
  }

  // 14. GET /api/desktop/events
  if (path === "events" && req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId");
    const db = openAgentOsDb();
    const rows = sessionId
      ? db.query("SELECT * FROM desktop_events WHERE session_id = ? ORDER BY ts_ms DESC LIMIT 50").all(sessionId)
      : db.query("SELECT * FROM desktop_events ORDER BY ts_ms DESC LIMIT 50").all();
    return jsonResponse({ success: true, events: rows }, 200, req, {});
  }

  return notFound(req, `Desktop route not found: /api/desktop/${path}`);
}
