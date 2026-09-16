// Phase 20.27 — Agent Cockpit & Production Readiness Control Plane models.
//
// EXTENDS the Phase 20.16 control plane (task envelopes, policy engine,
// reviewer consensus) rather than replacing it: an agent session maps onto a
// task envelope, and the Phase 20.16 policy engine stays the single
// authorization gate. VibeRaven is reference inspiration + an optional
// feature-flagged external evidence adapter — never the control plane owner.

import { randomUUID } from "node:crypto";

// --- Access modes & risk ------------------------------------------------------

export type AccessMode = "ask" | "approve" | "full";

/**
 * Risk ladder per the Phase 20.27 spec (doc §21). Mapped onto the Phase 20.16
 * L0-L3 task ceilings in access-policy.ts — one mapping, one place.
 */
export const CONTROL_RISKS = ["R0", "R1", "R2", "R3", "R4", "R5"] as const;
export type ControlRisk = (typeof CONTROL_RISKS)[number];

export function controlRiskRank(risk: ControlRisk): number {
  return CONTROL_RISKS.indexOf(risk);
}

// --- Command classification (doc §24) -----------------------------------------

export type CommandClass =
  | "read_only" | "build_test" | "write_local" | "network_read" | "network_write"
  | "package_install" | "git_write" | "git_remote" | "process_control"
  | "system_admin" | "destructive" | "unknown";

// --- Agent cockpit --------------------------------------------------------------

export type AgentType = "codex" | "claude" | "gemini" | "generic_cli";

export interface AgentDetection {
  type: AgentType;
  detected: boolean;
  binary?: string;
  version?: string;
  reason?: string;
}

export interface AgentCapabilities {
  chat: boolean;
  readFiles: boolean;
  writeFiles: boolean;
  runCommands: boolean;
  git: boolean;
  review: boolean;
}

export interface AgentProfile {
  id: string;
  type: AgentType;
  displayName: string;
  transport: "cli";
  status: "ready" | "unavailable" | "degraded";
  version?: string;
  accessMode: AccessMode;
  policyProfile: string;
  capabilities: AgentCapabilities;
  workspaceScope: string;
  lastHealthCheckAt?: string;
  reason?: string;
}

export type SessionStatus = "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface AgentSession {
  id: string;
  agentId: string;
  agentType: AgentType;
  accessMode: AccessMode;
  policyProfile: string;
  workspaceScope: string;
  taskId?: string;
  contextSnapshotId?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export type AgentEventType =
  | "session.started" | "message.user" | "message.agent"
  | "tool.requested" | "approval.required" | "approval.resolved"
  | "tool.started" | "tool.output" | "tool.completed"
  | "command.started" | "command.completed"
  | "session.completed" | "session.failed" | "session.cancelled";

export interface AgentEvent {
  id: string;
  sessionId: string;
  sequence: number;
  eventType: AgentEventType;
  payloadSummary: string;
  risk?: ControlRisk;
  createdAt: string;
}

