// Phase 20.98 — OpenHermit control plane service (spec §1, §3–§8, §10–§15, §26).
//
// Pao-hubPro is the platform authority:
//   - Owns canonical agent IDs, lifecycle state, policy evaluation, approval ledger
//   - Delegates actual execution to HermitRuntimeProvider behind an adapter boundary
//   - Durable operations state machine with idempotency and crash-recovery
//   - Desired-state reconciliation detects and corrects runtime drift safely

import { sha256Hex } from "../agent-runtime/hash";
import { getOpenHermitConfig, type OpenHermitConfig } from "./config";
import { FakeHermitProvider } from "./fake-provider";
import { openHermitEnabled, OPENHERMIT_FLAGS } from "./flags";
import { OpenHermitHttpProvider } from "./http-provider";
import { buildApprovalRequest, evaluatePolicy, inferRisk, redactArgs } from "./policy";
import { newOhId, nowIso, OpenHermitStore } from "./store";
import {
  type ActualAgentState,
  type AgentKind,
  type ApprovalRequestInput,
  type CompatibilityReport,
  type DesiredAgentState,
  type FleetAction,
  type FleetImpact,
  type HermitAgent,
  type HermitApproval,
  type HermitChannelBinding,
  type HermitOperation,
  type HermitRuntimeProvider,
  type HermitSession,
  HermitError,
  OPTIONAL_CAPABILITIES,
  REQUIRED_CAPABILITIES,
  type RiskClass,
  type SideEffectClass,
} from "./types";

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  kind?: AgentKind;
  instruction: string;
  policyProfile?: string;
  approvalProfile?: string;
  actor: string;
}

export interface DispatchOperationInput {
  agentId?: string | null;
  sessionId?: string | null;
  kind: string;
  args: Record<string, unknown>;
  sideEffect?: SideEffectClass;
  idempotencyKey: string;
  risk?: RiskClass;
  actor: string;
  workspaceId: string;
  preApproved?: boolean;
}

export class OpenHermitService {
  private readonly store: OpenHermitStore;
  private readonly config: OpenHermitConfig;
  private providerOverride: HermitRuntimeProvider | null = null;

  constructor(opts?: { store?: OpenHermitStore; config?: OpenHermitConfig; provider?: HermitRuntimeProvider }) {
    this.store = opts?.store ?? new OpenHermitStore();
    this.config = opts?.config ?? getOpenHermitConfig();
    this.providerOverride = opts?.provider ?? null;
  }

  setProviderForTests(provider: HermitRuntimeProvider | null): void {
    this.providerOverride = provider;
  }

  private resolveProvider(): HermitRuntimeProvider {
    if (this.providerOverride) return this.providerOverride;
    if (!this.config.gatewayBaseUrl) {
      // In tests / unconfigured environments default to in-memory fake
      return new FakeHermitProvider();
    }
    return new OpenHermitHttpProvider({
      baseUrl: this.config.gatewayBaseUrl,
      tokenRef: this.config.tokenRef,
      timeoutMs: this.config.requestTimeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
    });
  }

  // -------------------------------------------------------------------------
  // Health & Compatibility (§4)
  // -------------------------------------------------------------------------

