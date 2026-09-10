// Phase 20.16 — Multi-AI Control Plane: Management REST API.
//
//   GET    /api/agent-os/control-plane                  command-center summary + metrics
//   GET    /api/agent-os/control-plane/tasks            task list (?status=)
//   GET    /api/agent-os/control-plane/tasks/{id}       task graph + runs + reviews
//   GET    /api/agent-os/control-plane/approvals        approval queue
//   GET    /api/agent-os/control-plane/reviews          reviews for ?task_id=
//   GET    /api/agent-os/control-plane/tools            tool activity (redacted arguments)
//   GET    /api/agent-os/control-plane/artifacts        artifact registry
//   GET    /api/agent-os/control-plane/providers        provider usage
//   POST   /api/agent-os/control-plane/tasks            create a task
//   POST   /api/agent-os/control-plane/approvals/decide grant or deny
//   POST   /api/agent-os/control-plane/command/plan     policy verdict for a command, without running it
//
// Arguments in tool-activity responses were redacted before they were stored, so
// this file is not the last line of defence — it is a reader of already-safe data.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getControlPlaneService } from "../../agent-os/control-plane";
import { evaluateRequest } from "../../agent-os/control-plane/policy";
import type { TaskType } from "../../agent-os/control-plane/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "bad_request", message } }, 400, req, {});
}

