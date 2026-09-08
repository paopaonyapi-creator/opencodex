// Domain types and contracts for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

export type DeviceType = "emulator" | "physical_test" | "physical_personal" | "physical_restricted";

export type TrustLevel = "test" | "trusted" | "restricted" | "blocked";

export type DeviceStatus = "ready" | "busy" | "offline" | "disabled" | "error";

export interface MobileDevice {
  id: string;
  alias: string;
  provider: string; // e.g. "artemis"
  providerDeviceId: string; // Raw serial or IP e.g. "emulator-5554"
  deviceType: DeviceType;
  trustLevel: TrustLevel;
  status: DeviceStatus;
  allowAgent: boolean;
  allowShell: boolean;
  requiresApproval: boolean;
  labels: string[];
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export type MobileTaskStatus =
  | "NEW"
  | "VALIDATING"
  | "CLASSIFYING_RISK"
  | "WAITING_APPROVAL"
  | "QUEUED"
  | "RUNNING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "REJECTED"
  | "BLOCKED_BY_POLICY"
  | "DEVICE_OFFLINE"
  | "PROVIDER_ERROR";

export type TaskProfile = "auto" | "flash" | "pro";

export type VerificationLevel = "off" | "final" | "checkpoints" | "strict";

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export type PolicyDecision = "ALLOW" | "WAITING_APPROVAL" | "DENY";

export interface MobileTask {
  id: string;
  deviceId: string;
  goal: string;
  profile: TaskProfile;
  resolvedProfile?: "flash" | "pro";
  verificationLevel: VerificationLevel;
  riskLevel: RiskLevel;
  status: MobileTaskStatus;
  providerTaskId?: string;
  traceId?: string;
  requestedByType: string; // "agent" | "user" | "api"
  requestedById: string;   // e.g. "codex"
  approvedBy?: string;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MobileTaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface MobileArtifact {
  id: string;
  taskId: string;
  artifactType: "screenshot" | "trace" | "hierarchy" | "report";
  storageKey: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export interface PolicyDecisionRecord {
  id: string;
  taskId: string;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  ruleId: string;
  reason: string;
  createdAt: number;
}

export interface DeviceState {
  deviceId: string;
  provider: string;
  providerDeviceSerial: string;
  online: boolean;
  screen?: {
    width: number;
    height: number;
    orientation: "portrait" | "landscape";
  };
  foregroundApp?: string;
  screenshotBase64?: string;
  hierarchyJson?: string;
  capturedAt: number;
}

export interface TraceStep {
  step: number;
  actionType: "tap" | "swipe" | "input" | "key" | "scroll" | "wait" | "inspect";
  target?: {
    strategy: "resource_id" | "accessibility" | "text" | "ocr" | "region" | "coordinates";
    value: string;
  };
  inputPayload?: string;
  result: "success" | "failure" | "timeout";
  screenshotBefore?: string;
  screenshotAfter?: string;
  timestamp: number;
}

export interface MobileTrace {
  traceId: string;
  taskId: string;
  deviceId: string;
  steps: TraceStep[];
  checkerResults?: Array<{ name: string; pass: boolean; details?: string }>;
  errors?: string[];
  finalReport?: string;
  createdAt: number;
}

export interface ReviewerEvaluation {
  decision: "PASS" | "FAIL" | "NEEDS_REVIEW";
  confidence: number;
  goalComplete: boolean;
  safetyOk: boolean;
  evidenceOk: boolean;
  issues: string[];
  evaluatedAt: number;
}

export interface RunTaskInput {
  goal: string;
  deviceId?: string; // Logical alias or device ID
  profile?: TaskProfile;
  verificationLevel?: VerificationLevel;
  timeoutSec?: number;
  requestedByType?: string;
  requestedById?: string;
}

export interface RegisterDeviceInput {
  alias: string;
  provider?: string;
  providerDeviceId: string;
  deviceType?: DeviceType;
  trustLevel?: TrustLevel;
  allowAgent?: boolean;
  allowShell?: boolean;
  requiresApproval?: boolean;
  labels?: string[];
}
