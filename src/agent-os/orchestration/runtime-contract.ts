// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Runtime Contract and Pluggable Registry

import type { AgentRuntime, AgentRuntimeType } from "./types";

export class RuntimeRegistry {
  private runtimes = new Map<AgentRuntimeType, AgentRuntime>();

  registerRuntime(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.type, runtime);
  }

  getRuntime(type?: AgentRuntimeType): AgentRuntime {
    const isLangchainEnabled = process.env.PAO_LANGCHAIN_ENABLED !== "0";
    const requestedType: AgentRuntimeType = type || (isLangchainEnabled ? "langchain" : "native");

    const runtime = this.runtimes.get(requestedType);
    if (!runtime) {
      // Fallback to native or first available
      const fallback = this.runtimes.get("native") || this.runtimes.values().next().value;
      if (!fallback) {
        throw new Error(`No AgentRuntime registered for type '${requestedType}'`);
      }
      return fallback;
    }
    return runtime;
  }

  hasRuntime(type: AgentRuntimeType): boolean {
    return this.runtimes.has(type);
  }

  listRegisteredTypes(): AgentRuntimeType[] {
    return Array.from(this.runtimes.keys());
  }

  clear(): void {
    this.runtimes.clear();
  }
}

export const runtimeRegistry = new RuntimeRegistry();
