// Phase 21.02 — Pao-hubPro Multi-Agent Mission Control domain types.

export type MissionControlAgentStatus =
  | "IDLE"
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "PAUSED"
  | "BLOCKED"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "OFFLINE"
  | "QUARANTINED";

export type MissionControlTakeoverState =
  | "AUTONOMOUS"
  | "HUMAN_REVIEW"
  | "HUMAN_CONTROL"
  | "RETURNING_TO_AGENT";

export interface MissionControlAgent {
  id: string;
  name: string;
  agentType: string;
  status: MissionControlAgentStatus;
  hostId?: string | null;
  provider?: string | null;
  model?: string | null;
  currentRunId?: string | null;
  lastHeartbeat?: string | null;
  queueDepth: number;
  activeTools: string[];
  capabilities: string[];
  skills: string[];
  mcpServers: string[];
  allowedProviders: string[];
  allowedHosts: string[];
  riskCeiling: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  takeoverState: MissionControlTakeoverState;
  totalTokens: number;
  estimatedCost: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MissionControlRunStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "PAUSED"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface MissionControlRun {
  id: string;
  workflowId?: string | null;
  agentId?: string | null;
  parentRunId?: string | null;
  status: MissionControlRunStatus;
  priority: number;
  provider?: string | null;
  model?: string | null;
  host?: string | null;
  currentStep?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  estimatedCost: number;
  retryCount: number;
  maxRetries: number;
  approvalState?: string | null;
  executionSnapshot?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionControlRunEvent {
  id: string;
  runId: string;
  agentId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MissionControlApproval {
  id: string;
  runId: string;
  agentId?: string | null;
  action: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  policyRule?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";
  requestedBy?: string | null;
  requestedAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  decisionReason?: string | null;
}

export interface MissionControlCostUsage {
  id: string;
  runId?: string | null;
  agentId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface MissionControlQueue {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DRAINING";
  priority: number;
  concurrencyLimit: number;
  activeRunsCount: number;
  pausedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionControlDlqItem {
  id: string;
  runId: string;
  agentId?: string | null;
  failureReason: string;
  stackTrace?: string | null;
  retryCount: number;
  lastProvider?: string | null;
  lastModel?: string | null;
  inputSnapshot: Record<string, unknown>;
  toolContext: Record<string, unknown>;
  policyContext: Record<string, unknown>;
  status: "OPEN" | "RETRIED" | "REASSIGNED" | "ARCHIVED" | "CANCELLED";
  resolvedAt?: string | null;
  createdAt: string;
}

export interface MissionControlIncident {
  id: string;
  mode: "NORMAL" | "DEGRADED" | "LOCKDOWN";
  title: string;
  description?: string | null;
  triggerReason: string;
  createdBy: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface MissionControlAuditLog {
  id: string;
  actor: string;
  actorType: "HUMAN" | "AGENT" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState?: string | null;
  afterState?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  sessionId?: string | null;
  correlationId: string;
  createdAt: string;
}

export interface MissionControlOverviewKpi {
  activeAgents: number;
  activeRuns: number;
  waitingApproval: number;
  queueDepth: number;
  failedRuns: number;
  offlineAgents: number;
  costTodayUsd: number;
  tokensToday: number;
  incidentMode: "NORMAL" | "DEGRADED" | "LOCKDOWN";
}

export interface MissionControlConfig {
  enabled: boolean;
  approvalsEnabled: boolean;
  approvalTimeoutMinutes: number;
  dailyBudgetUsd: number;
  maxRetries: number;
  heartbeatIntervalSec: number;
  offlineAfterSec: number;
}
