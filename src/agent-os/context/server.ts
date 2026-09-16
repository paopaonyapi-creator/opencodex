/**
 * Pao Context Control Plane — HTTP server (Phase 20.53 §61).
 *
 * Loopback Bun server (default 8791), mirroring the AI Gateway/market server
 * conventions. /health is open for infrastructure probes; every other route
 * requires the PAO_CONTEXT_ADMIN_KEY bearer. Review/promotion routes
 * additionally require the acting user to appear in
 * PAO_CONTEXT_REVIEWER_ACTORS (empty = nobody, fail closed).
 */

import { loadContextConfig } from "./config";
import { ContextService, MemoryGovernanceError } from "./service";
import type { Server } from "bun";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Pao-Context": "1" },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function headersToObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

interface ServerState {
  readonly service: ContextService;
}

function adminActor(state: ServerState, req: Request): { id: string } | null {
  const adminKey = process.env.PAO_CONTEXT_ADMIN_KEY;
  const header = req.headers.get("authorization");
  if (!adminKey || !header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token || token !== adminKey) return null;
  return { id: "admin" };
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handleRoutes(state: ServerState, req: Request, url: URL): Promise<Response | null> {
  const { service } = state;
  const path = url.pathname;
  const method = req.method;
  const segments = path.split("/").filter(Boolean);

  if (path === "/api/context/health" && method === "GET") {
    return jsonResponse({ ...service.health(), backendProbe: await service.backendHealth() });
  }
  if (path === "/api/context/capabilities" && method === "GET") {
    return jsonResponse(await service.probeBackend());
  }
  if (path === "/health" || path === "/healthz") {
    return jsonResponse({ status: "ok", module: "context" });
  }

  const actor = adminActor(state, req);
  if (!actor) return errorResponse("CTX_UNAUTHORIZED", "Admin authorization required", 401);

  // Sources.
  if (segments[2] === "sources") {
    if (!segments[3] && method === "GET") {
      return jsonResponse({ sources: service.store.listSources() });
    }
    if (!segments[3] && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body.path !== "string" || typeof body.content !== "string") {
        return errorResponse("CTX_INVALID_BODY", "path and content are required", 422);
      }
      const outcome = await service.ingest.ingest({
        sourceType: typeof body.sourceType === "string" ? body.sourceType : "markdown",
        sourceLocator: typeof body.sourceLocator === "string" ? body.sourceLocator : body.path,
        sourceRevision: typeof body.sourceRevision === "string" ? body.sourceRevision : undefined,
        path: body.path,
        content: body.content,
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
        ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : undefined,
        targetUriOverride: typeof body.targetUri === "string" ? body.targetUri : undefined,
        isSkill: body.isSkill === true,
        skillName: typeof body.skillName === "string" ? body.skillName : undefined,
        skillDescription: typeof body.skillDescription === "string" ? body.skillDescription : undefined,
      });
      return jsonResponse({ outcome }, outcome.ok ? 201 : 422);
    }
    const sourceId = segments[3];
    if (segments[4] === "ingest" && method === "POST") {
      const source = service.store.getSource(sourceId);
      if (!source) return errorResponse("CTX_NOT_FOUND", "Source not found", 404);
      const body = await readBody(req);
      const content = typeof body?.content === "string" ? body.content : "";
      if (content === "") return errorResponse("CTX_INVALID_BODY", "content is required for re-ingest", 422);
      const outcome = await service.ingest.ingest({
        sourceType: source.sourceType,
        sourceLocator: source.sourceLocator,
        path: source.sourceLocator,
        content,
        sourceRevision: source.sourceRevision,
      });
      return jsonResponse({ outcome }, outcome.ok ? 200 : 422);
    }
    return errorResponse("not_found", "Unknown context endpoint", 404);
  }

  // Retrieval.
  if (path === "/api/context/search" && method === "POST") {
    const body = await readBody(req);
    if (!body || typeof body.query !== "string") return errorResponse("CTX_INVALID_BODY", "query is required", 422);
    const response = await service.retrieve({
      requestId: `req-${Date.now()}`,
      userId: typeof body.userId === "string" ? body.userId : "admin",
      agentId: typeof body.agentId === "string" ? body.agentId : "admin",
      taskType: typeof body.taskType === "string" ? body.taskType : "general",
      query: body.query,
      allowedScopes: ["shared"],
      allowedRoots: Array.isArray(body.roots) ? (body.roots as string[]) : ["viking://resources/pao-hubpro/"],
      budgetProfile: typeof body.budgetProfile === "string" ? body.budgetProfile : undefined,
      trace: true,
    } as never);
    return jsonResponse(response);
  }

  if (segments[2] === "retrievals" && segments[3] && method === "GET") {
    const run = service.store.getRetrievalRun(segments[3]);
    if (!run) return errorResponse("CTX_NOT_FOUND", "Retrieval run not found", 404);
    return jsonResponse({ run, hits: service.store.getRetrievalHits(segments[3]) });
  }

  // Memory review.
  if (segments[2] === "memories") {
    if (!segments[3] && method === "GET") {
      return jsonResponse({ pending: service.memory.reviewQueue(), all: service.store.listMemoryGovernance() });
    }
    const memoryId = segments[3];
    const action = segments[4];
    if (memoryId && action && method === "POST") {
      if (!service.canReview(actor.id)) {
        return errorResponse("CTX_FORBIDDEN", "Actor is not a memory reviewer", 403);
      }
      const body = await readBody(req);
      const reason = typeof body?.reason === "string" ? body.reason : undefined;
      try {
        let record;
        switch (action) {
          case "approve": record = service.memory.approve(memoryId, actor.id, reason); break;
          case "reject": record = service.memory.reject(memoryId, actor.id, reason); break;
          case "pin": record = service.memory.pin(memoryId, actor.id, reason); break;
          case "unpin": record = service.memory.unpin(memoryId, actor.id); break;
          case "suppress": record = service.memory.suppress(memoryId, actor.id, reason ?? "operator suppression"); break;
          case "unsuppress": record = service.memory.unsuppress(memoryId, actor.id); break;
          case "promote": record = service.memory.promote(memoryId, actor.id, typeof body?.impactClass === "string" ? body.impactClass : "shared_architecture_invariant"); break;
          case "expire": record = service.memory.expire(memoryId, actor.id); break;
          default: return errorResponse("not_found", "Unknown memory action", 404);
        }
        return jsonResponse({ record });
      } catch (err) {
        if (err instanceof MemoryGovernanceError) {
          return errorResponse(err.code, err.message, err.httpStatus);
        }
        throw err;
      }
    }
    return errorResponse("not_found", "Unknown context endpoint", 404);
  }

  // Sessions.
  if (segments[2] === "sessions") {
    if (!segments[3] && method === "GET") {
      return jsonResponse({ sessions: service.store.listSessionBindings() });
    }
    if (!segments[3] && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body.userId !== "string" || typeof body.agentId !== "string") {
        return errorResponse("CTX_INVALID_BODY", "userId and agentId are required", 422);
      }
      const binding = await service.sessions.createSession({
        paoConversationId: typeof body.conversationId === "string" ? body.conversationId : `conv-${Date.now()}`,
        userId: body.userId,
        agentId: body.agentId,
        peerId: typeof body.peerId === "string" ? body.peerId : undefined,
        memoryPolicyId: typeof body.memoryPolicyId === "string" ? body.memoryPolicyId : "user_preferences_only",
      });
      return jsonResponse({ binding }, 201);
    }
    const sessionId = segments[3];
    if (sessionId && segments[4] === "commit" && method === "POST") {
      const binding = await service.sessions.commit(sessionId);
      return jsonResponse({ binding });
    }
    if (sessionId && segments[4] === "messages" && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body.role !== "string" || typeof body.content !== "string") {
        return errorResponse("CTX_INVALID_BODY", "role and content are required", 422);
      }
      await service.sessions.appendMessage(sessionId, body.role as "user" | "assistant" | "tool", body.content);
      return jsonResponse({ appended: true });
    }
    return errorResponse("not_found", "Unknown context endpoint", 404);
  }

  // Handoffs.
  if (segments[2] === "handoffs") {
    if (!segments[3] && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body.fromAgentId !== "string" || typeof body.toAgentId !== "string" || typeof body.summary !== "string") {
        return errorResponse("CTX_INVALID_BODY", "fromAgentId, toAgentId and summary are required", 422);
      }
      const handoff = service.handoffs.create({
        fromAgentId: body.fromAgentId,
        toAgentId: body.toAgentId,
        userId: typeof body.userId === "string" ? body.userId : "admin",
        summary: body.summary,
        contextRefs: Array.isArray(body.contextRefs) ? (body.contextRefs as Array<{ uri: string; level: "L0" | "L1" | "L2" }>) : [],
        pendingActions: Array.isArray(body.pendingActions) ? (body.pendingActions as string[]) : undefined,
        constraints: Array.isArray(body.constraints) ? (body.constraints as string[]) : undefined,
        ttlMinutes: typeof body.ttlMinutes === "number" ? body.ttlMinutes : undefined,
      });
      return jsonResponse({ handoff }, 201);
    }
    if (segments[3] && segments[4] === "consume" && method === "POST") {
      const body = await readBody(req);
      const agentId = typeof body?.agentId === "string" ? body.agentId : "";
      try {
        const handoff = service.handoffs.consume(segments[3], agentId);
        return jsonResponse({ handoff });
      } catch (err) {
        return errorResponse("CTX_HANDOFF_INVALID", err instanceof Error ? err.message : "handoff invalid", 403);
      }
    }
    if (segments[3] && method === "GET") {
      const handoff = service.store.getHandoff(segments[3]);
      if (!handoff) return errorResponse("CTX_NOT_FOUND", "Handoff not found", 404);
      return jsonResponse({ handoff });
    }
    return errorResponse("not_found", "Unknown context endpoint", 404);
  }

  if (path === "/api/context/audit" && method === "GET") {
    return jsonResponse({ audit: service.auditTrail({ limit: Number(url.searchParams.get("limit")) || 200 }) });
  }

  return null;
}

export interface ContextServerHandle {
  server: Server<unknown>;
  stop(): void;
}

export async function startContextServer(): Promise<ContextServerHandle> {
  const config = loadContextConfig();
  if (!config.enabled) {
    throw new Error("Pao Context Control Plane is not enabled. Set PAO_CONTEXT_ENABLED=true to activate.");
  }

  const service = new ContextService({ config });
  const state: ServerState = { service };

  const server = Bun.serve({
    port: config.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      try {
        const handled = await handleRoutes(state, req, url);
        return handled ?? errorResponse("not_found", "Not found", 404);
      } catch {
        return errorResponse("context_internal_error", "Internal context module error", 500);
      }
    },
  });

  return {
    server,
    stop() {
      server.stop(true);
    },
  };
}
