/**
 * Pao Agent Platform — Phase 20.54 canonical type surface.
 *
 * The platform standard governing how Pao-hubPro agents declare identity,
 * patterns, capabilities, context, memory, protocols and policy. Provider-
 * neutral: model access always flows through existing Pao routing layers.
 *
 * LLM output is ADVISORY everywhere — the policy engine, risk classifier and
 * approval gates are deterministic and final.
 */

// ---------------------------------------------------------------------------
// Risk (spec §9)
// ---------------------------------------------------------------------------

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

// ---------------------------------------------------------------------------
// Capabilities (spec §8)
// ---------------------------------------------------------------------------

export type MutabilityClass = "read_only" | "local_reversible" | "external_reversible" | "external_irreversible";

export type ApprovalRequirement = "none" | "policy" | "required";

export interface CapabilityRecord {
  readonly id: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly mutability: MutabilityClass;
  readonly dataSensitivity: "public" | "internal" | "confidential" | "secret";
  readonly approvalDefault: ApprovalRequirement;
  readonly sandboxRequired: boolean;
  readonly rollbackSupported: boolean;
  readonly receiptRequired: boolean;
}

// ---------------------------------------------------------------------------
// Agent manifest (spec §5, §58)
// ---------------------------------------------------------------------------

export interface AgentManifest {
  readonly apiVersion: "pao.ai/v1";
  readonly kind: "Agent";
  readonly metadata: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly owner: string;
    readonly labels?: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly description: string;
    readonly patterns: readonly string[];
    readonly runtime: {
      readonly mode: "supervisor-managed" | "standalone";
      readonly timeoutSeconds: number;
      readonly maxSteps: number;
      readonly maxToolCalls: number;
      readonly allowParallelTools: boolean;
    };
    readonly models: {
      readonly preferred: ReadonlyArray<{ readonly provider: string; readonly capability: string }>;
      readonly fallback?: ReadonlyArray<{ readonly provider: string; readonly capability: string }>;
    };
    readonly context: {
      readonly strategy: "static" | "dynamic";
      readonly maxTokens: number;
      readonly include: readonly string[];
      readonly compression?: { readonly enabled: boolean; readonly thresholdRatio: number };
    };
    readonly memory: {
      readonly read: readonly string[];
      readonly write: readonly string[];
      readonly writePolicy: "gated" | "deny" | "auto";
    };
    readonly capabilities: {
      readonly required: readonly string[];
      readonly optional?: readonly string[];
    };
    readonly protocols?: {
      readonly mcp?: { readonly enabled: boolean };
      readonly a2a?: { readonly enabled: boolean; readonly exposeAgentCard: boolean };
    };
    readonly approvals: {
      readonly default: "none" | "required_for_r3_r4";
      readonly rules?: ReadonlyArray<{ readonly capability: string; readonly approval: "none" | "required" }>;
    };
    readonly security: {
      readonly sandbox: "required" | "preferred" | "none";
      readonly networkPolicy: "allowlist" | "deny-all";
      readonly secretsAccess: "deny-by-default";
    };
    readonly observability?: {
      readonly tracing?: boolean;
      readonly audit?: boolean;
      readonly cryptographicReceipts?: "off" | "privileged_actions" | "all";
    };
    readonly evaluation?: { readonly suite: string };
    /** Legacy compatibility wrappers carry an explicit warning flag (§45). */
    readonly legacy?: boolean;
  };
}

