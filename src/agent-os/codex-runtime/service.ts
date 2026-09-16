// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Central Service Facade with Rollback Controls & Operational Methods.

import { CodexRuntimeStore } from "./store";
import { CodexDetector } from "./detector";
import { PolicyEngine } from "./policy-engine";
import { ApprovalBroker } from "./approval-broker";
import { SessionManager } from "./session-manager";
import { CodexEventBus } from "./event-bus";
import { RuntimeRouter } from "./adapter";
import { McpInventory } from "./mcp-inventory";
import { DaemonManager } from "./daemon-manager";
import { NodeManager } from "./node-manager";
import { CodexAuditService } from "./audit";
import { CodexSchemaSync, type SchemaSyncResult } from "./schema-sync";
import type {
  CodexSession,
  CodexTurn,
  ApprovalRequest,
  McpToolInventoryItem,
  AuditLogEntry,
  CodexCapabilityReport,
  CodexHealthStatus,
  CodexPolicyProfile,
  CodexRuntimeMode,
} from "./types";

export interface CodexRuntimeStatusSummary {
  enabled: boolean;
  health: CodexHealthStatus;
  capabilities: CodexCapabilityReport;
  activeSessions: number;
  activeTurns: number;
  pendingApprovals: number;
  policyProfile: CodexPolicyProfile;
  runtimeMode: CodexRuntimeMode;
  localNodeId: string;
}

export class CodexRuntimeService {
  readonly store: CodexRuntimeStore;
  readonly detector = CodexDetector;
  readonly policy: PolicyEngine;
  readonly approvals: ApprovalBroker;
  readonly sessions: SessionManager;
  readonly events: CodexEventBus;
  readonly router: RuntimeRouter;
  readonly mcp: McpInventory;
  readonly daemon: DaemonManager;
  readonly nodes: NodeManager;
  readonly audit: CodexAuditService;

  constructor() {
    this.store = new CodexRuntimeStore();
    this.audit = new CodexAuditService(this.store);
    this.events = new CodexEventBus(this.store);
    this.approvals = new ApprovalBroker(this.store, this.audit);
    this.policy = new PolicyEngine((process.env.PAO_CODEX_DEFAULT_POLICY as CodexPolicyProfile) || "NORMAL");
    this.sessions = new SessionManager(this.store, this.events, this.audit);
    this.router = new RuntimeRouter();
    this.mcp = new McpInventory(this.store);
    this.daemon = new DaemonManager();
    this.nodes = new NodeManager(this.store);

    // Ensure local node and builtins
    this.nodes.ensureLocalNode();
    this.mcp.seedBuiltinTools();
    this.sessions.reconcileOnStartup();
  }

  isNativeRuntimeEnabled(): boolean {
    // Rollback switch: if PAO_CODEX_NATIVE_RUNTIME is set to "false", disables native codex runtime
    return process.env.PAO_CODEX_NATIVE_RUNTIME !== "false";
  }

  async getStatus(): Promise<CodexRuntimeStatusSummary> {
    const enabled = this.isNativeRuntimeEnabled();
    const capabilities = CodexDetector.detectCapabilities();
    const adapter = this.router.resolveAdapter();
    const health = await adapter.health();
    const sessions = this.store.listSessions();
    const pending = this.store.listApprovals("pending");

    return {
      enabled,
      health,
      capabilities,
      activeSessions: sessions.filter((s) => s.status === "running").length,
      activeTurns: sessions.filter((s) => s.activeTurnId !== null).length,
      pendingApprovals: pending.length,
      policyProfile: this.policy.getProfile(),
      runtimeMode: adapter.mode,
      localNodeId: "local_pc",
    };
  }

  createSession(options: {
    workspaceRoot: string;
    nodeId?: string;
    runtimeMode?: CodexRuntimeMode;
    policyProfile?: CodexPolicyProfile;
    title?: string;
  }): CodexSession {
    if (!this.isNativeRuntimeEnabled()) {
      throw new Error("Codex Native Runtime is disabled via PAO_CODEX_NATIVE_RUNTIME=false");
    }

    // Validate workspace path
    const pathCheck = this.policy.validatePath(options.workspaceRoot, options.workspaceRoot, false);
    if (!pathCheck.allowed) {
      throw new Error(`Invalid workspace root: ${pathCheck.reason}`);
    }

    return this.sessions.createSession(options);
  }

  async executeTurn(sessionId: string, prompt: string): Promise<CodexTurn> {
    if (!this.isNativeRuntimeEnabled()) {
      throw new Error("Codex Native Runtime is disabled via PAO_CODEX_NATIVE_RUNTIME=false");
    }

    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const adapter = this.router.resolveAdapter(session.runtimeMode);

    // Start thread if not present
    if (!session.threadId) {
      const threadRes = await adapter.startThread(sessionId, session.workspaceRoot);
      this.sessions.bindThread(sessionId, threadRes.threadId);
      session.threadId = threadRes.threadId;
    }

    return this.sessions.enqueueTurn(sessionId, prompt, async (turn) => {
      const execution = await adapter.startTurn(
        sessionId,
        session.threadId!,
        prompt,
        (event) => {
          this.events.emit(sessionId, turn.id, event);
        },
      );
      turn.resultSummary = execution.result;
      turn.fileChanges = execution.fileChanges;
    });
  }

  cancelTurn(turnId: string): boolean {
    const success = this.sessions.cancelTurn(turnId);
    void this.router.resolveAdapter().cancelTurn(turnId);
    return success;
  }

  resolveApproval(
    approvalId: string,
    decision: "allow" | "deny" | "cancel",
    operatorName = "operator",
  ): boolean {
    return this.approvals.resolve(approvalId, decision, operatorName);
  }

  getPendingApprovals(): ApprovalRequest[] {
    return this.approvals.getPendingApprovals();
  }

  listSessions(limit = 100): CodexSession[] {
    return this.store.listSessions(limit);
  }

  getSession(id: string): CodexSession | null {
    return this.store.getSession(id);
  }

  listTools(): McpToolInventoryItem[] {
    return this.mcp.listTools();
  }

  listAuditLogs(limit = 100): AuditLogEntry[] {
    return this.store.listAuditLogs(limit);
  }

  syncSchema(experimental = false): SchemaSyncResult {
    return CodexSchemaSync.sync({ experimental });
  }

  unlockFullAccess(operatorName: string, ttlSeconds = 900): { success: boolean; expiresAt: string } {
    const result = this.policy.unlockFullAccess(operatorName, ttlSeconds);
    this.audit.log({
      actor: operatorName,
      action: "policy.unlock_full_access",
      risk: "high",
      result: "ok",
      metadata: {
        ttlSeconds,
        expiresAt: result.expiresAt,
        warning: "FULL_ACCESS unlocked with elevated privileges",
      },
    });
    return result;
  }

  async shutdown(): Promise<void> {
    await this.router.shutdownAll();
  }
}

// Global Singleton Instance
let serviceInstance: CodexRuntimeService | null = null;

export function getCodexRuntimeService(): CodexRuntimeService {
  if (!serviceInstance) {
    serviceInstance = new CodexRuntimeService();
  }
  return serviceInstance;
}

export function resetCodexRuntimeServiceForTests(): void {
  serviceInstance = null;
}

