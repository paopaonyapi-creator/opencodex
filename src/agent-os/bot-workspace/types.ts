// Phase 20.42 — Named AI Teammate Workspace: canonical domain contracts
// (spec §5, §11, §16-§18). Clean-room implementation of BotWorkspace
// product patterns; no macOS/Swift code and no upstream source copied.
// Truthful states everywhere: nothing reports connected/running/completed
// unless the backend reached that state.

export type WorkspaceAgentStatus = "active" | "paused" | "disabled" | "archived";

export type WorkspaceAgentRole =
  | "chief_of_staff" | "researcher" | "planner" | "coder" | "reviewer"
  | "browser_operator" | "stock_metadata_specialist" | "video_pipeline_operator"
  | "system_admin" | "custom";

export type OrchestrationMode =
  | "ordered" | "parallel" | "lead_then_specialists"
  | "specialists_then_reviewer" | "review_loop" | "manual";

export const ORCHESTRATION_MODES: readonly OrchestrationMode[] = [
  "ordered", "parallel", "lead_then_specialists", "specialists_then_reviewer", "review_loop", "manual",
];

export type FailurePolicy =
  | "stop_on_failure" | "continue_and_mark_partial"
  | "continue_optional_agents_only" | "ask_user";

export const FAILURE_POLICIES: readonly FailurePolicy[] = [
  "stop_on_failure", "continue_and_mark_partial", "continue_optional_agents_only", "ask_user",
];

