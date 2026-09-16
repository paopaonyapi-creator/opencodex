// Phase 20.35 — Pao-hubPro × Transgentic-inspired Unified AI Runtime Control
// Plane routes (repo convention: /api/agent-os/unified/*). Full-literal
// pathname guards; ids travel in the JSON body (repo precedent).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getUnifiedRuntimeService } from "../../agent-os/unified-runtime/control-plane";
import { LeadError } from "../../agent-os/leads/errors";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message } }, 400, req, {});
}

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  const code = match ? match[1] : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : code === "POLICY_BLOCKED" ? 403 : 422;
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

function requestFrom(body: Record<string, unknown>) {
  return {
    model: typeof body.model === "string" ? body.model : "pao/general",
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    messages: Array.isArray(body.messages)
      ? (body.messages as Array<{ role: string; content: string }>).filter((message) => typeof message?.role === "string" && typeof message?.content === "string").slice(0, 64)
      : undefined,
    mode: body.mode as never,
    tools: body.tools === true,
    responseFormat: body.responseFormat as never,
    execution: {
      class: body.executionClass === "agent_mode" ? ("agent_mode" as const) : ("provider_mode" as const),
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    },
    routing: {
      requiredCapabilities: Array.isArray(body.requiredCapabilities) ? (body.requiredCapabilities as never[]) : undefined,
      preferLocal: body.preferLocal === true,
    },
  };
}

export async function handleUnifiedRuntimeRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getUnifiedRuntimeService();

  // 1. GET /api/agent-os/unified/health
  if (req.method === "GET" && pathname === "/api/agent-os/unified/health") {
    const providers = service.providers();
    const healthy = providers.filter((provider) => provider.health.state === "healthy").length;
    return jsonResponse({
      ok: true,
      data: {
        state: "healthy",
        providers: providers.length,
        healthyProviders: healthy,
        circuitsOpen: providers.filter((provider) => provider.health.circuitState === "OPEN").length,
      },
    }, 200, req, {});
  }

  // 2. GET /api/agent-os/unified/providers
  if (req.method === "GET" && pathname === "/api/agent-os/unified/providers") {
    return jsonResponse({ ok: true, data: { providers: service.providers() } }, 200, req, {});
  }

  // 3. POST /api/agent-os/unified/providers/test
  if (req.method === "POST" && pathname === "/api/agent-os/unified/providers/test") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string") return badRequest(req, "Field 'providerId' is required");
    try {
      return jsonResponse({ ok: true, data: await service.testProvider(body.providerId, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. POST /api/agent-os/unified/providers/enable (human-governed flag)
  if (req.method === "POST" && pathname === "/api/agent-os/unified/providers/enable") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string") return badRequest(req, "Field 'providerId' is required");
    try {
      service.setProviderEnabled(body.providerId, body.enabled !== false, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { providerId: body.providerId, enabled: body.enabled !== false } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. POST /api/agent-os/unified/router/preview (pure decision + reasons)
  if (req.method === "POST" && pathname === "/api/agent-os/unified/router/preview") {
    const body = await readJsonBody(req);
    return jsonResponse({ ok: true, data: service.preview(requestFrom(body)) }, 200, req, {});
  }

  // 6. POST /api/agent-os/unified/router/execute
  if (req.method === "POST" && pathname === "/api/agent-os/unified/router/execute") {
    const body = await readJsonBody(req);
    try {
      const outcome = await service.routeRequest(requestFrom(body));
      return jsonResponse({ ok: !("blocked" in outcome), data: outcome }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. POST /api/agent-os/unified/context/inspect (firewall preview)
  if (req.method === "POST" && pathname === "/api/agent-os/unified/context/inspect") {
    const body = await readJsonBody(req);
    const preview = service.preview(requestFrom(body));
    return jsonResponse({ ok: true, data: preview.contextPreview }, 200, req, {});
  }

  // 8. GET /api/agent-os/unified/workspaces/:id/grants — via body on POST
  if (req.method === "POST" && pathname === "/api/agent-os/unified/workspaces/grants") {
    const body = await readJsonBody(req);
    if (typeof body.workspaceId !== "string") return badRequest(req, "Field 'workspaceId' is required");
    return jsonResponse({ ok: true, data: service.getGrants(body.workspaceId) ?? { workspaceId: body.workspaceId, grants: {}, note: "default deny" } }, 200, req, {});
  }

  // 9. POST /api/agent-os/unified/workspaces/grants/set (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/unified/workspaces/grants/set") {
    const body = await readJsonBody(req);
    if (typeof body.workspaceId !== "string" || !(body.grants && typeof body.grants === "object")) {
      return badRequest(req, "Fields 'workspaceId' and 'grants' are required");
    }
    try {
      const set = service.setGrants(body.workspaceId, body.grants as Record<string, boolean>, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: set }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 10. POST /api/agent-os/unified/attachments/validate
  if (req.method === "POST" && pathname === "/api/agent-os/unified/attachments/validate") {
    const body = await readJsonBody(req);
    const attachments = Array.isArray(body.attachments) ? (body.attachments as Array<Record<string, unknown>>) : [];
    const input = attachments.map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "attachment",
      source: typeof entry.source === "string" ? entry.source : "",
      mimeHint: typeof entry.mimeHint === "string" ? entry.mimeHint : undefined,
    }));
    try {
      return jsonResponse({ ok: true, data: { validations: await service.validateAttachments(input) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. GET /api/agent-os/unified/usage
  if (req.method === "GET" && pathname === "/api/agent-os/unified/usage") {
    return jsonResponse({ ok: true, data: { summary: service.usageSummary() } }, 200, req, {});
  }

  // 12. GET /api/agent-os/unified/audit
  if (req.method === "GET" && pathname === "/api/agent-os/unified/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { entries: service.listAudit(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  return null;
}
