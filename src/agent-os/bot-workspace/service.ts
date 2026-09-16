// Phase 20.42 — BotWorkspaceService facade (spec §7, §14-§15, §20, §31-§32,
// §36). Agent registry with typed validation, team/conversation/draft
// services, provider/runtime bindings (credential REFERENCE only),
// approval engine (fingerprint-bound, single-use, human-actor), routine
// engine (manual/interval triggers, idempotent runs, concurrency policy),
// safe export, and restart reconciliation. Secrets never reach persistence.

import { redactText, redactJsonForAudit } from "../coding-cockpit/redaction";
import { createHash } from "node:crypto";
import { parseMentions } from "./context";
import { CodexAppServerAdapter, DelegatingChatAdapter, MockChatAdapter, type ChatCompletionFn } from "./providers";
import { actionFingerprintOf, GroupRoundOrchestrator, transitionRound } from "./orchestrator";
import { BotWorkspaceOpsStore, type BwRoutineRun } from "./store-ops";
import type { BotWorkspaceStore } from "./store";
import { blocksToJson } from "./store";
import {
  BotWorkspaceError,
  type AgentValidationResult, type BwAgent, type BwApproval, type BwGroupRound, type BwMessage, type BwAgentExecution,
  type FailurePolicy, type OrchestrationMode, type ProviderAdapter, type RiskLevel, type RoundStatus,
} from "./types";

export interface BotWorkspaceServiceOptions {
  chatCompletion: ChatCompletionFn | null;
  maxParallel: number;
}

const APPROVAL_TTL_MS = 10 * 60 * 1000;

export class BotWorkspaceService {
  readonly store: BotWorkspaceOpsStore;
  readonly mockAdapter = new MockChatAdapter();
  readonly codexAdapter = new CodexAppServerAdapter();
  private chatAdapter: DelegatingChatAdapter | null;
  private orchestrator: GroupRoundOrchestrator;
  private actorId = "operator";

  constructor(store?: BotWorkspaceStore, options?: Partial<BotWorkspaceServiceOptions>) {
    this.store = store instanceof BotWorkspaceOpsStore ? store : new BotWorkspaceOpsStore();
    this.chatAdapter = options?.chatCompletion ? new DelegatingChatAdapter(options.chatCompletion) : null;
    this.orchestrator = new GroupRoundOrchestrator({
      store: this.store,
      workspaceId: this.ensureWorkspace().id,
      actorId: this.actorId,
      maxParallel: options?.maxParallel ?? Number(process.env.BW_MAX_PARALLEL ?? 3),
      approvalGate: async () => undefined,
    });
  }

  ensureWorkspace(): ReturnType<BotWorkspaceStore["ensureWorkspace"]> {
    return this.store.ensureWorkspace(process.env.BW_DEFAULT_WORKSPACE ?? "pao-hubpro");
  }

  setApprovalGate(gate: NonNullable<BotWorkspaceServiceOptions["chatCompletion"]> extends never ? never : (input: { executionId: string; agentId: string; roundId: string; contextText: string }) => Promise<void>): void {
    this.orchestrator = new GroupRoundOrchestrator({
      store: this.store,
      workspaceId: this.ensureWorkspace().id,
      actorId: this.actorId,
      maxParallel: Number(process.env.BW_MAX_PARALLEL ?? 3),
      approvalGate: gate,
    });
  }

  audit(action: string, targetType: string | null, targetId: string | null, metadata?: Record<string, unknown>): void {
    this.store.insertAudit({
      workspaceId: this.ensureWorkspace().id,
      actorType: "operator",
      actorId: this.actorId,
      action,
      targetType,
      targetId,
      outcome: "ok",
      metadataJson: metadata ? redactJsonForAudit(metadata) : undefined,
    });
  }

  ensureMockRuntimeBinding(workspaceId: string): ReturnType<BotWorkspaceStore["insertRuntimeBinding"]> {
    const existing = this.store.listRuntimeBindings(workspaceId).find((binding) => binding.name === "deterministic-mock");
    if (existing) return existing;
    return this.store.insertRuntimeBinding({ workspaceId, runtimeType: "chat_provider", name: "deterministic-mock", configJson: JSON.stringify({ adapter: "mock" }), status: "healthy" });
  }

