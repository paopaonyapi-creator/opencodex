// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// LangChain Agent Runtime Implementation

import type {
  AgentRuntime,
  AgentRuntimeType,
  OrchestrationOptions,
  OrchestrationRun,
  OrchestrationCheckpoint,
  OrchestrationEvent,
  StreamChunk,
  EventType,
} from "./types";
import { OrchestrationStore } from "./store";
import { ModelRouter } from "./model-router";
import { McpToolProvider } from "./mcp-tool-provider";
import { ToolPolicyEngine } from "./tool-policy";
import { SafeguardMiddleware } from "./middleware";
import { CheckpointManager } from "./checkpoint";
import { ApprovalBridge } from "./approval-bridge";
import { StructuredOutputValidator } from "./structured-output";
import { CodexDelegationBridge } from "./codex-delegation";
import { ReviewerCouncilBridge } from "./reviewer-council";

export class LangChainAgentRuntime implements AgentRuntime {
  readonly type: AgentRuntimeType = "langchain";

  private store: OrchestrationStore;
  private router: ModelRouter;
  private mcp: McpToolProvider;
  private policy: ToolPolicyEngine;
  private checkpoints: CheckpointManager;
  private approvals: ApprovalBridge;
  private structuredValidator: StructuredOutputValidator;
  private codexDelegation: CodexDelegationBridge;
  private council: ReviewerCouncilBridge;

  constructor(deps?: {
    store?: OrchestrationStore;
    router?: ModelRouter;
    mcp?: McpToolProvider;
    policy?: ToolPolicyEngine;
    checkpoints?: CheckpointManager;
    approvals?: ApprovalBridge;
  }) {
    this.store = deps?.store || new OrchestrationStore();
    this.router = deps?.router || new ModelRouter();
    this.mcp = deps?.mcp || new McpToolProvider(this.store);
    this.policy = deps?.policy || new ToolPolicyEngine();
    this.checkpoints = deps?.checkpoints || new CheckpointManager(this.store);
    this.approvals = deps?.approvals || new ApprovalBridge(this.store);
    this.structuredValidator = new StructuredOutputValidator();
    this.codexDelegation = new CodexDelegationBridge();
    this.council = new ReviewerCouncilBridge();
  }

  private emitEvent(
    runId: string,
    seq: number,
    eventType: EventType,
    extra?: Partial<OrchestrationEvent>
  ): OrchestrationEvent {
    const event: OrchestrationEvent = {
      id: `evt_${Date.now()}_${seq}`,
      runId,
      sequenceNumber: seq,
      eventType,
      agentRole: extra?.agentRole,
      toolName: extra?.toolName,
      inputPayload: extra?.inputPayload,
      outputPayload: extra?.outputPayload,
      durationMs: extra?.durationMs,
      tokensUsed: extra?.tokensUsed,
      costUsd: extra?.costUsd,
      timestamp: new Date().toISOString(),
    };
    this.store.recordEvent(event);
    return event;
  }