export interface CommandSpec {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

/**
 * Adapter contract (doc §14). Adapters translate agent-specific mechanics;
 * the control plane owns permissions, sessions, audit, and evidence.
 */
export interface AgentAdapter {
  readonly type: AgentType;
  readonly displayName: string;
  readonly defaultBinary: string;
  detect(): AgentDetection;
  capabilities(): AgentCapabilities;
  buildCommand(input: { prompt: string; workspaceScope: string }): CommandSpec;
  /** Optional bounded --version probe for the doctor (doc §121). */
  probeVersion?(): Promise<string | undefined>;
}

// --- Policy decisions --------------------------------------------------------------

export type CockpitDecision = "allow" | "require_approval" | "deny";

export interface CockpitAction {
  actor: string;
  agentType?: AgentType;
  sessionId?: string;
  action:
    | "fs.read" | "fs.write" | "fs.delete"
    | "cmd.run" | "git.write" | "git.remote"
    | "network.call" | "package.install"
    | "secret.read" | "deploy"
    | "policy.manage" | "session.control";
  resource?: string;
  commandText?: string;
  commandClass?: CommandClass;
  workspaceRoot: string;
  accessMode: AccessMode;
  policyProfile: string;
}

export interface CockpitPolicyResult {
  decision: CockpitDecision;
  risk: ControlRisk;
  reason: string;
  policyIds: string[];
  approvalScope: "once" | "session" | "task" | "workspace" | "policy_rule";
}

// --- Approvals ----------------------------------------------------------------------

export type ApprovalScope = "once" | "session" | "task" | "workspace" | "policy_rule";

export interface CockpitApproval {
  id: string;
  action: string;
  agentId?: string;
  sessionId?: string;
  resource: string;
  risk: ControlRisk;
  reason: string;
  preview: string;
  scope: ApprovalScope;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: string;
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: string;
}

// --- Context plane ----------------------------------------------------------------------

export interface ContextSnapshot {
  id: string;
  schemaVersion: 1;
  gitSha?: string;
  branch?: string;
  policyHash: string;
  attachments: Array<{ kind: string; ref: string }>;
  createdAt: string;
  fresh: boolean;
}

// --- Providers ------------------------------------------------------------------------------

export type ProviderStatus =
  | "not_detected" | "detected" | "configured" | "verification_required"
  | "verified" | "degraded" | "failed" | "unknown";

export interface ProviderState {
  id: string;
  name: string;
  status: ProviderStatus;
  detectionEvidence: string;
  credentialConfigured: boolean;
  runtimeVerified: boolean;
  lastVerifiedAt?: string;
  verificationExpiresAt?: string;
}

// --- Evidence ledger ----------------------------------------------------------------------------

export type EvidenceType =
  | "file_line" | "git_diff" | "test_result" | "command_result"
  | "provider_verification" | "schema_check" | "config_check"
  | "runtime_probe" | "reviewer_finding" | "human_attestation"
  | "external_adapter" | "verification_missing";

export interface EvidenceRecord {
  id: string;
  type: EvidenceType;
  source: string;
  hash: string;
  summary: string;
  gitSha?: string;
  contextSnapshotId?: string;
  createdAt: string;
  expiresAt?: string;
}

// --- Readiness gate ---------------------------------------------------------------------------------

export type GateVerdict = "clear" | "warning" | "blocked" | "unknown";
export type GateSeverity = "info" | "warning" | "blocker" | "critical";
export type GateProfile = "dev" | "pre_commit" | "pull_request" | "staging" | "production" | "strict_production";

export interface GateFinding {
  id: string;
  ruleId: string;
  severity: GateSeverity;
  title: string;
  status: "open" | "resolved" | "not_applicable";
  evidence: Array<{ type: EvidenceType; ref?: string; summary: string }>;
  suggestedActions: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GateRun {
  id: string;
  profile: GateProfile;
  verdict: GateVerdict;
  exitCode: 0 | 1 | 2 | 3;
  findings: GateFinding[];
  gitSha?: string;
  overriddenFindingIds: string[];
  createdAt: string;
}

/** Stable CLI exit-code contract (doc §149). */
export const GATE_EXIT_CODES = {
  0: "clear or policy-allowed warnings",
  1: "blocked",
  2: "execution/config error",
  3: "required verification unavailable",
} as const;

// --- Release marks -----------------------------------------------------------------------------------

export interface ReleaseMark {
  sha: string;
  state: "known_good" | "known_bad" | "unknown";
  markedBy: string;
  reason?: string;
  createdAt: string;
}

// --- Reviewer bridge ------------------------------------------------------------------------------------

export interface ReviewFinding {
  reviewer: string;
  verdict: "pass" | "pass_with_warning" | "changes_required";
  confidence: number;
  severity: GateSeverity;
  title: string;
  needsVerification: boolean;
  evidenceRefs: string[];
  model?: string;
}

export interface ReviewRun {
  id: string;
  contextSnapshotId?: string;
  diffSummary: string;
  findings: ReviewFinding[];
  disagreements: string[];
  createdAt: string;
}

// --- Control tasks ------------------------------------------------------------------------------------------

export interface CockpitTask {
  id: string;
  title: string;
  ownerAgentId?: string;
  workspaceScope: string;
  risk: ControlRisk;
  status: "planned" | "ready" | "running" | "blocked" | "waiting_approval" | "reviewing" | "changes_required" | "ready_to_merge" | "completed" | "failed" | "cancelled";
  requiredGateProfile: GateProfile;
  contextSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
}

export function newCockpitId(prefix: string): string {
  return prefix + "_" + randomUUID().slice(0, 12);
}
