// Phase 20.100 — Pao-hubPro × ZCode Agent-Native Coding Workspace Runtime routes (/api/agent-os/zcode/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { ManagedZCodeRuntimeAdapter } from "../../agent-os/zcode";

const adapter = new ManagedZCodeRuntimeAdapter();

export async function handleZCodeRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (pathname !== "/api/agent-os/zcode" && !pathname.startsWith("/api/agent-os/zcode/")) {
    return null;
  }

  if (req.method === "GET" && pathname === "/api/agent-os/zcode/health") {
    const health = await adapter.getRuntimeHealth("local_runtime");
    return jsonResponse({ ok: true, health }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/agent-os/zcode/runtimes") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const handle = await adapter.startRuntime({
        workspacePath: String(body.workspacePath || "."),
        workspaceIdentity: String(body.workspaceIdentity || "default"),
        mode: body.mode as never,
      });
      return jsonResponse({ ok: true, runtime: handle }, 201, req, {});
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400, req, {});
    }
  }

  if (req.method === "GET" && pathname === "/api/agent-os/zcode/tools") {
    const tools = await adapter.listTools("default");
    return jsonResponse({ ok: true, count: tools.length, tools }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/agent-os/zcode/approvals") {
    const pending = adapter.permissionBridge.getPendingApprovals();
    return jsonResponse({ ok: true, count: pending.length, pending }, 200, req, {});
  }

  return jsonResponse({ error: "Not found" }, 404, req, {});
}
