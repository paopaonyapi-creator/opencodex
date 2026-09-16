// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Domain Types & Contracts

export type AgentRuntimeType = "langchain" | "native" | "codex";

export type OrchestrationRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type ToolRiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export type McpTrustLevel =
  | "trusted_internal"
  | "trusted_local"
  | "approved_third_party"
  | "untrusted_external";

export type PolicyDecision = "ALLOW" | "DENY" | "APPROVAL_REQUIRED";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

export type EventType =
  | "run_started"
  | "model_call_started"
  | "model_call_completed"
  | "tool_call_started"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "checkpoint_saved"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

export interface OrchestrationRun {
  id: string;
  sessionId?: string;
  workflowId?: string;
  runtimeType: AgentRuntimeType;
  status: OrchestrationRunStatus;
  prompt: string;
  resolvedPrompt?: string;
  primaryModel: string;
  fallbackModel?: string;
  modelCallCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  maxModelCalls: number;
  maxToolCalls: number;
  timeoutMs: number;
  outputText?: string;
  structuredOutputJson?: string;
  errorText?: string;
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface OrchestrationEvent {
  id: string;
  runId: string;
  sequenceNumber: number;
  eventType: EventType;
  agentRole?: string;
  toolName?: string;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  timestamp: string;
}

export interface OrchestrationCheckpoint {
  id: string;
  runId: string;
  stepNumber: number;
  stateHash: string;
  state: Record<string, unknown>;
  pendingAction?: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestrationApproval {
  id: string;
  runId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  actionSummary: string;
  toolArgs: Record<string, unknown>;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

export interface OrchestrationToolCall {
  id: string;
  runId: string;
  toolName: string;
  serverName: string;
  riskLevel: ToolRiskLevel;
  inputArgs: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
  status: "executing" | "completed" | "denied" | "failed" | "timeout";
  executionMs?: number;
  createdAt: string;
}

export interface OrchestrationMcpServer {
  id: string;
  serverName: string;
  trustLevel: McpTrustLevel;
  transport: "stdio" | "sse" | "websocket";
  endpointOrCommand: string;
  status: "active" | "disabled" | "error";
  toolCount: number;
  lastHeartbeat?: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface McpToolDefinition {
  name: string;
  serverName: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  trustLevel: McpTrustLevel;
}

export interface ToolPolicyResult {
  decision: PolicyDecision;
  riskLevel: ToolRiskLevel;
  reason: string;
  requiresReviewerCouncil?: boolean;
}

export interface SafeguardConfig {
  maxModelCalls: number;
  maxToolCalls: number;
  timeoutMs: number;
  maxConsecutiveIdenticalTools: number;
  maxCostUsd: number;
}

export interface OrchestrationOptions {
  runtimeType?: AgentRuntimeType;
  sessionId?: string;
  workflowId?: string;
  primaryModel?: string;
  fallbackModel?: string;
  safeguards?: Partial<SafeguardConfig>;
  schema?: Record<string, unknown>;
  tools?: string[];
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  runId: string;
  type: "token" | "tool_call" | "event" | "approval_required" | "final";
  content?: string;
  toolName?: string;
  event?: OrchestrationEvent;
  approval?: OrchestrationApproval;
  run?: OrchestrationRun;
}

export interface AgentRuntime {
  readonly type: AgentRuntimeType;
  run(prompt: string, options?: OrchestrationOptions): Promise<OrchestrationRun>;
  stream?(prompt: string, options?: OrchestrationOptions): AsyncIterable<StreamChunk>;
  resume(runId: string, approvalDecision?: { approvalId: string; approved: boolean; reason?: string }): Promise<OrchestrationRun>;
  cancel(runId: string, reason?: string): Promise<OrchestrationRun>;
  getState(runId: string): Promise<{ run: OrchestrationRun; checkpoints: OrchestrationCheckpoint[]; events: OrchestrationEvent[] } | null>;
}