  ensureMockProviderBinding(workspaceId: string): ReturnType<BotWorkspaceStore["insertProviderBinding"]> {
    const existing = this.store.listProviderBindings(workspaceId).find((binding) => binding.providerType === "mock");
    if (existing) return existing;
    return this.store.insertProviderBinding({ workspaceId, providerType: "mock", name: "deterministic-mock", endpoint: null, model: null, credentialRef: "builtin:mock", settingsJson: "{}", status: "healthy" });
  }

  // --- Agent registry (spec §7) -----------------------------------------------------------

  createAgent(input: { name: string; role?: BwAgent["role"]; description?: string | null; systemInstructions?: string | null; providerBindingId?: string | null; runtimeBindingId?: string | null; defaultModel?: string | null; skillSlugs?: string[] }): BwAgent {
    const workspace = this.ensureWorkspace();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
    let runtimeBindingId = input.runtimeBindingId ?? null;
    let providerBindingId = input.providerBindingId ?? null;
    if (!runtimeBindingId) {
      const mockRuntime = this.ensureMockRuntimeBinding(workspace.id);
      const mockProvider = this.ensureMockProviderBinding(workspace.id);
      runtimeBindingId = mockRuntime.id;
      providerBindingId = mockProvider.id;
    }
    const agent = this.store.insertAgent({
      workspaceId: workspace.id,
      name: input.name,
      slug,
      avatarRef: null,
      description: input.description ?? null,
      role: input.role ?? "custom",
      systemInstructions: input.systemInstructions ?? null,
      status: "active",
      visibility: "visible",
      providerBindingId,
      runtimeBindingId,
      defaultModel: input.defaultModel ?? null,
      contextPolicyJson: "{}",
      capabilityPolicyJson: input.skillSlugs ? JSON.stringify({ skills: input.skillSlugs }) : "{}",
      approvalPolicyJson: "{}",
      metadataJson: "{}",
    });
    this.audit("agent.created", "agent", agent.id, { name: agent.name, role: agent.role });
    return agent;
  }

  updateAgent(id: string, patch: Partial<Pick<BwAgent, "name" | "description" | "systemInstructions" | "providerBindingId" | "runtimeBindingId" | "defaultModel" | "capabilityPolicyJson">>): BwAgent {
    const updated = this.store.updateAgent(id, patch);
    this.audit("agent.updated", "agent", id, { patch: Object.keys(patch) });
    return updated;
  }

  setAgentStatus(id: string, status: BwAgent["status"]): BwAgent {
    const updated = this.store.updateAgent(id, { status });
    this.audit(status === "disabled" ? "agent.disabled" : "agent.updated", "agent", id, { status });
    return updated;
  }

  getAgent(id: string): BwAgent | null {
    return this.store.getAgent(id);
  }

  listAgents(): BwAgent[] {
    return this.store.listAgents(this.ensureWorkspace().id);
  }

  /** Typed validation — configuration problems never collapse into 500s. */
  validateAgent(id: string): AgentValidationResult {
    const agent = this.store.getAgent(id);
    if (!agent) return { runnable: false, issues: [{ code: "NOT_FOUND", severity: "blocking", message: "agent not found" }] };
    const issues: AgentValidationResult["issues"] = [];
    if (agent.status !== "active") {
      issues.push({ code: "AGENT_DISABLED", severity: "blocking", message: "agent is " + agent.status });
    }
    if (!agent.runtimeBindingId) {
      issues.push({ code: "RUNTIME_NOT_CONFIGURED", severity: "blocking", message: "no runtime binding" });
    } else {
      const runtime = this.store.getRuntimeBinding(agent.runtimeBindingId);
      if (!runtime) {
        issues.push({ code: "RUNTIME_NOT_CONFIGURED", severity: "blocking", message: "runtime binding missing" });
      } else if (runtime.runtimeType === "chat_provider" && !agent.providerBindingId) {
        issues.push({ code: "PROVIDER_NOT_CONFIGURED", severity: "blocking", message: "chat_provider runtime requires a provider binding" });
      } else if (runtime.runtimeType === "chat_provider" && agent.providerBindingId) {
        const provider = this.store.getProviderBinding(agent.providerBindingId);
        if (provider && provider.credentialRef === null && provider.providerType !== "mock" && provider.providerType !== "ollama" && provider.providerType !== "lmstudio") {
          issues.push({ code: "CREDENTIAL_MISSING", severity: "blocking", message: "provider credential is not configured" });
        }
      }
    }
    return { runnable: issues.every((issue) => issue.severity !== "blocking"), issues };
  }

