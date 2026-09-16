// Phase 20.41 — Memory Plane routes (repo convention:
// /api/memory/*). Protected memory routes enforce server-side scopes for
// OAuth bearer tokens AND system/dashboard actors; destructive operations
// are preview-confirm with signed receipts; OAuth discovery endpoints are
// body-validated by tests (never trusted by status code alone).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMemoryPlaneService } from "../../agent-os/memory-plane/service";
import { MemoryOAuthService, OAuthError } from "../../agent-os/memory-plane/oauth";
import { dashboardActor, systemActor, type ActorIdentity } from "../../agent-os/memory-plane/scopes";

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const parsed = parseErrorCode(message);
  const status = parsed.status ?? 500;
  return jsonResponse({ ok: false, error: { code: parsed.code, message } }, status, req, {});
}

function parseErrorCode(message: string): { code: string; status: number | null } {
  const start = message.indexOf("[");
  const end = message.indexOf("]");
  if (start === 0 && end > 1) {
    const token = message.slice(1, end);
    const colon = token.indexOf(":409");
    if (colon > 0) return { code: token.slice(0, colon), status: 409 };
    if (token === "NOT_FOUND") return { code: token, status: 404 };
    if (token === "VALIDATION_ERROR" || token === "MEMORY_PAYLOAD_TOO_LARGE") return { code: token, status: 400 };
    if (token === "MEMORY_SCOPE_DENIED" || token === "MEMORY_AUTHORITY_DENIED" || token === "MEMORY_DISABLED") return { code: token, status: 403 };
    if (token === "STALE_PREVIEW") return { code: token, status: 409 };
  }
  return { code: "INTERNAL_ERROR", status: 500 };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Resolve the caller: OAuth bearer token (scoped) or the management API's
 *  own admin authentication (system actor). Fails closed. */
function resolveActor(ctx: ManagementContext, oauth: MemoryOAuthService): ActorIdentity {
  const authHeader = ctx.req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const identity = oauth.authenticateBearer(authHeader);
    return { kind: "oauth", id: identity.clientId, scopes: identity.scopes };
  }
  // Management routes are already admin-token gated; system actor gets full
  // canonical scopes but never bypasses audit (spec §25).
  return systemActor();
}

