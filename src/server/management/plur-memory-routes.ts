// Phase 20.43 — PLUR Shared Agent Memory Runtime routes (repo convention:
// /api/agent-memory/*). Governed REST surface over the PaoMemoryService —
// every destructive route enforces policy + human actors; sync execute is
// dashboard-gated and fail-closed.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getPlurMemoryService } from "../../agent-os/plur-memory/service";
import { MemoryError } from "../../agent-os/plur-memory/types";

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const start = message.indexOf("[");
  const end = message.indexOf("]");
  const code = start === 0 && end > 1 ? message.slice(1, end) : "MEMORY_UPSTREAM_ERROR";
  const status = code === "NOT_FOUND" || code === "MEMORY_NOT_FOUND" ? 404
    : code === "VALIDATION_FAILED" || code === "MEMORY_SCOPE_INVALID" ? 400
    : code === "MEMORY_DISABLED" || code === "MEMORY_POLICY_DENIED" || code === "MEMORY_SCOPE_FORBIDDEN" || code === "MEMORY_SYNC_DISABLED" || code === "MEMORY_SYNC_UNSAFE_REMOTE" ? 403
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

export async function handlePlurMemoryRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getPlurMemoryService();

  // 1. GET /api/agent-memory/status
  if (req.method === "GET" && pathname === "/api/agent-memory/status") {
    try {
      return jsonResponse({ ok: true, data: await service.status() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 2. GET /api/agent-memory/doctor
  if (req.method === "GET" && pathname === "/api/agent-memory/doctor") {
    try {
      return jsonResponse({ ok: true, data: await service.doctor() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 3. GET /api/agent-memory/engrams
  if (req.method === "GET" && pathname === "/api/agent-memory/engrams") {
    try {
      await service.status();
      return jsonResponse({ ok: true, data: {
        engrams: service.listEngrams({
          state: url.searchParams.get("state") ?? undefined,
          scope: url.searchParams.get("scope") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? "200") || 200,
        }),
      } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. POST /api/agent-memory/learn
  if (req.method === "POST" && pathname === "/api/agent-memory/learn") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.learn({
        title: String(body.title ?? ""),
        content: String(body.content ?? ""),
        memoryType: (String(body.memoryType ?? "note")) as never,
        scope: typeof body.scope === "string" ? body.scope : undefined,
        visibility: (typeof body.visibility === "string" ? body.visibility : "project") as never,
        sensitivity: (typeof body.sensitivity === "string" ? body.sensitivity : "normal") as never,
        sourceKind: (typeof body.sourceKind === "string" ? body.sourceKind : "explicit") as never,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. POST /api/agent-memory/recall
  if (req.method === "POST" && pathname === "/api/agent-memory/recall") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.recall({ query: String(body.query ?? ""), limit: typeof body.limit === "number" ? body.limit : 10 }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. POST /api/agent-memory/inject
  if (req.method === "POST" && pathname === "/api/agent-memory/inject") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.inject({ query: String(body.query ?? ""), budgetTokens: typeof body.budgetTokens === "number" ? body.budgetTokens : undefined }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. POST /api/agent-memory/feedback
  if (req.method === "POST" && pathname === "/api/agent-memory/feedback") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.feedback(String(body.engramRegistryId ?? ""), String(body.signal ?? "neutral") as never, typeof body.reason === "string" ? body.reason : null) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. POST /api/agent-memory/rescope
  if (req.method === "POST" && pathname === "/api/agent-memory/rescope") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.rescope(String(body.engramRegistryId ?? ""), String(body.scope ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. POST /api/agent-memory/forget
  if (req.method === "POST" && pathname === "/api/agent-memory/forget") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.forget(String(body.engramRegistryId ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 10. GET /api/agent-memory/timeline
  if (req.method === "GET" && pathname === "/api/agent-memory/timeline") {
    return jsonResponse({ ok: true, data: { episodes: service.timeline({
      eventType: url.searchParams.get("eventType") ?? undefined,
      severity: url.searchParams.get("severity") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? "100") || 100,
    }) } }, 200, req, {});
  }

  // 11. POST /api/agent-memory/episodes
  if (req.method === "POST" && pathname === "/api/agent-memory/episodes") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.captureEpisode({
        summary: String(body.summary ?? ""),
        eventType: String(body.eventType ?? "operational"),
        severity: typeof body.severity === "string" ? body.severity : "info",
        metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. GET /api/agent-memory/receipts
  if (req.method === "GET" && pathname === "/api/agent-memory/receipts") {
    return jsonResponse({ ok: true, data: { receipts: service.listReceipts(Number(url.searchParams.get("limit") ?? "50") || 50) } }, 200, req, {});
  }

  // 13. GET /api/agent-memory/conflicts
  if (req.method === "GET" && pathname === "/api/agent-memory/conflicts") {
    return jsonResponse({ ok: true, data: { conflicts: service.listConflicts() } }, 200, req, {});
  }

  // 14. POST /api/agent-memory/conflicts/resolve
  if (req.method === "POST" && pathname === "/api/agent-memory/conflicts/resolve") {
    try {
      const body = await readJsonBody(req);
      const resolved = service.resolveConflict(String(body.conflictId ?? ""), String(body.resolution ?? ""), "operator");
      return jsonResponse({ ok: resolved, data: { resolved } }, resolved ? 200 : 404, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 15. GET /api/agent-memory/candidates
  if (req.method === "GET" && pathname === "/api/agent-memory/candidates") {
    return jsonResponse({ ok: true, data: { candidates: service.listEngrams({ state: "candidate" }) } }, 200, req, {});
  }

  // 16. POST /api/agent-memory/candidates/approve
  if (req.method === "POST" && pathname === "/api/agent-memory/candidates/approve") {
    try {
      const body = await readJsonBody(req);
      const ok = service.approveCandidate(String(body.engramRegistryId ?? ""), "operator");
      return jsonResponse({ ok, data: { approved: ok } }, ok ? 200 : 404, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 17. POST /api/agent-memory/candidates/reject
  if (req.method === "POST" && pathname === "/api/agent-memory/candidates/reject") {
    try {
      const body = await readJsonBody(req);
      const ok = service.rejectCandidate(String(body.engramRegistryId ?? ""), "operator");
      return jsonResponse({ ok, data: { rejected: ok } }, ok ? 200 : 404, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 18. GET /api/agent-memory/policies
  if (req.method === "GET" && pathname === "/api/agent-memory/policies") {
    return jsonResponse({ ok: true, data: { rules: service.policy.listRules() } }, 200, req, {});
  }

  // 19. GET /api/agent-memory/adapters
  if (req.method === "GET" && pathname === "/api/agent-memory/adapters") {
    try {
      await service.status();
      return jsonResponse({ ok: true, data: { adapters: service.listAdapters() } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 20. POST /api/agent-memory/sync/preview
  if (req.method === "POST" && pathname === "/api/agent-memory/sync/preview") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.syncPreview(String(body.profile ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 21. POST /api/agent-memory/sync/execute (dashboard-gated, fail-closed)
  if (req.method === "POST" && pathname === "/api/agent-memory/sync/execute") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.syncExecute(String(body.profile ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 22. POST /api/agent-memory/reconcile
  if (req.method === "POST" && pathname === "/api/agent-memory/reconcile") {
    try {
      return jsonResponse({ ok: true, data: await service.reconcile() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  return null;
}
