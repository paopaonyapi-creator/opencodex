// Phase 20.39 — Unified AI Coding Workspace routes (repo convention:
// /api/agent-os/coding-workspace/*). The 20.27 agency cockpit keeps the
// /api/agent-os/cockpit prefix; this module is the provider-neutral coding
// surface. Full-literal pathname guards; ids arrive via query params or the
// JSON body. Auth is inherited from the management API (admin token,
// loopback binding) — no unauthenticated execution surface. The session
// stream is SSE with event ids and Last-Event-ID replay.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCockpitService } from "../../agent-os/coding-cockpit/service";
import { ApprovalGateway } from "../../agent-os/coding-cockpit/approvals";
import { CockpitError } from "../../agent-os/coding-cockpit/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message } }, 400, req, {});
}

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof CockpitError ? err.code : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" || code === "WORKSPACE_NOT_FOUND" || code === "SESSION_NOT_FOUND"
    ? 404
    : code === "VALIDATION_ERROR"
      ? 400
      : code === "POLICY_DENIED" || code === "APPROVAL_DENIED" || code === "APPROVAL_EXPIRED" || code === "LOCK_CONFLICT" || code === "PATH_OUTSIDE_WORKSPACE" || code === "WORKSPACE_NOT_TRUSTED"
        ? 403
        : code === "APPROVAL_REQUIRED"
          ? 202
          : 422;
  return jsonResponse({ ok: false, error: { code, message } }, status, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function queryParam(ctx: ManagementContext, key: string): string | null {
  return ctx.url.searchParams.get(key);
}

function requireQuery(ctx: ManagementContext, key: string): string {
  const value = queryParam(ctx, key);
  if (!value) throw new CockpitError("VALIDATION_ERROR", "query parameter '" + key + "' is required");
  return value;
}

/** SSE stream: replay persisted events after Last-Event-ID, then fan out
 *  live envelopes. Deltas stream through un-persisted for smooth rendering. */
function sessionStreamResponse(ctx: ManagementContext, sessionId: string): Response {
  const service = getCockpitService();
  const afterSequence = Number(queryParam(ctx, "after") ?? queryParam(ctx, "lastEventId") ?? "0") || 0;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (envelope: { sequence: number; payload: unknown; type: string }) => {
        controller.enqueue(encoder.encode("id: " + envelope.sequence + "\nevent: agent\ndata: " + JSON.stringify(envelope) + "\n\n"));
      };
      for (const envelope of service.bus.replay(sessionId, afterSequence)) {
        send({ sequence: envelope.sequence, type: envelope.type, payload: envelope.payload });
      }
      unsubscribe = service.bus.subscribe(sessionId, (envelope) => {
        try {
          send({ sequence: envelope.sequence, type: envelope.type, payload: envelope.payload });
        } catch {
          // client vanished; cleanup happens in cancel()
        }
      });
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          if (keepAlive) clearInterval(keepAlive);
        }
      }, 15_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export async function handleCodingCockpitRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getCockpitService();

  // 1. GET /api/agent-os/coding-workspace/health
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/health") {
    return jsonResponse({
      ok: true,
      data: {
        backend: "ok",
        providers: service.providers.ids(),
        workspaces: service.store.listWorkspaces().length,
        openApprovals: service.store.listApprovals({ status: "PENDING" }).length,
      },
    }, 200, req, {});
  }

  // 2. GET /api/agent-os/coding-workspace/workspaces
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/workspaces") {
    return jsonResponse({ ok: true, data: { workspaces: service.store.listWorkspaces() } }, 200, req, {});
  }

  // 3. POST /api/agent-os/coding-workspace/workspaces
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/workspaces") {
    const body = await readJsonBody(req);
    if (typeof body.rootPath !== "string") return badRequest(req, "Field 'rootPath' is required");
    try {
      const workspace = service.registerWorkspace({
        rootPath: body.rootPath,
        name: typeof body.name === "string" ? body.name : undefined,
        actor: typeof body.actor === "string" ? body.actor : "operator",
      });
      return jsonResponse({ ok: true, data: workspace }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. GET /api/agent-os/coding-workspace/workspaces/detail?id=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/workspaces/detail") {
    try {
      const workspace = service.store.requireWorkspace(requireQuery(ctx, "id"));
      const lock = service.locks.currentHolder(workspace.id);
      return jsonResponse({ ok: true, data: { workspace, lock } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. PATCH /api/agent-os/coding-workspace/workspaces/detail (trust/name — human actor)
  if (req.method === "PATCH" && pathname === "/api/agent-os/coding-workspace/workspaces/detail") {
    const body = await readJsonBody(req);
    try {
      const id = requireQuery(ctx, "id");
      if (typeof body.trustLevel === "string") {
        const workspace = service.setWorkspaceTrust(id, body.trustLevel as never, typeof body.actor === "string" ? body.actor : "operator");
        return jsonResponse({ ok: true, data: workspace }, 200, req, {});
      }
      return badRequest(req, "Field 'trustLevel' is required");
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. GET /api/agent-os/coding-workspace/providers
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/providers") {
    return jsonResponse({
      ok: true,
      data: {
        providers: service.providers.list().map((adapter) => ({
          id: adapter.id,
          displayName: adapter.displayName,
          capabilities: adapter.getCapabilities(),
          instances: service.store.listProviderInstances(adapter.id),
        })),
      },
    }, 200, req, {});
  }

  // 7. POST /api/agent-os/coding-workspace/providers/probe
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/providers/probe") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string") return badRequest(req, "Field 'providerId' is required");
    try {
      const probe = await service.probeProvider(body.providerId);
      return jsonResponse({ ok: true, data: probe }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. GET /api/agent-os/coding-workspace/providers/capabilities?providerId=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/providers/capabilities") {
    try {
      return jsonResponse({ ok: true, data: service.capabilitiesFor(requireQuery(ctx, "providerId")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. GET /api/agent-os/coding-workspace/sessions
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/sessions") {
    const workspaceId = queryParam(ctx, "workspaceId") ?? undefined;
    return jsonResponse({ ok: true, data: { sessions: service.store.listSessions({ workspaceId }) } }, 200, req, {});
  }

  // 10. POST /api/agent-os/coding-workspace/sessions/start
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/sessions/start") {
    const body = await readJsonBody(req);
    if (typeof body.workspaceId !== "string" || typeof body.providerId !== "string") {
      return badRequest(req, "Fields 'workspaceId' and 'providerId' are required");
    }
    try {
      const result = await service.startSession({
        workspaceId: body.workspaceId,
        providerId: body.providerId,
        title: typeof body.title === "string" ? body.title : undefined,
        mode: typeof body.mode === "string" ? (body.mode as never) : undefined,
        actor: typeof body.actor === "string" ? body.actor : "operator",
      });
      return jsonResponse({ ok: true, data: result }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. GET /api/agent-os/coding-workspace/sessions/detail?id=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/sessions/detail") {
    try {
      const session = service.store.requireSession(requireQuery(ctx, "id"));
      return jsonResponse({
        ok: true,
        data: {
          session,
          workspace: service.store.getWorkspace(session.workspaceId),
          runs: service.store.listRuns({ sessionId: session.id, limit: 20 }),
          toolExecutions: service.store.listToolExecutions({ sessionId: session.id, limit: 100 }),
          artifacts: service.store.listArtifacts({ workspaceId: session.workspaceId, limit: 50 }),
        },
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. PATCH /api/agent-os/coding-workspace/sessions/detail (rename / mode)
  if (req.method === "PATCH" && pathname === "/api/agent-os/coding-workspace/sessions/detail") {
    const body = await readJsonBody(req);
    try {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.mode === "string") patch.mode = body.mode;
      if (Object.keys(patch).length === 0) return badRequest(req, "Nothing to update");
      const session = service.store.updateSession(requireQuery(ctx, "id"), patch as never);
      return jsonResponse({ ok: true, data: session }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 13. POST /api/agent-os/coding-workspace/sessions/resume
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/sessions/resume") {
    const body = await readJsonBody(req);
    if (typeof body.sessionId !== "string") return badRequest(req, "Field 'sessionId' is required");
    try {
      const session = await service.resumeSession(body.sessionId, typeof body.actor === "string" ? body.actor : "operator");
      return jsonResponse({ ok: true, data: session }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 14. POST /api/agent-os/coding-workspace/sessions/messages
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/sessions/messages") {
    const body = await readJsonBody(req);
    if (typeof body.sessionId !== "string" || typeof body.text !== "string") {
      return badRequest(req, "Fields 'sessionId' and 'text' are required");
    }
    try {
      const result = await service.sendMessage({
        sessionId: body.sessionId,
        text: body.text,
        mode: typeof body.mode === "string" ? (body.mode as never) : undefined,
        contextRefs: Array.isArray(body.contextRefs) ? (body.contextRefs as never) : undefined,
        actor: typeof body.actor === "string" ? body.actor : "operator",
        allowDangerousSkipPermissions: body.allowDangerousSkipPermissions === true,
      });
      return jsonResponse({ ok: true, data: result }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 15. POST /api/agent-os/coding-workspace/sessions/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/sessions/cancel") {
    const body = await readJsonBody(req);
    if (typeof body.sessionId !== "string") return badRequest(req, "Field 'sessionId' is required");
    try {
      const session = await service.cancelSession(body.sessionId, typeof body.actor === "string" ? body.actor : "operator");
      return jsonResponse({ ok: true, data: session }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 16. GET /api/agent-os/coding-workspace/sessions/events?id=&after=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/sessions/events") {
    try {
      const sessionId = requireQuery(ctx, "id");
      service.store.requireSession(sessionId);
      const after = Number(queryParam(ctx, "after") ?? "0") || 0;
      return jsonResponse({ ok: true, data: { events: service.bus.replay(sessionId, after) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 17. GET /api/agent-os/coding-workspace/sessions/stream?id= (SSE)
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/sessions/stream") {
    try {
      const sessionId = requireQuery(ctx, "id");
      service.store.requireSession(sessionId);
      return sessionStreamResponse(ctx, sessionId);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 18. GET /api/agent-os/coding-workspace/sessions/usage?id=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/sessions/usage") {
    try {
      const sessionId = requireQuery(ctx, "id");
      return jsonResponse({ ok: true, data: { usage: service.store.listUsage({ sessionId }) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 19. POST /api/agent-os/coding-workspace/session-discovery/scan
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/session-discovery/scan") {
    const body = await readJsonBody(req);
    if (typeof body.workspaceId !== "string") return badRequest(req, "Field 'workspaceId' is required");
    try {
      const discovered = await service.scanDiscovery(body.workspaceId, typeof body.providerId === "string" ? body.providerId : null);
      return jsonResponse({ ok: true, data: { discovered } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 20. POST /api/agent-os/coding-workspace/session-discovery/import
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/session-discovery/import") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string" || typeof body.nativeSessionId !== "string" || typeof body.workspaceId !== "string") {
      return badRequest(req, "Fields 'providerId', 'nativeSessionId', and 'workspaceId' are required");
    }
    try {
      const session = await service.importDiscoveredSession(body.providerId, body.nativeSessionId, body.workspaceId, typeof body.actor === "string" ? body.actor : "operator");
      return jsonResponse({ ok: true, data: session }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 21. GET /api/agent-os/coding-workspace/approvals?status=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/approvals") {
    const status = queryParam(ctx, "status") ?? undefined;
    return jsonResponse({ ok: true, data: { approvals: service.store.listApprovals({ status }) } }, 200, req, {});
  }

  // 22. POST /api/agent-os/coding-workspace/approvals/decide (human actors only)
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/approvals/decide") {
    const body = await readJsonBody(req);
    if (typeof body.approvalId !== "string" || typeof body.approve !== "boolean") {
      return badRequest(req, "Fields 'approvalId' (string) and 'approve' (boolean) are required");
    }
    try {
      ApprovalGateway.requireHumanActor(typeof body.actor === "string" ? body.actor : "operator");
      const approval = service.approvals.decide(body.approvalId, body.approve, typeof body.actor === "string" ? body.actor : "operator");
      return jsonResponse({ ok: true, data: approval }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 23. GET /api/agent-os/coding-workspace/workspaces/lock?workspaceId=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/workspaces/lock") {
    try {
      const holder = service.locks.currentHolder(requireQuery(ctx, "workspaceId"));
      return jsonResponse({ ok: true, data: { lock: holder } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 24. POST /api/agent-os/coding-workspace/workspaces/lock/takeover
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/workspaces/lock/takeover") {
    const body = await readJsonBody(req);
    if (typeof body.workspaceId !== "string" || typeof body.sessionId !== "string") {
      return badRequest(req, "Fields 'workspaceId' and 'sessionId' are required");
    }
    try {
      ApprovalGateway.requireHumanActor(typeof body.actor === "string" ? body.actor : "operator");
      const lock = service.locks.takeover(
        body.workspaceId,
        body.sessionId,
        typeof body.ownerInstanceId === "string" ? body.ownerInstanceId : "local_instance",
        typeof body.actor === "string" ? body.actor : "operator",
        { confirmHealthyTakeover: body.confirmHealthyTakeover === true },
      );
      return jsonResponse({ ok: true, data: lock }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 25. GET /api/agent-os/coding-workspace/usage/summary
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/usage/summary") {
    return jsonResponse({ ok: true, data: service.usageSummary() }, 200, req, {});
  }

  // 26. GET /api/agent-os/coding-workspace/context/search?q=&workspaceId=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/context/search") {
    const q = queryParam(ctx, "q") ?? "";
    const workspaceId = queryParam(ctx, "workspaceId") ?? undefined;
    return jsonResponse({ ok: true, data: { results: service.context.search(q, workspaceId) } }, 200, req, {});
  }

  // 27. POST /api/agent-os/coding-workspace/context/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/context/resolve") {
    const body = await readJsonBody(req);
    if (!Array.isArray(body.refs)) return badRequest(req, "Field 'refs' (array) is required");
    try {
      const workspaceRoot = typeof body.workspaceRoot === "string" ? body.workspaceRoot : null;
      const resolved = service.context.resolve(body.refs as never, workspaceRoot);
      return jsonResponse({ ok: true, data: { resolved } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 28. GET /api/agent-os/coding-workspace/slash-commands
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/slash-commands") {
    return jsonResponse({
      ok: true,
      data: {
        commands: service.commands.list().map((command) => ({
          id: command.id,
          name: command.name,
          description: command.description,
          aliases: command.aliases ?? [],
          argsSchema: command.argsSchema ?? null,
        })),
      },
    }, 200, req, {});
  }

  // 29. POST /api/agent-os/coding-workspace/slash-commands/execute
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/slash-commands/execute") {
    const body = await readJsonBody(req);
    if (typeof body.command !== "string" || typeof body.sessionId !== "string") {
      return badRequest(req, "Fields 'command' and 'sessionId' are required");
    }
    try {
      const result = await service.sendMessage({
        sessionId: body.sessionId,
        text: body.command.startsWith("/") ? body.command : "/" + body.command,
        actor: typeof body.actor === "string" ? body.actor : "operator",
      });
      return jsonResponse({ ok: true, data: result }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 30. GET /api/agent-os/coding-workspace/audit
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/audit") {
    return jsonResponse({
      ok: true,
      data: {
        events: service.store.listAudit({
          sessionId: queryParam(ctx, "sessionId") ?? undefined,
          workspaceId: queryParam(ctx, "workspaceId") ?? undefined,
          eventType: queryParam(ctx, "eventType") ?? undefined,
        }),
      },
    }, 200, req, {});
  }

  // 31. POST /api/agent-os/coding-workspace/reconcile
  if (req.method === "POST" && pathname === "/api/agent-os/coding-workspace/reconcile") {
    return jsonResponse({ ok: true, data: service.reconcile() }, 200, req, {});
  }

  // 32. GET /api/agent-os/coding-workspace/runs?sessionId=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/runs") {
    const sessionId = queryParam(ctx, "sessionId");
    return jsonResponse({ ok: true, data: { runs: service.store.listRuns({ sessionId: sessionId ?? undefined }) } }, 200, req, {});
  }

  // 33. GET /api/agent-os/coding-workspace/tools?sessionId=
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/tools") {
    const sessionId = queryParam(ctx, "sessionId");
    return jsonResponse({ ok: true, data: { toolExecutions: service.store.listToolExecutions({ sessionId: sessionId ?? undefined }) } }, 200, req, {});
  }

  // 34. GET /api/agent-os/coding-workspace/processes
  if (req.method === "GET" && pathname === "/api/agent-os/coding-workspace/processes") {
    return jsonResponse({ ok: true, data: { processes: service.supervisor.list() } }, 200, req, {});
  }

  return null;
}