export interface ManifestValidationIssue {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Patterns (spec §6-7)
// ---------------------------------------------------------------------------

export interface PatternRecord {
  readonly id: string;
  readonly version: string;
  readonly category: "execution" | "orchestration" | "review";
  readonly description: string;
  readonly recommendedFor: readonly string[];
  readonly antiPatterns: readonly string[];
  readonly requiredComponents: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly requiredEvents: readonly string[];
}

// ---------------------------------------------------------------------------
// Policy engine (spec §10)
// ---------------------------------------------------------------------------

export type PolicyDecision =
  | "ALLOW"
  | "DENY"
  | "ALLOW_WITH_SANDBOX"
  | "REQUIRE_APPROVAL"
  | "REQUIRE_REVIEW";

export interface PolicyInput {
  readonly actor: string;
  readonly taskId: string;
  readonly capability: string;
  readonly tool?: string;
  readonly resource?: string;
  readonly argumentsHash?: string;
  readonly risk: RiskLevel;
  readonly environment: "development" | "staging" | "production";
  readonly approvalContext: {
    readonly approvalId?: string;
    readonly approvedForCapability?: string;
    readonly approvedForTarget?: string;
    readonly approvedArgumentsHash?: string;
    readonly consumed?: boolean;
  } | null;
}

export interface PolicyOutput {
  readonly decision: PolicyDecision;
  readonly reason: string;
  readonly policyId: string;
  readonly reasonCode:
    | "POLICY_ALLOWED"
    | "POLICY_DENIED_UNREGISTERED"
    | "POLICY_DENIED_DISABLED_AGENT"
    | "POLICY_RISK_APPROVAL_REQUIRED"
    | "POLICY_REVIEW_REQUIRED"
    | "POLICY_SANDBOX_REQUIRED"
    | "POLICY_APPROVAL_APPLIED"
    | "POLICY_APPROVAL_REPLAY_BLOCKED"
    | "POLICY_APPROVAL_MISMATCH";
}

// ---------------------------------------------------------------------------
// Scoped approval tokens (spec §11)
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed";

export interface ApprovalRecord {
  readonly id: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly capabilityId: string;
  readonly target?: string;
  readonly argumentsHash?: string;
  readonly riskLevel: RiskLevel;
  readonly expectedSideEffect: string;
  readonly rollbackAvailable: boolean;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly expiresAt: string;
  /** One-time use for R4 (spec §11). */
  readonly consumed: boolean;
}

// ---------------------------------------------------------------------------
// Secure execution envelope (spec §28-29)
// ---------------------------------------------------------------------------

export type ToolExecutionErrorCode =
  | "TOOL_SCHEMA_INVALID"
  | "TOOL_TIMEOUT"
  | "TOOL_EXECUTION_FAILED"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "SECURITY_VIOLATION"
  | "LOOP_LIMIT_EXCEEDED"
  | "AGENT_NOT_FOUND"
  | "CAPABILITY_MISSING"
  | "LOOP_LIMIT_EXCEEDED";

export interface ToolExecutionEnvelope {
  readonly toolCallId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly toolId: string;
  readonly capability: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly argumentsHash: string;
  readonly sandboxProfile: "workspace-write" | "read-only" | "none";
  readonly requestedAt: string;
  readonly policyDecisionId?: string;
  readonly approvalId?: string;
}

export interface ToolExecutionResult {
  readonly toolCallId: string;
  readonly status: "success" | "failed" | "denied";
  readonly errorCode?: ToolExecutionErrorCode;
  readonly result?: unknown;
  readonly resultHash: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly receiptId?: string;
}

// ---------------------------------------------------------------------------
// Context engineering (spec §15-18)
// ---------------------------------------------------------------------------

export type ContextType =
  | "SYSTEM"
  | "TASK"
  | "USER"
  | "PROJECT"
  | "MEMORY"
  | "KNOWLEDGE"
  | "TOOLS"
  | "PLAN"
  | "EXECUTION_RESULT"
  | "AGENT_MESSAGE"
  | "POLICY"
  | "APPROVAL";

export interface ContextItem {
  readonly id: string;
  readonly type: ContextType;
  readonly content: unknown;
  readonly source: string;
  readonly sourceId?: string;
  readonly createdAt: string;
  readonly trustLevel: "trusted" | "verified" | "untrusted";
  readonly sensitivity: "public" | "internal" | "confidential" | "secret";
  readonly relevanceScore?: number;
  readonly tokenEstimate?: number;
  readonly expiresAt?: string;
  readonly immutable?: boolean;
}

export interface ContextBudgetAllocation {
  readonly totalTokens: number;
  readonly reserveOutputTokens: number;
  readonly allocations: Readonly<Record<string, number>>;
}

export interface CompiledContextPackage {
  readonly items: readonly ContextItem[];
  readonly totalTokens: number;
  readonly dropped: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
  readonly compressed: ReadonlyArray<{ readonly id: string; readonly before: number; readonly after: number }>;
  readonly precedenceApplied: readonly ContextType[];
}

// ---------------------------------------------------------------------------
// Memory gateway (spec §19-22)
// ---------------------------------------------------------------------------

export type MemoryType = "working" | "short_term" | "episodic" | "semantic" | "project" | "procedure" | "experience" | "user_preference";

export interface MemoryRecord {
  readonly id: string;
  readonly memoryType: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly createdBy: string;
  readonly taskId?: string;
  readonly trustLevel: "trusted" | "verified" | "untrusted";
  readonly confidence: number;
  readonly sensitivity: "public" | "internal" | "confidential" | "secret";
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface MemoryWriteGate {
  readonly decision: "store" | "discard";
  readonly memoryType: MemoryType;
  readonly scope: string;
  readonly retention: "working" | "short_term" | "long_term";
  readonly confidence: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Router / supervisor (spec §14, §23-24)
// ---------------------------------------------------------------------------

export interface RouteCandidate {
  readonly agentId: string;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly trustTier: string;
  readonly modelsAvailable: boolean;
  readonly healthy: boolean;
  readonly avgLatencyMs: number;
  readonly avgCostUsd: number;
  readonly localOnly: boolean;
  readonly evaluationScore: number;
}

export interface RoutingFactors {
  readonly requiredSkills: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly latencyBudgetMs?: number;
  readonly costBudgetUsd?: number;
  readonly requireLocal: boolean;
}

export interface SupervisorStatus {
  readonly state:
    | "RECEIVED"
    | "ANALYZING"
    | "PLANNING"
    | "DELEGATING"
    | "EXECUTING"
    | "REVIEWING"
    | "WAITING_APPROVAL"
    | "FINALIZING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  readonly at: string;
}

export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly agent: string;
  readonly dependsOn: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly completion: readonly string[];
}

export interface PlanGraph {
  readonly goal: string;
  readonly steps: readonly PlanStep[];
}

// ---------------------------------------------------------------------------
// A2A (spec §13, §53)
// ---------------------------------------------------------------------------

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly skills: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string }>;
  readonly capabilities: { readonly streaming: boolean; readonly artifacts: boolean; readonly pushNotifications: boolean };
  readonly pao: { readonly trustTier: string; readonly policyProfile: string };
}

