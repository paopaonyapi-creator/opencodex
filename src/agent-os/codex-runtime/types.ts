// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Core Domain Models, Contracts, Types, and Event Envelopes.

export type CodexRuntimeMode = "auto" | "sdk" | "app_server" | "cli";

export type CodexPolicyProfile = "SAFE" | "NORMAL" | "AUTOMATION" | "FULL_ACCESS";

export type RiskClassification = "low" | "medium" | "high";

export type ApprovalStatus =
  | "pending"
  | "approved_once"
  | "approved_scoped"
  | "denied"
  | "cancelled"
  | "timed_out";

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale";

export type JobState =
  | "queued"
  | "starting"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeConnectionState = "online" | "offline" | "degraded";

export type PlatformKind = "windows" | "linux" | "macos" | "unknown";

export const ERROR_CODES = [
  "RUNTIME_NOT_FOUND",
  "RUNTIME_VERSION_UNSUPPORTED",
  "AUTH_REQUIRED",
  "APP_SERVER_INIT_FAILED",
  "PROTOCOL_MISMATCH",
  "RUNTIME_OVERLOADED",
  "THREAD_NOT_FOUND",
  "TURN_FAILED",
  "TURN_CANCELLED",
  "APPROVAL_TIMEOUT",
  "APPROVAL_DENIED",
  "SANDBOX_DENIED",
  "PATH_DENIED",
  "NETWORK_DENIED",
  "TOOL_FAILED",
  "MCP_UNAVAILABLE",
  "REMOTE_NODE_OFFLINE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CodexCapabilityReport {
  codexInstalled: boolean;
  codexVersion: string | null;
  pythonSdkAvailable: boolean;
  appServerAvailable: boolean;
  execServerAvailable: boolean;
  daemonAvailable: boolean;
  remoteControlAvailable: boolean;
  mcpAvailable: boolean;
  experimentalApiEnabled: boolean;
  platform: PlatformKind;
}

export interface CodexHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  codex: {
    installed: boolean;
    version: string | null;
  };
  sdk: {
    available: boolean;
  };
  appServer: {
    available: boolean;
    initialized: boolean;
  };
  daemon: {
    enabled: boolean;
    status: string;
  };
  mcp: {
    healthy: boolean;
    toolCount: number;
  };
  timestamp: string;
}

export interface RuntimeNode {
  id: string;
  name: string;
  platform: PlatformKind;
  hostname: string;
  codexVersion: string | null;
  runtimeMode: CodexRuntimeMode;
  connectionState: NodeConnectionState;
  lastSeen: string | null;
  capabilityReport: CodexCapabilityReport;
  policyProfile: CodexPolicyProfile;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodexSession {
  id: string;
  threadId: string | null;
  workspaceRoot: string;
  nodeId: string;
  runtimeMode: CodexRuntimeMode;
  status: SessionStatus;
  policyProfile: CodexPolicyProfile;
  title: string | null;
  activeTurnId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodexTurn {
  id: string;
  sessionId: string;
  threadId: string | null;
  nodeId: string;
  prompt: string;
  status: JobState;
  fileChanges: string[];
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  turnId: string | null;
  nodeId: string;
  toolName: string;
  command?: string;
  path?: string;
  networkIntent?: string;
  riskLevel: RiskClassification;
  status: ApprovalStatus;
  decision?: "allow" | "deny" | "cancel";
  decidedBy?: string;
  decidedAt?: string;
  requestedAt: string;
  expiresAt: string;
}

export interface McpToolInventoryItem {
  id: string;
  serverName: string;
  toolName: string;
  description: string;
  risk: RiskClassification;
  approvalBehavior: "auto" | "ask" | "deny";
  source: "builtin" | "mcp" | "pao" | "node";
  health: "healthy" | "degraded" | "unhealthy";
  lastError?: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  sessionId?: string | null;
  turnId?: string | null;
  nodeId?: string | null;
  action: string;
  risk: RiskClassification;
  result: "ok" | "denied" | "failed" | "timed_out";
  metadata: Record<string, unknown>;
}

// Normalized Pao Runtime Events
export type PaoRuntimeEvent =
  | { type: "RuntimeConnected"; runtime: string; version: string; transport: string; timestamp: string }
  | { type: "RuntimeDisconnected"; runtime: string; reason?: string; timestamp: string }
  | { type: "ThreadStarted"; threadId: string; sessionId: string; timestamp: string }
  | { type: "ThreadResumed"; threadId: string; sessionId: string; timestamp: string }
  | { type: "TurnStarted"; turnId: string; threadId: string; sessionId: string; prompt: string; timestamp: string }
  | { type: "TurnProgress"; turnId: string; step: string; percentage?: number; timestamp: string }
  | { type: "AgentMessageDelta"; turnId: string; textDelta: string; timestamp: string }
  | { type: "AgentMessageCompleted"; turnId: string; fullText: string; timestamp: string }
  | { type: "ToolStarted"; turnId: string; toolId: string; toolName: string; args: Record<string, unknown>; risk: RiskClassification; timestamp: string }
  | { type: "ToolCompleted"; turnId: string; toolId: string; toolName: string; result: unknown; timestamp: string }
  | { type: "ToolFailed"; turnId: string; toolId: string; toolName: string; error: string; timestamp: string }
  | { type: "ApprovalRequested"; approvalId: string; turnId: string; sessionId: string; toolName: string; command?: string; path?: string; networkIntent?: string; risk: RiskClassification; expiresAt: string; timestamp: string }
  | { type: "ApprovalResolved"; approvalId: string; decision: "allow" | "deny" | "cancel"; decidedBy: string; timestamp: string }
  | { type: "SandboxViolation"; turnId?: string; violation: string; pathOrCommand: string; timestamp: string }
  | { type: "RuntimeWarning"; code: string; message: string; timestamp: string }
  | { type: "RuntimeError"; code: ErrorCode; message: string; fatal?: boolean; timestamp: string }
  | { type: "TurnCompleted"; turnId: string; resultSummary?: string; fileChanges?: string[]; timestamp: string }
  | { type: "TurnCancelled"; turnId: string; reason: string; timestamp: string };

export interface PolicyRuleSet {
  profile: CodexPolicyProfile;
  sandboxMode: "read-only" | "workspace-write" | "full-access";
  writeScope: "none" | "workspace" | "unrestricted";
  networkAccess: "restricted" | "allowlist" | "unrestricted";
  networkAllowlist: string[];
  destructiveToolsRequireApproval: boolean;
  ttlSeconds?: number;
  unlockedAt?: string;
  unlockedBy?: string;
}
