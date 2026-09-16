// Phase 20.63 — External API registry management routes.
//
// Prefix-decode dispatcher (capability-lab precedent). Admin lifecycle
// routes (approve/suspend/revoke) and execution sit behind the management
// principal gate; MCP-facing tools never expose approval/revocation.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getExternalApiService } from "../../agent-os/external-apis/service";
import { EXTERNAL_API_MCP_TOOLS } from "../../agent-os/external-apis/mcp-tools";
import { ExternalApiError } from "../../agent-os/external-apis/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof ExternalApiError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "internal_error", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleExternalApiRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/external-apis/")) subPath = url.pathname.slice("/api/agent-os/external-apis/".length);
  else if (url.pathname === "/api/agent-os/external-apis") {
    subPath = "";
  }
  else return null;

  const service = getExternalApiService();

  try {
    if (req.method === "GET" && (subPath === "" || subPath === "health")) {
      const providers = service.store.listProviders();
      return jsonResponse({
        ok: true,
        phase: "20.63",
        providers: providers.length,
        approved: providers.filter((p) => ["approved", "active"].includes(p.lifecycle)).length,
        degraded: providers.filter((p) => p.lifecycle === "degraded").length,
        suspended: providers.filter((p) => p.lifecycle === "suspended").length,
        revoked: providers.filter((p) => p.lifecycle === "revoked").length,
        tools: service.store.listTools().length,
        enabledTools: service.store.listTools({ enabled: true }).length,
      }, 200, req, {});
    }

    if (subPath === "sync" && req.method === "POST") {
      const body = await readJson(req);
      return jsonResponse(await service.syncFromSource(String(body.actorId ?? "operator")), 200, req, {});
    }

    if (subPath === "capabilities/search" && req.method === "POST") {
      const body = await readJson(req);
      return jsonResponse({
        results: service.searchCapabilities(String(body.query ?? ""), {
          authFreeOnly: body.authFreeOnly === true,
          approvedOnly: body.approvedOnly === true,
          actorId: String(body.actorId ?? "operator"),
        }),
      }, 200, req, {});
    }

    if (subPath === "providers" && req.method === "GET") {
      const lifecycle = url.searchParams.get("lifecycle") ?? undefined;
      return jsonResponse({ providers: service.store.listProviders(lifecycle ? { lifecycle } : undefined) }, 200, req, {});
    }
    if (subPath.startsWith("providers/")) {
      const rest = subPath.slice("providers/".length);
      const [id, action] = rest.split("/");
      const body = req.method === "POST" ? await readJson(req) : {};
      const actorId = String(body.actorId ?? "operator");
      if (req.method === "GET" && !action) {
        return jsonResponse({
          provider: service.store.getProvider(id),
          operations: service.store.listOperations(id),
          credentials: service.store.listCredentialProfiles(id).map((c) => ({ ...c, secretRef: c.secretRef ? "***ref***" : null })),
          healthChecks: service.store.recentHealthChecks(id, 10),
        }, 200, req, {});
      }
      if (req.method === "POST" && action === "review") {
        return jsonResponse({ provider: service.transitionProvider(id, "review_required", actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "approve") {
        return jsonResponse({ provider: service.transitionProvider(id, "approved", actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "suspend") {
        return jsonResponse({ provider: service.transitionProvider(id, "suspended", actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "revoke") {
        return jsonResponse({ provider: service.transitionProvider(id, "revoked", actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "health-check") {
        return jsonResponse({ health: await service.checkProviderHealth(id, actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "operations") {
        const operation = service.addOperation({
          providerId: id,
          operationKey: String(body.operationKey ?? ""),
          httpMethod: (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(String(body.httpMethod)) ? String(body.httpMethod) : "GET") as never,
          pathTemplate: String(body.pathTemplate ?? "/"),
          serverUrl: String(body.serverUrl ?? ""),
          summary: body.summary ? String(body.summary) : undefined,
          capabilityIds: Array.isArray(body.capabilityIds) ? body.capabilityIds.map(String) : [],
          requestSchema: body.requestSchema && typeof body.requestSchema === "object" ? body.requestSchema as Record<string, unknown> : null,
          actorId,
        });
        return jsonResponse({ operation }, 201, req, {});
      }
      if (req.method === "POST" && action === "credentials") {
        const profile = service.addCredentialProfile({
          providerId: id,
          authType: (["none", "api_key", "bearer", "basic", "oauth2", "custom"].includes(String(body.authType)) ? String(body.authType) : "api_key") as never,
          secretRef: body.secretRef ? String(body.secretRef) : null,
          scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
          environment: body.environment === "prod" ? "prod" : body.environment === "dev" ? "dev" : "test",
          ownerType: body.ownerType === "user" || body.ownerType === "service" ? body.ownerType : "workspace",
          ownerId: String(body.ownerId ?? "workspace"),
          headerName: body.headerName ? String(body.headerName) : undefined,
        });
        return jsonResponse({ credentialProfile: { ...profile, secretRef: profile.secretRef ? "***ref***" : null } }, 201, req, {});
      }
    }

    if (subPath.startsWith("operations/") && req.method === "POST") {
      const rest = subPath.slice("operations/".length);
      const [id, action] = rest.split("/");
      const body = await readJson(req);
      if (action === "generate-tool") {
        return jsonResponse({ tool: service.generateTool(id, String(body.actorId ?? "operator")) }, 201, req, {});
      }
    }

    if (subPath.startsWith("tools/")) {
      const rest = subPath.slice("tools/".length);
      const [id, action] = rest.split("/");
      const body = req.method === "POST" ? await readJson(req) : {};
      const actorId = String(body.actorId ?? "operator");
      if (req.method === "GET" && !action) {
        return jsonResponse({ tools: service.store.listTools() }, 200, req, {});
      }
      if (req.method === "POST" && action === "contract-test") {
        return jsonResponse({ tool: service.recordContractTest(id, body.passed !== false, actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "approve") {
        return jsonResponse({ tool: service.approveTool(id, actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "enable") {
        return jsonResponse({ tool: service.enableTool(id, actorId) }, 200, req, {});
      }
      if (req.method === "POST" && action === "disable") {
        return jsonResponse({ tool: service.disableTool(id, actorId) }, 200, req, {});
      }
    }

    if (subPath === "execute" && req.method === "POST") {
      const body = await readJson(req);
      const result = await service.executeApproved({
        operationId: String(body.operationId ?? ""),
        actorType: body.actorType === "human" ? "human" : "agent",
        actorId: String(body.actorId ?? "agent"),
        toolId: body.toolId ? String(body.toolId) : null,
        arguments: body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : {},
        credentialProfileId: body.credentialProfileId ? String(body.credentialProfileId) : null,
      });
      return jsonResponse(result, result.outcome === "completed" ? 200 : 207, req, {});
    }

    if (subPath === "calls" && req.method === "GET") {
      return jsonResponse({ calls: service.store.listRuntimeCalls() }, 200, req, {});
    }
    if (subPath === "audit" && req.method === "GET") {
      return jsonResponse({ entries: service.listAudit() }, 200, req, {});
    }
    if (subPath === "mcp-tools" && req.method === "GET") {
      return jsonResponse({
        tools: EXTERNAL_API_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskTier: tool.riskTier,
          readOnly: tool.readOnly,
        })),
        note: "Approval/revocation stay dashboard-only; generated per-operation tools are separate and disabled until enabled.",
      }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
