// Phase 20.82 — Sensorimotor runtime management routes
// (/api/agent-os/sensorimotor/*).
//
// Equality-guard dispatcher matching the management surface pattern
// (code-review / skill-gate precedent). Sessions, perception, transactional
// actions, and health. Every mutating route passes through the runtime's own
// policy/approval gates — routes only validate shape and dispatch.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSensorimotorService } from "../../agent-os/sensorimotor/service";
import { SensorimotorError } from "../../agent-os/sensorimotor/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof SensorimotorError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.httpStatus, req, {});
  }
  return jsonResponse(
    { error: { code: "sensorimotor_error", message: err instanceof Error ? err.message : "internal_error" } },
    500,
    req,
    {},
  );
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleSensorimotorRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getSensorimotorService();

  try {
    // 1. GET /api/agent-os/sensorimotor/health
    if (req.method === "GET" && pathname === "/api/agent-os/sensorimotor/health") {
      return jsonResponse({ phase: "20.82", ...service.health() }, 200, req, {});
    }

    // 2. GET /api/agent-os/sensorimotor/sessions
    if (req.method === "GET" && pathname === "/api/agent-os/sensorimotor/sessions") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const sessions = service.listSessions(Number.isFinite(limit) ? limit : 20);
      return jsonResponse({ ok: true, sessions }, 200, req, {});
    }

    // 3. POST /api/agent-os/sensorimotor/sessions
    if (req.method === "POST" && pathname === "/api/agent-os/sensorimotor/sessions") {
      const body = await readJson(req);
      const workspaceRoot = String(body.workspaceRoot ?? "").trim();
      const actorId = String(body.actorId ?? "operator").slice(0, 64);
      const goal = typeof body.goal === "string" ? body.goal.slice(0, 512) : undefined;
      if (!workspaceRoot) {
        return jsonResponse({ error: { code: "INVALID_REQUEST", message: "workspaceRoot is required" } }, 400, req, {});
      }
      const session = service.createSession({ workspaceRoot, actorId, goal });
      return jsonResponse({ ok: true, session }, 200, req, {});
    }

    // 4. GET /api/agent-os/sensorimotor/actions?sessionId=...
    if (req.method === "GET" && pathname === "/api/agent-os/sensorimotor/actions") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!sessionId) {
        return jsonResponse({ error: { code: "INVALID_REQUEST", message: "sessionId is required" } }, 400, req, {});
      }
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return jsonResponse({ ok: true, actions: service.listActions(sessionId, Number.isFinite(limit) ? limit : 50) }, 200, req, {});
    }

    // 5. POST /api/agent-os/sensorimotor/actions — transactional execution
    if (req.method === "POST" && pathname === "/api/agent-os/sensorimotor/actions") {
      const body = await readJson(req);
      const kind = String(body.kind ?? "");
      const target = String(body.target ?? "");
      if (!["fs.write", "fs.delete", "fs.move", "shell.exec", "git.mutate"].includes(kind)) {
        return jsonResponse({ error: { code: "INVALID_REQUEST", message: "kind must be fs.write, fs.delete, fs.move, shell.exec, or git.mutate" } }, 400, req, {});
      }
      if (!target) {
        return jsonResponse({ error: { code: "INVALID_REQUEST", message: "target is required" } }, 400, req, {});
      }
      const outcome = await service.executeAction({
        sessionId: typeof body.sessionId === "string" && body.sessionId ? body.sessionId : undefined,
        workspaceRoot: typeof body.workspaceRoot === "string" && body.workspaceRoot ? body.workspaceRoot : undefined,
        actorId: typeof body.actorId === "string" && body.actorId ? body.actorId.slice(0, 64) : undefined,
        kind: kind as "fs.write" | "fs.delete" | "fs.move" | "shell.exec" | "git.mutate",
        target,
        content: typeof body.content === "string" ? body.content : undefined,
        destination: typeof body.destination === "string" ? body.destination : undefined,
        timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
        maxAttempts: typeof body.maxAttempts === "number" ? Math.min(body.maxAttempts, 5) : undefined,
      });
      return jsonResponse({ ok: outcome.status === "succeeded", outcome }, 200, req, {});
    }

    // 6. GET /api/agent-os/sensorimotor/actions/{id} — outcome detail
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/sensorimotor/actions/")) {
      const actionId = pathname.slice("/api/agent-os/sensorimotor/actions/".length);
      const outcome = service.getActionOutcome(actionId);
      return jsonResponse({ ok: true, outcome }, 200, req, {});
    }

    // 7. POST /api/agent-os/sensorimotor/sessions/{id}/close
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/sensorimotor/sessions/") && pathname.endsWith("/close")) {
      const sessionId = pathname.slice("/api/agent-os/sensorimotor/sessions/".length, -"/close".length);
      const body = await readJson(req);
      const status = body.status === "aborted" ? "aborted" : "closed";
      const session = service.closeSession(sessionId, status);
      return jsonResponse({ ok: true, session }, 200, req, {});
    }

    return null;
  } catch (err: unknown) {
    return fail(req, err);
  }
}