  async health(): Promise<{ status: string; enabled: boolean; provider: string; details?: Record<string, unknown> }> {
    const enabled = openHermitEnabled();
    const prov = this.resolveProvider();
    try {
      const h = await prov.health();
      return {
        status: h.health,
        enabled,
        provider: prov.provider,
        details: { version: h.version, capabilities: h.capabilities, message: h.message },
      };
    } catch (err) {
      return {
        status: "unhealthy",
        enabled,
        provider: prov.provider,
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  async checkCompatibility(): Promise<CompatibilityReport> {
    const prov = this.resolveProvider();
    const now = nowIso();
    try {
      const h = await prov.health();
      const capSet = new Set(h.capabilities);
      const requiredMissing = REQUIRED_CAPABILITIES.filter((c) => !capSet.has(c));
      const optional: CompatibilityReport["optional"] = {};
      for (const opt of OPTIONAL_CAPABILITIES) {
        optional[opt] = capSet.has(opt);
      }

      let verdict: CompatibilityReport["verdict"] = "compatible";
      if (h.health === "unhealthy") verdict = "unreachable";
      else if (requiredMissing.length > 0) verdict = "incompatible";
      else if (h.health === "degraded") verdict = "degraded";

      return {
        provider: prov.provider,
        baseUrl: this.config.gatewayBaseUrl ?? null,
        runtimeVersion: h.version,
        gatewayHealth: h.health,
        requiredMissing,
        optional,
        verdict,
        checkedAt: now,
        message: h.message,
      };
    } catch (err) {
      return {
        provider: prov.provider,
        baseUrl: this.config.gatewayBaseUrl ?? null,
        runtimeVersion: null,
        gatewayHealth: "unhealthy",
        requiredMissing: [...REQUIRED_CAPABILITIES],
        optional: {},
        verdict: "unreachable",
        checkedAt: now,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Agent Lifecycle (§6)
  // -------------------------------------------------------------------------

  async createAgent(input: CreateAgentInput): Promise<HermitAgent> {
    if (!openHermitEnabled()) {
      throw new HermitError("DISABLED", "OpenHermit runtime is disabled");
    }
    const id = newOhId("oha");
    const now = nowIso();
    const digest = sha256Hex(input.instruction);

    const agent: HermitAgent = {
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind ?? "generalist",
      desiredState: "stopped",
      runtimeState: "stopped",
      runtimeProvider: null,
      runtimeAgentId: null,
      runtimeInstanceId: null,
      blueprintVersion: 1,
      policyProfile: input.policyProfile ?? "default",
      approvalProfile: input.approvalProfile ?? "default",
      instructionDigest: digest,
      drift: null,
      lastActivityAt: null,
      costUsd: 0,
      createdBy: input.actor,
      createdAt: now,
      updatedAt: now,
    };

    this.store.insertAgent(agent);
    this.store.appendEvent({
      eventType: "agent.created.v1",
      actor: input.actor,
      agentId: id,
      payload: { name: agent.name, kind: agent.kind, workspaceId: agent.workspaceId },
    });

    return agent;
  }

  getAgent(id: string): HermitAgent | null {
    return this.store.getAgent(id);
  }

  requireAgent(id: string): HermitAgent {
    const a = this.getAgent(id);
    if (!a) throw new HermitError("AGENT_NOT_FOUND", `agent not found: ${id}`);
    return a;
  }

  listAgents(workspaceId?: string): HermitAgent[] {
    return this.store.listAgents(workspaceId);
  }

  async startAgent(id: string, actor: string): Promise<HermitAgent> {
    const agent = this.requireAgent(id);
    const prov = this.resolveProvider();

    // Lazy provisioning on the remote runtime
    let runtimeAgentId = agent.runtimeAgentId;
    if (!runtimeAgentId) {
      const created = await prov.createAgent({
        name: agent.name,
        instruction: agent.instructionDigest,
      });
      runtimeAgentId = created.runtimeAgentId;
    }

    await prov.startAgent(runtimeAgentId);

    const updated = this.store.updateAgentStates(id, {
      desiredState: "running",
      runtimeState: "running",
      runtimeAgentId,
      runtimeProvider: prov.provider,
      drift: null,
      lastActivityAt: nowIso(),
    })!;

    this.store.appendEvent({
      eventType: "agent.started.v1",
      actor,
      agentId: id,
      payload: { runtimeAgentId, provider: prov.provider },
    });

    return updated;
  }

  async stopAgent(id: string, actor: string, reason = "user_stop"): Promise<HermitAgent> {
    const agent = this.requireAgent(id);
    if (agent.runtimeAgentId) {
      const prov = this.resolveProvider();
      await prov.stopAgent(agent.runtimeAgentId, reason);
    }

    const updated = this.store.updateAgentStates(id, {
      desiredState: "stopped",
      runtimeState: "stopped",
      drift: null,
      lastActivityAt: nowIso(),
    })!;

    this.store.appendEvent({
      eventType: "agent.stopped.v1",
      actor,
      agentId: id,
      payload: { reason },
    });

    return updated;
  }

  async restartAgent(id: string, actor: string): Promise<HermitAgent> {
    const agent = this.requireAgent(id);
    const prov = this.resolveProvider();

    if (!agent.runtimeAgentId) {
      return this.startAgent(id, actor);
    }

    await prov.restartAgent(agent.runtimeAgentId);

    const updated = this.store.updateAgentStates(id, {
      desiredState: "running",
      runtimeState: "running",
      drift: null,
      lastActivityAt: nowIso(),
    })!;

    this.store.appendEvent({
      eventType: "agent.restarted.v1",
      actor,
      agentId: id,
      payload: { runtimeAgentId: agent.runtimeAgentId },
    });

    return updated;
  }

  /**
   * Reconcile desired state with actual runtime state (spec §6).
   * Detects drift and safely transitions runtime to match desired state.
   */
  async reconcileAgent(id: string, actor = "reconciler"): Promise<{ agent: HermitAgent; drifted: boolean; action: string }> {
    const agent = this.requireAgent(id);
    if (!agent.runtimeAgentId) {
      if (agent.desiredState === "running") {
        const started = await this.startAgent(id, actor);
        return { agent: started, drifted: true, action: "provisioned_and_started" };
      }
      return { agent, drifted: false, action: "none" };
    }

    const prov = this.resolveProvider();
    const remote = await prov.getAgent(agent.runtimeAgentId);
    const actualRemoteState: ActualAgentState = remote ? (remote.state as ActualAgentState) : "missing";

    let drifted = false;
    let action = "none";

    if (actualRemoteState === "missing") {
      drifted = true;
      action = "remote_missing_recreated";
      if (agent.desiredState === "running") {
        this.store.updateAgentStates(id, { runtimeAgentId: null });
        const started = await this.startAgent(id, actor);
        return { agent: started, drifted, action };
      }
      const updated = this.store.updateAgentStates(id, { runtimeState: "missing", drift: "remote_missing" })!;
      return { agent: updated, drifted, action: "flagged_missing" };
    }

    if (agent.desiredState === "running" && actualRemoteState !== "running") {
      drifted = true;
      action = "restarted_to_match_desired";
      await prov.startAgent(agent.runtimeAgentId);
      const updated = this.store.updateAgentStates(id, {
        runtimeState: "running",
        drift: null,
        lastActivityAt: nowIso(),
      })!;
      return { agent: updated, drifted, action };
    }

    if (agent.desiredState === "stopped" && actualRemoteState === "running") {
      drifted = true;
      action = "stopped_to_match_desired";
      await prov.stopAgent(agent.runtimeAgentId, "reconcile_stop");
      const updated = this.store.updateAgentStates(id, {
        runtimeState: "stopped",
        drift: null,
        lastActivityAt: nowIso(),
      })!;
      return { agent: updated, drifted, action };
    }

    // States match; clear any prior drift
    const updated = this.store.updateAgentStates(id, { runtimeState: actualRemoteState, drift: null })!;
    return { agent: updated, drifted: false, action: "in_sync" };
  }

  // -------------------------------------------------------------------------
  // Durable Sessions (§7)
  // -------------------------------------------------------------------------

  async createSession(agentId: string, actorId: string, traceId?: string): Promise<HermitSession> {
    if (!OPENHERMIT_FLAGS.sessions()) {
      throw new HermitError("DISABLED", "OpenHermit sessions capability is disabled");
    }
    const agent = this.requireAgent(agentId);
    const prov = this.resolveProvider();

    // Ensure remote agent exists
    let runtimeAgentId = agent.runtimeAgentId;
    if (!runtimeAgentId) {
      const created = await prov.createAgent({ name: agent.name, instruction: agent.instructionDigest });
      runtimeAgentId = created.runtimeAgentId;
      this.store.updateAgentStates(agentId, { runtimeAgentId });
    }

    const tId = traceId ?? `trace_${crypto.randomUUID().slice(0, 12)}`;
    const remoteSess = await prov.createSession(runtimeAgentId, { traceId: tId });

    const session: HermitSession = {
      id: newOhId("ohs"),
      agentId,
      runtimeSessionId: remoteSess.runtimeSessionId,
      status: "active",
      traceId: tId,
      actorId,
      checkpointJson: null,
      messageCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      closedAt: null,
    };

    this.store.insertSession(session);
    this.store.appendEvent({
      eventType: "session.created.v1",
      actor: actorId,
      agentId,
      sessionId: session.id,
      payload: { runtimeSessionId: session.runtimeSessionId, traceId: tId },
    });

    return session;
  }

  getSession(id: string): HermitSession | null {
    return this.store.getSession(id);
  }

  requireSession(id: string): HermitSession {
    const s = this.getSession(id);
    if (!s) throw new HermitError("SESSION_NOT_FOUND", `session not found: ${id}`);
    return s;
  }

  listSessionsForAgent(agentId: string): HermitSession[] {
    return this.store.listSessionsForAgent(agentId);
  }

  async sendMessage(sessionId: string, message: string, actorId: string): Promise<{ accepted: boolean; messageCount: number }> {
    const session = this.requireSession(sessionId);
    if (session.status !== "active") {
      throw new HermitError("INVALID_INPUT", `cannot send message to session in status '${session.status}'`);
    }

    const prov = this.resolveProvider();
    if (session.runtimeSessionId) {
      await prov.sendMessage(session.runtimeSessionId, message);
    }

    const updated = this.store.updateSession(sessionId, { incrementMessages: 1 })!;
    this.store.updateAgentStates(session.agentId, { lastActivityAt: nowIso() });

    this.store.appendEvent({
      eventType: "session.message.v1",
      actor: actorId,
      agentId: session.agentId,
      sessionId,
      payload: { length: message.length },
    });

    return { accepted: true, messageCount: updated.messageCount };
  }

  async checkpointSession(sessionId: string, actorId: string): Promise<{ checkpoint: unknown }> {
    const session = this.requireSession(sessionId);
    const prov = this.resolveProvider();

    let remoteCp: unknown = null;
    if (session.runtimeSessionId) {
      const res = await prov.checkpointSession(session.runtimeSessionId);
      remoteCp = res.checkpoint;
    }

    const checkpointData = {
      sessionId,
      messages: session.messageCount,
      remoteCheckpoint: remoteCp,
      timestamp: nowIso(),
    };

    this.store.updateSession(sessionId, { checkpointJson: JSON.stringify(checkpointData) });
    this.store.appendEvent({
      eventType: "session.checkpoint.v1",
      actor: actorId,
      agentId: session.agentId,
      sessionId,
      payload: { checkpointData },
    });

    return { checkpoint: checkpointData };
  }

  async resumeSession(sessionId: string, actorId: string): Promise<HermitSession> {
    const session = this.requireSession(sessionId);
    const prov = this.resolveProvider();

    if (session.runtimeSessionId) {
      await prov.resumeSession(session.runtimeSessionId);
    }

    const updated = this.store.updateSession(sessionId, { status: "active" })!;
    this.store.appendEvent({
      eventType: "session.resumed.v1",
      actor: actorId,
      agentId: session.agentId,
      sessionId,
      payload: {},
    });

    return updated;
  }

  async closeSession(sessionId: string, actorId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const prov = this.resolveProvider();

    if (session.runtimeSessionId) {
      await prov.closeSession(session.runtimeSessionId);
    }

    this.store.updateSession(sessionId, { status: "closed", closedAt: nowIso() });
    this.store.appendEvent({
      eventType: "session.closed.v1",
      actor: actorId,
      agentId: session.agentId,
      sessionId,
      payload: {},
    });
  }

  // -------------------------------------------------------------------------
  // Resumable Operations & Idempotency (§8)
  // -------------------------------------------------------------------------

  async dispatchOperation<T>(
    input: DispatchOperationInput,
    fn: (op: HermitOperation) => Promise<T>,
  ): Promise<{ operation: HermitOperation; result?: T; approval?: HermitApproval }> {
    // Idempotency check: if already recorded, return existing terminal outcome or conflict
    const existing = this.store.getOperationByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.state === "succeeded") {
        const parsed = existing.resultJson ? JSON.parse(existing.resultJson) : undefined;
        return { operation: existing, result: parsed as T };
      }
      if (existing.state === "approval_wait" && existing.approvalId) {
        const appr = this.store.getApproval(existing.approvalId);
        return { operation: existing, approval: appr ?? undefined };
      }
      if (existing.state === "failed" || existing.state === "cancelled") {
        throw new HermitError(
          "IDEMPOTENCY_CONFLICT",
          `operation with idempotency key ${input.idempotencyKey} already ${existing.state}: ${existing.errorRedacted ?? ""}`,
        );
      }
      throw new HermitError(
        "IDEMPOTENCY_CONFLICT",
        `operation with idempotency key ${input.idempotencyKey} is currently in progress (${existing.state})`,
      );
    }

    const risk = input.risk ?? inferRisk(input.kind, input.args);
    const opId = newOhId("oho");
    const traceId = `trace_${crypto.randomUUID().slice(0, 12)}`;
    const now = nowIso();

    const op: HermitOperation = {
      id: opId,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      kind: input.kind,
      state: "queued",
      idempotencyKey: input.idempotencyKey,
      attempt: 0,
      maxAttempts: 3,
      sideEffect: input.sideEffect ?? "none",
      checkpointJson: null,
      requestJson: JSON.stringify(redactArgs(input.args)),
      resultJson: null,
      errorRedacted: null,
      approvalId: null,
      traceId,
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.store.insertOperation(op);

    // 1. Policy check phase
    this.store.updateOperationState(opId, { state: "policy_check" });

    // Look for active approval bound to exact action if supplied
    const actionHash = sha256Hex(
      JSON.stringify({ action: input.kind, target: input.agentId ?? "global", args: input.args, artifactHash: null, constraints: [] }),
    );
    const activeApproval = this.store.findActiveApprovalByHash(actionHash);

    const polDecision = evaluatePolicy({
      actor: input.actor,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      action: input.kind,
      target: input.agentId ?? "global",
      args: input.args,
      risk,
      approval: activeApproval,
      preApproved: input.preApproved,
    });

    if (polDecision.outcome === "deny") {
      this.store.updateOperationState(opId, {
        state: "failed",
        errorRedacted: `policy denied: ${polDecision.reason} (${polDecision.ruleId})`,
        completedAt: nowIso(),
      });
      throw new HermitError("POLICY_DENIED", `${polDecision.reason} (${polDecision.ruleId})`);
    }

    if (polDecision.outcome === "require_approval") {
      const appr = buildApprovalRequest(
        {
          action: input.kind,
          target: input.agentId ?? "global",
          args: input.args,
          risk,
          requestedBy: input.actor,
          agentId: input.agentId,
          operationId: opId,
        },
        () => newOhId("ohap"),
      );
      this.store.insertApproval(appr);
      this.store.updateOperationState(opId, {
        state: "approval_wait",
        approvalId: appr.id,
      });

      this.store.appendEvent({
        eventType: "tool.approval_requested.v1",
        actor: input.actor,
        agentId: input.agentId,
        operationId: opId,
        payload: { approvalId: appr.id, risk, action: input.kind },
      });

      return { operation: this.store.getOperation(opId)!, approval: appr };
    }

    // Approved / allowed — consume approval if one was used (single-use defense)
    if (activeApproval) {
      this.store.markApprovalConsumed(activeApproval.id);
    }

    // 2. Running phase
    this.store.updateOperationState(opId, { state: "running", incrementAttempt: true });

    try {
      const result = await fn(this.store.getOperation(opId)!);
      const resJson = JSON.stringify(result ?? null);
      const completed = this.store.updateOperationState(opId, {
        state: "succeeded",
        resultJson: resJson,
        completedAt: nowIso(),
      })!;

      this.store.appendEvent({
        eventType: "tool.completed.v1",
        actor: input.actor,
        agentId: input.agentId,
        operationId: opId,
        payload: { kind: input.kind },
      });

      return { operation: completed, result };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const failed = this.store.updateOperationState(opId, {
        state: "failed",
        errorRedacted: errMessage.slice(0, 512),
        completedAt: nowIso(),
      })!;

      this.store.appendEvent({
        eventType: "tool.failed.v1",
        actor: input.actor,
        agentId: input.agentId,
        operationId: opId,
        payload: { kind: input.kind, error: errMessage.slice(0, 256) },
      });

      throw err;
    }
  }

  /** Crash recovery sweep: locate incomplete operations and resume/fail safely (§8, §37). */
  async recoverIncompleteOperations(actor = "recovery_worker"): Promise<{ recovered: number; deadLettered: number }> {
    const incomplete = this.store.listIncompleteOperations();
    let recovered = 0;
    let deadLettered = 0;

    for (const op of incomplete) {
      if (op.state === "running") {
        // Never blindly repeat destructive external actions
        if (op.sideEffect === "external_destructive" || op.attempt >= op.maxAttempts) {
          this.store.updateOperationState(op.id, {
            state: "dead_letter",
            errorRedacted: "crashed mid-run: manual reconciliation required for destructive/max-attempt op",
            completedAt: nowIso(),
          });
          deadLettered++;
          continue;
        }

        // Checkpoint-safe: reset to retry_wait
        this.store.updateOperationState(op.id, { state: "retry_wait" });
        recovered++;
        this.store.appendEvent({
          eventType: "operation.recovered.v1",
          actor,
          operationId: op.id,
          payload: { previousState: "running", nextState: "retry_wait" },
        });
      }
    }

    return { recovered, deadLettered };
  }

  // -------------------------------------------------------------------------
  // Approvals management (§15)
  // -------------------------------------------------------------------------

  requestApproval(input: ApprovalRequestInput): HermitApproval {
    const appr = buildApprovalRequest(input, () => newOhId("ohap"));
    this.store.insertApproval(appr);
    this.store.appendEvent({
      eventType: "approval.created.v1",
      actor: input.requestedBy,
      agentId: input.agentId,
      operationId: input.operationId,
      payload: { approvalId: appr.id, action: appr.action, target: appr.target, risk: appr.risk },
    });
    return appr;
  }

  getApproval(id: string): HermitApproval | null {
    return this.store.getApproval(id);
  }

  listApprovals(filter?: { state?: HermitApproval["state"]; agentId?: string }): HermitApproval[] {
    return this.store.listApprovals(filter);
  }

  decideApproval(id: string, decision: "approved" | "rejected", actor: string, reason?: string): HermitApproval {
    const existing = this.store.getApproval(id);
    if (!existing) throw new HermitError("APPROVAL_NOT_FOUND", `approval not found: ${id}`);
    if (existing.state !== "pending") {
      throw new HermitError("INVALID_INPUT", `approval is already in state '${existing.state}'`);
    }

    const updated = this.store.decideApproval(id, decision, actor, reason);
    if (!updated) throw new HermitError("APPROVAL_NOT_FOUND", `failed to decide approval: ${id}`);

    this.store.appendEvent({
      eventType: decision === "approved" ? "approval.granted.v1" : "approval.denied.v1",
      actor,
      agentId: existing.agentId,
      operationId: existing.operationId,
      payload: { approvalId: id, decision, reason },
    });

    return updated;
  }

  expireApprovals(): number {
    return this.store.expirePendingApprovals();
  }

  // -------------------------------------------------------------------------
  // Fleet Bulk Operations (§26)
  // -------------------------------------------------------------------------

  calculateFleetImpact(action: FleetAction, agentIds: string[]): FleetImpact {
    const eligible: string[] = [];
    const blocked: Array<{ agentId: string; reason: string }> = [];

    for (const id of agentIds) {
      const agent = this.store.getAgent(id);
      if (!agent) {
        blocked.push({ agentId: id, reason: "agent not found" });
        continue;
      }
      if (agent.desiredState === "archived") {
        blocked.push({ agentId: id, reason: "agent is archived" });
        continue;
      }
      eligible.push(id);
    }

    const risk: RiskClass = action === "bulk_stop" || action === "bulk_restart" ? "R3" : "R2";
    const approvalRequired = eligible.length >= 3 || risk === "R3";

    return {
      action,
      eligible,
      blocked,
      affectedCount: eligible.length,
      risk,
      approvalRequired,
      reason: approvalRequired
        ? `fleet action '${action}' affects ${eligible.length} agents (threshold 3, risk ${risk})`
        : "within low-impact threshold",
    };
  }

  async executeFleetAction(
    action: FleetAction,
    agentIds: string[],
    actor: string,
    approvalId?: string,
  ): Promise<{ successful: string[]; failed: Array<{ agentId: string; error: string }> }> {
    const impact = this.calculateFleetImpact(action, agentIds);

    if (impact.approvalRequired) {
      if (!approvalId) {
        throw new HermitError("FLEET_APPROVAL_REQUIRED", impact.reason, { impact });
      }
      const appr = this.store.getApproval(approvalId);
      if (!appr || appr.state !== "approved") {
        throw new HermitError("FLEET_APPROVAL_REQUIRED", "valid approved approval record required for fleet action");
      }
      this.store.markApprovalConsumed(approvalId);
    }

    const successful: string[] = [];
    const failed: Array<{ agentId: string; error: string }> = [];

    for (const id of impact.eligible) {
      try {
        if (action === "bulk_start") await this.startAgent(id, actor);
        else if (action === "bulk_stop") await this.stopAgent(id, actor, "fleet_bulk_stop");
        else if (action === "bulk_restart") await this.restartAgent(id, actor);
        successful.push(id);
      } catch (err) {
        failed.push({ agentId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.store.appendEvent({
      eventType: "fleet.action.v1",
      actor,
      payload: { action, successfulCount: successful.length, failedCount: failed.length },
    });

    return { successful, failed };
  }

  // -------------------------------------------------------------------------
  // Channel bindings (§20)
  // -------------------------------------------------------------------------

  bindChannel(channel: HermitChannelBinding["channel"], channelIdentity: string, paoIdentity: string, agentId?: string): HermitChannelBinding {
    const binding: HermitChannelBinding = {
      id: newOhId("ohch"),
      channel,
      channelIdentity,
      paoIdentity,
      agentId: agentId ?? null,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertChannel(binding);
    return binding;
  }

  listChannels(): HermitChannelBinding[] {
    return this.store.listChannels();
  }

  // -------------------------------------------------------------------------
  // Audit & Events (§27, §29)
  // -------------------------------------------------------------------------

  listEvents(filter?: { agentId?: string; eventType?: string; limit?: number }) {
    return this.store.listEvents(filter);
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (following pattern in mcp-fabric/service.ts)
// ---------------------------------------------------------------------------

let singletonService: OpenHermitService | null = null;

export function getOpenHermitService(): OpenHermitService {
  if (!singletonService) {
    singletonService = new OpenHermitService();
  }
  return singletonService;
}

export function resetOpenHermitServiceForTests(): void {
  singletonService = null;
}
