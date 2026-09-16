// Phase 20.40 — Agent Observability routes (repo convention:
// /api/agent-os/observability/*). READ-ONLY control plane: no endpoint can
// mutate a monitored transcript, control a process, or send a prompt. The
// only writes are Pao-owned metadata (alias) and on-demand integrity
// checks against the registered source. Auth is inherited from the
// management API (admin token, loopback binding).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getObservabilityEngine, bindCockpitService } from "../../agent-os/agent-observability/engine";
import { getCockpitService } from "../../agent-os/coding-cockpit/service";

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message } }, 500, req, {});
}

export async function handleObservabilityRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const engine = getObservabilityEngine();
  bindCockpitService(getCockpitService());

  if (!engine.isEnabled()) {
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/observability/")) {
      return jsonResponse({ ok: true, data: { enabled: false } }, 200, req, {});
    }
    return null;
  }

  // 1. GET /api/agent-os/observability/health
  if (req.method === "GET" && pathname === "/api/agent-os/observability/health") {
    try {
      const snapshot = await engine.snapshot();
      const stats = engine.statsSnapshot();
      return jsonResponse({
        ok: true,
        data: {
          service: "healthy",
          database: "healthy",
          lastScanAt: stats.lastScanAt,
          lastScanDurationMs: stats.lastScanDurationMs,
          adapterErrors: snapshot.scan.adapterErrors,
          sessions: snapshot.summary.sessions,
        },
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 2. GET /api/agent-os/observability/snapshot
  if (req.method === "GET" && pathname === "/api/agent-os/observability/snapshot") {
    try {
      return jsonResponse({ ok: true, data: await engine.snapshot() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 3. GET /api/agent-os/observability/sessions
  if (req.method === "GET" && pathname === "/api/agent-os/observability/sessions") {
    try {
      await engine.snapshot();
      const runtime = ctx.url.searchParams.get("runtime") ?? undefined;
      const healthState = ctx.url.searchParams.get("health") ?? undefined;
      const activityState = ctx.url.searchParams.get("activity") ?? undefined;
      return jsonResponse({ ok: true, data: { sessions: engine.store.listSessions({ runtime, healthState, activityState }) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. GET /api/agent-os/observability/sessions/detail?id=
  if (req.method === "GET" && pathname === "/api/agent-os/observability/sessions/detail") {
    try {
      const id = ctx.url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "query 'id' is required" } }, 400, req, {});
      await engine.snapshot();
      const detail = engine.sessionDetail(id);
      if (!detail) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "session not observed" } }, 404, req, {});
      return jsonResponse({ ok: true, data: detail }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. GET /api/agent-os/observability/sessions/events?id=&limit=
  if (req.method === "GET" && pathname === "/api/agent-os/observability/sessions/events") {
    try {
      const id = ctx.url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "query 'id' is required" } }, 400, req, {});
      const limit = Number(ctx.url.searchParams.get("limit") ?? "50") || 50;
      await engine.snapshot();
      return jsonResponse({ ok: true, data: { events: engine.store.listEvents({ sessionId: id, limit }) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. GET /api/agent-os/observability/timeline
  if (req.method === "GET" && pathname === "/api/agent-os/observability/timeline") {
    try {
      const limit = Number(ctx.url.searchParams.get("limit") ?? "50") || 50;
      const kinds = ctx.url.searchParams.get("kinds");
      await engine.snapshot();
      return jsonResponse({
        ok: true,
        data: {
          events: engine.timeline({
            runtime: ctx.url.searchParams.get("runtime") ?? undefined,
            sessionId: ctx.url.searchParams.get("session") ?? undefined,
            kinds: kinds ? kinds.split(",").filter((kind) => kind.length > 0) : undefined,
            errorsOnly: ctx.url.searchParams.get("errors") === "true",
            search: ctx.url.searchParams.get("q") ?? undefined,
            limit,
          }),
        },
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. GET /api/agent-os/observability/adapters
  if (req.method === "GET" && pathname === "/api/agent-os/observability/adapters") {
    return jsonResponse({ ok: true, data: { adapters: engine.listAdapters() } }, 200, req, {});
  }

  // 8. GET /api/agent-os/observability/alerts
  if (req.method === "GET" && pathname === "/api/agent-os/observability/alerts") {
    try {
      const unresolvedOnly = ctx.url.searchParams.get("unresolved") === "true";
      await engine.snapshot();
      return jsonResponse({ ok: true, data: { alerts: engine.store.listAlerts({ unresolvedOnly }), rules: engine.store.listAlertRules() } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. GET /api/agent-os/observability/events/stream (SSE with replay token)
  if (req.method === "GET" && pathname === "/api/agent-os/observability/events/stream") {
    const after = Number(ctx.url.searchParams.get("lastEventId") ?? "0") || 0;
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    engine.clientConnected();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\n\n"));
          } catch {
            if (heartbeat) clearInterval(heartbeat);
          }
        };
        for (const event of engine.streamSince(after)) write(event);
        heartbeat = setInterval(() => {
          write({ type: "heartbeat", sequence: engine.currentSequence(), observedAt: new Date().toISOString() });
          // A live stream also nudges a shared scan so clients see changes.
          void engine.snapshot();
        }, 5000);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        engine.clientDisconnected();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  // 10. PUT /api/agent-os/observability/sessions/alias (Pao-owned metadata only)
  if (req.method === "PUT" && pathname === "/api/agent-os/observability/sessions/alias") {
    try {
      const body = (await req.json()) as { sessionId?: unknown; alias?: unknown };
      if (typeof body.sessionId !== "string" || typeof body.alias !== "string" || body.alias.trim().length === 0) {
        return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "fields 'sessionId' and 'alias' are required" } }, 400, req, {});
      }
      if (body.alias.length > 120) {
        return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "alias too long" } }, 400, req, {});
      }
      const applied = engine.setAlias(body.sessionId, body.alias.trim());
      if (!applied) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "session not observed" } }, 404, req, {});
      return jsonResponse({ ok: true, data: { sessionId: body.sessionId, alias: body.alias.trim() } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. POST /api/agent-os/observability/integrity-check (registered sources only)
  if (req.method === "POST" && pathname === "/api/agent-os/observability/integrity-check") {
    try {
      const body = (await req.json()) as { sessionId?: unknown; force?: unknown };
      if (typeof body.sessionId !== "string") {
        return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "field 'sessionId' is required" } }, 400, req, {});
      }
      const result = await engine.verifySessionIntegrity(body.sessionId, body.force === true);
      if (!result) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "session not observed" } }, 404, req, {});
      return jsonResponse({ ok: true, data: result }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. GET /api/agent-os/observability/stats
  if (req.method === "GET" && pathname === "/api/agent-os/observability/stats") {
    return jsonResponse({ ok: true, data: engine.statsSnapshot() }, 200, req, {});
  }

  return null;
}
