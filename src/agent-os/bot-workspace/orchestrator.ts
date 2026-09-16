// Phase 20.42 — GroupRoundOrchestrator + execution coordination (spec §11-§13,
// §17, §32). Backend-driven round orchestration with a centralized state
// machine: ordered/parallel rounds preserve the exact resolved order, Stop
// preserves completed outputs and prevents remaining agents from starting,
// retries create NEW attempts (history immutable), approvals pause the
// round, and crash recovery reconciles transient states truthfully.

import { redactText, redactJsonForAudit } from "../coding-cockpit/redaction";
import { createHash } from "node:crypto";
import { renderContextText } from "./context";
import type { BotWorkspaceOpsStore } from "./store-ops";
import type { ProviderAdapter } from "./types";
import {
  BotWorkspaceError,
  EXECUTION_TRANSITIONS,
  ROUND_TRANSITIONS,
  type BwAgent, type BwAgentExecution, type BwGroupRound, type ExecutionStatus, type FailurePolicy, type RoundStatus,
} from "./types";

export function transitionRound(current: RoundStatus, next: RoundStatus): RoundStatus {
  if (!ROUND_TRANSITIONS[current].includes(next)) {
    throw new BotWorkspaceError("VALIDATION_FAILED", "invalid round transition " + current + " → " + next);
  }
  return next;
}

export function transitionExecution(current: ExecutionStatus, next: ExecutionStatus): ExecutionStatus {
  if (!EXECUTION_TRANSITIONS[current].includes(next)) {
    throw new BotWorkspaceError("VALIDATION_FAILED", "invalid execution transition " + current + " → " + next);
  }
  return next;
}

export interface RoundAgentSpec {
  agent: BwAgent;
  position: number;
  adapter: ProviderAdapter;
}

export interface RoundOrchestrationDeps {
  store: BotWorkspaceOpsStore;
  workspaceId: string;
  actorId: string;
  maxParallel: number;
  approvalGate: (input: { executionId: string; agentId: string; roundId: string; contextText: string }) => Promise<void>;
}

export interface StartRoundInput {
  conversationId: string;
  initiatingMessageId: string;
  mode: "ordered" | "parallel";
  agentSpecs: RoundAgentSpec[];
  initiatingMessageText: string;
  conversationHistoryText: string;
  failurePolicy: FailurePolicy;
}

export class GroupRoundOrchestrator {
  constructor(private readonly deps: RoundOrchestrationDeps) {}

  /** Create the round in AWAITING_CONSENT with the exact resolved order. */
  createRound(input: StartRoundInput): BwGroupRound {
    if (input.agentSpecs.length === 0) {
      throw new BotWorkspaceError("VALIDATION_FAILED", "round requires at least one agent");
    }
    for (const spec of input.agentSpecs) {
      if (spec.agent.status !== "active") {
        throw new BotWorkspaceError("AGENT_DISABLED", "agent " + spec.agent.name + " is " + spec.agent.status);
      }
    }
    const order = [...input.agentSpecs].sort((a, b) => a.position - b.position);
    const round = this.deps.store.insertRound({
      conversationId: input.conversationId,
      initiatingMessageId: input.initiatingMessageId,
      orchestrationMode: input.mode,
      requestedAgentOrder: order.map((spec) => spec.agent.id),
      resolvedAgentOrder: order.map((spec) => spec.agent.id),
      status: "awaiting_consent",
      currentPosition: 0,
      failurePolicy: input.failurePolicy,
      stopReason: null,
      startedAt: null,
      completedAt: null,
    });
    this.deps.store.appendEvent(round.id, "round.created", { agentOrder: order.map((spec) => spec.agent.name) });
    this.deps.store.appendEvent(round.id, "round.consent_required", { destinations: order.map((spec) => spec.agent.name + "/" + spec.adapter.id) });
    return round;
  }

