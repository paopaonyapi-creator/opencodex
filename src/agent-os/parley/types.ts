// Phase 21.01 — Pao-hubPro × Parley Multi-Agent Work Room domain types.
//
// Key principles:
// 1. Runtime is the source of truth (provider, exact model id, endpoint, cost, tokens, duration).
// 2. Multi-agent addressing: @codex, @claude, @both, @all, @reviewers, @builders.
// 3. 4-level tool execution policy: Level 0 (Safe), Level 1 (Workspace Mutation), Level 2 (External/Network), Level 3 (Dangerous).
// 4. Run Inspector transparency: timeline, files changed, commands executed, routing hops, handoff chain.
// 5. Shared workspace boundary enforcement with Git diff tracking and safe rollback checkpoints.

export type ParleyRoomMode = "TALK" | "WORK" | "REVIEW" | "RESEARCH" | "AUTOPILOT";

export type ParleyPermissionProfile =
  | "read-only"
  | "workspace-write"
  | "reviewer"
  | "admin-approved";

export type ToolRiskLevel = 0 | 1 | 2 | 3; // 0: Safe, 1: Workspace, 2: External/Network, 3: Dangerous

export interface ParleyRoom {
  id: string;
  name: string;
  mode: ParleyRoomMode;
  workspacePath: string;
  permissionProfile: ParleyPermissionProfile;
  autoTurnsLimit: number;
  budgetLimitUsd: number;
  budgetSpentUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface ParleyRoomAgent {
  id: string;
  roomId: string;
  agentId: string;
  displayName: string;
  role: "builder" | "reviewer" | "researcher" | "coordinator";
  provider: string;
  actualModelId: string; // Authoritative runtime model ID, never LLM self-reported
  endpointProfile: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
}

export interface ParleyMessage {
  id: string;
  roomId: string;
  senderType: "user" | "agent" | "system";
  senderId: string;
  senderDisplayName: string;
  addressedTo?: string | null; // e.g. "@codex", "@claude", "@both", "@all"
  content: string;
  createdAt: string;
}

export type ParleyRunStatus =
  | "queued"
  | "routing"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface ParleyRun {
  id: string;
  roomId: string;
  agentId: string;
  provider: string;
  actualModelId: string;
  endpointProfile: string;
  permissionProfile: ParleyPermissionProfile;
  status: ParleyRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  runtimeSnapshotJson: string;
  createdAt: string;
}

export interface ParleyToolCall {
  id: string;
  runId: string;
  toolName: string;
  action: string;
  riskLevel: ToolRiskLevel;
  inputRedactedJson: string;
  outputSummary: string | null;
  status: "completed" | "failed" | "blocked";
  durationMs: number;
  createdAt: string;
}

export interface ParleyFileEvent {
  id: string;
  runId: string;
  path: string;
  operation: "read" | "create" | "modify" | "delete";
  diffPatch: string | null;
  createdAt: string;
}

export interface ParleyCommandEvent {
  id: string;
  runId: string;
  commandRedacted: string;
  cwd: string;
  exitCode: number;
  stdoutSummary: string | null;
  stderrSummary: string | null;
  durationMs: number;
  createdAt: string;
}

export interface ParleyHandoff {
  id: string;
  roomId: string;
  fromRunId: string;
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  artifacts: string[];
  createdAt: string;
}

export interface RunInspectorData {
  run: ParleyRun;
  runtimeSnapshot: Record<string, unknown>;
  toolCalls: ParleyToolCall[];
  fileEvents: ParleyFileEvent[];
  commandEvents: ParleyCommandEvent[];
  handoffs: ParleyHandoff[];
  routingChain: Array<{ hop: number; provider: string; model: string; reason: string }>;
}
