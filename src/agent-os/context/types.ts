/**
 * Pao Context Control Plane — Phase 20.53 canonical type surface.
 *
 * Pao owns policy/governance/identity/audit; OpenViking owns the viking://
 * filesystem, hierarchical retrieval, sessions and memory extraction. This
 * file holds ONLY canonical Pao types — OpenViking DTOs stay inside the
 * adapter module. No AGPLv3 upstream source is vendored anywhere.
 */

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ContextClass =
  | "project_knowledge"
  | "architecture"
  | "phase_spec"
  | "source_code"
  | "runbook"
  | "decision_record"
  | "user_preference"
  | "entity_memory"
  | "event_memory"
  | "workspace_memory"
  | "case"
  | "trajectory"
  | "experience"
  | "skill"
  | "session_summary"
  | "temporary_context"
  | "restricted_context";

export type ContextScope = "shared" | "user" | "peer" | "agent" | "session";

export type Sensitivity = "public" | "internal" | "private" | "restricted";

export type ContextLevel = "L0" | "L1" | "L2";

export interface ContextFreshness {
  readonly sourceUpdatedAt?: string;
  readonly indexedAt?: string;
  readonly lastVerifiedAt?: string;
  readonly expiresAt?: string;
  readonly status: "fresh" | "aging" | "stale" | "expired" | "unknown";
}

export interface PaoContextRef {
  readonly uri: string;
  readonly contextClass: ContextClass;
  readonly scope: ContextScope;
  readonly ownerUserId?: string;
  readonly workspaceId?: string;
  readonly peerId?: string;
  readonly level?: ContextLevel;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly sourceRevision?: string;
  readonly tags: readonly string[];
  readonly sensitivity: Sensitivity;
  readonly freshness?: ContextFreshness;
  readonly provenance?: {
    readonly sourceUri?: string;
    readonly importedBy?: string;
    readonly ingestionJobId?: string;
    readonly checksum?: string;
  };
}

// ---------------------------------------------------------------------------
// Reason codes (spec §64) — stable machine-readable outcomes
// ---------------------------------------------------------------------------

export type ContextReasonCode =
  | "CTX_ALLOWED_SHARED_RESOURCE"
  | "CTX_ALLOWED_USER_MEMORY"
  | "CTX_ALLOWED_WORKSPACE_PEER"
  | "CTX_BLOCKED_SCOPE"
  | "CTX_BLOCKED_ACL"
  | "CTX_BLOCKED_SENSITIVITY"
  | "CTX_BLOCKED_SECRET"
  | "CTX_BLOCKED_EXPIRED"
  | "CTX_BLOCKED_SUPPRESSED"
  | "CTX_BLOCKED_BUDGET"
  | "CTX_BLOCKED_POLICY"
  | "CTX_BLOCKED_CLASS"
  | "CTX_STALE_ALLOWED_WITH_WARNING"
  | "CTX_CONFLICT_REVIEW_REQUIRED"
  | "CTX_MEMORY_PROMOTION_REQUIRES_HUMAN"
  | "CTX_BACKEND_UNAVAILABLE"
  | "CTX_BACKEND_INCOMPATIBLE";

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface ContextBudget {
  readonly maxResults: number;
  readonly maxDirectories: number;
  readonly maxL2Documents: number;
  readonly maxChars: number;
  readonly maxEstimatedTokens: number;
  readonly maxLatencyMs: number;
}

export interface ContextRetrievalRequest {
  readonly requestId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly agentId: string;
  readonly taskType: string;
  readonly query: string;
  readonly intent?: string;
  readonly allowedScopes: readonly ContextScope[];
  readonly allowedRoots: readonly string[];
  readonly deniedRoots?: readonly string[];
  readonly contextClasses?: readonly ContextClass[];
  readonly budget: ContextBudget;
  readonly freshness?: { readonly preferRecent?: boolean; readonly maxAgeSeconds?: number };
  readonly minimumScore?: number;
  readonly trace: boolean;
}

export interface RetrievalHit {
  readonly uri: string;
  readonly contextClass: ContextClass;
  readonly level: ContextLevel;
  readonly score: number;
  readonly rank: number;
  readonly allowed: boolean;
  readonly exclusionReason?: ContextReasonCode;
  readonly estimatedTokens: number;
  readonly reason: ContextReasonCode;
  readonly chars: number;
  readonly trust: "high" | "medium" | "low";
  readonly freshnessStatus: "fresh" | "aging" | "stale" | "expired" | "unknown";
}

export interface ContextInjectionPlan {
  readonly planId: string;
  readonly retrievalRunId: string;
  readonly items: ReadonlyArray<{
    readonly uri: string;
    readonly level: ContextLevel;
    readonly reason: string;
    readonly estimatedTokens: number;
    readonly trust: "high" | "medium" | "low";
    readonly freshness: "fresh" | "stale" | "unknown";
  }>;
  readonly totalEstimatedTokens: number;
  readonly truncated: boolean;
  readonly truncationReason?: string;
}

export interface ContextRetrievalResponse {
  readonly retrievalRunId: string;
  readonly status: "ok" | "degraded" | "blocked";
  readonly budget: { readonly estimatedTokens: number; readonly maxEstimatedTokens: number };
  readonly items: readonly RetrievalHit[];
  readonly truncated: boolean;
  readonly degradedReason?: ContextReasonCode;
  readonly injectionPlan: ContextInjectionPlan;
}