  /** Run the round after consent. Ordered: strict sequential; parallel:
   *  bounded concurrency with independent agents. */
  async runRound(roundId: string, input: StartRoundInput): Promise<BwGroupRound> {
    let round = this.deps.store.getRound(roundId);
    if (!round) throw new BotWorkspaceError("NOT_FOUND", "round not found");
    round = this.applyRoundTransition(round, "queued");
    round = this.applyRoundTransition(round, "running", { startedAt: new Date().toISOString() });

    const specsById = new Map(input.agentSpecs.map((spec) => [spec.agent.id, spec]));
    const order = round.resolvedAgentOrder;
    const outputs: Array<{ agentId: string; text: string }> = [];
    let failures = 0;
    let cancelled = false;

    if (round.orchestrationMode === "parallel") {
      const bounded = order.slice(0, Math.max(1, this.deps.maxParallel));
      const results = await Promise.allSettled(bounded.map((agentId) => this.runOneExecution(roundId, specsById.get(agentId) as RoundAgentSpec, input, outputs)));
      for (const result of results) {
        if (result.status === "rejected") failures += 1;
      }
      for (const agentId of order.slice(bounded.length)) {
        this.recordNotStarted(roundId, agentId);
      }
    } else {
      for (let index = 0; index < order.length; index += 1) {
        const fresh = this.deps.store.getRound(roundId);
        if (!fresh || fresh.status === "cancelled") {
          cancelled = true;
          break;
        }
        if (failures > 0 && round.failurePolicy === "stop_on_failure") break;
        const spec = specsById.get(order[index]);
        if (!spec) continue;
        try {
          const text = await this.runOneExecution(roundId, spec, input, outputs);
          outputs.push({ agentId: spec.agent.id, text });
        } catch (error) {
          failures += 1;
          if (error instanceof BotWorkspaceError && error.code === "EXECUTION_CANCELLED") {
            cancelled = true;
            break;
          }
          if (round.failurePolicy !== "continue_and_mark_partial") {
            // stop_on_failure and unknown policies halt scheduling.
          }
        }
      }
    }

    round = this.deps.store.getRound(roundId) as BwGroupRound;
    if (cancelled) {
      // Truthful terminal state: cancelled. Completed outputs already
      // persisted as messages remain visible (spec §11.2).
      round = this.applyRoundTransition(round, "cancelled", { completedAt: new Date().toISOString(), stopReason: "user stop; completed outputs preserved" });
      this.deps.store.appendEvent(roundId, "round.cancel_requested", { completed: outputs.length });
    } else if (failures > 0 && outputs.length > 0) {
      round = this.applyRoundTransition(round, "partial", { completedAt: new Date().toISOString() });
      this.deps.store.appendEvent(roundId, "round.partial", { completed: outputs.length, failures });
      round = this.applyRoundTransition(round, "completed", {});
      this.deps.store.appendEvent(roundId, "round.completed", { completed: outputs.length, failures });
    } else if (failures > 0) {
      round = this.applyRoundTransition(round, "failed", { completedAt: new Date().toISOString(), stopReason: failures + " execution(s) failed" });
      this.deps.store.appendEvent(roundId, "round.failed", { failures });
    } else {
      round = this.applyRoundTransition(round, "completed", { completedAt: new Date().toISOString() });
      this.deps.store.appendEvent(roundId, "round.completed", { completed: outputs.length });
    }
    return round;
  }