export async function handleControlPlaneRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const prefix = "/api/agent-os/control-plane";
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) return null;
  const path = url.pathname.slice(prefix.length).replace(/^\//, "");
  const service = getControlPlaneService();

  // -- Command center ------------------------------------------------------

  if (path === "" && req.method === "GET") {
    const tasks = service.listTasks();
    const byStatus: Record<string, number> = {};
    for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    const recentCalls = service.listToolCalls(undefined).slice(0, 25);
    return jsonResponse(
      {
        metrics: service.metrics(),
        taskCount: tasks.length,
        byStatus,
        waitingApproval: service.listApprovals("pending"),
        failedTasks: tasks.filter((task) => task.status === "failed").slice(0, 20),
        activeTasks: tasks.filter((task) => task.status === "running").slice(0, 20),
        recentToolCalls: recentCalls,
        recentArtifacts: service.listArtifacts().slice(0, 10),
        deniedToolCalls: recentCalls.filter((call) => call.outcome === "denied").length,
      },
      200,
      req,
      {},
    );
  }

  // -- Tasks ---------------------------------------------------------------

  if (path === "tasks" && req.method === "GET") {
    const status = url.searchParams.get("status") ?? undefined;
    return jsonResponse({ tasks: service.listTasks(status as never) }, 200, req, {});
  }

  if (path === "tasks" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.project_id !== "string" || typeof body.goal !== "string") {
        return badRequest(req, "Fields 'project_id' and 'goal' are required.");
      }
      if (typeof body.workspace_root !== "string" || body.workspace_root.trim() === "") {
        return badRequest(req, "Field 'workspace_root' is required.");
      }
      const result = service.createTask({
        project_id: body.project_id,
        goal: body.goal,
        task_type: (body.task_type as TaskType) ?? "other",
        workspace_root: body.workspace_root,
        ...(body.risk_level ? { risk_level: body.risk_level as "L0" | "L1" | "L2" | "L3" } : {}),
        ...(body.created_by ? { created_by: body.created_by as never } : {}),
        ...(Array.isArray(body.allowed_tools) ? { allowed_tools: body.allowed_tools as string[] } : {}),
        ...(Array.isArray(body.forbidden_tools) ? { forbidden_tools: body.forbidden_tools as string[] } : {}),
        ...(body.requires_review === undefined ? {} : { requires_review: Boolean(body.requires_review) }),
        ...(body.requires_user_approval === undefined
          ? {}
          : { requires_user_approval: Boolean(body.requires_user_approval) }),
      });
      return jsonResponse({ task: result.task, routing: result.routing }, 201, req, {});
    } catch (error) {
      return badRequest(req, String(error));
    }
  }

  // Task graph: one task with every run, review, tool call, and artifact.
  if (path.startsWith("tasks/") && req.method === "GET") {
    const taskId = decodeURIComponent(path.slice("tasks/".length));
    const task = service.getTask(taskId);
    if (!task) {
      return jsonResponse({ error: { code: "not_found", message: "Unknown task " + taskId + "." } }, 404, req, {});
    }
    return jsonResponse(
      {
        task,
        runs: service.getStore().listRuns(taskId),
        reviews: service.getStore().listReviews(taskId),
        consensus: service.getConsensus(taskId),
        canApply: service.canApply(taskId),
        toolCalls: service.listToolCalls(taskId),
        artifacts: service.listArtifacts(taskId),
      },
      200,
      req,
      {},
    );
  }

  // -- Approvals -----------------------------------------------------------

  if (path === "approvals" && req.method === "GET") {
    const status = url.searchParams.get("status") ?? "pending";
    return jsonResponse({ approvals: service.listApprovals(status) }, 200, req, {});
  }

  if (path === "approvals/decide" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const approvalId = body.approval_id;
      const decision = body.decision;
      if (typeof approvalId !== "string" || (decision !== "grant" && decision !== "deny")) {
        return badRequest(req, "Fields 'approval_id' and 'decision' (grant|deny) are required.");
      }
      // A decision is the one action whose whole purpose is human, so the actor is
      // recorded as the dashboard session and never inherited from the body.
      const updated = service.decideApproval(approvalId, decision, "dashboard-session");
      if (!updated) {
        return jsonResponse(
          { error: { code: "not_pending", message: "Approval is unknown or already decided." } },
          409,
          req,
          {},
        );
      }
      return jsonResponse({ approval: updated }, 200, req, {});
    } catch (error) {
      return badRequest(req, String(error));
    }
  }

  // -- Reviews, tools, artifacts, providers --------------------------------

  if (path === "reviews" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    if (!taskId) return badRequest(req, "Query parameter 'task_id' is required.");
    return jsonResponse(
      {
        reviews: service.getStore().listReviews(taskId),
        consensus: service.getConsensus(taskId),
      },
      200,
      req,
      {},
    );
  }

  if (path === "tools" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id") ?? undefined;
    return jsonResponse({ toolCalls: service.listToolCalls(taskId ?? undefined) }, 200, req, {});
  }

  if (path === "artifacts" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id") ?? undefined;
    return jsonResponse({ artifacts: service.listArtifacts(taskId ?? undefined) }, 200, req, {});
  }

  if (path === "providers" && req.method === "GET") {
    const rows = service.getStore()
      .getDb()
      .query("SELECT * FROM cp_provider_usage ORDER BY provider")
      .all() as Record<string, unknown>[];
    return jsonResponse(
      {
        providers: rows.map((row) => ({
          provider: row.provider,
          model: row.model,
          calls: row.calls,
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          costUsd: row.cost_usd,
          errors: row.errors,
          updatedAt: row.updated_at,
        })),
      },
      200,
      req,
      {},
    );
  }

  // A policy verdict for a command WITHOUT running it. Read-only by construction.
  if (path === "command/plan" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    const command = url.searchParams.get("command");
    if (!taskId || !command) return badRequest(req, "Query parameters 'task_id' and 'command' are required.");
    const task = service.getTask(taskId);
    if (!task) return badRequest(req, "Unknown task " + taskId + ".");
    const decision = evaluateRequest({
      task: {
        task_id: task.task_id,
        workspace_root: task.workspace_root,
        allowed_tools: task.allowed_tools,
        forbidden_tools: task.forbidden_tools,
        risk_level: task.risk_level,
      },
      tool: "command.run_safe",
      arguments: { command },
    });
    return jsonResponse({ command, decision }, 200, req, {});
  }

  return jsonResponse(
    { error: { code: "not_found", message: "Control plane endpoint '/" + path + "' not found." } },
    404,
    req,
    {},
  );
}

