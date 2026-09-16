// Phase 20.61 — Pao-hubPro × amux: Agent Runtime control plane.
//
// Pao-hubPro owns canonical task identity, policy, approval, evidence, audit
// and lifecycle state. amux (external Rust runtime, separately deployed) owns
// worker/session execution mechanics. amux-specific payloads stop at the
// adapter boundary (adapter/amux-adapter.ts) and never leak into this file.

export const AGENT_RUNTIME_POLICY_VERSION = "ar-1";

export type AgentRuntimeErrorCode =
  | "RUNTIME_UNAVAILABLE"
  | "RUNTIME_AUTH_FAILED"
  | "RUNTIME_UNSUPPORTED"
  | "RUNTIME_VERSION_MISMATCH"
  | "RUNTIME_TASK_NOT_FOUND"
  | "RUNTIME_CONFLICT"
  | "AGENT_POLICY_DENIED"
  | "AGENT_CLAIM_CONFLICT"
  | "AGENT_CLAIM_STALE"
  | "AGENT_APPROVAL_REQUIRED"
  | "AGENT_APPROVAL_STALE"
  | "AGENT_VERIFICATION_REQUIRED"
  | "AGENT_NOT_FOUND"
  | "AGENT_DUPLICATE_OPERATION"
  | "AGENT_INVALID_INPUT"
  | "AGENT_INVALID_TRANSITION"
  | "AGENT_DISABLED";

export class AgentRuntimeHttpError extends Error {
  readonly code: AgentRuntimeErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: AgentRuntimeErrorCode, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AgentRuntimeHttpError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Task state machine (spec §2). DONE != VERIFIED != APPROVED.

export type TaskStatus =
  | "draft"
  | "queued"
  | "claimed"
  | "running"
  | "done"
  | "verifying"
  | "verified"
  | "approval_required"
  | "approved"
  | "merged"
  | "deployed"
  | "closed"
  | "blocked"
  | "failed"
  | "recovering"
  | "rejected"
  | "cancelled";

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["closed", "cancelled", "deployed"]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

/** Allowed forward transitions. Rejections and retries route back to `queued`. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["claimed", "cancelled"],
  claimed: ["running", "queued", "cancelled"],
  running: ["done", "blocked", "failed", "recovering", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  failed: ["queued", "cancelled"],
  recovering: ["running", "failed", "cancelled"],
  done: ["verifying", "cancelled"],
  verifying: ["verified", "rejected", "cancelled"],
  rejected: ["queued", "cancelled"],
  verified: ["approval_required", "approved", "cancelled"],
  approval_required: ["approved", "rejected", "cancelled"],
  approved: ["merged", "deployed", "closed", "cancelled"],
  merged: ["deployed", "closed", "cancelled"],
  deployed: ["closed"],
  closed: [],
  cancelled: [],
};

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw new AgentRuntimeHttpError(
      "AGENT_INVALID_TRANSITION",
      409,
      `invalid task transition ${from} -> ${to}`,
      { from, to },
    );
  }
}

// ---------------------------------------------------------------------------
// Workers

export type WorkerRole =
  | "planner"
  | "implementer"
  | "tester"
  | "reviewer"
  | "recovery-controller"
  | "release-controller";

export const WORKER_ROLES: readonly WorkerRole[] = [
  "planner", "implementer", "tester", "reviewer", "recovery-controller", "release-controller",
];

export type WorkerCapability =
  | "repo.read"
  | "repo.write_scoped"
  | "command.safe_dev"
  | "command.test"
  | "command.readonly_git"
  | "command.write_git"
  | "diff.review"
  | "test.read"
  | "evidence.read"
  | "secret.access"
  | "network.access"
  | "approval.decide";

export interface AgentWorkerConfig {
  id: string;
  name: string;
  provider: string;
  roles: WorkerRole[];
  capabilities: WorkerCapability[];
  maxConcurrency: number;
  status: "unknown" | "online" | "offline";
  runtimeWorkerId: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tasks / claims / checkpoints

export interface TaskCheckpoint {
  status: string;
  summary: string;
  completedSteps: string[];
  nextStep: string | null;
  changedFiles: string[];
  commandsRun: string[];
  evidenceIds: string[];
  blockers: string[];
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  priority: number;
  role: WorkerRole;
  claimOwner: string | null;
  claimToken: string | null;
  claimVersion: number;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  attempt: number;
  maxAttempts: number;
  runtimeProvider: string | null;
  runtimeTaskId: string | null;
  runtimeSessionId: string | null;
  policyProfile: string;
  requiresHumanApproval: boolean;
  repoRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  checkpoint: TaskCheckpoint;
  createdByType: "human" | "agent" | "system";
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  role?: WorkerRole;
  parentTaskId?: string | null;
  priority?: number;
  maxAttempts?: number;
  policyProfile?: string;
  requiresHumanApproval?: boolean;
  repoRoot?: string | null;
  actorType?: "human" | "agent" | "system";
  actorId?: string;
}

// ---------------------------------------------------------------------------
// Evidence / verification

export type EvidenceType =
  | "diff"
  | "commit"
  | "test_report"
  | "lint_report"
  | "typecheck_report"
  | "build_report"
  | "security_report"
  | "worker_transcript"
  | "runtime_log"
  | "screenshot"
  | "artifact"
  | "review_report";

export interface TaskEvidence {
  id: string;
  taskId: string;
  evidenceType: EvidenceType;
  uri: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface VerifierOutput {
  verdict: "pass" | "fail" | "needs_changes";
  requirements: Array<{ id: string; status: "pass" | "fail" | "unverified"; evidence: string[] }>;
  risks: string[];
  regressions: string[];
  recommendedAction: "approve" | "rework" | "manual_review";
  verifierId: string;
  reviewedAt: string;
}

// ---------------------------------------------------------------------------
// Approvals

export type ApprovalStatus = "pending" | "approved" | "rejected" | "stale";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  action: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** Approval binds to this hash; payload changes invalidate it (spec §11). */
  payloadHash: string;
}

// ---------------------------------------------------------------------------
// Events (spec §16)

export type AgentRuntimeEventType =
  | "task.created"
  | "task.claimed"
  | "task.started"
  | "task.heartbeat"
  | "task.done"
  | "task.failed"
  | "task.blocked"
  | "session.created"
  | "session.started"
  | "session.suspect"
  | "session.recovered"
  | "session.stopped"
  | "evidence.created"
  | "verification.started"
  | "verification.passed"
  | "verification.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "policy.allowed"
  | "policy.denied"
  | "security.alert";

export interface AgentRuntimeEvent {
  id: string;
  eventType: AgentRuntimeEventType;
  taskId: string | null;
  sessionId: string | null;
  source: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Execution gateway request (spec §10)

export interface ExecutionRequest {
  taskId: string;
  workerId: string;
  commandClass: CommandClass;
  argv: string[];
  cwdRelative?: string;
  paths?: string[];
  network?: boolean;
  secretAccess?: boolean;
}

export type CommandClass =
  | "command.safe_dev"
  | "command.test"
  | "command.readonly_git"
  | "command.write_git"
  | "command.package_install"
  | "command.network"
  | "command.secret"
  | "command.dangerous";

export interface ExecutionDecision {
  effect: "allow" | "deny" | "require_approval";
  ruleResults: Array<{ ruleId: string; effect: "allow" | "deny" | "require_approval"; reason: string }>;
}
