// Phase 20.3 — Desktop Vision Control MCP × Local Realtime Agent
//
// Canonical domain types for the Desktop Agent subsystem.
// Covers sessions, goals, steps, observations, actions, skills,
// profiles, policies, events, and all supporting enums.

// ─── Session Status ─────────────────────────────────────────────────
export type SessionStatus =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "WAITING_APPROVAL"
  | "BLOCKED"
  | "STOPPING"
  | "STOPPED"
  | "FAILED"
  | "COMPLETED"
  | "EMERGENCY_STOPPED";

// ─── Goal Status ────────────────────────────────────────────────────
export type GoalStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "VERIFYING"
  | "WAITING_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

// ─── Execution Modes ────────────────────────────────────────────────
export type ExecutionMode =
  | "OBSERVE_ONLY"
  | "ASSISTED"
  | "AUTONOMOUS_SAFE"
  | "MANUAL_CONTROL";

// ─── Risk Levels ────────────────────────────────────────────────────
export type DesktopRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ─── Control Priority Ladder ────────────────────────────────────────
export type ControlTier =
  | "DIRECT_API"      // Tier 0
  | "MCP_TOOL"        // Tier 1
  | "UIA"             // Tier 2
  | "VISION"          // Tier 3
  | "OCR"             // Tier 4
  | "RELATIVE_COORD"  // Tier 5
  | "ABSOLUTE_COORD"; // Tier 6

// ─── Action Types ───────────────────────────────────────────────────
export type ActionType =
  | "APP_LAUNCH"
  | "APP_FOCUS"
  | "WINDOW_FOCUS"
  | "WINDOW_MAXIMIZE"
  | "WINDOW_MINIMIZE"
  | "WINDOW_RESTORE"
  | "UIA_INVOKE"
  | "UIA_SELECT"
  | "UIA_SET_VALUE"
  | "UIA_EXPAND"
  | "UIA_COLLAPSE"
  | "MOUSE_MOVE"
  | "MOUSE_CLICK"
  | "MOUSE_DOUBLE_CLICK"
  | "MOUSE_DRAG"
  | "MOUSE_SCROLL"
  | "KEY_PRESS"
  | "KEY_COMBINATION"
  | "TEXT_TYPE"
  | "WAIT_FOR_STATE"
  | "WAIT_FOR_ELEMENT"
  | "WAIT_FOR_SCREEN_CHANGE"
  | "SCREEN_CAPTURE"
  | "READ_WINDOW_STATE"
  | "PAUSE"
  | "STOP";

// ─── Action Result Status ───────────────────────────────────────────
export type ActionResultStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYABLE"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "STALE_OBSERVATION"
  | "FOREGROUND_MISMATCH"
  | "POLICY_DENIED"
  | "TIMEOUT"
  | "CANCELLED";

// ─── Health Status ──────────────────────────────────────────────────
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "EMERGENCY_STOPPED";

// ─── Skill Lifecycle ────────────────────────────────────────────────
export type SkillLifecycle =
  | "DRAFT"
  | "VALIDATED"
  | "TESTED"
  | "APPROVED"
  | "ENABLED"
  | "DEPRECATED"
  | "DISABLED";

// ─── Skill Determinism ──────────────────────────────────────────────
export type SkillDeterminism =
  | "DETERMINISTIC"
  | "MOSTLY_DETERMINISTIC"
  | "VISION_ASSISTED"
  | "EXPERIMENTAL";

// ─── Retry Class ────────────────────────────────────────────────────
export type RetryClass =
  | "SAFE_RETRY"
  | "REOBSERVE_THEN_RETRY"
  | "REFOCUS_THEN_RETRY"
  | "REPLAN"
  | "NO_RETRY";

// ─── Profile Match Confidence ───────────────────────────────────────
export type ProfileConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

