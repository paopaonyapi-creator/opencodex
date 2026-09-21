// Phase 21.00 — Unified Control Plane REST Routes (/api/agent-os/unified/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getUnifiedControlPlane } from "../../agent-os/control-plane/unified-service";
import { UapError } from "../../agent-os/control-plane/unified-types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof UapError) {
    return jsonResponse(
      { error: { code: err.code, message: err.message, detail: err.detail } },
      err.httpStatus,
      req,
      {},
    );
  }
  return jsonResponse(
    { error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Unified control plane request failed" } },
    500,
    req,
    {},
  );
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleUnifiedControlPlaneRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/unified" && !pathname.startsWith("/api/agent-os/unified/")) return null;

  const uap = getUnifiedControlPlane();

  try {
    // Agents
    if (req.method === "GET" && pathname === "/api/agent-os/unified/agents") {
      return jsonResponse({ ok: true, agents: uap.listAgents() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/unified/agents") {
      const body = await readJson(req);
      const ag = uap.registerAgent({
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        displayName: String(body.displayName ?? "agent"),
        runtimeType: (body.runtimeType as any) ?? "custom",
        provider: String(body.provider ?? "generic"),
        model: typeof body.model === "string" ? body.model : null,
        hostId: String(body.hostId ?? "local"),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
      });
      return jsonResponse({ ok: true, agent: ag }, 201, req, {});
    }

    // Hosts
    if (req.method === "GET" && pathname === "/api/agent-os/unified/hosts") {
      return jsonResponse({ ok: true, hosts: uap.listHosts() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/unified/hosts") {
      const body = await readJson(req);
      const host = uap.registerHost({
        hostId: typeof body.hostId === "string" ? body.hostId : undefined,
        displayName: String(body.displayName ?? "host"),
        hostType: (body.hostType as any) ?? "remote_linux",
        osFamily: (body.osFamily as any) ?? "linux",
        architecture: (body.architecture as any) ?? "x86_64",
        connectionMode: (body.connectionMode as any) ?? "direct",
        trustLevel: (body.trustLevel as any) ?? "MANAGED_REMOTE",
      });
      return jsonResponse({ ok: true, host }, 201, req, {});
    }

    // Jobs
    if (req.method === "POST" && pathname === "/api/agent-os/unified/jobs") {
      const body = await readJson(req);
      const job = await uap.submitJob({
        jobType: String(body.jobType ?? "task"),
        hostId: String(body.hostId ?? "local"),
        requestedBy: String(body.requestedBy ?? "operator"),
        agentId: typeof body.agentId === "string" ? body.agentId : null,
        priority: typeof body.priority === "number" ? body.priority : 5,
        payload: (body.payload as any) ?? {},
        riskClass: body.riskClass as any,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
      });
      return jsonResponse({ ok: true, job }, 201, req, {});
    }

    // Approvals
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/unified/approvals/") && pathname.endsWith("/decide")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/unified/approvals/".length, -"/decide".length));
      const body = await readJson(req);
      const appr = uap.decideApproval(
        id,
        body.decision === "approved" ? "approved" : "rejected",
        String(body.decidedBy ?? "operator"),
        typeof body.reason === "string" ? body.reason : undefined,
      );
      return jsonResponse({ ok: true, approval: appr }, 200, req, {});
    }

    // MCP
    if (req.method === "GET" && pathname === "/api/agent-os/unified/mcp/tools") {
      return jsonResponse({ ok: true, tools: uap.listMcpTools() }, 200, req, {});
    }

    // Skills
    if (req.method === "GET" && pathname === "/api/agent-os/unified/skills") {
      return jsonResponse({ ok: true, skills: uap.listSkills() }, 200, req, {});
    }

    // Audit
    if (req.method === "GET" && pathname === "/api/agent-os/unified/audit") {
      const correlationId = url.searchParams.get("correlationId") ?? undefined;
      return jsonResponse({ ok: true, events: uap.listAuditEvents(correlationId) }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: "unknown unified control-plane route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
