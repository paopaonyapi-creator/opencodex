// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Central Orchestration Service Facade & Operational Controls

import { OrchestrationStore } from "./store";
import { runtimeRegistry, RuntimeRegistry } from "./runtime-contract";
import { LangChainAgentRuntime } from "./langchain-runtime";
import { NativeAgentRuntime } from "./native-runtime";
import { McpToolProvider } from "./mcp-tool-provider";
import { ToolPolicyEngine } from "./tool-policy";
import { ApprovalBridge } from "./approval-bridge";
import type {
  OrchestrationRun,
  OrchestrationApproval,
  OrchestrationMcpServer,
  OrchestrationOptions,
  OrchestrationRunStatus,
  ApprovalStatus,
  AgentRuntimeType,
} from "./types";

export interface OrchestrationStatusSummary {
  enabled: boolean;
  activeRuntimeType: AgentRuntimeType;
  registeredRuntimes: AgentRuntimeType[];
  totalRuns: number;
  activeRuns: number;
  pendingApprovals: number;
  mcpServerCount: number;
  mcpToolCount: number;
  rollbackConfigured: boolean;
}

export class OrchestrationService {
  readonly store: OrchestrationStore;
  readonly registry: RuntimeRegistry;
  readonly mcp: McpToolProvider;
  readonly policy: ToolPolicyEngine;
  readonly approvals: ApprovalBridge;

  constructor(store?: OrchestrationStore) {
    this.store = store || new OrchestrationStore();
    this.registry = runtimeRegistry;
    this.mcp = new McpToolProvider(this.store);
    this.policy = new ToolPolicyEngine();
    this.approvals = new ApprovalBridge(this.store);

    // Register built-in runtimes
    this.registry.registerRuntime(new LangChainAgentRuntime({
      store: this.store,
      mcp: this.mcp,
      policy: this.policy,
      approvals: this.approvals,
    }));
    this.registry.registerRuntime(new NativeAgentRuntime(this.store));
  }

  isLangchainEnabled(): boolean {
    return process.env.PAO_LANGCHAIN_ENABLED !== "0";
  }

  getActiveRuntimeType(): AgentRuntimeType {
    return this.isLangchainEnabled() ? "langchain" : "native";
  }

  async getStatus(): Promise<OrchestrationStatusSummary> {
    const runs = this.store.listRuns(100);
    const pending = this.store.listApprovals("pending");
    const mcpServers = this.store.listMcpServers();
    const tools = this.mcp.listTools();

    return {
      enabled: true,
      activeRuntimeType: this.getActiveRuntimeType(),
      registeredRuntimes: this.registry.listRegisteredTypes(),
      totalRuns: runs.length,
      activeRuns: runs.filter((r) => r.status === "running" || r.status === "waiting_approval").length,
      pendingApprovals: pending.length,
      mcpServerCount: mcpServers.length,
      mcpToolCount: tools.length,
      rollbackConfigured: !this.isLangchainEnabled(),
    };
  }

  async executeRun(prompt: string, options?: OrchestrationOptions): Promise<OrchestrationRun> {
    const runtimeType = options?.runtimeType || this.getActiveRuntimeType();
    const runtime = this.registry.getRuntime(runtimeType);
    return runtime.run(prompt, options);
  }

  async resumeRun(
    runId: string,
    decision?: { approvalId: string; approved: boolean; reason?: string }
  ): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    const runtime = this.registry.getRuntime(run.runtimeType);
    return runtime.resume(runId, decision);
  }

  async cancelRun(runId: string, reason?: string): Promise<OrchestrationRun> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    const runtime = this.registry.getRuntime(run.runtimeType);
    return runtime.cancel(runId, reason);
  }

  listRuns(limit = 50, status?: OrchestrationRunStatus): OrchestrationRun[] {
    return this.store.listRuns(limit, status);
  }

  getRun(id: string): OrchestrationRun | null {
    return this.store.getRun(id);
  }

  listApprovals(status?: ApprovalStatus, limit = 50): OrchestrationApproval[] {
    return this.store.listApprovals(status, limit);
  }

  resolveApproval(
    id: string,
    approved: boolean,
    decidedBy = "operator",
    reason?: string
  ): OrchestrationApproval {
    return this.approvals.resolve(id, approved, decidedBy, reason);
  }

  listMcpServers(): OrchestrationMcpServer[] {
    return this.store.listMcpServers();
  }

  registerMcpServer(server: OrchestrationMcpServer): void {
    this.store.upsertMcpServer(server);
  }

  resetForTests(): void {
    this.registry.clear();
    this.registry.registerRuntime(new LangChainAgentRuntime({
      store: this.store,
      mcp: this.mcp,
      policy: this.policy,
      approvals: this.approvals,
    }));
    this.registry.registerRuntime(new NativeAgentRuntime(this.store));
  }
}

let serviceInstance: OrchestrationService | null = null;

export function getOrchestrationService(): OrchestrationService {
  if (!serviceInstance) {
    serviceInstance = new OrchestrationService();
  }
  return serviceInstance;
}

export function resetOrchestrationServiceForTests(): void {
  serviceInstance?.resetForTests();
  serviceInstance = null;
}
