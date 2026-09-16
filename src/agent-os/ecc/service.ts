// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Main Service Facade linking all ECC harness subsystems

import { EccStore } from "./store";
import { EccDetector } from "./detector";
import { EccAdapter } from "./adapter";
import { SkillsRegistry } from "./skills-registry";
import { AgentRegistry } from "./agent-registry";
import { SafeToolGateway } from "./safe-tool-gateway";
import { ReviewerCouncilBridge } from "./council-bridge";
import { EccAuditLogger } from "./audit";
import { MemoryVault } from "./memory";
import { ContinuousLearningEngine } from "./learning";
import { AgentShieldAdapter } from "./agentshield";
import { EccOrchestrator, type OrchestrationTaskRequest, type OrchestrationRunResult } from "./orchestrator";
import type { ECCStatus, HarnessFeatureFlags } from "./types";

export interface EccServiceOptions {
  workspaceRoot?: string;
  storeDir?: string;
  flags?: Partial<HarnessFeatureFlags>;
  mockDetector?: EccDetector;
}

export class EccService {
  readonly store: EccStore;
  readonly detector: EccDetector;
  readonly adapter: EccAdapter;
  readonly skillsRegistry: SkillsRegistry;
  readonly agentRegistry: AgentRegistry;
  readonly toolGateway: SafeToolGateway;
  readonly councilBridge: ReviewerCouncilBridge;
  readonly auditLogger: EccAuditLogger;
  readonly memoryVault: MemoryVault;
  readonly learningEngine: ContinuousLearningEngine;
  readonly agentshield: AgentShieldAdapter;
  readonly orchestrator: EccOrchestrator;

  private flags: HarnessFeatureFlags;

  constructor(options: EccServiceOptions = {}) {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.store = new EccStore(options.storeDir);
    this.detector = options.mockDetector ?? new EccDetector({ workspaceRoot });
    this.skillsRegistry = new SkillsRegistry({ store: this.store, workspaceRoot });
    this.agentRegistry = new AgentRegistry(this.store);
    this.adapter = new EccAdapter({
      detector: this.detector,
      skillsRegistry: this.skillsRegistry,
      agentRegistry: this.agentRegistry,
    });
    this.toolGateway = new SafeToolGateway({ workspaceRoot });
    this.councilBridge = new ReviewerCouncilBridge();
    this.auditLogger = new EccAuditLogger(this.store);
    this.memoryVault = new MemoryVault(this.store);
    this.learningEngine = new ContinuousLearningEngine(this.store);
    this.agentshield = new AgentShieldAdapter();

    this.orchestrator = new EccOrchestrator(
      this.agentRegistry,
      this.skillsRegistry,
      this.toolGateway,
      this.councilBridge,
      this.auditLogger,
      this.learningEngine,
      this.memoryVault,
      this.store,
    );

    this.flags = {
      enabled: options.flags?.enabled ?? process.env.PAO_ECC_ENABLED !== "false",
      skillsEnabled: options.flags?.skillsEnabled ?? process.env.PAO_ECC_SKILLS_ENABLED !== "false",
      multiAgentEnabled: options.flags?.multiAgentEnabled ?? process.env.PAO_ECC_MULTI_AGENT_ENABLED !== "false",
      learningEnabled: options.flags?.learningEnabled ?? process.env.PAO_ECC_LEARNING_ENABLED !== "false",
    };
  }

  getFeatureFlags(): HarnessFeatureFlags {
    return { ...this.flags };
  }

  setFeatureFlags(flags: Partial<HarnessFeatureFlags>): void {
    this.flags = { ...this.flags, ...flags };
  }

  getStatus(): ECCStatus {
    if (!this.flags.enabled) {
      return {
        installed: false,
        available: true,
        mode: "native-only",
        plugin: {
          supported: true,
          marketplaceRegistered: false,
          pluginInstalled: false,
          pluginEnabled: false,
        },
        duplicateInstallDetected: false,
        skillsIndexed: this.skillsRegistry.listAll().length,
        agentsIndexed: this.agentRegistry.listAgents().length,
        warnings: ["ECC integration is disabled via feature flag PAO_ECC_ENABLED=false. Operating in native proxy mode."],
        lastCheckedAt: new Date().toISOString(),
      };
    }
    return this.adapter.getECCStatus();
  }

  rollback(reason = "Emergency operator rollback"): { success: boolean; reason: string; disabledAt: string } {
    this.flags.enabled = false;
    this.flags.skillsEnabled = false;
    this.flags.multiAgentEnabled = false;
    this.flags.learningEnabled = false;
    this.auditLogger.logToolExecution({
      runId: `rollback_${Date.now()}`,
      agentRole: "operator",
      requestedTool: "rollback",
      riskClass: "E",
      policyDecision: { allowed: true, riskClass: "E", requiresApproval: false, reason },
      actionSummary: `Rollback triggered: ${reason}`,
      finalState: "PASS",
    });
    return {
      success: true,
      reason,
      disabledAt: new Date().toISOString(),
    };
  }

  async runTask(request: OrchestrationTaskRequest): Promise<OrchestrationRunResult> {
    if (!this.flags.enabled) {
      return {
        runId: `run_disabled_${Date.now()}`,
        taskId: `task_disabled_${Date.now()}`,
        goal: request.goal,
        status: "BLOCKED",
        agentRolesUsed: [],
        skillsLoaded: [],
        plan: { summary: "Blocked: ECC Agent Harness is disabled.", steps: [] },
        verification: {
          state: "BLOCKED",
          checks: [{ name: "harness_enabled", status: "fail", message: "ECC Agent Harness is disabled via feature flag or rollback." }],
          summary: "Execution blocked: ECC Agent Harness is disabled.",
          timestamp: new Date().toISOString(),
        },
        auditEventsCount: 0,
      };
    }

    const status = this.adapter.getECCStatus();
    if (status.duplicateInstallDetected) {
      return {
        runId: `run_conflict_${Date.now()}`,
        taskId: `task_conflict_${Date.now()}`,
        goal: request.goal,
        status: "BLOCKED",
        agentRolesUsed: [],
        skillsLoaded: [],
        plan: { summary: "Blocked due to duplicate ECC installation conflict.", steps: [] },
        verification: {
          state: "BLOCKED",
          checks: [{ name: "duplicate_install_guard", status: "fail", message: "Duplicate ECC installation detected: both native plugin and legacy sync artifacts exist." }],
          summary: "Duplicate ECC installation detected: both native plugin and legacy sync artifacts exist.",
          timestamp: new Date().toISOString(),
        },
        auditEventsCount: 0,
      };
    }

    return this.orchestrator.executeTask(request);
  }
}

let defaultServiceInstance: EccService | null = null;

export function getEccService(): EccService {
  if (!defaultServiceInstance) {
    defaultServiceInstance = new EccService();
  }
  return defaultServiceInstance;
}