  resolveMention(text: string): ReturnType<typeof parseMentions> {
    return parseMentions({ workspaceId: this.ensureWorkspace().id, findAgentsByName: (workspaceId, name) => this.store.findAgentsByName(workspaceId, name) }, text);
  }

  // --- Teams ---------------------------------------------------------------------------

  createTeam(input: { name: string; description?: string | null; orchestrationMode?: OrchestrationMode; memberAgentIds: string[]; leadAgentId?: string | null; failurePolicy?: FailurePolicy }): ReturnType<BotWorkspaceStore["insertTeam"]> {
    const workspace = this.ensureWorkspace();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
    const team = this.store.insertTeam({
      workspaceId: workspace.id,
      name: input.name,
      slug,
      description: input.description ?? null,
      leadAgentId: input.leadAgentId ?? null,
      orchestrationMode: input.orchestrationMode ?? "ordered",
      defaultRecipientOrderJson: JSON.stringify(input.memberAgentIds),
      status: "active",
    });
    input.memberAgentIds.forEach((agentId, index) => {
      this.store.addTeamMember(team.id, agentId, index + 1, null, true, false);
    });
    this.audit("team.updated", "team", team.id, { members: input.memberAgentIds.length });
    return team;
  }

  reorderTeam(teamId: string, orderedAgentIds: string[]): void {
    orderedAgentIds.forEach((agentId, index) => {
      const members = this.store.listMembers(teamId);
      const member = members.find((candidate) => candidate.agentId === agentId);
      if (member) this.store.addTeamMember(teamId, agentId, index + 1, member.roleInTeam, member.isRequired, member.canDelegate);
    });
    this.audit("team.updated", "team", teamId, { reordered: orderedAgentIds.length });
  }

  // --- Conversations / messages / drafts -----------------------------------------------------

  createConversation(input: { kind: "direct" | "group"; agentId?: string | null; teamId?: string | null; title?: string | null }): ReturnType<BotWorkspaceStore["insertConversation"]> {
    if (input.kind === "direct" && !input.agentId) {
      throw new BotWorkspaceError("VALIDATION_FAILED", "direct conversation requires agentId");
    }
    if (input.kind === "group" && !input.teamId) {
      throw new BotWorkspaceError("VALIDATION_FAILED", "group conversation requires teamId");
    }
    return this.store.insertConversation({
      workspaceId: this.ensureWorkspace().id,
      kind: input.kind,
      agentId: input.agentId ?? null,
      teamId: input.teamId ?? null,
      title: input.title ?? null,
      status: "active",
    });
  }

  listConversations(): ReturnType<BotWorkspaceStore["listConversations"]> {
    return this.store.listConversations(this.ensureWorkspace().id);
  }

  listMessages(conversationId: string): BwMessage[] {
    return this.store.listMessages(conversationId);
  }

  postUserMessage(input: { conversationId: string; text: string; clientMessageId?: string | null; replyToMessageId?: string | null }): { message: BwMessage; mentions: ReturnType<typeof parseMentions> } {
    if (input.clientMessageId) {
      const existing = this.store.findMessageByClientKey(input.conversationId, input.clientMessageId);
      if (existing) return { message: existing, mentions: { matches: [], ambiguous: [] } };
    }
    const mentions = this.resolveMention(input.text);
    const message = this.store.insertMessage({
      conversationId: input.conversationId,
      senderType: "user",
      senderId: null,
      role: "user",
      contentJson: blocksToJson([{ type: "text", text: input.text }]),
      replyToMessageId: input.replyToMessageId ?? null,
      parentExecutionId: null,
      clientMessageId: input.clientMessageId ?? null,
      status: "final",
    });
    for (const match of mentions.matches) {
      this.store.insertMention(message.id, match.agentId, match.token, match.startOffset, match.endOffset);
    }
    this.store.touchConversation(input.conversationId);
    return { message, mentions };
  }

  saveDraft(input: { conversationId: string; text: string; selectedAgentIds: string[]; ownerKey?: string }): ReturnType<BotWorkspaceStore["saveDraft"]> {
    return this.store.saveDraft({
      conversationId: input.conversationId,
      ownerKey: input.ownerKey ?? "operator",
      contentJson: blocksToJson([{ type: "text", text: input.text }]),
      selectedAgentIds: input.selectedAgentIds,
      attachmentRefs: [],
    });
  }