// ─── Error Codes ────────────────────────────────────────────────────
export type DesktopErrorCode =
  | "AGENT_OFFLINE"
  | "CAPABILITY_UNAVAILABLE"
  | "PROFILE_NOT_MATCHED"
  | "WINDOW_NOT_FOUND"
  | "FOREGROUND_MISMATCH"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_AMBIGUOUS"
  | "STALE_OBSERVATION"
  | "ACTION_DENIED"
  | "APPROVAL_REQUIRED"
  | "INPUT_FAILED"
  | "CAPTURE_FAILED"
  | "UIA_FAILED"
  | "VERIFICATION_FAILED"
  | "TIMEOUT"
  | "EMERGENCY_STOPPED"
  | "RECOVERY_REQUIRED"
  | "UNKNOWN_STATE";

// ─── Evidence Types ─────────────────────────────────────────────────
export type EvidenceType =
  | "WINDOW_STATE"
  | "UIA_STATE"
  | "SCREEN_REGION"
  | "API_RESPONSE"
  | "FILE_STATE"
  | "JOB_STATE"
  | "LOG_EVENT";

// ─── Audit Event Kinds ──────────────────────────────────────────────
export type DesktopEventKind =
  | "desktop.session.created"
  | "desktop.session.started"
  | "desktop.session.paused"
  | "desktop.session.resumed"
  | "desktop.session.stopped"
  | "desktop.emergency_stop"
  | "desktop.goal.created"
  | "desktop.goal.started"
  | "desktop.goal.completed"
  | "desktop.goal.failed"
  | "desktop.observe"
  | "desktop.action.planned"
  | "desktop.action.allowed"
  | "desktop.action.denied"
  | "desktop.action.executed"
  | "desktop.action.failed"
  | "desktop.action.verified"
  | "desktop.approval.requested"
  | "desktop.approval.approved"
  | "desktop.approval.denied"
  | "desktop.foreground.mismatch"
  | "desktop.profile.changed"
  | "desktop.unknown_state"
  | "desktop.recovery.started"
  | "desktop.recovery.completed";

// ─── Agent Capabilities ─────────────────────────────────────────────
export type AgentCapability =
  | "capture.window"
  | "capture.monitor"
  | "uia.read"
  | "uia.invoke"
  | "input.mouse"
  | "input.keyboard"
  | "hotkey.emergency"
  | "vision.locator"
  | "ocr";

// ─── Domain Objects ─────────────────────────────────────────────────

export interface DesktopSession {
  id: string;
  ownerUserId: string;
  machineId: string;
  status: SessionStatus;
  mode: ExecutionMode;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  currentGoalId: string | null;
  currentAppProfileId: string | null;
  foregroundWindowId: string | null;
  emergencyStopped: boolean;
  dryRun: boolean;
  policyProfile: string;
  lastHeartbeatAt: string | null;
  metadata: Record<string, unknown>;
}

export interface DesktopGoal {
  id: string;
  sessionId: string;
  goalType: string;
  title: string;
  description: string;
  argumentsJson: Record<string, unknown>;
  constraintsJson: Record<string, unknown>;
  riskLevel: DesktopRiskLevel;
  status: GoalStatus;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
}

export interface DesktopStep {
  id: string;
  goalId: string;
  sessionId: string;
  stepIndex: number;
  skillRunId: string | null;
  actionType: ActionType;
  target: string | null;
  status: ActionResultStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: DesktopErrorCode | null;
  errorMessage: string | null;
}

export interface WindowSnapshot {
  windowId: string;
  processId: number;
  processName: string;
  title: string;
  className: string;
  bounds: { x: number; y: number; width: number; height: number };
  clientBounds: { x: number; y: number; width: number; height: number };
  monitorId: string;
  dpi: number;
  isVisible: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isForeground: boolean;
  isAllowed: boolean;
  capturedAt: string;
}

export interface UIElementSnapshot {
  elementId: string;
  automationId: string | null;
  controlType: string;
  name: string;
  valueRedacted: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  enabled: boolean;
  visible: boolean;
  focused: boolean;
  keyboardFocusable: boolean;
  invokeSupported: boolean;
  selectionSupported: boolean;
  textSupported: boolean;
  ancestorPath: string[];
  confidence: number;
}

