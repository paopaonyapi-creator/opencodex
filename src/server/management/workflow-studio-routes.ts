// Phase 20.93 — Workflow Studio management routes (/api/agent-os/workflow-studio/*).
//
// Follows the repo's route conventions: literal `pathname ===` guards with a
// method clause on the same line for registered literal routes; `{id}` slices
// for parameterized paths. Mutating operations traverse the run engine's gates
// (policy, approvals) and error codes are machine-readable.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getWorkflowStudioService } from "../../agent-os/workflow-studio/service";
import { getWorkflowRunEngine } from "../../agent-os/workflow-studio/run-engine";
import { getNodeRegistry } from "../../agent-os/workflow-studio/registry";
import { WorkflowStudioError } from "../../agent-os/workflow-studio/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof WorkflowStudioError) {
    return jsonResponse({ error: { code: err.code, message: err.message, detail: err.detail } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "INTERNAL", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function actor(ctx: ManagementContext, body?: Record<string, unknown>): string {
  const fromBody = body && typeof body.actor === "string" ? body.actor : undefined;
  const fromHeader = ctx.req.headers.get("x-pao-actor") ?? undefined;
  return (fromBody ?? fromHeader ?? "operator").slice(0, 64);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function handleWorkflowStudioRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getWorkflowStudioService();
  const engine = getWorkflowRunEngine(service);

  try {
    // 1. GET /api/agent-os/workflow-studio/health
    if (req.method === "GET" && pathname === "/api/agent-os/workflow-studio/health") {
      const nodes = getNodeRegistry().list();
      return jsonResponse({ ok: true, phase: "20.93", nodeTypes: nodes.length, nodes: nodes.map((n) => ({ type: n.type, title: n.title, category: n.category, riskLevel: n.riskLevel, sideEffect: n.sideEffect })) }, 200, req, {});
    }

    // 2. GET /api/agent-os/workflow-studio/workflows
    if (req.method === "GET" && pathname === "/api/agent-os/workflow-studio/workflows") {
      return jsonResponse({ ok: true, workflows: service.listWorkflows() }, 200, req, {});
    }

    // 3. POST /api/agent-os/workflow-studio/workflows
    if (req.method === "POST" && pathname === "/api/agent-os/workflow-studio/workflows") {
      const body = await readJson(req);
      const result = service.createWorkflow({ name: String(body.name ?? "Untitled"), description: str(body.description), graph: body.graph, actor: actor(ctx, body) });
      return jsonResponse({ ok: true, ...result }, 201, req, {});
    }

    // 4. GET /api/agent-os/workflow-studio/nodes (node registry)
    if (req.method === "GET" && pathname === "/api/agent-os/workflow-studio/nodes") {
      const nodes = getNodeRegistry().list();
      return jsonResponse({ ok: true, count: nodes.length, nodes }, 200, req, {});
    }

    // 5. GET /api/agent-os/workflow-studio/workflows/{id}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/workflow-studio/workflows/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/workflows/".length));
      const detail = service.getWorkflowDetail(id);
      if (!detail) {
        return jsonResponse({ error: { code: "WORKFLOW_NOT_FOUND", message: `workflow '${id}' not found` } }, 404, req, {});
      }
      return jsonResponse({ ok: true, ...detail }, 200, req, {});
    }

    // 6. POST /api/agent-os/workflow-studio/workflows/{id}/validate
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/workflows/") && pathname.endsWith("/validate")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/workflows/".length, -"/validate".length));
      const body = await readJson(req);
      const detail = service.getWorkflowDetail(id);
      const graph = body.graph ?? detail?.graph;
      if (!graph) return jsonResponse({ error: { code: "GRAPH_INVALID", message: "no graph provided and workflow has none" } }, 422, req, {});
      const validation = service.validateGraph(graph);
      return jsonResponse({ ok: validation.ok, diagnostics: validation.diagnostics }, 200, req, {});
    }

    // 7. POST /api/agent-os/workflow-studio/workflows/{id}/publish
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/workflows/") && pathname.endsWith("/publish")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/workflows/".length, -"/publish".length));
      const body = await readJson(req);
      const detail = service.getWorkflowDetail(id);
      const graph = body.graph ?? detail?.graph;
      if (!graph) return jsonResponse({ error: { code: "GRAPH_INVALID", message: "no graph provided and workflow has none" } }, 422, req, {});
      return jsonResponse({ ok: true, ...(await Promise.resolve(service.publishVersion(id, graph, actor(ctx, body)))) }, 200, req, {});
    }

    // 8. POST /api/agent-os/workflow-studio/workflows/{id}/run
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/workflows/") && pathname.endsWith("/run")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/workflows/".length, -"/run".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.startRun(id, str(body.trigger) ?? "manual", actor(ctx, body)))) }, 201, req, {});
    }

    // 9. POST /api/agent-os/workflow-studio/runs/{id}/advance
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/runs/") && pathname.endsWith("/advance")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length, -"/advance".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.advanceRun(id, actor(ctx, body)))) }, 200, req, {});
    }

    // 10. POST /api/agent-os/workflow-studio/runs/{id}/pause
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/runs/") && pathname.endsWith("/pause")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length, -"/pause".length));
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.pauseRun(id))) }, 200, req, {});
    }

    // 11. POST /api/agent-os/workflow-studio/runs/{id}/resume
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/runs/") && pathname.endsWith("/resume")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length, -"/resume".length));
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.resumeRun(id))) }, 200, req, {});
    }

    // 12. POST /api/agent-os/workflow-studio/runs/{id}/cancel
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/runs/") && pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length, -"/cancel".length));
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.cancelRun(id))) }, 200, req, {});
    }

    // 13. POST /api/agent-os/workflow-studio/runs/{id}/retry
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/runs/") && pathname.endsWith("/retry")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length, -"/retry".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.retryNode(id, String(body.nodeId ?? "")))) }, 200, req, {});
    }

    // 14. GET /api/agent-os/workflow-studio/runs/{id}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/workflow-studio/runs/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/runs/".length));
      const inspection = engine.inspectRun(id);
      if (!inspection) {
        return jsonResponse({ error: { code: "RUN_NOT_FOUND", message: `run '${id}' not found` } }, 404, req, {});
      }
      return jsonResponse({ ok: true, ...inspection }, 200, req, {});
    }

    // 15. GET /api/agent-os/workflow-studio/approvals
    if (req.method === "GET" && pathname === "/api/agent-os/workflow-studio/approvals") {
      return jsonResponse({ ok: true, approvals: engine.listPendingApprovals() }, 200, req, {});
    }

    // 16. POST /api/agent-os/workflow-studio/approvals/{id}/decision
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/workflow-studio/approvals/") && pathname.endsWith("/decision")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/workflow-studio/approvals/".length, -"/decision".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await Promise.resolve(engine.decideApproval(id, body.approve === true, actor(ctx, body), str(body.note)))) }, 200, req, {});
    }

    return null;
  } catch (err) {
    return fail(req, err);
  }
}