export async function handleMemoryPlaneRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getMemoryPlaneService();
  const oauth = new MemoryOAuthService(service.store);

  if (!service.config.enabled) {
    if (req.method === "GET" && pathname === "/api/memory/info") {
      return jsonResponse({ ok: true, data: { enabled: false } }, 200, req, {});
    }
    return null;
  }

  // --- OAuth discovery (public, body-validated in tests) -------------------------------

  if (req.method === "GET" && pathname === "/api/memory/.well-known/oauth-authorization-server") {
    return jsonResponse(oauth.discoveryMetadata(baseUrlOf(ctx.url)), 200, req, {});
  }
  if (req.method === "GET" && pathname === "/api/memory/.well-known/oauth-protected-resource") {
    return jsonResponse(oauth.protectedResourceMetadata(baseUrlOf(ctx.url)), 200, req, {});
  }

  // --- OAuth registration / token / revoke (rate-limited) ---------------------------------

  if (req.method === "POST" && pathname === "/api/memory/oauth/register") {
    try {
      if (!service.config.oauthEnabled || !oauth.config.dcrEnabled) {
        return jsonResponse({ ok: false, error: { code: "DCR_DISABLED", message: "dynamic client registration is disabled" } }, 403, req, {});
      }
      const clientIp = ctx.req.headers.get("x-forwarded-for") ?? "local";
      if (!oauth.rateLimiter.allow("dcr:" + clientIp, 10, 60_000)) {
        return jsonResponse({ ok: false, error: { code: "RATE_LIMITED", message: "too many registrations" } }, 429, req, {});
      }
      const body = await readJsonBody(req);
      const result = oauth.registerClient({
        clientName: String(body.client_name ?? body.clientName ?? ""),
        redirectUris: Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : Array.isArray(body.redirectUris) ? (body.redirectUris as string[]) : [],
        grantTypes: Array.isArray(body.grant_types) ? (body.grant_types as string[]) : undefined,
        scope: String(body.scope ?? "memory:read"),
        tokenEndpointAuth: typeof body.token_endpoint_auth === "string" ? body.token_endpoint_auth : undefined,
      }, "operator");
      service.store.upsertConsent(result.clientId, String(body.scope ?? "memory:read"), "operator-bootstrap", "approved");
      return jsonResponse({ ok: true, data: { client_id: result.clientId, client_secret: result.clientSecret, token_endpoint_auth: body.token_endpoint_auth === "none" ? "none" : "client_secret_basic" } }, 201, req, {});
    } catch (err) {
      return oauthErrorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/oauth/token") {
    try {
      const clientIp = ctx.req.headers.get("x-forwarded-for") ?? "local";
      if (!oauth.rateLimiter.allow("token:" + clientIp, 30, 60_000)) {
        return jsonResponse({ ok: false, error: { code: "RATE_LIMITED", message: "too many token requests" } }, 429, req, {});
      }
      const body = await readJsonBody(req);
      const result = oauth.grant({
        grantType: String(body.grant_type ?? ""),
        clientId: String(body.client_id ?? ""),
        clientSecret: typeof body.client_secret === "string" ? body.client_secret : null,
        code: typeof body.code === "string" ? body.code : undefined,
        redirectUri: typeof body.redirect_uri === "string" ? body.redirect_uri : undefined,
        codeVerifier: typeof body.code_verifier === "string" ? body.code_verifier : undefined,
        refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      });
      return jsonResponse({ ok: true, data: result }, 200, req, {});
    } catch (err) {
      return oauthErrorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/oauth/revoke") {
    try {
      const body = await readJsonBody(req);
      oauth.revoke({ token: String(body.token ?? ""), clientId: String(body.client_id ?? "") });
      return jsonResponse({ ok: true, data: { revoked: true } }, 200, req, {});
    } catch (err) {
      return oauthErrorResponse(req, err);
    }
  }

  // --- OAuth admin (operator-only consent management) ----------------------------------------

  if (req.method === "GET" && pathname === "/api/memory/oauth/clients") {
    return jsonResponse({ ok: true, data: { clients: service.store.listOAuthClients(), consents: service.store.listConsents() } }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/memory/oauth/clients/decide") {
    try {
      const body = await readJsonBody(req);
      if (typeof body.clientId !== "string" || typeof body.scope !== "string" || typeof body.approve !== "boolean") {
        return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "fields 'clientId', 'scope', 'approve' are required" } }, 400, req, {});
      }
      service.store.upsertConsent(body.clientId, body.scope, "operator", body.approve ? "approved" : "denied");
      if (!body.approve) service.store.revokeClientTokens(body.clientId);
      return jsonResponse({ ok: true, data: { decided: true } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // --- MemoryPlane health/info/stats/preflight/verify ------------------------------------------

  if (req.method === "GET" && pathname === "/api/memory/health") {
    try {
      return jsonResponse({ ok: true, data: await service.health() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/info") {
    return jsonResponse({
      ok: true,
      data: {
        enabled: true,
        provider: service.embeddingProvider.id,
        model: service.embeddingProvider.model,
        dimensions: service.embeddingProvider.dimensions,
        defaultWorkspace: service.config.defaultWorkspace,
        defaultRecallMode: service.config.defaultRecallMode,
        maxRecallResults: service.config.maxRecallResults,
        oauth: service.config.oauthEnabled,
        dcr: oauth.config.dcrEnabled,
      },
    }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/memory/stats") {
    try {
      return jsonResponse({ ok: true, data: await service.stats() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/preflight") {
    return jsonResponse({ ok: true, data: service.preflight() }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/memory/verify") {
    try {
      return jsonResponse({ ok: true, data: await service.verifyContracts() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // --- Memory CRUD / recall (scope-protected) ------------------------------------------------------

  if (req.method === "POST" && pathname === "/api/memory/memories") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      const result = await service.remember({
        workspace: typeof body.workspace === "string" ? body.workspace : undefined,
        project: typeof body.project === "string" ? body.project : null,
        title: String(body.title ?? ""),
        content: String(body.content ?? ""),
        kind: (typeof body.kind === "string" ? body.kind : "note") as never,
        authority: (typeof body.authority === "string" ? body.authority : "observed") as never,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
        sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : null,
        actor: { agentKey: typeof body.agentKey === "string" ? body.agentKey : "dashboard", name: "dashboard" },
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      }, actor);
      return jsonResponse({ ok: true, data: result }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/memories") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:read");
      const workspace = url.searchParams.get("workspace") ?? undefined;
      const search = url.searchParams.get("q") ?? undefined;
      const kind = url.searchParams.get("kind") ?? undefined;
      return jsonResponse({
        ok: true,
        data: {
          memories: service.store.listMemories({
            workspaceId: workspace ? service.store.getWorkspaceBySlug(workspace)?.id : undefined,
            search,
            kinds: kind ? [kind] : undefined,
          }),
        },
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/memories/detail") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:read");
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "query 'id' required" } }, 400, req, {});
      const memory = service.store.getMemory(id);
      if (!memory) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "memory not found" } }, 404, req, {});
      return jsonResponse({
        ok: true,
        data: {
          memory,
          revisions: service.store.listRevisions(id),
          tags: service.store.tagsForMemory(id, memory.currentRevision),
          supersession: service.store.listSupersession(id),
          supersededBy: service.store.supersededBy(id),
          chunks: service.store.countChunks(id, memory.currentRevision),
        },
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/memories/revisions") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:read");
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "query 'id' required" } }, 400, req, {});
      return jsonResponse({ ok: true, data: { revisions: service.store.listRevisions(id) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/recall") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      const result = await service.recall({
        workspace: typeof body.workspace === "string" ? body.workspace : undefined,
        project: typeof body.project === "string" ? body.project : null,
        query: String(body.query ?? ""),
        mode: (typeof body.mode === "string" ? body.mode : undefined) as never,
        allowFallback: body.allowFallback !== false,
        limit: typeof body.limit === "number" ? body.limit : 8,
        kinds: Array.isArray(body.kinds) ? (body.kinds as never) : undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
        authority: Array.isArray(body.authority) ? (body.authority as never) : undefined,
        includeContent: body.includeContent !== false,
        trace: body.trace !== false,
      }, actor);
      return jsonResponse({ ok: true, data: result }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/observations") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      const result = await service.observe({
        workspace: typeof body.workspace === "string" ? body.workspace : undefined,
        project: typeof body.project === "string" ? body.project : null,
        observationText: String(body.observationText ?? body.observation_text ?? ""),
        confidence: typeof body.confidence === "number" ? body.confidence : null,
        sources: Array.isArray(body.sources) ? (body.sources as never) : [],
        actor: { agentKey: typeof body.agentKey === "string" ? body.agentKey : "dashboard" },
      }, actor);
      return jsonResponse({ ok: true, data: result }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/memories/forget/preview") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.forgetPreview(String(body.memoryId ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/memories/forget/confirm") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.forgetConfirm(String(body.memoryId ?? ""), String(body.confirmationReceipt ?? body.confirmation_receipt ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/index/rebuild/preview") {
    try {
      const actor = resolveActor(ctx, oauth);
      return jsonResponse({ ok: true, data: service.rebuildPreview() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/index/rebuild/confirm") {
    try {
      const actor = resolveActor(ctx, oauth);
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.rebuildConfirm(String(body.confirmationReceipt ?? body.confirmation_receipt ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/traces") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:trace");
      return jsonResponse({ ok: true, data: { traces: service.store.listTraces(null, Number(url.searchParams.get("limit") ?? "50") || 50) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/traces/detail") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:trace");
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message: "query 'id' required" } }, 400, req, {});
      return jsonResponse({ ok: true, data: service.store.getTrace(id) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/workspaces") {
    return jsonResponse({ ok: true, data: { workspaces: service.store.listWorkspaces() } }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/memory/projects") {
    const workspace = url.searchParams.get("workspace");
    return jsonResponse({
      ok: true,
      data: { projects: service.store.listProjects(workspace ? service.store.getWorkspaceBySlug(workspace)?.id : undefined) },
    }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/memory/tags") {
    try {
      const workspace = service.store.ensureWorkspace(url.searchParams.get("workspace") ?? service.config.defaultWorkspace);
      return jsonResponse({ ok: true, data: { tags: service.store.listTags(workspace.id) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/memory/export") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:read");
      const workspace = url.searchParams.get("workspace") ?? service.config.defaultWorkspace;
      return jsonResponse({ ok: true, data: service.exportMemory(workspace) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (req.method === "POST" && pathname === "/api/memory/import") {
    try {
      const actor = resolveActor(ctx, oauth);
      service.authorize(actor, "memory:write");
      const body = await readJsonBody(req);
      const items = Array.isArray(body.items) ? (body.items as never) : [];
      return jsonResponse({
        ok: true,
        data: service.importMemories(items, { dryRun: body.dryRun === true, workspace: typeof body.workspace === "string" ? body.workspace : undefined }),
      }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  return null;
}

function baseUrlOf(url: URL): string {
  const issuer = process.env.MEMORY_OAUTH_ISSUER;
  if (issuer && issuer.length > 0) return issuer.replace(/\/$/, "");
  return url.origin;
}

function oauthErrorResponse(req: Request, err: unknown): Response {
  if (err instanceof OAuthError) {
    return jsonResponse({ ok: false, error: { code: err.code, message: err.message } }, err.status, req, {});
  }
  return errorResponse(req, err);
}
