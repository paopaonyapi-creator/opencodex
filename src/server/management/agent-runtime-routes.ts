// Phase 20.61 — Agent Runtime management routes.
//
// Prefix-decode dispatcher (capability-lab precedent): the namespace check is
// a route-scan anchor and intentionally carries no MANAGEMENT_ROUTES literal
// entries. Every handler resolves through getAgentRuntimeService(); the state
// machine, policy gateway, and payload-bound approvals are enforced inside
// the service, never by the caller's claims.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAgentRuntimeService } from "../../agent-os/agent-runtime/service";
import { AGENT_RUNTIME_MCP_TOOLS } from "../../agent-os/agent-runtime/mcp-tools";
import { AgentRuntimeHttpError } from "../../agent-os/agent-runtime/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof AgentRuntimeHttpError) {
    return jsonResponse({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "internal_error", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleAgentRuntimeRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/agent-runtime/")) subPath = url.pathname.slice("/api/agent-os/agent-runtime/".length);
  else if (url.pathname === "/api/agent-os/agent-runtime") {
    subPath = "";
  }
  else return null;

  const service = getAgentRuntimeService();

  try {
    if (req.method === "GET" && (subPath === "" || subPath === "health")) {
      const tasks = service.listTasks();
      return jsonResponse({
        ok: true,
        phase: "20.61",
        tasks: tasks.length,
        running: tasks.filter((t) => t.status === "running").length,
        blocked: tasks.filter((t) => t.status === "blocked").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        awaitingApproval: service.store.listApprovals({ status: "pending" }).length,
        workers: service.listWorkers().length,
      }, 200, req, {});
    }

    // --- runtime ---

    if (subPath === "runtime/health" && req.method === "GET") {
      return jsonResponse({ runtime: await service.runtimeHealth() }, 200, req, {});
    }

    // --- workers ---

    if (subPath === "workers" && req.method === "GET") {
      return jsonResponse({ workers: service.listWorkers() }, 200, req, {});
    }
    if (subPath === "workers" && req.method === "POST") {
      const body = await readJson(req);
      const roleList = Array.isArray(body.roles) ? body.roles.map(String) : [];
      const capabilityList = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
      const worker = service.registerWorker({
        name: String(body.name ?? ""),
        provider: body.provider ? String(body.provider) : undefined,
        roles: roleList as never,
        capabilities: capabilityList as never,
        maxConcurrency: typeof body.maxConcurrency === "number" ? body.maxConcurrency : undefined,
        runtimeWorkerId: body.runtimeWorkerId ? String(body.runtimeWorkerId) : null,
      });
      return jsonResponse({ worker }, 201, req, {});
    }

    // --- sessions ---

    if (subPath === "sessions" && req.method === "GET") {
      const taskId = url.searchParams.get("task_id") ?? undefined;
      return jsonResponse({ sessions: service.listSessions(taskId ? { taskId } : undefined) }, 200, req, {});
    }

    // --- tasks ---

    if (subPath === "tasks" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ tasks: service.listTasks(status ? { status } : undefined) }, 200, req, {});
    }
    if (subPath === "tasks" && req.method === "POST") {
      const body = await readJson(req);
      const criteria = Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.map(String) : [];
      const task = service.createTask({
        title: String(body.title ?? ""),
        description: String(body.description ?? ""),
        acceptanceCriteria: criteria,
        role: body.role ? String(body.role) as never : undefined,
        parentTaskId: body.parentTaskId ? String(body.parentTaskId) : null,
        priority: typeof body.priority === "number" ? body.priority : undefined,
        maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
        repoRoot: body.repoRoot ? String(body.repoRoot) : null,
        requiresHumanApproval: body.requiresHumanApproval === false ? false : true,
        actorType: body.actorType === "agent" || body.actorType === "system" ? body.actorType : "human",
        actorId: body.actorId ? String(body.actorId) : "operator",
      });
      return jsonResponse({ task }, 201, req, {});
    }
    if (subPath.startsWith("tasks/")) {
      const rest = subPath.slice("tasks/".length);
      const [id, action] = rest.split("/");
      const body = req.method === "POST" ? await readJson(req) : {};
      if (req.method === "GET" && !action) {
        return jsonResponse(service.getTask(id), 200, req, {});
      }
      if (req.method === "POST" && action === "queue") {
        return jsonResponse({ task: service.queueTask(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "dispatch") {
        const workerId = body.workerId ? String(body.workerId) : undefined;
        return jsonResponse(await service.dispatchTask(id, { workerId }), 202, req, {});
      }
      if (req.method === "POST" && action === "heartbeat") {
        const claimToken = String(body.claimToken ?? "");
        const checkpoint = body.checkpoint && typeof body.checkpoint === "object" ? body.checkpoint as never : undefined;
        return jsonResponse({ ok: service.heartbeat(id, { claimToken, checkpoint }) }, 200, req, {});
      }
      if (req.method === "POST" && action === "complete") {
        const claimToken = String(body.claimToken ?? "");
        const summary = body.summary ? String(body.summary) : undefined;
        return jsonResponse({ task: service.completeTask(id, { claimToken, summary }) }, 200, req, {});
      }
      if (req.method === "POST" && action === "cancel") {
        const actorId = String(body.actorId ?? "operator");
        return jsonResponse({ task: service.cancelTask(id, { type: "human", id: actorId }) }, 200, req, {});
      }
      if (req.method === "POST" && action === "retry") {
        const actorId = String(body.actorId ?? "operator");
        return jsonResponse({ task: service.retryTask(id, { type: "human", id: actorId }) }, 200, req, {});
      }
      if (req.method === "GET" && action === "evidence") {
        return jsonResponse({ evidence: service.getTask(id).evidence }, 200, req, {});
      }
      if (req.method === "POST" && action === "evidence") {
        const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
        const evidence = service.addEvidence(id, {
          evidenceType: String(body.evidenceType ?? ""),
          uri: body.uri ? String(body.uri) : null,
          content: body.content ? String(body.content) : undefined,
          metadata,
          createdBy: body.createdBy ? String(body.createdBy) : undefined,
        });
        return jsonResponse({ evidence }, 201, req, {});
      }
      if (req.method === "POST" && action === "run") {
        // Policy-gateway probe: decide and enforce; nothing runs on the host.
        const request = buildExecutionRequest(id, body);
        const decision = await service.evaluate(request);
        return jsonResponse({ decision }, 200, req, {});
      }
      if (req.method === "POST" && action === "verify") {
        const verifierWorkerId = String(body.verifierWorkerId ?? "");
        const verifierRole = body.verifierRole ? String(body.verifierRole) as never : undefined;
        const verdict = (body.verdict && typeof body.verdict === "object" ? body.verdict : {}) as never;
        return jsonResponse(await service.verifyTask(id, { verifierWorkerId, verifierRole, verdict }), 200, req, {});
      }
      if (req.method === "POST" && action === "request-approval") {
        const approval = service.requestApproval(id, {
          action: String(body.action ?? ""),
          payload: body.payload ?? {},
          requestedBy: String(body.requestedBy ?? "worker"),
        });
        return jsonResponse({ approval }, 201, req, {});
      }
      if (req.method === "POST" && action === "promote-merge") {
        const targetBranch = String(body.targetBranch ?? "main");
        const approverId = String(body.approverId ?? "operator");
        const task = service.promoteMergeCandidate(id, { targetBranch, approverId, payload: body.payload ?? {} });
        return jsonResponse({ task }, 200, req, {});
      }
    }

    // --- approvals / events / audit / mcp tools ---

    if (subPath === "approvals" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ approvals: service.store.listApprovals(status ? { status } : undefined) }, 200, req, {});
    }
    if (subPath.startsWith("approvals/") && req.method === "POST") {
      const rest = subPath.slice("approvals/".length);
      const [id, action] = rest.split("/");
      const body = await readJson(req);
      if (action === "approve" || action === "reject") {
        const approverId = String(body.approverId ?? "operator");
        const reason = body.reason ? String(body.reason) : null;
        return jsonResponse(
          service.decideApproval(id, {
            decision: action === "approve" ? "approved" : "rejected",
            approverId,
            reason,
            currentPayload: body.currentPayload,
          }),
          200,
          req,
          {},
        );
      }
    }
    if (subPath === "events" && req.method === "GET") {
      const taskId = url.searchParams.get("task_id") ?? undefined;
      return jsonResponse({ events: service.listEvents({ taskId, limit: 200 }) }, 200, req, {});
    }
    if (subPath === "audit" && req.method === "GET") {
      return jsonResponse({ entries: service.store.listAudit() }, 200, req, {});
    }
    if (subPath === "mcp-tools" && req.method === "GET") {
      return jsonResponse({
        tools: AGENT_RUNTIME_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskTier: tool.riskTier,
          readOnly: tool.readOnly,
        })),
      }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}

function buildExecutionRequest(taskId: string, body: Record<string, unknown>) {
  return {
    taskId,
    workerId: String(body.workerId ?? ""),
    commandClass: String(body.commandClass ?? "command.dangerous") as never,
    argv: Array.isArray(body.argv) ? body.argv.map(String) : [],
    paths: Array.isArray(body.paths) ? body.paths.map(String) : undefined,
    network: body.network === true,
    secretAccess: body.secretAccess === true,
  };
}
