// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Management REST API Routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getOrchestrationService } from "../../agent-os/orchestration";
import type { OrchestrationRunStatus, ApprovalStatus } from "../../agent-os/orchestration/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleOrchestrationRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getOrchestrationService();

  // 1. GET /api/agent-os/orchestration/status
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/status") {
    const status = await service.getStatus();
    return jsonResponse({ status }, 200, req, {});
  }

  // 2. GET /api/agent-os/orchestration/runs
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/runs") {
    const statusParam = url.searchParams.get("status") as OrchestrationRunStatus | null;
    const limitParam = Number(url.searchParams.get("limit") || 50);
    const runs = service.listRuns(limitParam, statusParam || undefined);
    return jsonResponse({ runs }, 200, req, {});
  }

  // 3. POST /api/agent-os/orchestration/runs
  if (req.method === "POST" && pathname === "/api/agent-os/orchestration/runs") {
    const body = await readJsonBody(req);
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      return badRequest(req, "Field 'prompt' is required");
    }
    const run = await service.executeRun(prompt, {
      runtimeType: body.runtimeType as any,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      workflowId: typeof body.workflowId === "string" ? body.workflowId : undefined,
      primaryModel: typeof body.primaryModel === "string" ? body.primaryModel : undefined,
      fallbackModel: typeof body.fallbackModel === "string" ? body.fallbackModel : undefined,
      metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
    });
    return jsonResponse({ run }, 200, req, {});
  }

  // 4. GET /api/agent-os/orchestration/run
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/run") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const state = await service.registry.getRuntime().getState(id);
    if (!state) return notFound(req, `Run '${id}' not found`);
    return jsonResponse(state, 200, req, {});
  }

  // 5. POST /api/agent-os/orchestration/runs/resume
  if (req.method === "POST" && pathname === "/api/agent-os/orchestration/runs/resume") {
    const body = await readJsonBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return badRequest(req, "Field 'runId' is required");

    const approvalId = typeof body.approvalId === "string" ? body.approvalId : undefined;
    const approved = body.approved !== undefined ? Boolean(body.approved) : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    const decision = approvalId && approved !== undefined ? { approvalId, approved, reason } : undefined;
    const run = await service.resumeRun(runId, decision);
    return jsonResponse({ run }, 200, req, {});
  }

  // 6. POST /api/agent-os/orchestration/runs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/orchestration/runs/cancel") {
    const body = await readJsonBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return badRequest(req, "Field 'runId' is required");
    const reason = typeof body.reason === "string" ? body.reason : "Cancelled via API";
    const run = await service.cancelRun(runId, reason);
    return jsonResponse({ run }, 200, req, {});
  }

  // 7. GET /api/agent-os/orchestration/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/approvals") {
    const statusParam = url.searchParams.get("status") as ApprovalStatus | null;
    const approvals = service.listApprovals(statusParam || undefined);
    return jsonResponse({ approvals }, 200, req, {});
  }

  // 8. POST /api/agent-os/orchestration/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/orchestration/approvals/resolve") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const approved = Boolean(body.approved);
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy : "operator";

    const approval = service.resolveApproval(id, approved, decidedBy, reason);
    return jsonResponse({ approval }, 200, req, {});
  }

  // 9. GET /api/agent-os/orchestration/mcp/servers
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/mcp/servers") {
    const servers = service.listMcpServers();
    return jsonResponse({ servers }, 200, req, {});
  }

  // 10. POST /api/agent-os/orchestration/mcp/servers
  if (req.method === "POST" && pathname === "/api/agent-os/orchestration/mcp/servers") {
    const body = await readJsonBody(req);
    const serverName = typeof body.serverName === "string" ? body.serverName : "";
    if (!serverName) return badRequest(req, "Field 'serverName' is required");

    const now = new Date().toISOString();
    service.registerMcpServer({
      id: `mcp_${Date.now()}_${serverName}`,
      serverName,
      trustLevel: (body.trustLevel as any) || "approved_third_party",
      transport: (body.transport as any) || "stdio",
      endpointOrCommand: typeof body.endpointOrCommand === "string" ? body.endpointOrCommand : "echo mcp",
      status: "active",
      toolCount: Number(body.toolCount || 0),
      lastHeartbeat: now,
      metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {},
      updatedAt: now,
    });

    return jsonResponse({ result: "ok" }, 200, req, {});
  }

  // 11. GET /api/agent-os/orchestration/policies
  if (req.method === "GET" && pathname === "/api/agent-os/orchestration/policies") {
    return jsonResponse({
      policies: {
        r0: "Harmless read - ALLOW",
        r1: "State reading / query - ALLOW",
        r2: "State modification - ALLOW inside workspace / APPROVAL_REQUIRED outside",
        r3: "Execution / destructive changes - APPROVAL_REQUIRED",
        r4: "Privileged / infrastructure - APPROVAL_REQUIRED with Reviewer Council",
      },
    }, 200, req, {});
  }

  return null;
}