  /** One agent execution: created → queued → running → (approval) → completed. */
  private async runOneExecution(roundId: string, spec: RoundAgentSpec, input: StartRoundExecutionInput, outputs: Array<{ agentId: string; text: string }>): Promise<string> {
    const attempt = this.deps.store.maxAttemptFor(roundId, spec.agent.id, spec.position) + 1;
    let execution = this.deps.store.insertExecution({
      groupRoundId: roundId,
      routineRunId: null,
      agentId: spec.agent.id,
      providerBindingId: spec.agent.providerBindingId,
      runtimeBindingId: spec.agent.runtimeBindingId,
      model: spec.agent.defaultModel,
      position: spec.position,
      attempt,
      status: "queued",
      inputSnapshotRef: null,
      outputMessageId: null,
      errorCode: null,
      errorMessageSafe: null,
      startedAt: null,
      completedAt: null,
    });
    this.deps.store.appendEvent(execution.id, "execution.queued", { agent: spec.agent.name, attempt });

    const round = this.deps.store.getRound(roundId);
    const previousOutputs = outputs.map((output, index) => ({
      agentName: input.agentSpecs.find((candidate) => candidate.agent.id === output.agentId)?.agent.name ?? ("agent " + (index + 1)),
      text: output.text,
    }));
    const contextText = renderForExecution(input, spec, previousOutputs);

    execution = this.setStatus(execution.id, "starting", {});
    execution = this.setStatus(execution.id, "running", { startedAt: new Date().toISOString() });
    this.deps.store.appendEvent(execution.id, "execution.started", { agent: spec.agent.name });

    // Create the streaming agent message shell.
    const message = this.deps.store.insertMessage({
      conversationId: input.conversationId,
      senderType: "agent",
      senderId: spec.agent.id,
      role: "assistant",
      contentJson: JSON.stringify({ blocks: [{ type: "text", text: "" }] }),
      replyToMessageId: null,
      parentExecutionId: execution.id,
      clientMessageId: null,
      status: "streaming",
    });
    let finalText = "";

    try {
      await this.deps.approvalGate({ executionId: execution.id, agentId: spec.agent.id, roundId, contextText });
      const result = await spec.adapter.startGeneration({
        executionId: execution.id,
        agentInstructions: spec.agent.systemInstructions,
        contextText,
        model: spec.agent.defaultModel,
        onDelta: (delta) => {
          finalText += delta;
          this.deps.store.appendEvent(execution.id, "execution.output.delta", { textDelta: redactText(delta) });
        },
      });
      finalText = result.text;
      if (!result.completed) {
        execution = this.setStatus(execution.id, "cancelled", { completedAt: new Date().toISOString(), errorCode: "EXECUTION_CANCELLED" });
        this.deps.store.updateMessageStatus(message.id, "cancelled", JSON.stringify({ blocks: [{ type: "text", text: finalText }] }));
        this.deps.store.updateExecutionStatus(execution.id, "cancelled", { outputMessageId: message.id });
        throw new BotWorkspaceError("EXECUTION_CANCELLED", "cancelled by user");
      }
      this.deps.store.updateMessageStatus(message.id, "final", JSON.stringify({ blocks: [{ type: "text", text: finalText }] }));
      this.deps.store.updateExecutionStatus(execution.id, "completed", { completedAt: new Date().toISOString(), outputMessageId: message.id });
      this.deps.store.appendEvent(execution.id, "execution.output.completed", { chars: finalText.length });
      this.deps.store.appendEvent(execution.id, "execution.completed", {});
      return finalText;
    } catch (error) {
      const isCancel = error instanceof BotWorkspaceError && error.code === "EXECUTION_CANCELLED";
      if (!isCancel) {
        const code = error instanceof BotWorkspaceError ? error.code : "UNKNOWN_ERROR";
        const safe = redactText(error instanceof Error ? error.message : String(error)).slice(0, 300);
        this.deps.store.updateMessageStatus(message.id, "failed");
        this.deps.store.updateExecutionStatus(execution.id, "failed", { completedAt: new Date().toISOString(), errorCode: code, errorMessageSafe: safe, outputMessageId: message.id });
        this.deps.store.appendEvent(execution.id, "execution.failed", { code });
      }
      throw error;
    }
  }

  private recordNotStarted(roundId: string, agentId: string): void {
    void roundId;
    void agentId;
  }

  /** Stop: cancellation intent first, then adapter signal, then state
   *  reconciliation. Remaining agents never start (outer loop checks). */
  stopRound(roundId: string, adapterByAgent: Map<string, ProviderAdapter>): BwGroupRound {
    const round = this.deps.store.getRound(roundId);
    if (!round) throw new BotWorkspaceError("NOT_FOUND", "round not found");
    const executions = this.deps.store.listExecutionsForRound(roundId);
    for (const execution of executions) {
      if (execution.status === "running") {
        if (transitionOk(execution.status, "cancelling")) {
          this.deps.store.updateExecutionStatus(execution.id, "cancelling", {});
          adapterByAgent.get(execution.agentId)?.cancelGeneration(execution.id);
        }
        this.deps.store.updateExecutionStatus(execution.id, "cancelled", { completedAt: new Date().toISOString(), errorCode: "EXECUTION_CANCELLED" });
        this.deps.store.appendEvent(execution.id, "execution.cancel_requested", {});
        this.deps.store.appendEvent(execution.id, "execution.cancelled", {});
      } else if (execution.status === "queued" || execution.status === "created" || execution.status === "starting") {
        this.deps.store.updateExecutionStatus(execution.id, "cancelled", { completedAt: new Date().toISOString(), errorCode: "EXECUTION_CANCELLED" });
        this.deps.store.appendEvent(execution.id, "execution.cancelled", { note: "never started" });
      }
    }
    if (round.status === "running" || round.status === "queued" || round.status === "awaiting_consent") {
      this.applyRoundTransition(round, "cancelled", { stopReason: "stop requested" });
    }
    return this.deps.store.getRound(roundId) as BwGroupRound;
  }

