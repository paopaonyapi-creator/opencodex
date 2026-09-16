// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Safeguard & Execution Middleware

import type { SafeguardConfig } from "./types";

export interface ExecutionStateTracker {
  modelCallCount: number;
  toolCallCount: number;
  totalCostUsd: number;
  startTime: number;
  recentToolCalls: Array<{ name: string; argsHash: string }>;
}

export class SafeguardMiddleware {
  private config: SafeguardConfig;

  constructor(custom?: Partial<SafeguardConfig>) {
    this.config = {
      maxModelCalls: custom?.maxModelCalls ?? 25,
      maxToolCalls: custom?.maxToolCalls ?? 50,
      timeoutMs: custom?.timeoutMs ?? 300000,
      maxConsecutiveIdenticalTools: custom?.maxConsecutiveIdenticalTools ?? 3,
      maxCostUsd: custom?.maxCostUsd ?? 5.0,
    };
  }

  createStateTracker(): ExecutionStateTracker {
    return {
      modelCallCount: 0,
      toolCallCount: 0,
      totalCostUsd: 0,
      startTime: Date.now(),
      recentToolCalls: [],
    };
  }

  checkModelCallLimit(state: ExecutionStateTracker): void {
    state.modelCallCount++;
    if (state.modelCallCount > this.config.maxModelCalls) {
      throw new Error(
        `Safeguard: Exceeded maximum allowed model calls (${this.config.maxModelCalls})`
      );
    }
  }

  checkToolCallLimit(state: ExecutionStateTracker): void {
    state.toolCallCount++;
    if (state.toolCallCount > this.config.maxToolCalls) {
      throw new Error(
        `Safeguard: Exceeded maximum allowed tool calls (${this.config.maxToolCalls})`
      );
    }
  }

  checkTimeout(state: ExecutionStateTracker): void {
    const elapsed = Date.now() - state.startTime;
    if (elapsed > this.config.timeoutMs) {
      throw new Error(
        `Safeguard: Execution timed out after ${elapsed}ms (limit: ${this.config.timeoutMs}ms)`
      );
    }
  }

  checkCostLimit(state: ExecutionStateTracker, addedCost: number): void {
    state.totalCostUsd += addedCost;
    if (state.totalCostUsd > this.config.maxCostUsd) {
      throw new Error(
        `Safeguard: Exceeded maximum allowed cost ($${this.config.maxCostUsd.toFixed(2)}, current: $${state.totalCostUsd.toFixed(2)})`
      );
    }
  }

  recordAndCheckToolOscillation(state: ExecutionStateTracker, toolName: string, args: Record<string, unknown>): void {
    const argsHash = JSON.stringify(args);
    state.recentToolCalls.push({ name: toolName, argsHash });

    if (state.recentToolCalls.length >= this.config.maxConsecutiveIdenticalTools) {
      const slice = state.recentToolCalls.slice(-this.config.maxConsecutiveIdenticalTools);
      const isIdentical = slice.every((item) => item.name === toolName && item.argsHash === argsHash);
      if (isIdentical) {
        throw new Error(
          `Safeguard: Detected infinite loop / oscillation: tool '${toolName}' invoked ${this.config.maxConsecutiveIdenticalTools} times consecutively with identical arguments`
        );
      }
    }
  }
}