export interface ObservationSnapshot {
  snapshotId: string;
  sessionId: string;
  capturedAt: string;
  displayTopologyHash: string;
  foregroundWindow: WindowSnapshot | null;
  visibleWindows: WindowSnapshot[];
  uiaTreeHash: string | null;
  screenHash: string | null;
  changeScore: number;
  ocrSummary: string | null;
  visionSummary: string | null;
  redactionApplied: boolean;
}

export interface VisionMatch {
  candidateBounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  semanticLabel: string;
  frameId: string;
}

export interface ActionRequest {
  actionId: string;
  sessionId: string;
  goalId: string | null;
  stepId: string | null;
  actionType: ActionType;
  target: string | null;
  arguments: Record<string, unknown>;
  riskLevel: DesktopRiskLevel;
  requiresApproval: boolean;
  expectedPostcondition: string | null;
  timeoutMs: number;
  retryPolicy: RetryClass;
  idempotencyKey: string | null;
}

export interface ActionAttempt {
  attemptId: string;
  actionId: string;
  startedAt: string;
  endedAt: string | null;
  status: ActionResultStatus;
  methodUsed: ControlTier;
  targetResolved: string | null;
  preconditionResult: boolean | null;
  executionResult: string | null;
  postconditionResult: boolean | null;
  errorCode: DesktopErrorCode | null;
  errorMessage: string | null;
  evidenceRefs: string[];
}

export interface ActionResult {
  actionId: string;
  status: ActionResultStatus;
  methodUsed: ControlTier;
  attempts: ActionAttempt[];
  finalEvidence: string[];
}

export interface VerificationResult {
  verified: boolean;
  method: string;
  evidence: string | null;
  confidence: number;
  details: string;
}

// ─── Application Profile ────────────────────────────────────────────

export interface ProcessMatch {
  processNames: string[];
  executablePaths?: string[];
}

export interface WindowMatch {
  titleContains?: string[];
  titleRegex?: string;
  className?: string;
}

export interface ProfileSecurity {
  allowInput: boolean;
  allowClipboard: boolean;
  destructiveActionsRequireApproval: boolean;
}

export interface ProfileState {
  id: string;
  label?: string;
}

export interface ApplicationProfile {
  id: string;
  displayName: string;
  version: number;
  processMatch: ProcessMatch;
  windowMatch: WindowMatch;
  security: ProfileSecurity;
  states: ProfileState[];
  skills: string[];
  enabled: boolean;
}

// ─── Skill Definition ───────────────────────────────────────────────

export interface SkillLocator {
  type: "automation_id" | "name" | "control_type" | "vision" | "ocr" | "relative_coord";
  value: string;
  fallback?: SkillLocator;
}

export interface SkillStepDef {
  stepId: string;
  action: ActionType | string;
  locator?: SkillLocator;
  arguments?: Record<string, unknown>;
  preconditions?: string[];
  postconditions?: string[];
  timeoutMs?: number;
  retryClass?: RetryClass;
  fallback?: SkillStepDef;
  riskLevel?: DesktopRiskLevel;
  requiresApproval?: boolean;
  onFailure?: "stop" | "skip" | "retry" | "fallback";
}

