// Phase 20.42 — Named AI Teammate Workspace routes (repo convention:
// /api/agent-workspace/*). Full-literal pathname guards; auth inherited
// from the management API. Approval decisions additionally enforce the
// human-actor invariant inside the service.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getBotWorkspaceService } from "../../agent-os/bot-workspace/service";
import { BotWorkspaceError } from "../../agent-os/bot-workspace/types";

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const start = message.indexOf("[");
  const end = message.indexOf("]");
  const code = start === 0 && end > 1 ? message.slice(1, end) : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" ? 404
    : code === "VALIDATION_FAILED" ? 400
    : code === "AGENT_DISABLED" || code === "AGENT_CONFIG_INVALID" || code === "APPROVAL_DENIED" || code === "APPROVAL_EXPIRED" || code === "ROUTINE_CONFLICT" ? 403
    : 422;
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

export async function handleBotWorkspaceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getBotWorkspaceService();

  // 1. GET /api/agent-workspace/health
  if (req.method === "GET" && pathname === "/api/agent-workspace/health") {
    return jsonResponse({ ok: true, data: { workspace: service.ensureWorkspace().slug, runtimes: await Promise.all(service.runtimeHealth()) } }, 200, req, {});
  }

  // 2. Agents
  if (req.method === "GET" && pathname === "/api/agent-workspace/agents") {
    return jsonResponse({ ok: true, data: { agents: service.listAgents() } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/agents") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createAgent({
        name: String(body.name ?? ""),
        role: (typeof body.role === "string" ? body.role : "custom") as never,
        description: typeof body.description === "string" ? body.description : null,
        systemInstructions: typeof body.systemInstructions === "string" ? body.systemInstructions : null,
        providerBindingId: typeof body.providerBindingId === "string" ? body.providerBindingId : null,
        runtimeBindingId: typeof body.runtimeBindingId === "string" ? body.runtimeBindingId : null,
        defaultModel: typeof body.defaultModel === "string" ? body.defaultModel : null,
        skillSlugs: Array.isArray(body.skillSlugs) ? (body.skillSlugs as string[]) : undefined,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/agents/detail") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_FAILED", message: "query 'id' required" } }, 400, req, {});
      const agent = service.getAgent(id);
      if (!agent) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "agent not found" } }, 404, req, {});
      return jsonResponse({ ok: true, data: { agent, validation: service.validateAgent(id) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "PATCH" && pathname === "/api/agent-workspace/agents/detail") {
    try {
      const id = url.searchParams.get("id");
      const body = await readJsonBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string") patch.name = body.name;
      if (typeof body.description === "string") patch.description = body.description;
      if (typeof body.systemInstructions === "string") patch.systemInstructions = body.systemInstructions;
      if (typeof body.providerBindingId === "string" || body.providerBindingId === null) patch.providerBindingId = body.providerBindingId;
      if (typeof body.runtimeBindingId === "string" || body.runtimeBindingId === null) patch.runtimeBindingId = body.runtimeBindingId;
      if (typeof body.defaultModel === "string" || body.defaultModel === null) patch.defaultModel = body.defaultModel;
      return jsonResponse({ ok: true, data: service.updateAgent(id ?? "", patch) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/agents/status") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.setAgentStatus(String(body.id ?? ""), String(body.status ?? "active") as never) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 3. Teams
  if (req.method === "GET" && pathname === "/api/agent-workspace/teams") {
    return jsonResponse({ ok: true, data: { teams: service.store.listTeams(service.ensureWorkspace().id).map((team) => ({ ...team, members: service.store.listMembers(team.id) })) } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/teams") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createTeam({
        name: String(body.name ?? ""),
        description: typeof body.description === "string" ? body.description : null,
        orchestrationMode: (typeof body.orchestrationMode === "string" ? body.orchestrationMode : "ordered") as never,
        memberAgentIds: Array.isArray(body.memberAgentIds) ? (body.memberAgentIds as string[]) : [],
        leadAgentId: typeof body.leadAgentId === "string" ? body.leadAgentId : null,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/teams/reorder") {
    try {
      const body = await readJsonBody(req);
      service.reorderTeam(String(body.teamId ?? ""), Array.isArray(body.orderedAgentIds) ? (body.orderedAgentIds as string[]) : []);
      return jsonResponse({ ok: true, data: { reordered: true } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. Conversations / messages / drafts
  if (req.method === "GET" && pathname === "/api/agent-workspace/conversations") {
    return jsonResponse({ ok: true, data: { conversations: service.listConversations() } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/conversations") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createConversation({
        kind: (String(body.kind ?? "direct") as "direct" | "group"),
        agentId: typeof body.agentId === "string" ? body.agentId : null,
        teamId: typeof body.teamId === "string" ? body.teamId : null,
        title: typeof body.title === "string" ? body.title : null,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/conversations/messages") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_FAILED", message: "query 'id' required" } }, 400, req, {});
      return jsonResponse({ ok: true, data: { messages: service.listMessages(id) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/conversations/messages") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.postUserMessage({
        conversationId: String(body.conversationId ?? ""),
        text: String(body.text ?? ""),
        clientMessageId: typeof body.clientMessageId === "string" ? body.clientMessageId : null,
        replyToMessageId: typeof body.replyToMessageId === "string" ? body.replyToMessageId : null,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "PUT" && pathname === "/api/agent-workspace/conversations/draft") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.saveDraft({
        conversationId: String(body.conversationId ?? ""),
        text: String(body.text ?? ""),
        selectedAgentIds: Array.isArray(body.selectedAgentIds) ? (body.selectedAgentIds as string[]) : [],
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/conversations/draft") {
    const id = url.searchParams.get("id");
    return jsonResponse({ ok: true, data: { draft: service.getDraft(id ?? "") } }, 200, req, {});
  }

  // 5. Provider / runtime bindings
  if (req.method === "GET" && pathname === "/api/agent-workspace/providers") {
    return jsonResponse({ ok: true, data: { providers: service.store.listProviderBindings(service.ensureWorkspace().id), runtimes: service.store.listRuntimeBindings(service.ensureWorkspace().id) } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/providers") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createProviderBinding({
        providerType: (String(body.providerType ?? "openai_compatible") as never),
        name: String(body.name ?? ""),
        endpoint: typeof body.endpoint === "string" ? body.endpoint : null,
        model: typeof body.model === "string" ? body.model : null,
        credentialRef: typeof body.credentialRef === "string" ? body.credentialRef : null,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/providers/healthcheck") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.healthcheckProvider(String(body.id ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/runtimes") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createRuntimeBinding({ runtimeType: (String(body.runtimeType ?? "chat_provider") as never), name: String(body.name ?? "") }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. Rounds
  if (req.method === "POST" && pathname === "/api/agent-workspace/rounds") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.startGroupRound({
        conversationId: String(body.conversationId ?? ""),
        text: String(body.text ?? ""),
        agentIdsInOrder: Array.isArray(body.agentIdsInOrder) ? (body.agentIdsInOrder as string[]) : [],
        mode: body.mode === "parallel" ? "parallel" : "ordered",
        failurePolicy: (typeof body.failurePolicy === "string" ? body.failurePolicy : "stop_on_failure") as never,
        clientMessageId: typeof body.clientMessageId === "string" ? body.clientMessageId : null,
        requireConsent: body.requireConsent !== false,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/rounds/run") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.runRound(String(body.roundId ?? ""), {
        conversationId: String(body.conversationId ?? ""),
        text: String(body.text ?? ""),
        agentIdsInOrder: Array.isArray(body.agentIdsInOrder) ? (body.agentIdsInOrder as string[]) : [],
        mode: body.mode === "parallel" ? "parallel" : "ordered",
        failurePolicy: (typeof body.failurePolicy === "string" ? body.failurePolicy : "stop_on_failure") as never,
        requireConsent: false,
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/rounds/detail") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_FAILED", message: "query 'id' required" } }, 400, req, {});
      const round = service.store.getRound(id);
      if (!round) return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "round not found" } }, 404, req, {});
      const executions = service.store.listExecutionsForRound(id).map((execution) => ({
        ...execution,
        agentName: service.getAgent(execution.agentId)?.name ?? execution.agentId,
        events: service.store.listEvents(execution.id),
      }));
      return jsonResponse({ ok: true, data: { round, executions } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/rounds/cancel") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.stopRound(String(body.roundId ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/rounds/retry") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createRetry(String(body.roundId ?? ""), String(body.agentId ?? "")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. Approvals
  if (req.method === "GET" && pathname === "/api/agent-workspace/approvals") {
    const status = url.searchParams.get("status") ?? undefined;
    return jsonResponse({ ok: true, data: { approvals: service.store.listApprovals(service.ensureWorkspace().id, status) } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/approvals/decide") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.decideApproval(String(body.approvalId ?? ""), body.approve === true, String(body.actor ?? "operator")) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. Routines
  if (req.method === "GET" && pathname === "/api/agent-workspace/routines") {
    return jsonResponse({ ok: true, data: { routines: service.store.listRoutines(service.ensureWorkspace().id) } }, 200, req, {});
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/routines") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.createRoutine({
        name: String(body.name ?? ""),
        ownerAgentId: typeof body.ownerAgentId === "string" ? body.ownerAgentId : null,
        ownerTeamId: typeof body.ownerTeamId === "string" ? body.ownerTeamId : null,
        triggerType: (String(body.triggerType ?? "manual") as never),
        intervalMinutes: typeof body.intervalMinutes === "number" ? body.intervalMinutes : undefined,
        instructionTemplate: String(body.instructionTemplate ?? ""),
        skillSlug: typeof body.skillSlug === "string" ? body.skillSlug : null,
        concurrencyPolicy: (typeof body.concurrencyPolicy === "string" ? body.concurrencyPolicy : "skip_if_running") as never,
      }) }, 201, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/routines/status") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: service.setRoutineStatus(String(body.id ?? ""), String(body.status ?? "paused") as never) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/routines/run") {
    try {
      const body = await readJsonBody(req);
      return jsonResponse({ ok: true, data: await service.runRoutine(String(body.id ?? ""), "manual", typeof body.idempotencyKey === "string" ? body.idempotencyKey : null) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/routines/runs") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: { code: "VALIDATION_FAILED", message: "query 'id' required" } }, 400, req, {});
      return jsonResponse({ ok: true, data: { runs: service.store.listRoutineRuns(id) } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. Audit + export + recovery
  if (req.method === "GET" && pathname === "/api/agent-workspace/audit") {
    return jsonResponse({ ok: true, data: { events: service.store.listAudit(service.ensureWorkspace().id) } }, 200, req, {});
  }
  if (req.method === "GET" && pathname === "/api/agent-workspace/export") {
    try {
      return jsonResponse({ ok: true, data: service.exportWorkspace() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }
  if (req.method === "POST" && pathname === "/api/agent-workspace/reconcile") {
    return jsonResponse({ ok: true, data: service.reconcileOnRestart() }, 200, req, {});
  }

  return null;
}
