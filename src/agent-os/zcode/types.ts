/**
 * Phase 20.100 — Pao-hubPro × ZCode Unified Agent-Native Coding Workspace Runtime
 * Core Type Definitions, Adapter Contracts, and Governance Interfaces.
 */

export type ZCodeRuntimeMode = "SAFE" | "BUILD" | "REVIEW" | "ADMIN";

export type ZCodeSideEffectScope =
  | "read.files"
  | "write.files"
  | "delete.files"
  | "shell.local"
  | "shell.remote"
  | "git.read"
  | "git.write"
  | "git.push"
  | "network.read"
  | "network.write"
  | "browser.read"
  | "browser.write"
  | "credentials.read"
  | "mcp.invoke"
  | "system.settings";

export type ZCodeRiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  sideEffectScope: ZCodeSideEffectScope;
  riskLevel: ZCodeRiskLevel;
}

export interface McpServerStatus {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  status: "connected" | "disconnected" | "error";
  toolsCount: number;
  trustLevel: "TRUSTED_BUILTIN" | "TRUSTED_ADMIN" | "TRUSTED_USER" | "WORKSPACE_APPROVED" | "UNTRUSTED" | "BLOCKED";
}

export interface SkillDescriptor {
  id: string;
  name: string;
  version: string;
  description: string;
  scope: "system" | "user" | "workspace" | "session";
  trustLevel: string;
  enabled: boolean;
}

export interface SubagentDescriptor {
  agentId: string;
  parentAgentId?: string;
  role: string;
  state: "starting" | "running" | "waiting" | "blocked" | "completed" | "failed" | "cancelled";
  currentTask?: string;
  tokensUsed: number;
}

export interface ProviderLease {
  leaseId: string;
  providerId: string;
  modelId: string;
  endpointRef: string;
  credentialRef: string;
  expiresAt: string;
  maxTokens: number;
  maxCostUsd: number;
  allowedCapabilities: string[];
  fallbackChain?: string[];
  activeTokensUsed: number;
  activeCostUsd: number;
}

export interface PermissionDecision {
  decision: "allow" | "deny" | "ask";
  riskLevel: ZCodeRiskLevel;
  sideEffectScope: ZCodeSideEffectScope;
  reason: string;
  ruleId?: string;
  expiresAt?: string;
}

export interface StartRuntimeInput {
  runtimeId?: string;
  workspacePath: string;
  workspaceIdentity: string;
  mode?: ZCodeRuntimeMode;
  hostId?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeHandle {
  runtimeId: string;
  workspacePath: string;
  workspaceIdentity: string;
  mode: ZCodeRuntimeMode;
  hostId: string;
  status: "starting" | "ready" | "stopping" | "stopped" | "error";
  startedAt: string;
  version: string;
}

export interface CreateSessionInput {
  runtimeId: string;
  providerLeaseId: string;
  mode?: ZCodeRuntimeMode;
  initialPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionHandle {
  sessionId: string;
  runtimeId: string;
  providerLeaseId: string;
  mode: ZCodeRuntimeMode;
  status: "active" | "waiting_approval" | "paused" | "completed" | "error";
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExecuteTurnInput {
  sessionId: string;
  prompt: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface TurnResult {
  turnId: string;
  sessionId: string;
  status: "completed" | "requires_approval" | "failed";
  output: string;
  toolCallsExecuted: string[];
  pendingApproval?: {
    approvalId: string;
    toolName: string;
    input: Record<string, unknown>;
    riskLevel: ZCodeRiskLevel;
    reason: string;
  };
  tokensUsed: number;
  durationMs: number;
}

export interface WorkflowEvent {
  eventId: string;
  workflowRunId: string;
  sequence: number;
  eventType: string;
  actorType: "lead_agent" | "subagent" | "reviewer" | "human" | "system";
  actorId?: string;
  payload: Record<string, unknown>;
  traceId: string;
  createdAt: string;
}

export interface WorkflowProjection {
  workflowRunId: string;
  workflowId: string;
  status: "running" | "paused" | "completed" | "failed";
  currentStep: string;
  stepsCompleted: string[];
  activeSubagents: string[];
  pendingApprovals: string[];
  eventCount: number;
  updatedAt: string;
}

export interface RuntimeHealth {
  runtimeId: string;
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  activeSessions: number;
  activeSubagents: number;
  mcpConnected: number;
  policyMode: ZCodeRuntimeMode;
  uptimeSeconds: number;
}

export interface ZCodeRuntimeAdapter {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeHandle>;
  stopRuntime(runtimeId: string): Promise<void>;

  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  cancelSession(sessionId: string): Promise<void>;

  executeTurn(input: ExecuteTurnInput): Promise<TurnResult>;

  listTools(sessionId: string): Promise<ToolDescriptor[]>;
  listMcpServers(sessionId: string): Promise<McpServerStatus[]>;
  listSkills(sessionId: string): Promise<SkillDescriptor[]>;
  listSubagents(sessionId: string): Promise<SubagentDescriptor[]>;

  getWorkflowState(workflowRunId: string): Promise<WorkflowProjection>;
  getRuntimeHealth(runtimeId: string): Promise<RuntimeHealth>;
}