  getDraft(conversationId: string): ReturnType<BotWorkspaceStore["getDraft"]> {
    return this.store.getDraft(conversationId, "operator");
  }

  // --- Bindings -------------------------------------------------------------------------------

  createProviderBinding(input: { providerType: BwProviderBindingInput["providerType"]; name: string; endpoint?: string | null; model?: string | null; credentialRef?: string | null }): ReturnType<BotWorkspaceStore["insertProviderBinding"]> {
    if (input.endpoint && !/^https?:\/\//i.test(input.endpoint)) {
      throw new BotWorkspaceError("VALIDATION_FAILED", "provider endpoint must be an http(s) URL");
    }
    const binding = this.store.insertProviderBinding({
      workspaceId: this.ensureWorkspace().id,
      providerType: input.providerType,
      name: input.name,
      endpoint: input.endpoint ?? null,
      model: input.model ?? null,
      credentialRef: input.credentialRef ?? null,
      settingsJson: "{}",
      status: "unverified",
    });
    this.audit("provider.created", "provider_binding", binding.id, { providerType: input.providerType });
    return binding;
  }

  createRuntimeBinding(input: { runtimeType: BwRuntimeBindingInput["runtimeType"]; name: string }): ReturnType<BotWorkspaceStore["insertRuntimeBinding"]> {
    return this.store.insertRuntimeBinding({
      workspaceId: this.ensureWorkspace().id,
      runtimeType: input.runtimeType,
      name: input.name,
      configJson: "{}",
      status: input.runtimeType === "codex_app_server" ? "unverified" : "unverified",
    });
  }

  async healthcheckProvider(bindingId: string): Promise<{ status: string; detail: string }> {
    const binding = this.store.getProviderBinding(bindingId);
    if (!binding) throw new BotWorkspaceError("NOT_FOUND", "provider binding not found");
    let result: { status: "healthy" | "degraded" | "unavailable"; detail: string };
    if (binding.providerType === "mock") {
      result = await this.mockAdapter.healthcheck();
    } else if (binding.credentialRef === null && binding.providerType !== "ollama" && binding.providerType !== "lmstudio") {
      result = { status: "unavailable", detail: "credential reference is not configured" };
    } else {
      result = { status: "degraded", detail: "credential reference present; live validation requires dispatch" };
    }
    this.store.updateProviderBindingStatus(bindingId, result.status);
    return result;
  }

  // --- Rounds --------------------------------------------------------------------------------------

  async startGroupRound(input: { conversationId: string; text: string; agentIdsInOrder: string[]; mode: "ordered" | "parallel"; failurePolicy?: FailurePolicy; clientMessageId?: string | null; requireConsent?: boolean }): Promise<{ round: BwGroupRound; messageId: string; consentRequired: boolean }> {
    const specs = input.agentIdsInOrder.map((agentId, index) => {
      const agent = this.store.getAgent(agentId);
      if (!agent) throw new BotWorkspaceError("NOT_FOUND", "agent not found: " + agentId);
      const validation = this.validateAgent(agentId);
      if (!validation.runnable) {
        throw new BotWorkspaceError("AGENT_CONFIG_INVALID", "agent " + agent.name + ": " + validation.issues.map((issue) => issue.code).join(", "));
      }
      const runtime = agent.runtimeBindingId ? this.store.getRuntimeBinding(agent.runtimeBindingId) : null;
      const adapter = resolveAdapterForBinding(runtime?.runtimeType ?? "mock", runtime?.configJson ?? null, this);
      return { agent, position: index + 1, adapter };
    });
    const { message } = this.postUserMessage({ conversationId: input.conversationId, text: input.text, clientMessageId: input.clientMessageId ?? null });
    const round = this.orchestrator.createRound({
      conversationId: input.conversationId,
      initiatingMessageId: message.id,
      mode: input.mode,
      agentSpecs: specs,
      initiatingMessageText: input.text,
      conversationHistoryText: "",
      failurePolicy: input.failurePolicy ?? "stop_on_failure",
    });
    const consentRequired = input.requireConsent !== false;
    if (!consentRequired) {
      await this.runRound(round.id, input);
    }
    return { round: this.store.getRound(round.id) as BwGroupRound, messageId: message.id, consentRequired };
  }

