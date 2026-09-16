// Phase 20.33 — Pao-hubPro × Open WebUI Unified AI Workspace & MCP Control
// Plane routes (repo convention: /api/agent-os/ai-workspace/*). The MCP
// JSON-RPC endpoint rides the token-authenticated management API; Open WebUI
// connects to it as a remote MCP server with the admin token as header auth.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAiWorkspaceGateway } from "../../agent-os/ai-workspace/gateway";
import { handleMcpRpc } from "./mcp-gateway-protocol";

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function handleAiWorkspaceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const gateway = getAiWorkspaceGateway();

  // 1. GET /api/agent-os/ai-workspace/status
  if (req.method === "GET" && pathname === "/api/agent-os/ai-workspace/status") {
    return jsonResponse({ ok: true, data: gateway.status() }, 200, req, {});
  }

  // 2. GET /api/agent-os/ai-workspace/health (aggregate; optional parts degrade)
  if (req.method === "GET" && pathname === "/api/agent-os/ai-workspace/health") {
    const health = await gateway.health();
    return jsonResponse({ ok: true, data: health }, 200, req, {});
  }

  // 3. GET /api/agent-os/ai-workspace/tools (pao.* catalog with risk metadata)
  if (req.method === "GET" && pathname === "/api/agent-os/ai-workspace/tools") {
    return jsonResponse({ ok: true, data: { tools: gateway.listTools() } }, 200, req, {});
  }

  // 4. POST /api/agent-os/ai-workspace/mcp — MCP JSON-RPC endpoint
  if (req.method === "POST" && pathname === "/api/agent-os/ai-workspace/mcp") {
    const body = await readJsonBody(req);
    try {
      const reply = await handleMcpRpc(body);
      if (reply === null) return new Response(null, { status: 202 });
      return jsonResponse(reply, 200, req, {});
    } catch (err) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: err instanceof Error ? err.message : "internal error" },
      }, 200, req, {});
    }
  }

  // 5. POST /api/agent-os/ai-workspace/tools/call — dashboard convenience
  if (req.method === "POST" && pathname === "/api/agent-os/ai-workspace/tools/call") {
    const body = await readJsonBody(req);
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (typeof input.name !== "string") {
      return jsonResponse({ ok: false, error: { code: "TOOL_DENIED", message: "Field 'name' is required" } }, 400, req, {});
    }
    const outcome = await gateway.callTool({
      name: input.name,
      args: input.args && typeof input.args === "object" ? (input.args as Record<string, unknown>) : {},
      actor: typeof input.actor === "string" ? input.actor : "dashboard",
      sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
      approvalId: typeof input.approvalId === "string" ? input.approvalId : undefined,
    });
    return jsonResponse({ ok: outcome.status === "success" || outcome.status === "surface", data: outcome }, 200, req, {});
  }

  // 6. GET /api/agent-os/ai-workspace/openwebui — pin/reachability status
  if (req.method === "GET" && pathname === "/api/agent-os/ai-workspace/openwebui") {
    const status = await gateway.openWebuiStatus();
    return jsonResponse({ ok: true, data: status }, 200, req, {});
  }

  return null;
}
