// Phase 20.98 — OpenHermit durable multi-agent fleet runtime (canonical types).
//
// Ownership model (spec §1): Pao-hubPro is the platform authority — identity,
// policy, approval, credentials, skills, MCP governance, audit. OpenHermit is a
// REPLACEABLE durable agent runtime behind the HermitRuntimeProvider adapter.
// Nothing outside src/agent-os/openhermit may depend on OpenHermit raw API
// shapes; everything crosses this boundary as the normalized types below.

/** Normalized runtime health (spec §4). */
export type HermitHealth = "healthy" | "degraded" | "unhealthy" | "unknown";

/** Risk classes (spec §14): R0 low-risk read … R4 destructive/financial/security-critical. */
export type RiskClass = "R0" | "R1" | "R2" | "R3" | "R4";

export const RISK_ORDER: Record<RiskClass, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export function riskAtLeast(a: RiskClass, b: RiskClass): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

export function maxRisk(a: RiskClass, b: RiskClass): RiskClass {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/** Normalized policy outcomes (spec §13). Deny always overrides allow. */
export type PolicyOutcome = "allow" | "deny" | "require_approval" | "allow_with_constraints";

export interface PolicyDecision {
  outcome: PolicyOutcome;
  ruleId: string;
  reason: string;
  constraints?: string[];
}

// ---------------------------------------------------------------------------
// Typed errors (fail closed, normalized across the adapter boundary)
// ---------------------------------------------------------------------------

export type HermitErrorCode =
  | "DISABLED"
  | "HERMIT_UNAVAILABLE"
  | "HERMIT_CAPABILITY_UNAVAILABLE"
  | "HERMIT_TIMEOUT"
  | "HERMIT_BAD_RESPONSE"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_CONSUMED"
  | "APPROVAL_ACTION_CHANGED"
  | "AGENT_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "OPERATION_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "RESEARCH_NOT_FOUND"
  | "RESEARCH_PLAN_REQUIRED"
  | "RESEARCH_PLAN_NOT_APPROVED"
  | "RESEARCH_BUDGET_EXHAUSTED"
  | "RESEARCH_PROVIDER_UNAVAILABLE"
  | "RESEARCH_CITATION_UNVERIFIED"
  | "SANDBOX_POLICY_VIOLATION"
  | "SANDBOX_PROVIDER_UNCONFIGURED"
  | "SANDBOX_EXPORT_DENIED"
  | "CREDENTIAL_DENIED"
  | "FLEET_APPROVAL_REQUIRED"
  | "INVALID_INPUT"
  | "INTERNAL";

export class HermitError extends Error {
  readonly code: HermitErrorCode;
  readonly httpStatus: number;
  readonly detail?: Record<string, unknown>;

  constructor(code: HermitErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "HermitError";
    this.code = code;
    this.httpStatus = HermitError.httpStatusFor(code);
    this.detail = detail;
  }

  static httpStatusFor(code: HermitErrorCode): number {
    switch (code) {
      case "DISABLED":
        return 403;
      case "POLICY_DENIED":
      case "APPROVAL_REQUIRED":
      case "CREDENTIAL_DENIED":
      case "FLEET_APPROVAL_REQUIRED":
      case "SANDBOX_POLICY_VIOLATION":
      case "SANDBOX_EXPORT_DENIED":
        return 403;
      case "APPROVAL_NOT_FOUND":
      case "AGENT_NOT_FOUND":
      case "SESSION_NOT_FOUND":
      case "OPERATION_NOT_FOUND":
      case "RESEARCH_NOT_FOUND":
        return 404;
      case "HERMIT_UNAVAILABLE":
      case "HERMIT_CAPABILITY_UNAVAILABLE":
      case "HERMIT_TIMEOUT":
      case "HERMIT_BAD_RESPONSE":
      case "RESEARCH_PROVIDER_UNAVAILABLE":
      case "SANDBOX_PROVIDER_UNCONFIGURED":
        return 503;
      case "APPROVAL_NOT_APPROVED":
      case "APPROVAL_EXPIRED":
      case "APPROVAL_ALREADY_CONSUMED":
      case "APPROVAL_ACTION_CHANGED":
      case "RESEARCH_PLAN_REQUIRED":
      case "RESEARCH_PLAN_NOT_APPROVED":
      case "RESEARCH_BUDGET_EXHAUSTED":
      case "RESEARCH_CITATION_UNVERIFIED":
      case "IDEMPOTENCY_CONFLICT":
      case "INVALID_INPUT":
        return 409;
      default:
        return 500;
    }
  }
}

// ---------------------------------------------------------------------------
// Agents (stable Pao IDs, independent of the runtime ID — spec §5)
// ---------------------------------------------------------------------------

export type DesiredAgentState = "running" | "stopped" | "archived";
export type ActualAgentState =
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "crashed"
  | "missing"
  | "archived"
  | "unknown";

export type AgentKind =
  | "generalist"
  | "research"
  | "coding-inspector"
  | "coding"
  | "browser"
  | "stock-production"
  | "operations"
  | "custom";

export interface HermitAgent {
  id: string; // Pao-owned stable ID (oh_…), never the runtime ID
  workspaceId: string;
  name: string;
  kind: AgentKind;
  desiredState: DesiredAgentState;
  runtimeState: ActualAgentState;
  runtimeProvider: string | null;
  runtimeAgentId: string | null;
  runtimeInstanceId: string | null;
  blueprintVersion: number;
  policyProfile: string;
  approvalProfile: string;
  instructionDigest: string; // sha256 of the platform-owned instruction
  drift: string | null;
  lastActivityAt: string | null;
  costUsd: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HermitRuntimeInstance {
  id: string;
  name: string;
  baseUrl: string;
  tokenRef: string | null;
  version: string | null;
  health: HermitHealth;
  requiredMissingJson: string;
  capabilitiesJson: string;
  registeredAt: string;
  lastCheckedAt: string | null;
}

// ---------------------------------------------------------------------------
// Compatibility / capability detection (spec §4)
// ---------------------------------------------------------------------------

/** Capabilities the platform refuses to run the fleet without (fail closed). */
export const REQUIRED_CAPABILITIES = [
  "agent.lifecycle",
  "agent.status",
  "session.create",
  "session.message",
  "events",
] as const;

/** Capabilities gated per-flag; missing ones degrade but never break the core. */
export const OPTIONAL_CAPABILITIES = [
  "streaming",
  "checkpoint",
  "resume",
  "sandbox",
  "skills",
  "mcp",
  "research",
  "channels",
  "schedules",
] as const;

export type Capability = (typeof REQUIRED_CAPABILITIES)[number] | (typeof OPTIONAL_CAPABILITIES)[number];

export interface CompatibilityReport {
  provider: string;
  baseUrl: string | null;
  runtimeVersion: string | null;
  gatewayHealth: HermitHealth;
  requiredMissing: string[];
  optional: Partial<Record<(typeof OPTIONAL_CAPABILITIES)[number], boolean>>;
  verdict: "compatible" | "degraded" | "incompatible" | "unreachable" | "unconfigured";
  checkedAt: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Sessions (spec §7)
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "paused" | "closed" | "failed";

export interface HermitSession {
  id: string;
  agentId: string;
  runtimeSessionId: string | null;
  status: SessionStatus;
  traceId: string;
  actorId: string;
  checkpointJson: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Durable operations (spec §8)
// ---------------------------------------------------------------------------

export const OPERATION_STATES = [
  "queued",
  "policy_check",
  "approval_wait",
  "running",
  "checkpointed",
  "retry_wait",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "dead_letter",
] as const;

export type OperationState = (typeof OPERATION_STATES)[number];

/** Terminal and waiting states the state machine may legally enter. */
export const OPERATION_TRANSITIONS: Record<OperationState, OperationState[]> = {
  queued: ["policy_check", "cancelled"],
  policy_check: ["approval_wait", "running", "failed", "cancelled"],
  approval_wait: ["running", "failed", "cancelled", "dead_letter"],
  running: ["checkpointed", "succeeded", "failed", "paused", "retry_wait", "cancelled"],
  checkpointed: ["running", "paused", "failed", "cancelled"],
  retry_wait: ["running", "dead_letter", "failed", "cancelled"],
  paused: ["running", "cancelled", "dead_letter"],
  succeeded: [],
  failed: ["retry_wait", "dead_letter"],
  cancelled: [],
  dead_letter: [],
};

export function assertOperationTransition(from: OperationState, to: OperationState): void {
  if (!OPERATION_TRANSITIONS[from]?.includes(to)) {
    throw new HermitError("INVALID_INPUT", `illegal operation transition ${from} -> ${to}`);
  }
}

export type SideEffectClass = "none" | "local" | "external_reversible" | "external_destructive";

export interface HermitOperation {
  id: string;
  agentId: string | null;
  sessionId: string | null;
  kind: string;
  state: OperationState;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  sideEffect: SideEffectClass;
  checkpointJson: string | null;
  requestJson: string;
  resultJson: string | null;
  errorRedacted: string | null;
  approvalId: string | null;
  traceId: string;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Approvals — exact-action binding (spec §15)
// ---------------------------------------------------------------------------

export const APPROVAL_STATES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "superseded",
] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];

export interface ApprovalRequestInput {
  action: string; // e.g. "tool.invoke" | "research.plan" | "fleet.bulk_stop" | "agent.restart"
  target: string; // agent id / tool id / run id
  args: Record<string, unknown>;
  risk: RiskClass;
  ttlMs?: number;
  requestedBy: string;
  agentId?: string | null;
  operationId?: string | null;
  artifactHash?: string | null;
  constraints?: string[];
}

export interface HermitApproval {
  id: string;
  agentId: string | null;
  operationId: string | null;
  action: string;
  target: string;
  actionHash: string; // sha256(canonicalJson({action,target,args,artifactHash,constraints}))
  argsRedactedJson: string;
  risk: RiskClass;
  ttlMs: number;
  expiresAt: string | null;
  state: ApprovalState;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  consumedAt: string | null;
  supersededBy: string | null;
  reason: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Skill / MCP assignments (spec §10, §11)
// ---------------------------------------------------------------------------

export type AssignmentStatus = "requested" | "approved" | "active" | "disabled" | "denied" | "revoked" | "drifted";

export interface HermitAgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  version: string;
  provenanceHash: string;
  riskClass: RiskClass;
  status: AssignmentStatus;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** MCP capability taxonomy (spec §11) — mapped from tool metadata, never from descriptions. */
export interface McpCapabilityTaxonomy {
  dataRead: boolean;
  dataWrite: boolean;
  codeExecution: boolean;
  filesystemAccess: boolean;
  networkAccess: boolean;
  externalSideEffects: boolean;
  destructiveCapability: boolean;
  credentialRequirement: boolean;
}

export const EMPTY_MCP_CAPABILITIES: McpCapabilityTaxonomy = {
  dataRead: false,
  dataWrite: false,
  codeExecution: false,
  filesystemAccess: false,
  networkAccess: false,
  externalSideEffects: false,
  destructiveCapability: false,
  credentialRequirement: false,
};

export interface HermitAgentMcp {
  id: string;
  agentId: string;
  serverId: string;
  toolName: string | null; // null = whole server assignment
  capabilityJson: string;
  riskClass: RiskClass;
  status: AssignmentStatus;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Deep research (spec §16–§19)
// ---------------------------------------------------------------------------

export type ResearchRunState =
  | "planning"
  | "plan_review"
  | "plan_approved"
  | "running"
  | "paused"
  | "budget_exhausted"
  | "synthesis"
  | "council_review"
  | "completed"
  | "failed"
  | "cancelled";

export interface ResearchBudget {
  maxQueries: number;
  maxSources: number;
  maxEvidence: number;
  maxIterations: number;
  maxRuntimeMs: number;
  maxCostUsd: number;
}

export interface ResearchSpent {
  queries: number;
  sources: number;
  evidence: number;
  iterations: number;
  runtimeMs: number;
  costUsd: number;
}

export function emptySpent(): ResearchSpent {
  return { queries: 0, sources: 0, evidence: 0, iterations: 0, runtimeMs: 0, costUsd: 0 };
}

export function defaultBudget(): ResearchBudget {
  return {
    maxQueries: 12,
    maxSources: 24,
    maxEvidence: 64,
    maxIterations: 6,
    maxRuntimeMs: 15 * 60_000,
    maxCostUsd: 5,
  };
}

export type ResearchStepKind = "search" | "analyze" | "synthesize";

export interface ResearchPlanStep {
  id: string;
  kind: ResearchStepKind;
  query: string;
  done: boolean;
}

export interface ResearchPlan {
  goal: string;
  steps: ResearchPlanStep[];
  budget: ResearchBudget;
  createdAt: string;
  planHash: string;
}

export interface HermitResearchRun {
  id: string;
  agentId: string | null;
  question: string;
  state: ResearchRunState;
  planJson: string | null;
  planHash: string | null;
  planApprovedBy: string | null;
  budgetJson: string;
  spentJson: string;
  reportJson: string | null;
  checkpointJson: string | null;
  councilJson: string | null;
  errorRedacted: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SourceStatus = "acquired" | "rejected" | "flagged" | "superseded";

export interface ResearchSource {
  id: string;
  runId: string;
  uri: string;
  title: string | null;
  contentHash: string;
  excerpt: string;
  status: SourceStatus;
  rejectionReason: string | null;
  flagged: boolean; // prompt-injection patterns detected — data only, never instruction
  acquiredAt: string;
}

export type SupportType = "supports" | "contradicts" | "context";

export interface ResearchClaim {
  id: string;
  runId: string;
  text: string;
  status: "open" | "supported" | "contradicted" | "unverified";
  createdAt: string;
}

export interface ResearchEvidence {
  id: string;
  runId: string;
  sourceId: string;
  claimId: string | null;
  excerpt: string;
  location: string;
  support: SupportType;
  relevance: number;
  createdAt: string;
}

export interface ResearchReport {
  runId: string;
  question: string;
  claims: Array<{
    claimId: string;
    text: string;
    status: ResearchClaim["status"];
    citations: Array<{
      evidenceId: string;
      sourceId: string;
      uri: string;
      contentHash: string;
      excerpt: string;
      support: SupportType;
    }>;
  }>;
  coverage: { stepsTotal: number; stepsDone: number };
  contradictions: number;
  sourcesUsed: number;
  citationsVerified: boolean;
  generatedAt: string;
}

/** Injection boundary (spec §18): untrusted source text is DATA, never instruction. */
export const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*[:=]\s*/i,
  /developer\s+message\s*[:=]/i,
  /new\s+instructions?\s*[:=]/i,
  /override\s+(your|the)\s+(system|safety|policy)/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /<\s*\/?\s*(system|assistant|tool)\s*>/i,
];

export function detectInjection(content: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(content));
}

// ---------------------------------------------------------------------------
// Channels + schedules (spec §20, §21) — interface preserved, gated behind flags
// ---------------------------------------------------------------------------

export type ChannelKind = "web" | "cli" | "telegram" | "discord" | "slack";

export interface HermitChannelBinding {
  id: string;
  channel: ChannelKind;
  channelIdentity: string;
  paoIdentity: string; // channel identity maps to a Pao identity — never grants permissions itself
  agentId: string | null;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface HermitSchedule {
  id: string;
  agentId: string;
  action: string;
  intervalMs: number | null;
  nextDueMs: number | null;
  lastRunMs: number | null;
  status: "active" | "paused";
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Fleet operations (spec §26)
// ---------------------------------------------------------------------------

export type FleetAction = "bulk_start" | "bulk_stop" | "bulk_restart" | "bulk_skill_disable" | "bulk_mcp_disable";

export interface FleetImpact {
  action: FleetAction;
  eligible: string[];
  blocked: Array<{ agentId: string; reason: string }>;
  affectedCount: number;
  risk: RiskClass;
  approvalRequired: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Runtime provider contract (spec §3) — the replaceable adapter boundary
// ---------------------------------------------------------------------------

export interface HermitRemoteAgent {
  runtimeAgentId: string;
  state: string;
  health: HermitHealth;
}

export interface HermitRemoteSession {
  runtimeSessionId: string;
  state: string;
}

export interface HermitEventEnvelope {
  type: string; // provider-native event type
  occurredAt: string;
  agentId?: string;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export interface HermitRuntimeProvider {
  readonly provider: string;

  health(): Promise<{ health: HermitHealth; version: string | null; capabilities: string[]; message?: string }>;

  createAgent(input: { name: string; instruction: string; skills?: string[]; mcpServers?: string[] }): Promise<{
    runtimeAgentId: string;
  }>;
  startAgent(runtimeAgentId: string): Promise<{ state: string }>;
  stopAgent(runtimeAgentId: string, reason: string): Promise<{ state: string }>;
  restartAgent(runtimeAgentId: string): Promise<{ state: string }>;
  getAgent(runtimeAgentId: string): Promise<HermitRemoteAgent | null>;
  deleteAgent(runtimeAgentId: string): Promise<void>;

  createSession(runtimeAgentId: string, input: { traceId: string }): Promise<{ runtimeSessionId: string }>;
  sendMessage(runtimeSessionId: string, message: string): Promise<{ accepted: boolean }>;
  getSession(runtimeSessionId: string): Promise<HermitRemoteSession | null>;
  checkpointSession(runtimeSessionId: string): Promise<{ checkpoint: unknown }>;
  resumeSession(runtimeSessionId: string): Promise<{ state: string }>;
  closeSession(runtimeSessionId: string): Promise<void>;

  listEvents(input: { runtimeAgentId?: string; since?: string }): Promise<HermitEventEnvelope[]>;
}