  async runRound(roundId: string, input: { conversationId: string; text: string; agentIdsInOrder: string[]; mode: "ordered" | "parallel"; failurePolicy?: FailurePolicy; clientMessageId?: string | null; requireConsent?: boolean }): Promise<BwGroupRound> {
    const specs = input.agentIdsInOrder.map((agentId, index) => {
      const agent = this.store.getAgent(agentId) as BwAgent;
      const runtime = agent.runtimeBindingId ? this.store.getRuntimeBinding(agent.runtimeBindingId) : null;
      return { agent, position: index + 1, adapter: resolveAdapterForBinding(runtime?.runtimeType ?? "mock", runtime?.configJson ?? null, this) };
    });
    const initiating = this.store.listRounds(roundId) ? (this.store.getRound(roundId) as BwGroupRound).initiatingMessageId : "";
    void initiating;
    return this.orchestrator.runRound(roundId, {
      conversationId: input.conversationId,
      initiatingMessageId: (this.store.getRound(roundId) as BwGroupRound).initiatingMessageId,
      mode: input.mode,
      agentSpecs: specs,
      initiatingMessageText: input.text,
      conversationHistoryText: "",
      failurePolicy: input.failurePolicy ?? "stop_on_failure",
    });
  }

  stopRound(roundId: string): BwGroupRound {
    const round = this.store.getRound(roundId);
    if (!round) throw new BotWorkspaceError("NOT_FOUND", "round not found");
    const executions = this.store.listExecutionsForRound(roundId);
    const adapterByAgent = new Map<string, ProviderAdapter>();
    for (const execution of executions) {
      const agent = this.store.getAgent(execution.agentId);
      if (!agent) continue;
      const runtime = agent.runtimeBindingId ? this.store.getRuntimeBinding(agent.runtimeBindingId) : null;
      adapterByAgent.set(agent.id, resolveAdapterForBinding(runtime?.runtimeType ?? "mock", runtime?.configJson ?? null, this));
    }
    this.audit("execution.cancel_requested", "round", roundId, {});
    return this.orchestrator.stopRound(roundId, adapterByAgent);
  }

  createRetry(roundId: string, agentId: string): { attempt: number; executionId: string } {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new BotWorkspaceError("NOT_FOUND", "agent not found");
    const executions = this.store.listExecutionsForRound(roundId).filter((execution) => execution.agentId === agentId);
    const position = executions[0]?.position ?? 1;
    const runtime = agent.runtimeBindingId ? this.store.getRuntimeBinding(agent.runtimeBindingId) : null;
    return this.orchestrator.createRetryExecution(roundId, agentId, position, agent, resolveAdapterForBinding(runtime?.runtimeType ?? "mock", runtime?.configJson ?? null, this));
  }

  // --- Approvals (spec §14) ------------------------------------------------------------------------

  requestApproval(input: { executionId: string | null; requestedByAgentId: string | null; actionType: string; actionSummary: string; riskLevel: RiskLevel; payload: Record<string, unknown> }): BwApproval {
    const workspace = this.ensureWorkspace();
    const fingerprint = actionFingerprintOf({ agentId: input.requestedByAgentId ?? "unknown", actionType: input.actionType, payload: input.payload });
    const approval = this.store.insertApproval({
      workspaceId: workspace.id,
      executionId: input.executionId,
      requestedByAgentId: input.requestedByAgentId,
      actionType: input.actionType,
      actionSummary: input.actionSummary,
      riskLevel: input.riskLevel,
      actionFingerprint: fingerprint,
      requestPayloadRedactedJson: JSON.stringify(redactJsonForAudit(input.payload) as unknown as Record<string, unknown>),
      status: "pending",
      decisionBy: null,
      decisionReason: null,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      decidedAt: null,
    });
    if (input.executionId) {
      this.store.appendEvent(input.executionId, "execution.approval.requested", { approvalId: approval.id, actionType: input.actionType });
    }
    this.audit("approval.requested", "approval", approval.id, { actionType: input.actionType, riskLevel: input.riskLevel });
    return approval;
  }