export interface SkillArgDef {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface SkillDefinition {
  id: string;
  profileId: string;
  version: number;
  displayName: string;
  description: string;
  arguments: SkillArgDef[];
  preconditions: string[];
  postconditions: string[];
  steps: SkillStepDef[];
  riskLevel: DesktopRiskLevel;
  determinism: SkillDeterminism;
  requiredCapabilities: AgentCapability[];
  fallbackCapabilities?: AgentCapability[];
  lifecycle: SkillLifecycle;
  timeoutSeconds: number;
}

export interface SkillRun {
  id: string;
  sessionId: string;
  goalId: string | null;
  profileId: string;
  profileVersion: number;
  skillId: string;
  skillVersion: number;
  agentVersion: string;
  protocolVersion: string;
  policyVersion: string;
  arguments: Record<string, unknown>;
  mode: ExecutionMode;
  dryRun: boolean;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  currentStepIndex: number;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: DesktopErrorCode | null;
  errorMessage: string | null;
  evidenceRefs: string[];
}

// ─── Desktop Policy ─────────────────────────────────────────────────

export interface DesktopPolicy {
  allowedApps: string[];
  deniedApps: string[];
  approvedExecutablePaths: string[];
  allowedTitlePatterns: string[];
  deniedTitlePatterns: string[];
  sensitiveWindowPatterns: string[];
  maxActionsPerSecond: number;
  maxClicksPerSecond: number;
  maxRetriesPerStep: number;
  actionTimeoutMs: number;
  skillTimeoutSeconds: number;
  goalTimeoutSeconds: number;
  frameMaxAgeMs: number;
  approvalMode: "always" | "high_risk_only" | "critical_only" | "never";
  emergencyHotkey: string;
}

// ─── Desktop Approval ───────────────────────────────────────────────

export interface DesktopApproval {
  id: string;
  sessionId: string;
  goalId: string | null;
  actionId: string | null;
  riskLevel: DesktopRiskLevel;
  reason: string;
  preview: string;
  actionFingerprint: string;
  windowFingerprint: string;
  stateFingerprint: string;
  requestedAt: string;
  expiresAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  decision: "pending" | "approved" | "denied" | "expired" | "stale";
}

// ─── Desktop Evidence ───────────────────────────────────────────────

export interface DesktopEvidence {
  id: string;
  sessionId: string;
  type: EvidenceType;
  capturedAt: string;
  source: string;
  summary: string;
  redacted: boolean;
  hash: string;
  artifactRef: string | null;
}

// ─── Agent Heartbeat ────────────────────────────────────────────────

export interface AgentHeartbeat {
  agentId: string;
  version: string;
  protocolVersion: string;
  machineId: string;
  sessionId: string | null;
  status: HealthStatus;
  foregroundProfile: string | null;
  captureHealth: HealthStatus;
  uiaHealth: HealthStatus;
  inputHealth: HealthStatus;
  emergencyStop: boolean;
  capabilities: AgentCapability[];
  timestamp: string;
}

// ─── Agent State (Working Memory) ───────────────────────────────────

export interface AgentState {
  currentApp: string | null;
  currentProfile: string | null;
  currentWindow: WindowSnapshot | null;
  currentProfileState: string | null;
  lastAction: ActionResult | null;
  lastSuccessfulLocator: SkillLocator | null;
  lastFailedLocator: SkillLocator | null;
  modalDialog: boolean;
  pendingApproval: string | null;
  goalProgress: number;
  retryCounts: Record<string, number>;
}

// ─── Desktop Telemetry ──────────────────────────────────────────────

export interface DesktopTelemetry {
  activeSessions: number;
  actionsTotal: number;
  actionsFailed: number;
  actionsDenied: number;
  verificationFailures: number;
  foregroundMismatches: number;
  emergencyStops: number;
  skillSuccessRate: number;
  locatorSuccessRate: number;
  uiaResolutionRate: number;
  visionFallbackRate: number;
  averageActionLatencyMs: number;
  averageGoalDurationMs: number;
  captureFps: number;
  captureLatencyMs: number;
}

// ─── Protocol Types ─────────────────────────────────────────────────

export interface ProtocolHandshake {
  protocolVersion: string;
  agentVersion: string;
  capabilities: AgentCapability[];
  machineId: string;
}

export interface ProtocolMessage {
  type: string;
  id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────

export const DESKTOP_AGENT_VERSION = "20.3.0";
export const DESKTOP_PROTOCOL_VERSION = "1.0";
export const DEFAULT_EMERGENCY_HOTKEY = "Ctrl+Alt+Pause";
export const DEFAULT_FRAME_MAX_AGE_MS = 2000;
export const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
export const DEFAULT_SKILL_TIMEOUT_SECONDS = 120;
export const DEFAULT_GOAL_TIMEOUT_SECONDS = 600;
export const DEFAULT_MAX_ACTIONS_PER_SECOND = 5;
export const DEFAULT_MAX_CLICKS_PER_SECOND = 3;
export const DEFAULT_MAX_RETRIES_PER_STEP = 3;
