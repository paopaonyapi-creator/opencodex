// Phase 20.2 — SDLC Orchestrator REST Management API
//
// Endpoints mounted under /api/sdlc/* for programmatic and dashboard control.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSdlcOrchestrator } from "../../agent-os/sdlc/orchestrator";
import { ApprovalEngine } from "../../agent-os/sdlc/approvals";
import { openAgentOsDb } from "../../agent-os/db";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleSdlcRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  if (!url.pathname.startsWith("/api/sdlc/")) return null;

  const path = url.pathname.slice("/api/sdlc/".length);
  const segments = path.split("/").filter(Boolean);
  const orchestrator = getSdlcOrchestrator();

  // 1. Approvals routes: /api/sdlc/approvals...
  if (segments[0] === "approvals") {
    if (req.method === "GET") {
      const cycleId = url.searchParams.get("cycleId") ?? undefined;
      const approvals = ApprovalEngine.listPendingApprovals(cycleId);
      return jsonResponse({ approvals }, 200, req, {});
    }

    if (req.method === "POST" && segments.length === 3) {
      const approvalId = segments[1]!;
      const action = segments[2];
      if (action !== "approve" && action !== "reject") {
        return badRequest(req, "Invalid approval action. Expected 'approve' or 'reject'");
      }

      try {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy : "operator";
        const result = ApprovalEngine.decideApproval(approvalId, action, decidedBy);
        return jsonResponse({ success: true, approval: result }, 200, req, {});
      } catch (err) {
        return badRequest(req, err instanceof Error ? err.message : String(err));
      }
    }
  }

  // 2. Cycles collection: /api/sdlc/cycles
  if (segments[0] === "cycles" && segments.length === 1) {
    if (req.method === "GET") {
      const status = (url.searchParams.get("status") as any) ?? undefined;
      const cycles = orchestrator.listCycles({ status });
      return jsonResponse({ cycles }, 200, req, {});
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (!body.title || typeof body.title !== "string" || !body.sourceIdea || typeof body.sourceIdea !== "string") {
        return badRequest(req, "Fields 'title' and 'sourceIdea' are required");
      }

      try {
        const cycle = orchestrator.createCycle({
          title: body.title,
          sourceIdea: body.sourceIdea,
          projectId: typeof body.projectId === "string" ? body.projectId : undefined,
          priority: typeof body.priority === "number" ? body.priority : undefined,
          riskLevel: typeof body.riskLevel === "string" ? (body.riskLevel as any) : undefined,
          autoRunMode: typeof body.autoRunMode === "string" ? (body.autoRunMode as any) : undefined,
          constraints: Array.isArray(body.constraints) ? body.constraints : undefined,
          createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
        });
        return jsonResponse({ success: true, cycle }, 201, req, {});
      } catch (err) {
        return badRequest(req, err instanceof Error ? err.message : String(err));
      }
    }
  }

  // 3. Single cycle routes: /api/sdlc/cycles/:id...
  if (segments[0] === "cycles" && segments.length >= 2) {
    const cycleId = segments[1]!;

    let cycle;
    try {
      cycle = orchestrator.getCycle(cycleId);
    } catch {
      return notFound(req, `Cycle '${cycleId}' not found`);
    }

    // Detail GET: /api/sdlc/cycles/:id
    if (segments.length === 2 && req.method === "GET") {
      const db = openAgentOsDb();
      const requirements = orchestrator.getRequirements(cycleId);
      const acceptanceCriteria = orchestrator.getAcceptanceCriteria(cycleId);
      const tasks = orchestrator.getTasks(cycleId);
      const adrs = db.query("SELECT * FROM sdlc_adrs WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId);
      const clarifications = db.query("SELECT * FROM sdlc_clarifications WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId);
      const gates = db.query("SELECT * FROM sdlc_gates WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId);
      const reviews = db.query("SELECT * FROM sdlc_reviews WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId);

      return jsonResponse({
        cycle,
        requirements,
        acceptanceCriteria,
        tasks,
        adrs,
        clarifications,
        gates,
        reviews,
      }, 200, req, {});
    }

    // Stage executions: POST /api/sdlc/cycles/:id/:action
    if (segments.length === 3 && req.method === "POST") {
      const action = segments[2];

      try {
        switch (action) {
          case "specify": {
            const result = await orchestrator.specify(cycleId);
            return jsonResponse({ success: true, ...result }, 200, req, {});
          }
          case "clarify": {
            const result = await orchestrator.clarify(cycleId);
            return jsonResponse({ success: true, ...result }, 200, req, {});
          }
          case "plan": {
            const result = await orchestrator.plan(cycleId);
            return jsonResponse({ success: true, ...result }, 200, req, {});
          }
          case "tasks": {
            const result = await orchestrator.generateTasks(cycleId);
            return jsonResponse({ success: true, ...result }, 200, req, {});
          }
          case "analyze": {
            const result = await orchestrator.analyze(cycleId);
            return jsonResponse({ success: true, coverage: result }, 200, req, {});
          }
          case "checklist": {
            const result = await orchestrator.evaluateChecklist(cycleId);
            return jsonResponse({ success: true, ...result }, 200, req, {});
          }
          case "implement": {
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
            const taskId = typeof body.taskId === "string" ? body.taskId : "";
            if (!taskId) return badRequest(req, "Field 'taskId' is required for implement");
            const result = await orchestrator.implementTask(cycleId, taskId);
            return jsonResponse(result, 200, req, {});
          }
          case "test": {
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
            const fastCheck = Boolean(body.fastCheck);
            const result = await orchestrator.runTests(cycleId, { fastCheck });
            return jsonResponse({ success: true, verification: result }, 200, req, {});
          }
          case "review": {
            const result = await orchestrator.runReview(cycleId);
            return jsonResponse({ success: true, review: result }, 200, req, {});
          }
          case "converge": {
            const result = await orchestrator.converge(cycleId);
            return jsonResponse({ success: true, convergence: result }, 200, req, {});
          }
          case "rollback": {
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
            const reason = typeof body.reason === "string" ? body.reason : undefined;
            const updated = orchestrator.rollback(cycleId, reason);
            return jsonResponse({ success: true, cycle: updated }, 200, req, {});
          }
          default:
            return notFound(req, `Action '${action}' not supported`);
        }
      } catch (err) {
        return badRequest(req, err instanceof Error ? err.message : String(err));
      }
    }

    // Sub-resources GET: /api/sdlc/cycles/:id/artifacts | gates | evidence
    if (segments.length === 3 && req.method === "GET") {
      const sub = segments[2];
      const db = openAgentOsDb();

      if (sub === "artifacts") {
        const artifacts = db.query("SELECT * FROM sdlc_artifacts WHERE cycle_id = ? ORDER BY version DESC").all(cycleId);
        return jsonResponse({ artifacts }, 200, req, {});
      }
      if (sub === "gates") {
        const gates = db.query("SELECT * FROM sdlc_gates WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId);
        return jsonResponse({ gates }, 200, req, {});
      }
      if (sub === "evidence") {
        const evidence = db.query("SELECT * FROM sdlc_evidence WHERE cycle_id = ? ORDER BY verified_at DESC").all(cycleId);
        return jsonResponse({ evidence }, 200, req, {});
      }
    }
  }

  return null;
}