  decideApproval(approvalId: string, approve: boolean, actor: string): BwApproval {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor)) {
      throw new BotWorkspaceError("APPROVAL_DENIED", "approval decisions require a human actor");
    }
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new BotWorkspaceError("NOT_FOUND", "approval not found");
    if (approval.status !== "pending") {
      throw new BotWorkspaceError("APPROVAL_DENIED", "approval is " + approval.status + " — replay rejected");
    }
    if (approval.expiresAt && Date.parse(approval.expiresAt) < Date.now()) {
      this.store.updateApprovalStatus(approvalId, "expired", actor, null);
      throw new BotWorkspaceError("APPROVAL_EXPIRED", "approval expired before decision");
    }
    const nextStatus: BwApproval["status"] = approve ? "approved" : "denied";
    this.store.updateApprovalStatus(approvalId, nextStatus, actor, null);
    if (approval.executionId) {
      this.store.appendEvent(approval.executionId, approve ? "execution.approval.approved" : "execution.approval.denied", { approvalId });
    }
    this.audit(approve ? "approval.approved" : "approval.denied", "approval", approvalId, { actor });
    return this.store.getApproval(approvalId) as BwApproval;
  }

  /** Consume a single-use approval bound to the EXACT action fingerprint. */
  consumeApproval(approvalId: string, actionType: string, payload: Record<string, unknown>): void {
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new BotWorkspaceError("NOT_FOUND", "approval not found");
    if (approval.status === "consumed") throw new BotWorkspaceError("APPROVAL_DENIED", "approval already consumed (single-use)");
    if (approval.status === "expired" || (approval.expiresAt && Date.parse(approval.expiresAt) < Date.now())) {
      if (approval.status === "pending") this.store.updateApprovalStatus(approvalId, "expired", null, null);
      throw new BotWorkspaceError("APPROVAL_EXPIRED", "approval expired");
    }
    if (approval.status !== "approved") throw new BotWorkspaceError("APPROVAL_DENIED", "approval is " + approval.status);
    const fingerprint = actionFingerprintOf({ agentId: approval.requestedByAgentId ?? "unknown", actionType, payload });
    if (fingerprint !== approval.actionFingerprint) {
      throw new BotWorkspaceError("APPROVAL_DENIED", "approval is bound to a different action fingerprint");
    }
    this.store.updateApprovalStatus(approvalId, "consumed", approval.decisionBy, null);
  }

  // --- Routines (spec §15) ---------------------------------------------------------------------------

  createRoutine(input: { name: string; ownerAgentId?: string | null; ownerTeamId?: string | null; triggerType: BwRoutineInput["triggerType"]; intervalMinutes?: number; instructionTemplate: string; skillSlug?: string | null; concurrencyPolicy?: BwRoutineInput["concurrencyPolicy"] }): ReturnType<BotWorkspaceOpsStore["insertRoutine"]> {
    if (input.triggerType === "interval" && (!input.intervalMinutes || input.intervalMinutes < 1)) {
      throw new BotWorkspaceError("VALIDATION_FAILED", "interval trigger requires intervalMinutes >= 1");
    }
    const triggerConfig = input.triggerType === "interval" ? JSON.stringify({ intervalMinutes: input.intervalMinutes }) : "{}";
    const nextRunAt = input.triggerType === "interval" ? new Date(Date.now() + (input.intervalMinutes ?? 1) * 60_000).toISOString() : null;
    const routine = this.store.insertRoutine({
      workspaceId: this.ensureWorkspace().id,
      name: input.name,
      ownerAgentId: input.ownerAgentId ?? null,
      ownerTeamId: input.ownerTeamId ?? null,
      triggerType: input.triggerType,
      triggerConfigJson: triggerConfig,
      instructionTemplate: input.instructionTemplate,
      skillSlug: input.skillSlug ?? null,
      status: input.triggerType === "manual" ? "active" : "active",
      concurrencyPolicy: input.concurrencyPolicy ?? "skip_if_running",
      approvalPolicyJson: "{}",
      lastRunAt: null,
      nextRunAt,
    });
    this.audit("routine.created", "routine", routine.id, { triggerType: input.triggerType });
    return routine;
  }

  setRoutineStatus(routineId: string, status: BwRoutineInput["status"]): ReturnType<BotWorkspaceOpsStore["updateRoutine"]> {
    const updated = this.store.updateRoutine(routineId, { status });
    this.audit(status === "paused" ? "routine.paused" : "routine.enabled", "routine", routineId, { status });
    return updated;
  }

  /** Run Now / due trigger. Idempotency key prevents duplicate event
   *  deliveries; concurrency policy enforced (skip_if_running default). */
  async runRoutine(routineId: string, triggerSource: string, idempotencyKey?: string | null): Promise<BwRoutineRun> {
    const routine = this.store.getRoutine(routineId);
    if (!routine) throw new BotWorkspaceError("NOT_FOUND", "routine not found");
    if (routine.status !== "active") throw new BotWorkspaceError("ROUTINE_CONFLICT", "routine is " + routine.status);
    if (idempotencyKey) {
      const existing = this.store.findRoutineRunByIdempotencyKey(routineId, idempotencyKey);
      if (existing) return existing; // duplicate event delivery → same run
    }
    if (routine.concurrencyPolicy === "skip_if_running" && this.store.hasOpenRun(routineId)) {
      const skipped = this.store.insertRoutineRun({
        routineId, triggerSource, status: "skipped", rootExecutionId: null,
        idempotencyKey: idempotencyKey ?? null, startedAt: null, completedAt: new Date().toISOString(),
        errorCode: "ROUTINE_CONFLICT", errorMessageSafe: "run skipped: previous run still open",
      });
      return skipped;
    }
    const run = this.store.insertRoutineRun({
      routineId, triggerSource, status: "running", rootExecutionId: null,
      idempotencyKey: idempotencyKey ?? null, startedAt: new Date().toISOString(),
      completedAt: null, errorCode: null, errorMessageSafe: null,
    });
    this.store.appendEvent(run.id.replace("bwrr", "bwe"), "routine.run.started", { routine: routine.name });
    const execution = this.store.insertExecution({
      groupRoundId: null,
      routineRunId: run.id,
      agentId: routine.ownerAgentId ?? "system",
      providerBindingId: null,
      runtimeBindingId: null,
      model: null,
      position: null,
      attempt: 1,
      status: "running",
      inputSnapshotRef: null,
      outputMessageId: null,
      errorCode: null,
      errorMessageSafe: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    this.store.updateRoutineRun(run.id, { rootExecutionId: execution.id });
    // Execution runs through the mock adapter when the owner is a mock-bound
    // agent; without a runnable owner the run completes with the template
    // echoed as the deterministic manual-run output (documented behavior).
    try {
      const adapter = this.resolveRoutineAdapter(routine.ownerAgentId);
      const result = await adapter.startGeneration({
        executionId: execution.id,
        agentInstructions: null,
        contextText: routine.instructionTemplate,
        model: null,
        onDelta: () => undefined,
      });
      this.store.updateExecutionStatus(execution.id, "completed", { completedAt: new Date().toISOString() });
      this.store.updateRoutineRun(run.id, { status: result.completed ? "completed" : "cancelled", completedAt: new Date().toISOString() });
      this.store.updateRoutine(routineId, { lastRunAt: new Date().toISOString() });
      this.store.appendEvent(execution.id, "routine.run.completed", { chars: result.text.length });
    } catch (error) {
      const code = error instanceof BotWorkspaceError ? error.code : "UNKNOWN_ERROR";
      this.store.updateExecutionStatus(execution.id, "failed", { completedAt: new Date().toISOString(), errorCode: code, errorMessageSafe: redactText(error instanceof Error ? error.message : String(error)).slice(0, 200) });
      this.store.updateRoutineRun(run.id, { status: "failed", completedAt: new Date().toISOString(), errorCode: code, errorMessageSafe: redactText(error instanceof Error ? error.message : String(error)).slice(0, 200) });
      this.store.appendEvent(execution.id, "routine.run.failed", { code });
    }
    return this.store.getRoutineRun(run.id) as BwRoutineRun;
  }

  private resolveRoutineAdapter(ownerAgentId: string | null): ProviderAdapter {
    if (ownerAgentId) {
      const agent = this.store.getAgent(ownerAgentId);
      const runtime = agent?.runtimeBindingId ? this.store.getRuntimeBinding(agent.runtimeBindingId) : null;
      return resolveAdapterForBinding(runtime?.runtimeType ?? "mock", runtime?.configJson ?? null, this);
    }
    return this.mockAdapter;
  }

  /** Interval due-check is polled on demand — no background timers; the
   *  wake limitation (requires active server) is truthful by design. */
  dueRoutineSweep(): Array<BwRoutineRun> {
    const runs: Array<BwRoutineRun> = [];
    for (const routine of this.store.dueRoutines(new Date().toISOString())) {
      runs.push(this.runRoutineSync(routine.id, "interval"));
      const config = JSON.parse(routine.triggerConfigJson) as { intervalMinutes?: number };
      const intervalMs = Math.max(1, config.intervalMinutes ?? 1) * 60_000;
      this.store.updateRoutine(routine.id, { nextRunAt: new Date(Date.now() + intervalMs).toISOString() });
    }
    return runs;
  }

  private runRoutineSync(routineId: string, triggerSource: string): BwRoutineRun {
    void triggerSource;
    void routineId;
    // Fire-and-forget scheduling hook; the returned run is created
    // synchronously and the execution continues async.
    const promise = this.runRoutine(routineId, "interval", null);
    const run = this.store.listRoutineRuns(routineId, 1)[0];
    void promise;
    return run;
  }

  // --- Export (spec §20) -------------------------------------------------------------------------------

  exportWorkspace(): Record<string, unknown> {
    const workspace = this.ensureWorkspace();
    const providers = this.store.listProviderBindings(workspace.id).map((binding) => ({
      name: binding.name,
      providerType: binding.providerType,
      endpoint: binding.endpoint,
      model: binding.model,
      credentialRef: binding.credentialRef,
      credentialIncluded: false,
    }));
    this.audit("export.created", "workspace", workspace.id, {});
    return {
      format: "pao-hubpro-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      redactionBoundary: "credential secrets are never exported; only credential references",
      workspace: { name: workspace.name, slug: workspace.slug },
      agents: this.store.listAgents(workspace.id, true).map((agent) => ({
        name: agent.name, role: agent.role, description: agent.description,
        systemInstructions: agent.systemInstructions, status: agent.status,
        defaultModel: agent.defaultModel, capabilityPolicy: agent.capabilityPolicyJson,
      })),
      teams: this.store.listTeams(workspace.id).map((team) => ({
        name: team.name, orchestrationMode: team.orchestrationMode,
        members: this.store.listMembers(team.id).map((member) => ({ position: member.position, agentName: this.store.getAgent(member.agentId)?.name ?? member.agentId })),
      })),
      routines: this.store.listRoutines(workspace.id, true).map((routine) => ({
        name: routine.name, triggerType: routine.triggerType, instructionTemplate: routine.instructionTemplate,
        concurrencyPolicy: routine.concurrencyPolicy, status: routine.status,
      })),
      provider_bindings: providers,
    };
  }

  // --- Recovery --------------------------------------------------------------------------------------

  reconcileOnRestart(): ReturnType<GroupRoundOrchestrator["reconcileOnRestart"]> {
    return this.orchestrator.reconcileOnRestart();
  }

  runtimeHealth(): Array<{ id: string; runtimeType: string; status: string; detail: string }> {
    return [
      { id: this.mockAdapter.id, runtimeType: "chat_provider", status: "healthy", detail: "deterministic mock (dev only)" },
      ...(this.chatAdapter ? [{ id: "chat_provider", runtimeType: "chat_provider", status: "degraded", detail: "delegates to bound provider router" }] : []),
      ...[this.codexAdapter ? { id: "codex_app_server", runtimeType: "codex_app_server", status: "", detail: "" } : null].filter(Boolean).map(async (entry) => {
        const health = await this.codexAdapter.healthcheck();
        return { ...entry, status: health.status, detail: health.detail };
      }),
    ].filter(Boolean) as Array<{ id: string; runtimeType: string; status: string; detail: string }>;
  }
}

type BwProviderBindingInput = { providerType: import("./types").ProviderType };
type BwRuntimeBindingInput = { runtimeType: import("./types").RuntimeType };
type BwRoutineInput = import("./types").BwRoutine;

function resolveAdapterFor(runtimeType: string, service: BotWorkspaceService): ProviderAdapter {
  if (runtimeType === "codex_app_server") return service.codexAdapter;
  if (runtimeType === "chat_provider" && service["chatAdapter"]) return service["chatAdapter"];
  return service.mockAdapter;
}

function resolveAdapterForBinding(runtimeType: string, configJson: string | null, service: BotWorkspaceService): ProviderAdapter {
  if (configJson) {
    try {
      const config = JSON.parse(configJson) as { adapter?: string };
      if (config.adapter === "mock") return service.mockAdapter;
    } catch {
      // fall through to default resolution
    }
  }
  return resolveAdapterFor(runtimeType, service);
}

// --- singleton -------------------------------------------------------------------------------------------

let singleton: BotWorkspaceService | null = null;

export function getBotWorkspaceService(chatCompletion?: ChatCompletionFn | null): BotWorkspaceService {
  if (!singleton) singleton = new BotWorkspaceService(undefined, { chatCompletion: chatCompletion ?? null });
  return singleton;
}

export function resetBotWorkspaceForTests(): void {
  singleton = null;
}

void transitionRound;
