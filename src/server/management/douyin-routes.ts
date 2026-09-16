// Phase 20.26 — Pao-hubPro × Douyin Media Intelligence & Downloader Engine
// Management REST API routes (repo convention: /api/agent-os/media/douyin/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getDouyinService } from "../../agent-os/douyin/service";
import type { UsageClass, DownloadPreset } from "../../agent-os/media-acquisition/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "DOUYIN_INVALID_ARGUMENT", message } }, 400, req, {});
}

function providerError(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  const code = match ? match[1] : "DOUYIN_PROVIDER_ERROR";
  // Error bodies are provider-shaped and already redacted upstream.
  return jsonResponse({ ok: false, error: { code, message } }, 422, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleDouyinRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getDouyinService();

  // 1. GET /api/agent-os/media/douyin/health
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/health") {
    const health = await service.health();
    return jsonResponse({ ok: true, provider: "douyin", data: health }, 200, req, {});
  }

  // 2. POST /api/agent-os/media/douyin/inspect
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/inspect") {
    const body = await readJsonBody(req);
    const targetUrl = typeof body.url === "string" ? body.url : "";
    if (!targetUrl) return badRequest(req, "Field 'url' is required");
    try {
      const item = await service.inspectUrl(targetUrl);
      return jsonResponse({ ok: true, provider: "douyin", data: { item } }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 3. POST /api/agent-os/media/douyin/download
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/download") {
    const body = await readJsonBody(req);
    const targetUrl = typeof body.url === "string" ? body.url : "";
    if (!targetUrl) return badRequest(req, "Field 'url' is required");
    try {
      const job = await service.enqueueDownload({
        url: targetUrl,
        preset: (typeof body.preset === "string" ? body.preset : undefined) as DownloadPreset,
        usageClass: (typeof body.usageClass === "string" ? body.usageClass : "research_reference") as UsageClass,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
        maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
      });
      return jsonResponse({ ok: true, provider: "douyin", data: { job } }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 4. POST /api/agent-os/media/douyin/search
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/search") {
    const body = await readJsonBody(req);
    const query = typeof body.query === "string" ? body.query : "";
    if (!query.trim()) return badRequest(req, "Field 'query' is required");
    try {
      const result = await service.search({
        query,
        maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ ok: true, provider: "douyin", data: result }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 5. POST /api/agent-os/media/douyin/hot-board
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/hot-board") {
    const body = await readJsonBody(req);
    try {
      const result = await service.hotBoard({
        limit: typeof body.limit === "number" ? body.limit : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ ok: true, provider: "douyin", data: result }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 6. POST /api/agent-os/media/douyin/creators/sync
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/creators/sync") {
    const body = await readJsonBody(req);
    const targetUrl = typeof body.url === "string" ? body.url : "";
    if (!targetUrl) return badRequest(req, "Field 'url' is required");
    try {
      const result = await service.syncCreator({
        url: targetUrl,
        maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ ok: true, provider: "douyin", data: result }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 7. GET /api/agent-os/media/douyin/creators
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/creators") {
    const limit = Number(url.searchParams.get("limit") || 50);
    return jsonResponse({ ok: true, provider: "douyin", data: { creators: service.listCreators(limit) } }, 200, req, {});
  }

  // 8. POST /api/agent-os/media/douyin/comments/fetch
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/comments/fetch") {
    const body = await readJsonBody(req);
    const targetUrl = typeof body.url === "string" ? body.url : "";
    if (!targetUrl) return badRequest(req, "Field 'url' is required");
    try {
      const result = await service.fetchComments({
        url: targetUrl,
        mediaItemId: typeof body.mediaItemId === "string" ? body.mediaItemId : undefined,
        maxComments: typeof body.maxComments === "number" ? body.maxComments : undefined,
        includeReplies: body.includeReplies === true,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ ok: true, provider: "douyin", data: result }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 9. GET /api/agent-os/media/douyin/comments
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/comments") {
    const mediaItemId = url.searchParams.get("mediaItemId");
    if (!mediaItemId) return badRequest(req, "Query parameter 'mediaItemId' is required");
    const comments = service.store.listComments(mediaItemId);
    return jsonResponse({ ok: true, provider: "douyin", data: { comments } }, 200, req, {});
  }

  // 10. POST /api/agent-os/media/douyin/transcribe
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/transcribe") {
    const body = await readJsonBody(req);
    const mediaItemId = typeof body.mediaItemId === "string" ? body.mediaItemId : "";
    if (!mediaItemId) return badRequest(req, "Field 'mediaItemId' is required");
    try {
      const transcript = await service.saveTranscript({
        mediaItemId,
        artifactId: typeof body.artifactId === "string" ? body.artifactId : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
      });
      return jsonResponse({ ok: true, provider: "douyin", data: { transcript } }, 200, req, {});
    } catch (err) {
      return providerError(req, err);
    }
  }

  // 11. GET /api/agent-os/media/douyin/items
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/items") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const creatorProviderId = url.searchParams.get("creatorId") ?? undefined;
    return jsonResponse({ ok: true, provider: "douyin", data: { items: service.listItems(limit, creatorProviderId) } }, 200, req, {});
  }

  // 12. GET /api/agent-os/media/douyin/search-snapshots
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/search-snapshots") {
    const limit = Number(url.searchParams.get("limit") || 20);
    const query = url.searchParams.get("query") ?? undefined;
    return jsonResponse({ ok: true, provider: "douyin", data: { snapshots: service.listSearchSnapshots(limit, query) } }, 200, req, {});
  }

  // 13. GET /api/agent-os/media/douyin/hot-board (history)
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/hot-board") {
    const limit = Number(url.searchParams.get("limit") || 2);
    return jsonResponse({ ok: true, provider: "douyin", data: { snapshots: service.hotBoardHistory(limit) } }, 200, req, {});
  }

  // 14. GET /api/agent-os/media/douyin/sessions — safe metadata only (doc §52)
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/sessions") {
    // Only status metadata is exposed; secret values never leave the vault.
    const sessions = service.store.listSessions().map((session) => ({
      profile: session.profile,
      status: session.status,
      lastVerifiedAt: session.lastVerifiedAt,
      secretConfigured: Boolean(session.secretRef),
    }));
    return jsonResponse({ ok: true, provider: "douyin", data: { sessions } }, 200, req, {});
  }

  // 15. POST /api/agent-os/media/douyin/stock-export/check — rights boundary transparency
  if (req.method === "POST" && pathname === "/api/agent-os/media/douyin/stock-export/check") {
    const body = await readJsonBody(req);
    const decision = service.stockExportDecision({
      usageClass: typeof body.usageClass === "string" ? body.usageClass : undefined,
    });
    return jsonResponse({ ok: true, provider: "douyin", data: { decision } }, 200, req, {});
  }

  // 16. GET /api/agent-os/media/douyin/mcp-tools
  if (req.method === "GET" && pathname === "/api/agent-os/media/douyin/mcp-tools") {
    const { DOUYIN_MCP_TOOLS } = await import("../../agent-os/douyin/mcp-tools");
    return jsonResponse({ ok: true, provider: "douyin", data: { tools: DOUYIN_MCP_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) } }, 200, req, {});
  }

  return null;
}
