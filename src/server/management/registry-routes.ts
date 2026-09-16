// Phase 20.25 — Pao-hubPro × Agentic AI Universal Registry & Toolchain
// Management REST API routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getUniversalRegistryService } from "../../agent-os/universal-registry/service";
import type { RegistryRiskLevel } from "../../agent-os/universal-registry/types";

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

export async function handleRegistryRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getUniversalRegistryService();

  // 1. GET /api/agent-os/registry/status
  if (req.method === "GET" && pathname === "/api/agent-os/registry/status") {
    return jsonResponse({ status: service.status() }, 200, req, {});
  }

  // 2. GET /api/agent-os/registry/tools
  if (req.method === "GET" && pathname === "/api/agent-os/registry/tools") {
    const riskMaxRaw = url.searchParams.get("riskMax");
    const filters = {
      type: (url.searchParams.get("type") ?? undefined) as never,
      provider: url.searchParams.get("provider") ?? undefined,
      health: (url.searchParams.get("health") ?? undefined) as never,
      riskMax: riskMaxRaw !== null ? (Number(riskMaxRaw) as RegistryRiskLevel) : undefined,
      executableOnly: url.searchParams.get("executableOnly") === "true",
      sourceKind: (url.searchParams.get("sourceKind") ?? undefined) as never,
      capability: url.searchParams.get("capability") ?? undefined,
    };
    return jsonResponse({ tools: service.listTools(filters) }, 200, req, {});
  }

  // 3. GET /api/agent-os/registry/tool
  if (req.method === "GET" && pathname === "/api/agent-os/registry/tool") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const tool = service.getTool(id);
    if (!tool) return notFound(req, `Tool '${id}' not found`);
    return jsonResponse({ tool }, 200, req, {});
  }

  // 4. POST /api/agent-os/registry/search
  if (req.method === "POST" && pathname === "/api/agent-os/registry/search") {
    const body = await readJsonBody(req);
    const query = typeof body.query === "string" ? body.query : "";
    if (!query.trim()) return badRequest(req, "Field 'query' is required");
    const limit = typeof body.limit === "number" ? Math.min(100, Math.max(1, body.limit)) : 20;
    const result = service.search(query, (body.filters ?? {}) as never, limit);
    return jsonResponse({
      query: result.query,
      results: result.results.map((r) => ({
        tool: r.tool,
        score: Math.round(r.score * 1000) / 1000,
        match: Math.round(r.match * 1000) / 1000,
        reasons: r.reasons,
      })),
    }, 200, req, {});
  }

  // 5. POST /api/agent-os/registry/sync
  if (req.method === "POST" && pathname === "/api/agent-os/registry/sync") {
    const body = await readJsonBody(req);
    const sources = Array.isArray(body.sources) && body.sources.every((s) => typeof s === "string")
      ? (body.sources as string[])
      : undefined;
    return jsonResponse({ sync: service.sync(sources) }, 200, req, {});
  }

  // 6. POST /api/agent-os/registry/health-check
  if (req.method === "POST" && pathname === "/api/agent-os/registry/health-check") {
    // MVP health pass: derives health from accumulated execution metrics.
    // Network health probes for remote APIs are a documented follow-up.
    return jsonResponse(service.healthCheck(), 200, req, {});
  }

  // 7. POST /api/agent-os/registry/plan
  if (req.method === "POST" && pathname === "/api/agent-os/registry/plan") {
    const body = await readJsonBody(req);
    const goal = typeof body.goal === "string" ? body.goal : "";
    if (!goal.trim()) return badRequest(req, "Field 'goal' is required");
    try {
      const run = service.plan({
        goal,
        profile: (typeof body.profile === "string" ? body.profile : "balanced") as never,
        dryRun: body.dryRun === true,
      });
      return jsonResponse({ run }, 201, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 8. POST /api/agent-os/registry/runs (execute a planned run)
  if (req.method === "POST" && pathname === "/api/agent-os/registry/runs") {
    const body = await readJsonBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return badRequest(req, "Field 'runId' is required");
    try {
      const inputs = Array.isArray(body.inputs)
        ? (body.inputs as Array<{ stepId?: unknown; input?: unknown }>).map((item) => ({
            stepId: String(item.stepId ?? ""),
            input: (item.input && typeof item.input === "object" ? item.input : {}) as Record<string, unknown>,
          }))
        : [];
      const run = await service.executeRun(runId, inputs);
      return jsonResponse({ run }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 9. GET /api/agent-os/registry/runs
  if (req.method === "GET" && pathname === "/api/agent-os/registry/runs") {
    const limit = Number(url.searchParams.get("limit") || 50);
    return jsonResponse({ runs: service.listRuns(limit) }, 200, req, {});
  }

  // 10. GET /api/agent-os/registry/run
  if (req.method === "GET" && pathname === "/api/agent-os/registry/run") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const found = service.getRun(id);
    if (!found) return notFound(req, `Run '${id}' not found`);
    return jsonResponse(found, 200, req, {});
  }

  // 11. POST /api/agent-os/registry/runs/replay
  if (req.method === "POST" && pathname === "/api/agent-os/registry/runs/replay") {
    const body = await readJsonBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return badRequest(req, "Field 'runId' is required");
    const mode = (typeof body.mode === "string" ? body.mode : "exact") as "exact" | "latest_tools" | "from_failed";
    try {
      const run = await service.replay(runId, mode);
      return jsonResponse({ run }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 12. GET /api/agent-os/registry/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/registry/approvals") {
    const status = (url.searchParams.get("status") ?? undefined) as never;
    return jsonResponse({ approvals: service.listApprovals(status) }, 200, req, {});
  }

  // 13. POST /api/agent-os/registry/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/registry/approvals/resolve") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
    if (!id || !decision) return badRequest(req, "Fields 'id' and decision (approved|rejected) are required");
    const approval = service.resolveApproval(id, decision);
    if (!approval) return notFound(req, `Pending approval '${id}' not found`);
    return jsonResponse({ approval }, 200, req, {});
  }

  // 14. GET /api/agent-os/registry/audit
  if (req.method === "GET" && pathname === "/api/agent-os/registry/audit") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const runId = url.searchParams.get("runId") ?? undefined;
    return jsonResponse({ events: service.audit(limit, runId) }, 200, req, {});
  }

  // 15. GET /api/agent-os/registry/stats
  if (req.method === "GET" && pathname === "/api/agent-os/registry/stats") {
    return jsonResponse({ stats: service.stats() }, 200, req, {});
  }

  // 16. POST /api/agent-os/registry/tools/toggle
  if (req.method === "POST" && pathname === "/api/agent-os/registry/tools/toggle") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const enabled = body.enabled === true;
    if (!id) return badRequest(req, "Field 'id' is required");
    const tool = service.setToolEnabled(id, enabled);
    if (!tool) return notFound(req, `Tool '${id}' not found`);
    return jsonResponse({ tool }, 200, req, {});
  }

  // 17. POST /api/agent-os/registry/feedback
  if (req.method === "POST" && pathname === "/api/agent-os/registry/feedback") {
    const body = await readJsonBody(req);
    const toolId = typeof body.toolId === "string" ? body.toolId : "";
    if (!toolId) return badRequest(req, "Field 'toolId' is required");
    const ok = service.feedback(toolId, body.useful === true, body.prefer === true);
    if (!ok) return notFound(req, `Tool '${toolId}' not found`);
    return jsonResponse({ recorded: true }, 200, req, {});
  }

  return null;
}
