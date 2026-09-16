// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// State Checkpointing & Snapshot Manager

import { createHash } from "node:crypto";
import type { OrchestrationCheckpoint } from "./types";
import { OrchestrationStore } from "./store";
import { ToolPolicyEngine } from "./tool-policy";

export class CheckpointManager {
  private store: OrchestrationStore;
  private policy: ToolPolicyEngine;

  constructor(store?: OrchestrationStore) {
    this.store = store || new OrchestrationStore();
    this.policy = new ToolPolicyEngine();
  }

  saveStep(
    runId: string,
    stepNumber: number,
    state: Record<string, unknown>,
    pendingAction?: Record<string, unknown>
  ): OrchestrationCheckpoint {
    // Redact any secrets before serializing
    const stateStr = JSON.stringify(state);
    const sanitizedStateStr = this.policy.redactSecrets(stateStr);
    const sanitizedState = JSON.parse(sanitizedStateStr);

    const pendingStr = pendingAction ? JSON.stringify(pendingAction) : "";
    const sanitizedPendingStr = pendingAction ? this.policy.redactSecrets(pendingStr) : undefined;
    const sanitizedPending = sanitizedPendingStr ? JSON.parse(sanitizedPendingStr) : undefined;

    const hash = createHash("sha256")
      .update(`${runId}:${stepNumber}:${sanitizedStateStr}:${pendingStr}`)
      .digest("hex");

    const checkpoint: OrchestrationCheckpoint = {
      id: `chk_${runId}_${stepNumber}`,
      runId,
      stepNumber,
      stateHash: hash,
      state: sanitizedState,
      pendingAction: sanitizedPending,
      createdAt: new Date().toISOString(),
    };

    this.store.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  restoreStep(runId: string, stepNumber?: number): OrchestrationCheckpoint | null {
    if (stepNumber !== undefined) {
      const all = this.store.listCheckpointsForRun(runId);
      return all.find((c) => c.stepNumber === stepNumber) || null;
    }
    return this.store.getLatestCheckpoint(runId);
  }
}
