// Phase 20.39 — Pao-hubPro Unified AI Coding Workspace (coding cockpit).
// Domain types for the provider-neutral session control plane: workspaces,
// unified sessions, normalized events, execution policy, approvals, locks,
// usage, runs/artifacts, audit. Native provider session identity is always
// preserved (spec §3.2) — Pao sessions are wrappers that reference native ids.

// --- Error taxonomy (spec §43) ---------------------------------------------------

export type CockpitErrorCode =
  | "PROVIDER_NOT_INSTALLED"
  | "PROVIDER_NOT_AUTHENTICATED"
  | "PROVIDER_UNAVAILABLE"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_RESUMABLE"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_NOT_TRUSTED"
  | "LOCK_CONFLICT"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DENIED"
  | "APPROVAL_EXPIRED"
  | "PROCESS_FAILED"
  | "PROCESS_TIMEOUT"
  | "STREAM_DISCONNECTED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "CAPABILITY_UNSUPPORTED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class CockpitError extends Error {
  readonly code: CockpitErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CockpitErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "CockpitError";
    this.code = code;
    this.details = details;
  }
}

// --- Workspaces (spec §5) ---------------------------------------------------------

export type WorkspaceTrustLevel = "UNTRUSTED" | "READ_ONLY" | "STANDARD" | "TRUSTED" | "PRIVILEGED";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  normalizedRootPath: string;
  gitRemoteUrl: string | null;
  gitBranch: string | null;
  gitHeadSha: string | null;
  trustLevel: WorkspaceTrustLevel;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

// --- Sessions (spec §6) -----------------------------------------------------------

export type SessionStatus =
  | "DISCOVERED"
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "DISCONNECTED"
  | "STALE";

export type SessionMode = "CHAT" | "PLAN" | "CODE" | "REVIEW" | "RESEARCH" | "AUTOMATION";

export type WriterState = "NONE" | "PENDING" | "HELD" | "BLOCKED";

export interface UnifiedSession {
  id: string;
  workspaceId: string;
  providerId: string;
  nativeSessionId: string | null;
  parentSessionId: string | null;
  title: string;
  status: SessionStatus;
  mode: SessionMode;
  writerState: WriterState;
  startedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  nativeMetadataJson: string | null;
  capabilitiesJson: string | null;
  resumeTokenRef: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Provider capabilities (spec §11) ----------------------------------------------

export interface ProviderCapabilities {
  chat: boolean;
  nativeSessions: boolean;
  resume: boolean;
  streaming: boolean;
  tools: boolean;
  toolInputVisibility: boolean;
  toolOutputVisibility: boolean;
  fileRead: boolean;
  fileWrite: boolean;
  shell: boolean;
  git: boolean;
  mcp: boolean;
  usage: boolean;
  cost: boolean;
  artifacts: boolean;
  cancellation: boolean;
}

export interface ProviderProbeResult {
  providerId: string;
  installed: boolean;
  authenticated: boolean | null;
  version: string | null;
  supportsResume: boolean;
  supportsStreaming: boolean;
  supportsUsage: boolean;
  detail: string;
}

// --- Adapter contract (spec §7) -----------------------------------------------------

export interface DiscoveredNativeSession {
  providerId: string;
  nativeSessionId: string;
  title: string;
  workspaceId: string | null;
  lastActivityAt: string | null;
  resumable: boolean;
  nativeMetadata: Record<string, unknown>;
}

export interface StartSessionInput {
  sessionId: string;
  workspaceId: string;
  workspaceRoot: string;
  title: string;
  mode: SessionMode;
  allowDangerousSkipPermissions?: boolean;
}

export interface ResumeSessionInput extends StartSessionInput {
  nativeSessionId: string;
}

export interface ProviderMessageInput {
  text: string;
  mode: SessionMode;
  contextRefs: ContextReference[];
  /** Advanced opt-in, honored ONLY when PAO_CLAUDE_ALLOW_DANGEROUS_SKIP_PERMISSIONS=true
   *  and the service has verified PRIVILEGED workspace trust (spec §8). */
  allowDangerousSkipPermissions?: boolean;
}

export interface ProviderSessionHandle {
  sessionId: string;
  nativeSessionId: string | null;
  processId: string | null;
}

export interface ProviderUsageSnapshot {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  reportedCostUsd: number | null;
  source: "PROVIDER_REPORTED" | "CALCULATED" | "UNKNOWN";
}

export type UnsubscribeFn = () => void;

export interface CodingProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  probe(): Promise<ProviderProbeResult>;
  getCapabilities(): ProviderCapabilities;
  discoverSessions(workspaceId: string, workspaceRoot: string | null): Promise<DiscoveredNativeSession[]>;
  startSession(input: StartSessionInput): Promise<ProviderSessionHandle>;
  resumeSession(input: ResumeSessionInput): Promise<ProviderSessionHandle>;
  sendMessage(handle: ProviderSessionHandle, input: ProviderMessageInput): Promise<void>;
  cancel(handle: ProviderSessionHandle): Promise<void>;
  subscribe(handle: ProviderSessionHandle, sink: AgentEventSink): UnsubscribeFn;
  getUsage?(handle: ProviderSessionHandle): Promise<ProviderUsageSnapshot | null>;
}