export interface A2ADelegation {
  readonly delegationId: string;
  readonly toAgent: string;
  readonly taskSummary: string;
  readonly context: ReadonlyArray<{ readonly type: ContextType; readonly content: string }>;
  readonly provenance: readonly string[];
  readonly expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Receipts (spec §31)
// ---------------------------------------------------------------------------

export interface ReceiptPayload {
  readonly version: "pao.receipt/v1";
  readonly receiptId: string;
  readonly previousHash: string;
  readonly timestamp: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly action: string;
  readonly target?: string;
  readonly argumentsHash: string;
  readonly policyDecision: string;
  readonly approvalId?: string;
  readonly result: string;
  readonly resultHash: string;
}

export interface ReceiptRecord {
  readonly payload: ReceiptPayload;
  readonly payloadHash: string;
  readonly signature: string;
  readonly signingKeyId: string;
}

// ---------------------------------------------------------------------------
// Reviewer contract (spec §25)
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  readonly dimension: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
}

export interface ReviewResult {
  readonly reviewerId: string;
  readonly verdict: "pass" | "pass_with_notes" | "fail" | "uncertain";
  readonly score: number;
  readonly findings: readonly ReviewFinding[];
  readonly requiredActions: readonly string[];
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Error taxonomy (spec §48)
// ---------------------------------------------------------------------------

export type PlatformErrorCode =
  | "AGENT_NOT_FOUND"
  | "AGENT_DISABLED"
  | "CAPABILITY_MISSING"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "TOOL_SCHEMA_INVALID"
  | "TOOL_TIMEOUT"
  | "TOOL_EXECUTION_FAILED"
  | "MCP_UNAVAILABLE"
  | "A2A_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "SECURITY_VIOLATION"
  | "LOOP_LIMIT_EXCEEDED"
  | "RECEIPT_VERIFICATION_FAILED"
  | "EVALUATION_FAILED";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly httpStatus: number;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(code: PlatformErrorCode, message: string, httpStatus = 409, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