// ---------------------------------------------------------------------------
// Backend adapter surface (canonical Pao view)
// ---------------------------------------------------------------------------

export interface ContextDbCapabilities {
  readonly resources: boolean;
  readonly memory: boolean;
  readonly skills: boolean;
  readonly sessions: boolean;
  readonly mcp: boolean;
  readonly acl: boolean;
  readonly backupRestore: boolean;
  readonly agentEvolution: boolean;
  readonly warnings: readonly string[];
}

export interface ContextDbHealth {
  readonly reachable: boolean;
  readonly compatible: boolean;
  readonly version?: string;
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface ContextSearchRequest {
  readonly query: string;
  readonly roots: readonly string[];
  readonly maxResults: number;
}

export interface ContextSearchHit {
  readonly uri: string;
  readonly score: number;
  readonly snippet?: string;
}

export interface ContextIngestHandle {
  readonly taskId: string;
  readonly targetUri: string;
}

export interface ContextIngestResult {
  readonly status: "ready" | "processing" | "failed";
  readonly targetUri: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionBindingStatus = "active" | "committing" | "committed" | "failed" | "closed";

export interface ContextSessionBinding {
  readonly id: string;
  readonly paoConversationId: string;
  readonly paoRunId?: string;
  readonly openVikingSessionId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly agentId: string;
  readonly peerId?: string;
  readonly memoryPolicyId: string;
  readonly status: SessionBindingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Memory governance
// ---------------------------------------------------------------------------

export type MemoryReviewState =
  | "auto_accepted_private"
  | "pending_review"
  | "approved"
  | "rejected"
  | "suppressed"
  | "expired"
  | "superseded";

export interface MemoryGovernanceRecord {
  readonly id: string;
  readonly memoryUri: string;
  readonly memoryType?: string;
  readonly ownerUserId?: string;
  readonly workspaceId?: string;
  readonly peerId?: string;
  readonly reviewState: MemoryReviewState;
  readonly pinned: boolean;
  readonly suppressed: boolean;
  readonly riskLevel: "low" | "normal" | "elevated" | "high";
  readonly sourceSessionId?: string;
  readonly contentPreview?: string;
  readonly lastVerifiedAt?: string;
  readonly expiresAt?: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MemoryReviewAction =
  | "approve"
  | "reject"
  | "suppress"
  | "unsuppress"
  | "pin"
  | "unpin"
  | "promote"
  | "expire"
  | "mark_superseded";

export interface MemoryReviewRecord {
  readonly id: string;
  readonly governanceId: string;
  readonly action: MemoryReviewAction;
  readonly reviewerType: "user" | "system" | "policy";
  readonly reviewerId?: string;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface SuppressionRule {
  readonly id: string;
  readonly field: "uri" | "memory_type" | "tag" | "workspace" | "peer" | "checksum" | "content_pattern";
  readonly pattern: string;
  readonly reason: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Experience governance (advisory only — never an authorization decision)
// ---------------------------------------------------------------------------

export interface ExperienceGovernanceRecord {
  readonly id: string;
  readonly experienceUri: string;
  readonly workspaceId?: string;
  readonly reuseCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly humanApproved: boolean;
  readonly confidence: number;
  readonly lastUsedAt?: string;
  readonly lastValidatedAt?: string;
  readonly status: "private" | "pending_review" | "promoted" | "rejected";
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export interface AgentHandoffPackage {
  readonly id: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly summary: string;
  readonly contextRefs: ReadonlyArray<{ readonly uri: string; readonly level: ContextLevel }>;
  readonly pendingActions: readonly string[];
  readonly constraints: readonly string[];
  readonly provenance: readonly string[];
  readonly expiresAt?: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit + health
// ---------------------------------------------------------------------------

export interface ContextAuditEvent {
  readonly id: string;
  readonly eventType: string;
  readonly actorType: "user" | "system" | "agent" | "provider" | "scheduler";
  readonly actorId?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly agentId?: string;
  readonly resourceUri?: string;
  readonly reasonCode?: ContextReasonCode;
  readonly metadata?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly createdAt: string;
}

export interface ContextSubsystemHealth {
  readonly overall: "healthy" | "degraded" | "unhealthy" | "disabled";
  readonly backend: {
    readonly reachable: boolean;
    readonly compatible: boolean;
    readonly version?: string;
    readonly latencyMs?: number;
  };
  readonly retrieval: { readonly healthy: boolean };
  readonly ingestion: { readonly healthy: boolean; readonly queueDepth?: number };
  readonly memory: { readonly healthy: boolean; readonly pendingReviews?: number };
  readonly circuitBreaker: "closed" | "open" | "half_open";
  readonly pendingReviews?: number;
  readonly lastErrorAt?: string;
}

export interface CompatibilityProbe {
  readonly adapter: "openviking";
  readonly status: "compatible" | "degraded" | "unreachable";
  readonly serverVersion?: string;
  readonly capabilities: ContextDbCapabilities;
  readonly warnings: readonly string[];
}
