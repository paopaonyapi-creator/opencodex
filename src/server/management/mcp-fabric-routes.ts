// Phase 20.96 — MCP Fabric / AnythingMCP control plane routes (/api/agent-os/mcp-fabric/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMcpFabricService } from "../../agent-os/mcp-fabric/service";
import { McpFabricError } from "../../agent-os/mcp-fabric/types";
import { mcpFabricEnabled } from "../../agent-os/mcp-fabric/flags";
import type { ConnectorKind, PublicationProfile } from "../../agent-os/mcp-fabric/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof McpFabricError) {
    return jsonResponse({ error: { code: err.code, message: err.message, detail: err.detail } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "INTERNAL", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch { return {}; }
}

function actor(ctx: ManagementContext, body?: Record<string, unknown>): string {
  return String(body?.actor ?? ctx.req.headers.get("x-pao-actor") ?? "operator").slice(0, 64);
}

export async function handleMcpFabricRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/mcp-fabric" && !pathname.startsWith("/api/agent-os/mcp-fabric/")) return null;
  if (!mcpFabricEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "Phase 20.96 MCP fabric is disabled" } }, 403, req, {});
  }
  const svc = getMcpFabricService();
  try {
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/health") {
      return jsonResponse(await svc.health(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/doctor") {
      return jsonResponse(await svc.doctor(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/connectors") {
      return jsonResponse({ ok: true, connectors: svc.listConnectors() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/tools") {
      return jsonResponse({ ok: true, tools: svc.listTools() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/approvals") {
      return jsonResponse({ ok: true, approvals: svc.listApprovals() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/knowledge") {
      return jsonResponse({ ok: true, candidates: svc.listKnowledge() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/skills") {
      return jsonResponse({ ok: true, candidates: svc.listSkills() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/mcp-fabric/metrics") {
      return jsonResponse({ ok: true, ...svc.metrics() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/mcp-fabric/import") {
      const body = await readJson(req);
      const result = svc.importConnector({
        kind: String(body.kind ?? "openapi") as ConnectorKind,
        name: String(body.name ?? "connector"),
        raw: String(body.raw ?? body.spec ?? ""),
        environment: typeof body.environment === "string" ? body.environment : undefined,
        credentialRef: typeof body.credentialRef === "string" ? body.credentialRef : undefined,
        actor: actor(ctx, body),
      });
      return jsonResponse({ ok: true, ...result }, 201, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/mcp-fabric/execute") {
      const body = await readJson(req);
      const result = await svc.execute({
        toolId: typeof body.toolId === "string" ? body.toolId : undefined,
        canonicalName: typeof body.canonicalName === "string" ? body.canonicalName : undefined,
        args: (body.args as Record<string, unknown>) ?? {},
        actor: actor(ctx, body),
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        profile: body.profile as PublicationProfile | undefined,
        approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
        fallbackToRaw: body.fallbackToRaw === true,
      });
      return jsonResponse(result, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/mcp-fabric/privacy-preview") {
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...svc.privacyPreview(String(body.toolId), body.payload) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/connectors/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/connectors/".length, -"/approve".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, connector: svc.approveConnector(id, actor(ctx, body), String(body.reason ?? "approved")) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/connectors/") && pathname.endsWith("/publish")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/connectors/".length, -"/publish".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, connector: svc.publishConnector(id, (body.profile as PublicationProfile) ?? "paohub-readonly", actor(ctx, body)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/connectors/") && pathname.endsWith("/disable")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/connectors/".length, -"/disable".length));
      return jsonResponse({ ok: true, connector: svc.disableConnector(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/connectors/") && pathname.endsWith("/drift")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/connectors/".length, -"/drift".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...svc.detectDrift(id, String(body.raw ?? ""), actor(ctx, body)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/approvals/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/approvals/".length, -"/approve".length));
      return jsonResponse({ ok: true, ...svc.decideApproval(id, true, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mcp-fabric/approvals/") && pathname.endsWith("/deny")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/approvals/".length, -"/deny".length));
      return jsonResponse({ ok: true, ...svc.decideApproval(id, false, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/mcp-fabric/connectors/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/mcp-fabric/connectors/".length));
      if (id.includes("/")) return jsonResponse({ error: { code: "not_found", message: "unknown connector subroute" } }, 404, req, {});
      return jsonResponse({ ok: true, connector: svc.requireConnector(id), tools: svc.listTools(id) }, 200, req, {});
    }
    return jsonResponse({ error: { code: "not_found", message: "unknown mcp-fabric route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