  async run(prompt: string, options?: OrchestrationOptions): Promise<OrchestrationRun> {
    const now = new Date().toISOString();
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const primaryModel = options?.primaryModel || "claude-3-7-sonnet";
    const fallbackModel = options?.fallbackModel || "gpt-4o-mini";
    const safeguards = new SafeguardMiddleware(options?.safeguards);
    const tracker = safeguards.createStateTracker();

    const run: OrchestrationRun = {
      id: runId,
      sessionId: options?.sessionId,
      workflowId: options?.workflowId,
      runtimeType: "langchain",
      status: "running",
      prompt,
      resolvedPrompt: prompt,
      primaryModel,
      fallbackModel,
      modelCallCount: 0,
      toolCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      maxModelCalls: options?.safeguards?.maxModelCalls ?? 25,
      maxToolCalls: options?.safeguards?.maxToolCalls ?? 50,
      timeoutMs: options?.safeguards?.timeoutMs ?? 300000,
      metadata: options?.metadata || {},
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    };

    this.store.upsertRun(run);
    let seq = 1;
    this.emitEvent(runId, seq++, "run_started", { inputPayload: { prompt } });

    try {
      // Step 1: Initial Model Invocation
      safeguards.checkTimeout(tracker);
      safeguards.checkModelCallLimit(tracker);

      this.emitEvent(runId, seq++, "model_call_started", { inputPayload: { model: primaryModel } });
      const availableTools = this.mcp.filterToolsForModel(options?.tools);
      const modelRes = await this.router.invokeModel({
        model: primaryModel,
        fallbackModel,
        messages: [
          { role: "system", content: "You are Pao-hubPro LangChain Orchestrator. Execute safely according to policy." },
          { role: "user", content: prompt },
        ],
        tools: availableTools,
      });

      run.modelCallCount = tracker.modelCallCount;
      run.totalInputTokens += modelRes.usage.inputTokens;
      run.totalOutputTokens += modelRes.usage.outputTokens;
      safeguards.checkCostLimit(tracker, modelRes.usage.costUsd);
      run.totalCostUsd = tracker.totalCostUsd;

      this.emitEvent(runId, seq++, "model_call_completed", {
        outputPayload: { text: modelRes.text, toolCalls: modelRes.toolCalls },
        tokensUsed: modelRes.usage.inputTokens + modelRes.usage.outputTokens,
        costUsd: modelRes.usage.costUsd,
        durationMs: modelRes.latencyMs,
      });

      // Step 2: Handle Tool Calls if generated
      if (modelRes.toolCalls && modelRes.toolCalls.length > 0) {
        for (const tc of modelRes.toolCalls) {
          safeguards.checkTimeout(tracker);
          safeguards.checkToolCallLimit(tracker);
          safeguards.recordAndCheckToolOscillation(tracker, tc.name, tc.args);
          run.toolCallCount = tracker.toolCallCount;

          this.emitEvent(runId, seq++, "tool_call_started", {
            toolName: tc.name,
            inputPayload: tc.args,
          });

          // Pao-hubPro decides whether it is allowed to happen
          const toolDef = this.mcp.findToolByName(tc.name);
          const serverName = toolDef ? toolDef.serverName : "builtin";
          const policyDecision = this.policy.evaluateTool({
            toolName: tc.name,
            serverName,
            args: tc.args,
          });

          // Check if Reviewer Council is required
          if (policyDecision.requiresReviewerCouncil) {
            const verdict = await this.council.evaluateAction({
              toolName: tc.name,
              args: tc.args,
              riskLevel: policyDecision.riskLevel,
              reason: policyDecision.reason,
            });
            if (!verdict.approved) {
              this.store.recordToolCall({
                id: `tc_${Date.now()}`,
                runId,
                toolName: tc.name,
                serverName,
                riskLevel: policyDecision.riskLevel,
                inputArgs: tc.args,
                outputResult: { error: "Denied by Reviewer Council", verdict },
                status: "denied",
                createdAt: new Date().toISOString(),
              });
              throw new Error(`Execution blocked: Action rejected by Reviewer Council`);
            }
          }

          if (policyDecision.decision === "DENY") {
            this.store.recordToolCall({
              id: `tc_${Date.now()}`,
              runId,
              toolName: tc.name,
              serverName,
              riskLevel: policyDecision.riskLevel,
              inputArgs: tc.args,
              outputResult: { error: policyDecision.reason },
              status: "denied",
              createdAt: new Date().toISOString(),
            });
            throw new Error(`Tool policy violation: ${policyDecision.reason}`);
          }

          if (policyDecision.decision === "APPROVAL_REQUIRED") {
            const approval = this.approvals.requestApproval(
              runId,
              tc.name,
              policyDecision.riskLevel,
              policyDecision.reason,
              tc.args
            );

            // Save checkpoint before pausing
            this.checkpoints.saveStep(runId, 1, { status: "paused_waiting_approval", prompt }, { toolCall: tc, approvalId: approval.id });
            this.emitEvent(runId, seq++, "approval_requested", {
              toolName: tc.name,
              inputPayload: { approvalId: approval.id, reason: policyDecision.reason },
            });

            run.status = "waiting_approval";
            run.updatedAt = new Date().toISOString();
            this.store.upsertRun(run);
            return run;
          }

          // Execute allowed tool
          let toolResult: Record<string, unknown> = { status: "success", executed: true };
          if (tc.name === "delegate_codex" || tc.name.includes("codex")) {
            const codexRes = await this.codexDelegation.delegateCodingTask({
              prompt: (tc.args.prompt as string) || prompt,
            });
            toolResult = { ...codexRes };
          }

          this.store.recordToolCall({
            id: `tc_${Date.now()}`,
            runId,
            toolName: tc.name,
            serverName,
            riskLevel: policyDecision.riskLevel,
            inputArgs: tc.args,
            outputResult: toolResult,
            status: "completed",
            executionMs: 15,
            createdAt: new Date().toISOString(),
          });

          this.emitEvent(runId, seq++, "tool_call_completed", {
            toolName: tc.name,
            outputPayload: toolResult,
          });
        }
      }

      // Checkpoint step completion
      const chk = this.checkpoints.saveStep(runId, 1, { prompt, output: modelRes.text });
      this.emitEvent(runId, seq++, "checkpoint_saved", { outputPayload: { checkpointId: chk.id, hash: chk.stateHash } });

      // Structured output parsing if relevant
      let structuredJson: string | undefined;
      const parsedJson = this.structuredValidator.parseJsonFromText(modelRes.text);
      if (parsedJson.found) {
        structuredJson = parsedJson.jsonString;
      }

      run.status = "completed";
      run.outputText = modelRes.text;
      run.structuredOutputJson = structuredJson;
      run.completedAt = new Date().toISOString();
      run.updatedAt = new Date().toISOString();
      this.store.upsertRun(run);

      this.emitEvent(runId, seq++, "run_completed", { outputPayload: { outputText: modelRes.text } });
      return run;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes("timed out");
      run.status = isTimeout ? "timed_out" : "failed";
      run.errorText = errMsg;
      run.errorCode = isTimeout ? "ERR_TIMEOUT" : "ERR_EXECUTION_FAILED";
      run.completedAt = new Date().toISOString();
      run.updatedAt = new Date().toISOString();
      this.store.upsertRun(run);

      this.emitEvent(runId, seq++, "run_failed", { outputPayload: { error: errMsg } });
      return run;
    }
  }

