/**
 * Pao AI Gateway — Reviewer Council & Risk Classifier Types.
 *
 * Enforces Phase 20.13.8:
 * - Risk classification hierarchy (R0 to R5)
 * - Reviewer roles and provider independence constraints
 * - Vote aggregation and council decision states
 * - Fail-closed human approval tokens for critical operations
 */

import type { NormalizedChatRequest } from "../types";

/**
 * Risk classification levels from Section 17 of Phase 20.13 spec:
 * R0 - Informational / read-only / research
 * R1 - Minor / reversible single-file edit
 * R2 - Multi-file edit / feature implementation
 * R3 - Dependency / config / database migration / package install
 * R4 - Privileged / local command execution / MCP tool call
 * R5 - Destructive / security-sensitive / production deployment / secret handling
 */
export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

export interface RiskClassificationResult {
  readonly level: RiskLevel;
  readonly score: number; // 0 to 100
  readonly reasons: readonly string[];
  readonly detectedPatterns: readonly string[];
  readonly reviewRequirement: ReviewRequirement;
}

export type ReviewRequirementType =
  | "none" // R0, R1: single model
  | "optional" // R2: optional reviewer
  | "mandatory_single" // R3: 1 independent reviewer
  | "full_council" // R4: 2+ independent reviewers
  | "human_approval_required"; // R5: fail closed + human approval

export interface ReviewRequirement {
  readonly type: ReviewRequirementType;
  readonly minReviewers: number;
  readonly requiredRoles: readonly ReviewerRole[];
  readonly requireDifferentProviders: boolean;
  readonly humanApprovalRequired: boolean;
}

/**
 * Reviewer roles defined in Section 16 of the spec.
 */
export type ReviewerRole =
  | "reviewer-security"
  | "reviewer-architecture"
  | "reviewer-correctness"
  | "reviewer-regression"
  | "reviewer-cost";

export type ReviewerVote = "approve" | "request_changes" | "reject";

export interface ReviewerFinding {
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly title: string;
  readonly description: string;
  readonly suggestedFix?: string;
}

export interface ReviewerFeedback {
  readonly reviewerRole: ReviewerRole;
  readonly providerId: string;
  readonly modelId: string;
  readonly vote: ReviewerVote;
  readonly summary: string;
  readonly findings: readonly ReviewerFinding[];
  readonly durationMs: number;
}

export type CouncilDecisionState =
  | "approved"
  | "changes_requested"
  | "rejected"
  | "pending_human_approval";

export interface CouncilDecision {
  readonly state: CouncilDecisionState;
  readonly riskLevel: RiskLevel;
  readonly votes: {
    readonly approve: number;
    readonly requestChanges: number;
    readonly reject: number;
  };
  readonly feedback: readonly ReviewerFeedback[];
  readonly blockingReasons: readonly string[];
  readonly fixInstructions: readonly string[];
  readonly humanApprovalGranted?: boolean;
}

export interface CouncilReviewTarget {
  readonly summary: string;
  readonly developerProviderId?: string;
  readonly developerModelId?: string;
  readonly proposedChanges?: string;
  readonly commandToExecute?: string;
  readonly affectedFiles?: readonly string[];
  readonly rawRequest?: NormalizedChatRequest;
  readonly humanApprovalToken?: string;
}
