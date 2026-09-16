// Phase 20.37 — Agentic Development OS routes (repo convention:
// /api/agent-os/orch/*). Full-literal pathname guards; ids in the JSON body
// (repo precedent); approval resolution is human-governed inside the service.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAgenticOsService } from "../../agent-os/agentic-os/service";
import { BusinessError } from "../../agent-os/business-builder/sources";

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

export async function handleAgenticOsRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getAgenticOsService();

  // 1. GET /api/agent-os/orch/health (doctor)
  if (req.method === "GET" && pathname === "/api/agent-os/orch/health") {
    return jsonResponse({ ok: true, data: await service.doctor() }, 200, req, {});
  }

  // 2. GET /api/agent-os/orch/agents
  if (req.method === "GET" && pathname === "/api/agent-os/orch/agents") {
    return jsonResponse({ ok: true, data: { agents: service.listAgents() } }, 200, req, {});
  }

  // 3. POST /api/agent-os/orch/agents/enable (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/agents/enable") {
    const body = await readJsonBody(req);
    if (typeof body.agentSlug !== "string") return badRequest(req, "Field 'agentSlug' is required");
    try {
      service.setAgentEnabled(body.agentSlug, body.enabled !== false, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { agentSlug: body.agentSlug, enabled: body.enabled !== false } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. GET /api/agent-os/orch/skills
  if (req.method === "GET" && pathname === "/api/agent-os/orch/skills") {
    return jsonResponse({ ok: true, data: { skills: service.listSkills() } }, 200, req, {});
  }

  // 5. GET /api/agent-os/orch/hooks
  if (req.method === "GET" && pathname === "/api/agent-os/orch/hooks") {
    return jsonResponse({ ok: true, data: { policies: service.listHookPolicies() } }, 200, req, {});
  }

  // 6. POST /api/agent-os/orch/route (preview only — never executes)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/route") {
    const body = await readJsonBody(req);
    if (typeof body.goal !== "string" || !body.goal.trim()) return badRequest(req, "Field 'goal' is required");
    const decision = service.previewRoute({
      goal: body.goal,
      source: (typeof body.source === "string" ? body.source : "dashboard") as never,
      requestedAgent: typeof body.requestedAgent === "string" ? body.requestedAgent : undefined,
      requestedSkill: typeof body.requestedSkill === "string" ? body.requestedSkill : undefined,
    });
    return jsonResponse({ ok: true, data: { decision } }, 200, req, {});
  }

  // 7. POST /api/agent-os/orch/runs (intake)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/runs") {
    const body = await readJsonBody(req);
    if (typeof body.goal !== "string" || !body.goal.trim()) return badRequest(req, "Field 'goal' is required");
    try {
      const run = await service.startRun({
        goal: body.goal,
        source: (typeof body.source === "string" ? body.source : "dashboard") as never,
        requestedAgent: typeof body.requestedAgent === "string" ? body.requestedAgent : undefined,
        requestedSkill: typeof body.requestedSkill === "string" ? body.requestedSkill : undefined,
        workspaceRoot: typeof body.workspaceRoot === "string" ? body.workspaceRoot : undefined,
      }, typeof body.requestedBy === "string" ? body.requestedBy : "dashboard");
      return jsonResponse({ ok: true, data: { run, decision: run.routeJson ? JSON.parse(run.routeJson) : null } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. GET /api/agent-os/orch/runs
  if (req.method === "GET" && pathname === "/api/agent-os/orch/runs") {
    const status = url.searchParams.get("status") || undefined;
    return jsonResponse({ ok: true, data: { runs: service.listRuns(status as never) } }, 200, req, {});
  }

  // 9. POST /api/agent-os/orch/runs/detail
  if (req.method === "POST" && pathname === "/api/agent-os/orch/runs/detail") {
    const body = await readJsonBody(req);
    if (typeof body.runId !== "string") return badRequest(req, "Field 'runId' is required");
    const run = service.getRun(body.runId);
    if (!run) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "run not found" } }, 404, req, {});
    return jsonResponse({ ok: true, data: { run, toolCalls: service.listToolCalls(body.runId) } }, 200, req, {});
  }

  // 10. POST /api/agent-os/orch/runs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/orch/runs/cancel") {
    const body = await readJsonBody(req);
    if (typeof body.runId !== "string") return badRequest(req, "Field 'runId' is required");
    try {
      return jsonResponse({ ok: true, data: { run: service.cancelRun(body.runId, typeof body.actor === "string" ? body.actor : "dashboard") } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. GET /api/agent-os/orch/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/orch/approvals") {
    return jsonResponse({ ok: true, data: { approvals: service.listApprovals(url.searchParams.get("status") || undefined) } }, 200, req, {});
  }

  // 12. POST /api/agent-os/orch/approvals/resolve (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/approvals/resolve") {
    const body = await readJsonBody(req);
    if (typeof body.approvalId !== "string" || (body.decision !== "approved" && body.decision !== "rejected")) {
      return badRequest(req, "Fields 'approvalId' and 'decision' (approved|rejected) are required");
    }
    try {
      const run = await service.resolveApproval(body.approvalId, body.decision, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { run } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 13. GET /api/agent-os/orch/worktrees
  if (req.method === "GET" && pathname === "/api/agent-os/orch/worktrees") {
    return jsonResponse({ ok: true, data: { worktrees: service.listWorktrees() } }, 200, req, {});
  }

  // 14. POST /api/agent-os/orch/worktrees/allocate
  if (req.method === "POST" && pathname === "/api/agent-os/orch/worktrees/allocate") {
    const body = await readJsonBody(req);
    if (typeof body.repoRoot !== "string" || typeof body.runId !== "string" || typeof body.agentSlug !== "string") {
      return badRequest(req, "Fields 'repoRoot', 'runId' and 'agentSlug' are required");
    }
    try {
      return jsonResponse({ ok: true, data: { worktree: await service.allocateWorktree(body.repoRoot, body.runId, body.agentSlug) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 15. POST /api/agent-os/orch/worktrees/release (refuses dirty)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/worktrees/release") {
    const body = await readJsonBody(req);
    if (typeof body.worktreeId !== "string") return badRequest(req, "Field 'worktreeId' is required");
    try {
      return jsonResponse({ ok: true, data: { worktree: await service.releaseWorktree(body.worktreeId) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 16. GET /api/agent-os/orch/memories
  if (req.method === "GET" && pathname === "/api/agent-os/orch/memories") {
    return jsonResponse({ ok: true, data: { memories: service.listMemories(url.searchParams.get("scope") || undefined) } }, 200, req, {});
  }

  // 17. POST /api/agent-os/orch/memories (redacted, bounded)
  if (req.method === "POST" && pathname === "/api/agent-os/orch/memories") {
    const body = await readJsonBody(req);
    if (typeof body.memoryType !== "string" || typeof body.scope !== "string" || typeof body.key !== "string" || typeof body.summary !== "string") {
      return badRequest(req, "Fields 'memoryType', 'scope', 'key' and 'summary' are required");
    }
    try {
      return jsonResponse({ ok: true, data: service.writeMemory({
        memoryType: body.memoryType as never,
        scope: body.scope,
        key: body.key,
        summary: body.summary,
        sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : undefined,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        runId: typeof body.runId === "string" ? body.runId : undefined,
        actor: typeof body.actor === "string" ? body.actor : "agent:memory-curator",
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 18. GET /api/agent-os/orch/audit (filters: runId/eventType/severity)
  if (req.method === "GET" && pathname === "/api/agent-os/orch/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { events: service.listAudit({
      runId: url.searchParams.get("runId") || undefined,
      eventType: url.searchParams.get("eventType") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      limit: Number.isFinite(limitParam) ? limitParam : 50,
    }) } }, 200, req, {});
  }

  return null;
}

export { BusinessError };