export interface BwWorkspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface BwAgent {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  avatarRef: string | null;
  description: string | null;
  role: WorkspaceAgentRole;
  systemInstructions: string | null;
  status: WorkspaceAgentStatus;
  visibility: "visible" | "hidden";
  providerBindingId: string | null;
  runtimeBindingId: string | null;
  defaultModel: string | null;
  contextPolicyJson: string;
  capabilityPolicyJson: string;
  approvalPolicyJson: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface BwTeam {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  leadAgentId: string | null;
  orchestrationMode: OrchestrationMode;
  defaultRecipientOrderJson: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface BwTeamMember {
  id: string;
  teamId: string;
  agentId: string;
  position: number;
  roleInTeam: string | null;
  isRequired: boolean;
  canDelegate: boolean;
  createdAt: string;
}

export interface BwConversation {
  id: string;
  workspaceId: string;
  kind: "direct" | "group" | "system" | "routine";
  agentId: string | null;
  teamId: string | null;
  title: string | null;
  status: "active" | "archived";
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBlock {
  type: "text" | "code" | "artifact_ref" | "approval_ref" | "tool_result_ref";
  text?: string;
  language?: string;
  artifactId?: string;
  approvalId?: string;
  toolCallId?: string;
}

export interface BwMessage {
  id: string;
  conversationId: string;
  senderType: "user" | "agent" | "system" | "tool" | "runtime";
  senderId: string | null;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  contentJson: string;
  blocks: ContentBlock[];
  replyToMessageId: string | null;
  parentExecutionId: string | null;
  clientMessageId: string | null;
  status: "streaming" | "final" | "cancelled" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface BwDraft {
  conversationId: string;
  ownerKey: string;
  contentJson: string;
  selectedAgentIds: string[];
  attachmentRefs: string[];
  updatedAt: string;
}

export type ProviderType =
  | "openai" | "openai_compatible" | "anthropic" | "xai" | "zai" | "deepseek"
  | "openrouter" | "ollama" | "lmstudio" | "vllm" | "runpod" | "custom" | "mock";

export interface BwProviderBinding {
  id: string;
  workspaceId: string;
  providerType: ProviderType;
  name: string;
  endpoint: string | null;
  model: string | null;
  credentialRef: string | null;
  settingsJson: string;
  status: "unverified" | "healthy" | "degraded" | "unavailable";
  lastHealthcheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeType = "chat_provider" | "codex_app_server" | "mcp_agent" | "local_agent" | "reviewer_council" | "custom";

export interface BwRuntimeBinding {
  id: string;
  workspaceId: string;
  runtimeType: RuntimeType;
  name: string;
  configJson: string;
  status: "unverified" | "healthy" | "degraded" | "unavailable";
  createdAt: string;
  updatedAt: string;
}

// --- Group rounds (spec §11) ---------------------------------------------------------

export type RoundStatus =
  | "draft" | "resolving_recipients" | "awaiting_consent" | "queued" | "running"
  | "paused_for_approval" | "partial" | "failed" | "cancelled" | "completed";

export const ROUND_TRANSITIONS: Record<RoundStatus, readonly RoundStatus[]> = {
  draft: ["resolving_recipients", "cancelled"],
  resolving_recipients: ["awaiting_consent", "queued", "cancelled", "failed"],
  awaiting_consent: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["paused_for_approval", "partial", "failed", "cancelled", "completed"],
  paused_for_approval: ["running", "cancelled", "failed"],
  partial: ["completed"],
  failed: [],
  cancelled: [],
  completed: [],
};

export interface BwGroupRound {
  id: string;
  conversationId: string;
  initiatingMessageId: string;
  orchestrationMode: OrchestrationMode;
  requestedAgentOrder: string[];
  resolvedAgentOrder: string[];
  status: RoundStatus;
  currentPosition: number;
  failurePolicy: FailurePolicy;
  stopReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Executions (spec §17) ---------------------------------------------------------------

export type ExecutionStatus =
  | "created" | "queued" | "starting" | "running" | "waiting_approval"
  | "cancelling" | "cancelled" | "failed" | "completed" | "orphaned";

export const EXECUTION_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  created: ["queued", "cancelled", "failed"],
  queued: ["starting", "cancelled", "failed"],
  starting: ["running", "failed", "cancelled", "orphaned"],
  running: ["waiting_approval", "cancelling", "cancelled", "failed", "completed", "orphaned"],
  waiting_approval: ["running", "cancelled", "failed"],
  cancelling: ["cancelled", "failed", "orphaned"],
  cancelled: [],
  failed: [],
  completed: [],
  orphaned: [],
};

export interface BwAgentExecution {
  id: string;
  groupRoundId: string | null;
  routineRunId: string | null;
  agentId: string;
  providerBindingId: string | null;
  runtimeBindingId: string | null;
  model: string | null;
  position: number | null;
  attempt: number;
  status: ExecutionStatus;
  inputSnapshotRef: string | null;
  outputMessageId: string | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BwExecutionEvent {
  id: string;
  executionId: string;
  sequence: number;
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

export type EventType =
  | "round.created" | "round.consent_required" | "round.started" | "round.cancel_requested"
  | "round.completed" | "round.partial" | "round.failed"
  | "execution.created" | "execution.queued" | "execution.started"
  | "execution.output.delta" | "execution.output.completed"
  | "execution.tool.started" | "execution.tool.completed" | "execution.tool.failed"
  | "execution.approval.requested" | "execution.approval.approved" | "execution.approval.denied"
  | "execution.cancel_requested" | "execution.cancelled" | "execution.failed" | "execution.completed"
  | "routine.run.created" | "routine.run.started" | "routine.run.completed"
  | "routine.run.failed" | "routine.run.cancelled"
  | "provider.degraded" | "runtime.started" | "runtime.stopped" | "runtime.crashed";

// --- Approvals (spec §14) --------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface BwApproval {
  id: string;
  workspaceId: string;
  executionId: string | null;
  requestedByAgentId: string | null;
  actionType: string;
  actionSummary: string;
  riskLevel: RiskLevel;
  actionFingerprint: string;
  requestPayloadRedactedJson: string;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled" | "consumed";
  decisionBy: string | null;
  decisionReason: string | null;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Routines (spec §15) --------------------------------------------------------------------------

export type RoutineTriggerType = "manual" | "interval" | "daily" | "webhook" | "event" | "connector_event" | "file_event";

export const SUPPORTED_TRIGGER_TYPES: readonly RoutineTriggerType[] = ["manual", "interval", "daily"];

export type RoutineConcurrencyPolicy = "skip_if_running" | "queue" | "replace" | "allow_parallel";

export interface BwRoutine {
  id: string;
  workspaceId: string;
  name: string;
  ownerAgentId: string | null;
  ownerTeamId: string | null;
  triggerType: RoutineTriggerType;
  triggerConfigJson: string;
  instructionTemplate: string;
  skillSlug: string | null;
  status: "draft" | "active" | "paused" | "disabled" | "archived";
  concurrencyPolicy: RoutineConcurrencyPolicy;
  approvalPolicyJson: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BwRoutineRun {
  id: string;
  routineId: string;
  triggerSource: string;
  status: "created" | "running" | "completed" | "failed" | "cancelled" | "skipped";
  rootExecutionId: string | null;
  idempotencyKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  createdAt: string;
}

// --- Errors (spec §18) ----------------------------------------------------------------------------------

export type BotWorkspaceErrorCode =
  | "AGENT_DISABLED" | "AGENT_CONFIG_INVALID" | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "MODEL_NOT_FOUND" | "RUNTIME_NOT_AVAILABLE"
  | "RUNTIME_CRASHED" | "CODEX_PROCESS_FAILED" | "CODEX_PROTOCOL_ERROR" | "TOOL_DENIED"
  | "APPROVAL_DENIED" | "APPROVAL_EXPIRED" | "EXECUTION_CANCELLED" | "CONTEXT_TOO_LARGE"
  | "ATTACHMENT_UNSUPPORTED" | "ROUTINE_CONFLICT" | "ROUTINE_DUPLICATE_EVENT" | "VALIDATION_FAILED"
  | "NOT_FOUND" | "UNKNOWN_ERROR";

export class BotWorkspaceError extends Error {
  readonly code: BotWorkspaceErrorCode;
  constructor(code: BotWorkspaceErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "BotWorkspaceError";
    this.code = code;
  }
}

// --- Validation (spec §7.1) ----------------------------------------------------------------------------------

export interface AgentValidationIssue {
  code: string;
  severity: "blocking" | "warning";
  message: string;
}

export interface AgentValidationResult {
  runnable: boolean;
  issues: AgentValidationIssue[];
}

// --- Provider adapter contract (spec §8) -------------------------------------------------------------------------

export interface ProviderCapabilities {
  streaming: boolean;
  systemPrompt: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  attachmentsText: boolean;
  attachmentsImage: boolean;
  reasoningControls: boolean;
  modelDiscovery: boolean;
  cancel: boolean;
  resume: boolean;
}

export interface GenerationRequest {
  executionId: string;
  agentInstructions: string | null;
  contextText: string;
  model: string | null;
  onDelta: (text: string) => void;
}

export interface GenerationResult {
  text: string;
  completed: boolean;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly runtimeType: RuntimeType;
  capabilities(): ProviderCapabilities;
  healthcheck(): Promise<{ status: "healthy" | "degraded" | "unavailable"; detail: string }>;
  startGeneration(request: GenerationRequest): Promise<GenerationResult>;
  cancelGeneration(executionId: string): boolean;
}

// --- Mention / context -----------------------------------------------------------------------------------------

export interface MentionMatch {
  agentId: string;
  agentName: string;
  token: string;
  startOffset: number;
  endOffset: number;
}
