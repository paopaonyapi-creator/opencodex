// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Native Agent Runtime Implementation (High-speed fallback & zero-dependency execution)

import type {
  AgentRuntime,
  AgentRuntimeType,
  OrchestrationOptions,
  OrchestrationRun,
  OrchestrationCheckpoint,
  OrchestrationEvent,
  StreamChunk,
} from "./types";
import { OrchestrationStore } from "./store";
import { ModelRouter } from "./model-router";
import { CheckpointManager } from "./checkpoint";

export class NativeAgentRuntime implements AgentRuntime {
  readonly type: AgentRuntimeType = "native";

  private store: OrchestrationStore;
  private router: ModelRouter;
  private checkpoints: CheckpointManager;

  constructor(store?: OrchestrationStore) {
    this.store = store || new OrchestrationStore();
    this.router = new ModelRouter();
    this.checkpoints = new CheckpointManager(this.store);
  }

  async run(prompt: string, options?: OrchestrationOptions): Promise<OrchestrationRun> {
    const now = new Date().toISOString();
    const runId = `run_nat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const primaryModel = options?.primaryModel || "claude-3-7-sonnet";

    const run: OrchestrationRun = {
      id: runId,
      sessionId: options?.sessionId,
      workflowId: options?.workflowId,
      runtimeType: "native",
      status: "running",
      prompt,
      resolvedPrompt: prompt,
      primaryModel,
      fallbackModel: options?.fallbackModel,
      modelCallCount: 1,
      toolCallCount: 0,
      totalInputTokens: Math.max(1, Math.round(prompt.length / 4)),
      totalOutputTokens: 20,
      totalCostUsd: 0.0001,
      maxModelCalls: options?.safeguards?.maxModelCalls ?? 25,
      maxToolCalls: options?.safeguards?.maxToolCalls ?? 50,
      timeoutMs: options?.safeguards?.timeoutMs ?? 300000,
      metadata: options?.metadata || {},
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    };

    this.store.upsertRun(run);

    const modelRes = await this.router.invokeModel({
      model: primaryModel,
      messages: [{ role: "user", content: prompt }],
    });

    run.status = "completed";
    run.outputText = `[Native Runtime] ${modelRes.text}`;
    run.completedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    this.store.upsertRun(run);

    this.checkpoints.saveStep(runId, 1, { output: run.outputText });
    return run;
  }

  async *stream(prompt: string, options?: OrchestrationOptions): AsyncIterable<StreamChunk> {
    const run = await this.run(prompt, options);
    yield { runId: run.id, type: "token", content: run.outputText };
    yield { runId: run.id, type: "final", run };
  }

  async resume(runId: string): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    this.store.upsertRun(run);
    return run;
  }

  async cancel(runId: string, reason = "Cancelled"): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);
    run.status = "cancelled";
    run.errorText = reason;
    run.completedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    this.store.upsertRun(run);
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
