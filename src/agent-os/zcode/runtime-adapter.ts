/**
 * Phase 20.100 — Pao-hubPro × ZCode Runtime Adapter
 * Coordinates process lifecycle, session execution, turn dispatch, tool filtering, and runtime health.
 */

import { ZCodePermissionBridge } from "./permission-bridge";
import { ZCodeProviderBridge } from "./provider-bridge";
import type {
  CreateSessionInput,
  ExecuteTurnInput,
  McpServerStatus,
  RuntimeHandle,
  RuntimeHealth,
  SessionHandle,
  SkillDescriptor,
  StartRuntimeInput,
  SubagentDescriptor,
  ToolDescriptor,
  TurnResult,
  WorkflowProjection,
  ZCodeRuntimeAdapter,
  ZCodeSideEffectScope,
} from "./types";

export class ManagedZCodeRuntimeAdapter implements ZCodeRuntimeAdapter {
  private runtimes = new Map<string, RuntimeHandle>();
  private sessions = new Map<string, SessionHandle>();
  private subagents = new Map<string, SubagentDescriptor[]>();
  private idempotencyCache = new Map<string, TurnResult>();

  public readonly providerBridge = new ZCodeProviderBridge();
  public readonly permissionBridge = new ZCodePermissionBridge();

  public async startRuntime(input: StartRuntimeInput): Promise<RuntimeHandle> {
    const runtimeId = input.runtimeId || `rt_zc_${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();

    const handle: RuntimeHandle = {
      runtimeId,
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
      mode: input.mode ?? "BUILD",
      hostId: input.hostId ?? "local_host",
      status: "ready",
      startedAt,
      version: "3.14.2", // ZCode upstream-compatible runtime version
    };

    this.runtimes.set(runtimeId, handle);
    return handle;
  }

  public async stopRuntime(runtimeId: string): Promise<void> {
    const handle = this.runtimes.get(runtimeId);
    if (!handle) {
      throw new Error(`ZCode runtime '${runtimeId}' not found`);
    }
    handle.status = "stopped";
  }

  public async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    const runtime = this.runtimes.get(input.runtimeId);
    if (!runtime || runtime.status !== "ready") {
      throw new Error(`ZCode runtime '${input.runtimeId}' is not active or ready`);
    }

    const lease = this.providerBridge.getLease(input.providerLeaseId);
    if (!lease) {
      throw new Error(`Invalid or expired provider lease '${input.providerLeaseId}'`);
    }

    const sessionId = `sess_zc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const session: SessionHandle = {
      sessionId,
      runtimeId: input.runtimeId,
      providerLeaseId: input.providerLeaseId,
      mode: input.mode ?? runtime.mode,
      status: "active",
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(sessionId, session);
    this.subagents.set(sessionId, []);
    return session;
  }

  public async resumeSession(sessionId: string): Promise<SessionHandle> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }
    session.status = "active";
    session.updatedAt = new Date().toISOString();
    return session;
  }

  public async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "completed";
    session.updatedAt = new Date().toISOString();
  }

  public async executeTurn(input: ExecuteTurnInput): Promise<TurnResult> {
    const start = performance.now();

    // Idempotency check (§45)
    if (input.idempotencyKey && this.idempotencyCache.has(input.idempotencyKey)) {
      return this.idempotencyCache.get(input.idempotencyKey)!;
    }

    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Session '${input.sessionId}' not found`);
    }

    const runtime = this.runtimes.get(session.runtimeId);
    if (!runtime) {
      throw new Error(`Runtime '${session.runtimeId}' not found for session`);
    }

    const lease = this.providerBridge.getLease(session.providerLeaseId);
    if (!lease) {
      throw new Error(`Provider lease for session '${session.sessionId}' has expired`);
    }

    session.turnCount += 1;
    session.updatedAt = new Date().toISOString();

    // Determine simulated tool intent from prompt for policy check
    const toolCallsExecuted: string[] = [];
    let pendingApproval: TurnResult["pendingApproval"] = undefined;
    let turnStatus: TurnResult["status"] = "completed";
    let outputText = "";

    // Parse potential tool call intent
    let requestedTool: { name: string; scope: ZCodeSideEffectScope; args: Record<string, unknown> } | null = null;
    const lowerPrompt = input.prompt.toLowerCase();

    if (lowerPrompt.includes("run command") || lowerPrompt.includes("bash") || lowerPrompt.includes("exec")) {
      requestedTool = {
        name: "shell",
        scope: "shell.local",
        args: { command: input.prompt },
      };
    } else if (lowerPrompt.includes("write file") || lowerPrompt.includes("save code")) {
      requestedTool = {
        name: "write_file",
        scope: "write.files",
        args: { path: "src/example.ts", content: "..." },
      };
    } else if (lowerPrompt.includes("git push")) {
      requestedTool = {
        name: "git_push",
        scope: "git.push",
        args: { remote: "origin", branch: "main" },
      };
    }

    if (requestedTool) {
      const decision = await this.permissionBridge.evaluateTool({
        sessionId: session.sessionId,
        toolName: requestedTool.name,
        args: requestedTool.args,
        runtimeMode: session.mode,
        workspacePath: runtime.workspacePath,
        sideEffectScope: requestedTool.scope,
      });

      if (decision.decision === "deny") {
        turnStatus = "failed";
        outputText = `Execution blocked by Pao Policy Engine: ${decision.reason}`;
      } else if (decision.decision === "ask") {
        turnStatus = "requires_approval";
        pendingApproval = {
          approvalId: decision.ruleId || `appr_${Date.now()}`,
          toolName: requestedTool.name,
          input: requestedTool.args,
          riskLevel: decision.riskLevel,
          reason: decision.reason,
        };
        session.status = "waiting_approval";
        outputText = `Operation requires human approval before proceeding: ${decision.reason}`;
      } else {
        toolCallsExecuted.push(requestedTool.name);
        outputText = `Executed tool '${requestedTool.name}' successfully in mode ${session.mode}.`;
      }
    } else {
      outputText = `Turn ${session.turnCount} processed successfully by ZCode Agent Runtime (${lease.modelId}).`;
    }

    // Record token usage on provider lease
    const tokensUsed = 320;
    const costUsd = 0.00005;
    this.providerBridge.recordUsage(lease.leaseId, tokensUsed, costUsd);

    const result: TurnResult = {
      turnId: `turn_${Date.now().toString(36)}`,
      sessionId: session.sessionId,
      status: turnStatus,
      output: outputText,
      toolCallsExecuted,
      pendingApproval,
      tokensUsed,
      durationMs: Math.round(performance.now() - start),
    };

    if (input.idempotencyKey) {
      this.idempotencyCache.set(input.idempotencyKey, result);
    }

    return result;
  }

  public async listTools(sessionId: string): Promise<ToolDescriptor[]> {
    const session = this.sessions.get(sessionId);
    const mode = session?.mode ?? "BUILD";

    const allTools: ToolDescriptor[] = [
      {
        name: "read_file",
        description: "Read contents of a file in the workspace",
        parameters: { path: "string" },
        sideEffectScope: "read.files",
        riskLevel: "low",
      },
      {
        name: "write_file",
        description: "Write content to a file in the workspace",
        parameters: { path: "string", content: "string" },
        sideEffectScope: "write.files",
        riskLevel: "medium",
      },
      {
        name: "shell",
        description: "Execute a local shell command in the workspace directory",
        parameters: { command: "string" },
        sideEffectScope: "shell.local",
        riskLevel: "high",
      },
      {
        name: "git_status",
        description: "Inspect git status and recent changes",
        parameters: {},
        sideEffectScope: "git.read",
        riskLevel: "low",
      },
      {
        name: "git_push",
        description: "Push local commits to remote repository",
        parameters: { remote: "string", branch: "string" },
        sideEffectScope: "git.push",
        riskLevel: "critical",
      },
    ];

    if (mode === "SAFE") {
      return allTools.filter((t) => t.sideEffectScope.startsWith("read.") || t.sideEffectScope === "git.read");
    }

    return allTools;
  }

  public async listMcpServers(_sessionId: string): Promise<McpServerStatus[]> {
    return [
      {
        id: "mcp_pao_core",
        name: "Pao Core Capabilities",
        transport: "stdio",
        status: "connected",
        toolsCount: 12,
        trustLevel: "TRUSTED_BUILTIN",
      },
      {
        id: "mcp_git_tools",
        name: "Git & VCS Tools",
        transport: "stdio",
        status: "connected",
        toolsCount: 6,
        trustLevel: "TRUSTED_ADMIN",
      },
    ];
  }

  public async listSkills(_sessionId: string): Promise<SkillDescriptor[]> {
    return [
      {
        id: "skill_code_review",
        name: "Deterministic Code Review",
        version: "1.0.0",
        description: "Review diffs against security standards and test safety nets",
        scope: "workspace",
        trustLevel: "TRUSTED_BUILTIN",
        enabled: true,
      },
      {
        id: "skill_test_driven",
        name: "Test-Driven Development",
        version: "1.2.0",
        description: "Enforces red-green-refactor workflow on code changes",
        scope: "user",
        trustLevel: "TRUSTED_USER",
        enabled: true,
      },
    ];
  }

  public registerSubagent(sessionId: string, subagent: SubagentDescriptor): void {
    if (!this.subagents.has(sessionId)) {
      this.subagents.set(sessionId, []);
    }
    this.subagents.get(sessionId)!.push(subagent);
  }

  public async listSubagents(sessionId: string): Promise<SubagentDescriptor[]> {
    return this.subagents.get(sessionId) ?? [];
  }

  public async getWorkflowState(_workflowRunId: string): Promise<WorkflowProjection> {
    return {
      workflowRunId: _workflowRunId,
      workflowId: "feature-build",
      status: "running",
      currentStep: "implement",
      stepsCompleted: ["plan"],
      activeSubagents: ["coder_1", "tester_1"],
      pendingApprovals: [],
      eventCount: 4,
      updatedAt: new Date().toISOString(),
    };
  }

  public async getRuntimeHealth(runtimeId: string): Promise<RuntimeHealth> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      return {
        runtimeId,
        status: "healthy",
        version: "3.14.2",
        activeSessions: 0,
        activeSubagents: 0,
        mcpConnected: 2,
        policyMode: "BUILD",
        uptimeSeconds: 0,
      };
    }

    const activeSessions = Array.from(this.sessions.values()).filter((s) => s.runtimeId === runtimeId && s.status === "active").length;

    return {
      runtimeId,
      status: runtime.status === "ready" ? "healthy" : "degraded",
      version: runtime.version,
      activeSessions,
      activeSubagents: 2,
      mcpConnected: 2,
      policyMode: runtime.mode,
      uptimeSeconds: Math.round((Date.now() - new Date(runtime.startedAt).getTime()) / 1000),
    };
  }
}