export interface AgentEventSink {
  (event: NormalizedAgentEvent): void;
}

// --- Normalized events (spec §3.3, §12) ----------------------------------------------

export type NormalizedAgentEvent =
  | { type: "SessionStarted"; nativeSessionId: string | null; detail: string }
  | { type: "MessageDelta"; text: string }
  | { type: "MessageCompleted"; text: string }
  | { type: "ToolStarted"; toolExecutionId: string; toolName: string; actionType: ActionType; summary: string }
  | { type: "ToolOutput"; toolExecutionId: string; output: string }
  | { type: "ToolCompleted"; toolExecutionId: string; status: "COMPLETED" | "FAILED"; exitCode: number | null }
  | { type: "ApprovalRequired"; approvalId: string; actionType: ActionType; summary: string; riskScore: number }
  | { type: "UsageUpdated"; usage: ProviderUsageSnapshot }
  | { type: "ArtifactCreated"; artifactId: string; artifactType: string; label: string }
  | { type: "RuntimeError"; errorCode: CockpitErrorCode; message: string }
  | { type: "SessionCompleted"; status: "COMPLETED" | "FAILED"; detail: string };

export interface AgentEventEnvelope {
  id: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  runId: string | null;
  sequence: number;
  type: NormalizedAgentEvent["type"];
  timestamp: string;
  payload: NormalizedAgentEvent;
  rawRef: string | null;
}

// --- Execution policy (spec §16-§17) ---------------------------------------------------

export type ActionType =
  | "READ"
  | "WRITE"
  | "SHELL"
  | "NETWORK"
  | "GIT_WRITE"
  | "PACKAGE_INSTALL"
  | "PROCESS_CONTROL"
  | "SECRET_ACCESS"
  | "DEPLOY"
  | "DELETE"
  | "PRIVILEGED";

export type ExecutionLevel =
  | "LEVEL_0_READ_ONLY"
  | "LEVEL_1_SAFE_WRITE"
  | "LEVEL_2_COMMAND"
  | "LEVEL_3_NETWORK"
  | "LEVEL_4_DEPLOY"
  | "LEVEL_5_FULL_CONTROL";

export const EXECUTION_LEVELS: readonly ExecutionLevel[] = [
  "LEVEL_0_READ_ONLY",
  "LEVEL_1_SAFE_WRITE",
  "LEVEL_2_COMMAND",
  "LEVEL_3_NETWORK",
  "LEVEL_4_DEPLOY",
  "LEVEL_5_FULL_CONTROL",
];

export const DEFAULT_EXECUTION_LEVEL: ExecutionLevel = "LEVEL_0_READ_ONLY";

export interface PolicyDecision {
  effect: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  riskScore: number;
  reasons: string[];
  ruleIds: string[];
}

// --- Approvals (spec §18) ---------------------------------------------------------------