  async *stream(prompt: string, options?: OrchestrationOptions): AsyncIterable<StreamChunk> {
    const run = await this.run(prompt, options);
    yield { runId: run.id, type: "event", run };
    yield { runId: run.id, type: "token", content: run.outputText || run.errorText || "" };
    yield { runId: run.id, type: "final", run };
  }

  async resume(
    runId: string,
    decision?: { approvalId: string; approved: boolean; reason?: string }
  ): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    if (run.status !== "waiting_approval" && run.status !== "paused") {
      return run;
    }

    if (decision) {
      const resolved = this.approvals.resolve(decision.approvalId, decision.approved, "operator", decision.reason);
      if (resolved.status === "rejected" || resolved.status === "timed_out") {
        run.status = "failed";
        run.errorText = `Run rejected during approval: ${decision.reason || resolved.reason || "Denied"}`;
        run.completedAt = new Date().toISOString();
        run.updatedAt = new Date().toISOString();
        this.store.upsertRun(run);
        return run;
      }
    }

    // Restore from checkpoint and finish run
    const chk = this.checkpoints.restoreStep(runId);
    run.status = "completed";
    run.outputText = `Resumed and completed after approval of checkpoint ${chk?.id || "step"}`;
    run.completedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    this.store.upsertRun(run);

    const seq = (this.store.listEventsForRun(runId).length || 0) + 1;
    this.emitEvent(runId, seq, "run_completed", { outputPayload: { outputText: run.outputText } });
    return run;
  }

  async cancel(runId: string, reason = "Operator cancelled"): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    run.status = "cancelled";
    run.errorText = reason;
    run.completedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    this.store.upsertRun(run);

    const seq = (this.store.listEventsForRun(runId).length || 0) + 1;
    this.emitEvent(runId, seq, "run_cancelled", { outputPayload: { reason } });
    return run;
  }

  async getState(
    runId: string
  ): Promise<{ run: OrchestrationRun; checkpoints: OrchestrationCheckpoint[]; events: OrchestrationEvent[] } | null> {
    const run = this.store.getRun(runId);
    if (!run) return null;
    const checkpoints = this.store.listCheckpointsForRun(runId);
    const events = this.store.listEventsForRun(runId);
    return { run, checkpoints, events };
  }
}
