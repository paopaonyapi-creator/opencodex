// Phase 20.29 — ClawFlows-inspired Workflow Registry & Safe Automation Engine
// REST routes (/api/agent-os/automation/*). Distinct from the Phase 20.12
// browser workflow routes; this surface governs WORKFLOW.md registry runs.

import { existsSync, readFileSync } from "node:fs";
import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { WorkflowEngine, workflowFlags } from "../../agent-os/workflows/runtime";

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

let engineSingleton: WorkflowEngine | null = null;

function getEngine(): WorkflowEngine {
  if (!engineSingleton) engineSingleton = new WorkflowEngine();
  return engineSingleton;
}

/** Test seam. */
export function resetWorkflowEngineForTests(): void {
  engineSingleton = null;
}

function engineError(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  return jsonResponse({ error: { code: match ? match[1] : "workflow_error", message } }, 422, req, {});
}

export async function handleAutomationRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const engine = getEngine();

  // 1. GET /api/agent-os/automation — registry list + flags
  // Auto-seeds repo workflows on first inspect if registry is empty.
  if (req.method === "GET" && pathname === "/api/agent-os/automation") {
    let list = engine.listWorkflows();
    if (list.length === 0 && existsSync("workflows")) {
      engine.seedFromDirectory("workflows");
      list = engine.listWorkflows();
    }
    return jsonResponse({ workflows: list, flags: workflowFlags() }, 200, req, {});
  }

  // POST /api/agent-os/automation/seed — seed or refresh from workflows/ directory
  if (req.method === "POST" && pathname === "/api/agent-os/automation/seed") {
    const body = await readJsonBody(req);
    const dir = typeof body.dir === "string" && body.dir ? body.dir : "workflows";
    const result = engine.seedFromDirectory(dir);
    return jsonResponse({
      ok: true,
      directory: dir,
      imported: result.imported,
      importedCount: result.imported.length,
      failed: result.failed,
      workflows: engine.listWorkflows(),
    }, 200, req, {});
  }

  // 2. POST /api/agent-os/automation/import
  if (req.method === "POST" && pathname === "/api/agent-os/automation/import") {
    const body = await readJsonBody(req);
    const source = typeof body.source === "string" ? body.source : "imported";
    let raw = typeof body.raw === "string" ? body.raw : "";
    if (!raw && typeof body.path === "string" && existsSync(body.path)) {
      raw = readFileSync(body.path, "utf8");
    }
    if (!raw) return badRequest(req, "Field 'raw' (WORKFLOW.md content) or a readable 'path' is required");
    try {
      return jsonResponse({ import: engine.importWorkflow(raw, source) }, 201, req, {});
    } catch (err) {
      return engineError(req, err);
    }
  }

  // 3. POST /api/agent-os/automation/enable | disable (full-literal guards)
  if (req.method === "POST" && pathname === "/api/agent-os/automation/enable") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    if (!engine.setEnabled(id, true)) return notFound(req, "Workflow not found");
    return jsonResponse({ id, enabled: true }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-os/automation/disable") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    if (!engine.setEnabled(id, false)) return notFound(req, "Workflow not found");
    return jsonResponse({ id, enabled: false }, 200, req, {});
  }

  // 4. POST /api/agent-os/automation/dry-run
  if (req.method === "POST" && pathname === "/api/agent-os/automation/dry-run") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const dry = engine.dryRun(id);
    if (!dry) return notFound(req, "Workflow not found");
    return jsonResponse({ dryRun: dry }, 200, req, {});
  }

  // 5. POST /api/agent-os/automation/run
  if (req.method === "POST" && pathname === "/api/agent-os/automation/run") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    try {
      const run = await engine.startRun(id, { dryRun: body.dryRun === true });
      if (!run) return notFound(req, "Workflow not found");
      return jsonResponse({ run }, 201, req, {});
    } catch (err) {
      return engineError(req, err);
    }
  }

  // 6. GET /api/agent-os/automation/runs
  if (req.method === "GET" && pathname === "/api/agent-os/automation/runs") {
    const workflowId = url.searchParams.get("workflowId") ?? undefined;
    return jsonResponse({ runs: engine.store.listRuns(workflowId) }, 200, req, {});
  }

  // 7. GET /api/agent-os/automation/runs/detail
  if (req.method === "GET" && pathname === "/api/agent-os/automation/runs/detail") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const run = engine.store.getRun(id);
    if (!run) return notFound(req, "Run not found");
    return jsonResponse({ run, steps: engine.store.listStepRuns(id), audit: engine.store.listAudit(200, id) }, 200, req, {});
  }

  // 8. POST /api/agent-os/automation/runs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/automation/runs/cancel") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const run = engine.cancelRun(id, typeof body.actor === "string" ? body.actor : "dashboard");
    if (!run) return notFound(req, "Run not found");
    return jsonResponse({ run }, 200, req, {});
  }

  // 9. POST /api/agent-os/automation/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/automation/approvals/resolve") {
    const body = await readJsonBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
    const actor = typeof body.actor === "string" ? body.actor : "dashboard";
    if (!runId || !decision) return badRequest(req, "Fields 'runId' and decision (approved|denied) are required");
    try {
      const run = decision === "approved"
        ? await engine.approveRun(runId, actor)
        : engine.denyRun(runId, actor);
      if (!run) return notFound(req, "Run not found or not awaiting approval");
      return jsonResponse({ run }, 200, req, {});
    } catch (err) {
      return engineError(req, err);
    }
  }

  // 10. POST /api/agent-os/automation/runs/replay
  if (req.method === "POST" && pathname === "/api/agent-os/automation/runs/replay") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    try {
      const run = await engine.replayRun(id, typeof body.actor === "string" ? body.actor : "dashboard");
      if (!run) return notFound(req, "Run not found or not replayable");
      return jsonResponse({ run }, 201, req, {});
    } catch (err) {
      return engineError(req, err);
    }
  }

  // 11. GET /api/agent-os/automation/audit
  if (req.method === "GET" && pathname === "/api/agent-os/automation/audit") {
    const runId = url.searchParams.get("runId") ?? undefined;
    return jsonResponse({ events: engine.store.listAudit(100, runId) }, 200, req, {});
  }

  // 12. POST /api/agent-os/automation/scheduler/tick
  if (req.method === "POST" && pathname === "/api/agent-os/automation/scheduler/tick") {
    try {
      return jsonResponse({ dispatched: await engine.schedulerTick() }, 200, req, {});
    } catch (err) {
      return engineError(req, err);
    }
  }

  return null;
}