export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "CONSUMED";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  workspaceId: string;
  actionType: ActionType;
  summary: string;
  normalizedInputJson: string;
  inputHash: string;
  riskScore: number;
  reasonsJson: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

// --- Writer lock (spec §19) ---------------------------------------------------------------

export type LockStatus = "ACTIVE" | "RELEASED" | "EXPIRED" | "REVOKED";

export interface WorkspaceWriterLock {
  id: string;
  workspaceId: string;
  sessionId: string;
  ownerInstanceId: string;
  status: LockStatus;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

// --- Usage (spec §23) -----------------------------------------------------------------------

export type UsageSource = "PROVIDER_REPORTED" | "CALCULATED" | "UNKNOWN";

export interface UsageRecord {
  id: string;
  sessionId: string;
  providerId: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  source: UsageSource;
  recordedAt: string;
}

// --- Runs / artifacts (spec §24) ----------------------------------------------------------------

export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface AgentRun {
  id: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorSummary: string | null;
}

export type ArtifactType =
  | "FILE" | "PATCH" | "DIFF" | "LOG" | "REPORT" | "IMAGE" | "VIDEO"
  | "ARCHIVE" | "TEST_RESULT" | "BUILD_OUTPUT";

export interface RunArtifact {
  id: string;
  runId: string;
  workspaceId: string;
  type: ArtifactType;
  label: string;
  relativePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  metadataJson: string | null;
  createdAt: string;
}

// --- Context references (spec §14) ------------------------------------------------------------

export type ContextRefType =
  | "workspace" | "repo" | "file" | "folder" | "session" | "agent"
  | "skill" | "mcp" | "phase" | "run" | "artifact";

export interface ContextReference {
  id?: string;
  type: ContextRefType;
  label: string;
  workspaceId?: string | null;
  targetId?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
}

// --- Audit (spec §22) ----------------------------------------------------------------------------

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEvent {
  id: string;
  actorId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  runId: string | null;
  providerId: string | null;
  eventType: string;
  severity: AuditSeverity;
  action: string;
  decision: string | null;
  riskScore: number | null;
  summary: string;
  metadataJson: string | null;
  createdAt: string;
}

// --- Tool executions (spec §13) -------------------------------------------------------------------

export type ToolExecutionStatus = "RUNNING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "DENIED";

export interface ToolExecution {
  id: string;
  runId: string | null;
  sessionId: string;
  toolName: string;
  actionType: ActionType;
  status: ToolExecutionStatus;
  riskScore: number | null;
  approvalRequestId: string | null;
  inputJson: string | null;
  outputSummary: string | null;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
}

// --- Providers registry row -------------------------------------------------------------------------

export interface ProviderRecord {
  id: string;
  displayName: string;
  adapterType: "codex" | "claude_code" | "local" | "mock" | "openai_optional" | "deepseek_optional" | "grok_optional";
  enabled: boolean;
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInstanceRecord {
  id: string;
  providerId: string;
  instanceKey: string;
  version: string | null;
  status: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  capabilitiesJson: string;
  lastProbeAt: string | null;
  metadataJson: string | null;
}

// --- Slash commands (spec §15) ------------------------------------------------------------------------

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  argsSchema?: string;
  requiredCapabilities?: (keyof ProviderCapabilities)[];
  minExecutionLevel?: ExecutionLevel;
}

export interface SlashCommandResult {
  commandId: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  errorCode?: CockpitErrorCode;
}

// --- Process supervision (spec §33) ----------------------------------------------------------------------

export type ProcessState = "STARTING" | "RUNNING" | "EXITED" | "CRASHED" | "TIMED_OUT" | "CANCELLED";

export interface ManagedProcessInfo {
  processId: string;
  sessionId: string | null;
  providerId: string | null;
  pid: number | null;
  state: ProcessState;
  startedAt: string;
  lastHeartbeat: string | null;
  exitCode: number | null;
}

// --- Reconciliation (spec §6.4) ------------------------------------------------------------------------------

export interface ReconciliationReport {
  checkedSessions: number;
  markedStale: number;
  markedDisconnected: number;
  expiredLocks: number;
  duplicateNativeIds: number;
  deadProcesses: number;
}