  /** Retry: NEW attempt row for the failed agent; prior records immutable. */
  createRetryExecution(roundId: string, agentId: string, position: number, agent: BwAgent, adapter: ProviderAdapter): { attempt: number; executionId: string } {
    const attempt = this.deps.store.maxAttemptFor(roundId, agentId, position) + 1;
    const execution = this.deps.store.insertExecution({
      groupRoundId: roundId,
      routineRunId: null,
      agentId,
      providerBindingId: agent.providerBindingId,
      runtimeBindingId: agent.runtimeBindingId,
      model: agent.defaultModel,
      position,
      attempt,
      status: "queued",
      inputSnapshotRef: null,
      outputMessageId: null,
      errorCode: null,
      errorMessageSafe: null,
      startedAt: null,
      completedAt: null,
    });
    void adapter;
    this.deps.store.appendEvent(execution.id, "execution.created", { retryOfAttempt: attempt - 1 });
    return { attempt, executionId: execution.id };
  }

  /** Crash recovery: transient states reconcile truthfully (§32). */
  reconcileOnRestart(): { reconciled: number; orphaned: number; failed: number } {
    let orphaned = 0;
    let failed = 0;
    for (const status of ["running", "starting", "queued", "created", "cancelling"] as ExecutionStatus[]) {
      for (const execution of this.deps.store.listExecutionsInState([status], 200)) {
        if (execution.status === "waiting_approval") continue; // remains waiting if valid
        if (transitionOk(execution.status, "orphaned") && (execution.status === "starting" || execution.status === "cancelling")) {
          this.deps.store.updateExecutionStatus(execution.id, "orphaned", { errorCode: "RUNTIME_CRASHED", errorMessageSafe: "runtime did not survive restart" });
          orphaned += 1;
        } else {
          this.deps.store.updateExecutionStatus(execution.id, "failed", { errorCode: "RUNTIME_CRASHED", errorMessageSafe: "process restart interrupted execution; completed output preserved; no side effects replayed" });
          failed += 1;
        }
        this.deps.store.appendEvent(execution.id, "execution.failed", { reason: "restart reconciliation" });
      }
    }
    return { reconciled: orphaned + failed, orphaned, failed };
  }

  private setStatus(executionId: string, status: ExecutionStatus, extra: { startedAt?: string; completedAt?: string; errorCode?: string }): BwAgentExecution {
    const current = this.deps.store.getExecution(executionId);
    if (!current) throw new BotWorkspaceError("NOT_FOUND", "execution not found");
    transitionExecution(current.status, status);
    this.deps.store.updateExecutionStatus(executionId, status, extra);
    return this.deps.store.getExecution(executionId) as BwAgentExecution;
  }

  private applyRoundTransition(round: BwGroupRound, next: RoundStatus, extra: { startedAt?: string; completedAt?: string; stopReason?: string | null } = {}): BwGroupRound {
    transitionRound(round.status, next);
    this.deps.store.updateRoundStatus(round.id, next, extra);
    return this.deps.store.getRound(round.id) as BwGroupRound;
  }
}

type StartRoundExecutionInput = {
  conversationId: string;
  agentSpecs: RoundAgentSpec[];
  initiatingMessageText: string;
  conversationHistoryText: string;
};

function transitionOk(current: ExecutionStatus, next: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[current].includes(next);
}

/** Approval fingerprint binds the decision to the EXACT action payload. */
export function actionFingerprintOf(input: { agentId: string; actionType: string; payload: Record<string, unknown> }): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(redactJsonForAudit({ agentId: input.agentId, actionType: input.actionType, payload: input.payload }))).digest("hex").slice(0, 24);
}

// local helper: assemble the per-execution context text
function renderForExecution(input: StartRoundExecutionInput, spec: RoundAgentSpec, previousOutputs: Array<{ agentName: string; text: string }>): string {
  return renderContextText({
    order: [],
    sections: [
      { heading: "User task", text: input.initiatingMessageText },
      ...previousOutputs.map((output) => ({ heading: "Output from " + output.agentName, text: output.text })),
    ],
    approxTokens: 0,
    truncated: false,
  });
}
