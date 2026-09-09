/**
 * Pao AI Gateway — Reviewer Council Orchestrator.
 *
 * Implements Section 16 & 26: Phase 20.13.8 Council Workflow.
 * - Coordinates risk classification, reviewer selection, evaluation, and decision aggregation
 * - Ensures provider independence between developer and reviewer models
 * - Enforces fail-closed human approval gating on R5 operations
 */

import type { ProviderRegistry } from "../providers/registry";
import type { GatewayModelConfig, GatewayProviderConfig } from "../types";
import { classifyRisk } from "./classifier";
import { selectReviewers, type ReviewerAssignment } from "./roles";
import { aggregateCouncilVotes } from "./aggregator";
import type {
  CouncilDecision,
  CouncilReviewTarget,
  ReviewerFeedback,
  ReviewerFinding,
  ReviewerVote,
} from "./types";

export interface CouncilContext {
  availableModels: readonly GatewayModelConfig[];
  providers: readonly GatewayProviderConfig[];
  providerRegistry?: ProviderRegistry;
}

/**
 * Execute a Reviewer Council evaluation against a review target.
 */
export async function evaluateWithCouncil(
  target: CouncilReviewTarget,
  ctx: CouncilContext,
  customReviewerRunner?: (assignment: ReviewerAssignment, target: CouncilReviewTarget) => Promise<ReviewerFeedback>,
): Promise<CouncilDecision> {
  // 1. Classify task risk
  const classification = classifyRisk({
    text: target.summary + "\n" + (target.proposedChanges ?? ""),
    command: target.commandToExecute,
    affectedFiles: target.affectedFiles,
    alias: target.rawRequest?.model,
  });

  // 2. If no review required (R0, R1), return direct approval
  if (classification.reviewRequirement.type === "none") {
    return {
      state: "approved",
      riskLevel: classification.level,
      votes: { approve: 1, requestChanges: 0, reject: 0 },
      feedback: [],
      blockingReasons: [],
      fixInstructions: [],
    };
  }

  // 3. Select independent reviewers
  const assignments = selectReviewers(
    classification.reviewRequirement,
    ctx.availableModels,
    ctx.providers,
    target.developerProviderId,
  );

  // 4. Run each reviewer
  const feedbacks: ReviewerFeedback[] = [];

  for (const assignment of assignments) {
    if (customReviewerRunner) {
      const fb = await customReviewerRunner(assignment, target);
      feedbacks.push(fb);
    } else {
      // Default deterministic analysis based on role
      const fb = runDeterministicReview(assignment, target, classification.level);
      feedbacks.push(fb);
    }
  }

  // 5. Aggregate votes
  return aggregateCouncilVotes(
    feedbacks,
    classification.level,
    target.humanApprovalToken,
  );
}

/**
 * Built-in deterministic reviewer evaluator when live LLM is not directly invoked.
 */
function runDeterministicReview(
  assignment: ReviewerAssignment,
  target: CouncilReviewTarget,
  riskLevel: string,
): ReviewerFeedback {
  const start = Date.now();
  const findings: ReviewerFinding[] = [];
  let vote: ReviewerVote = "approve";
  let summary = "Review completed with no blocking issues detected.";

  const content = [target.summary, target.proposedChanges, target.commandToExecute].filter(Boolean).join("\n");

  if (assignment.role === "reviewer-security") {
    // Security scan
    if (/rm\s+-rf|\bdrop\s+database\b/i.test(content)) {
      findings.push({
        severity: "critical",
        title: "Destructive Operation",
        description: "Operation contains potentially destructive commands without guardrails.",
        suggestedFix: "Remove destructive commands or gate behind explicit human approval token.",
      });
      vote = "reject";
      summary = "Security review rejected due to destructive operations.";
    } else if (/curl\s+.*\|\s*bash/i.test(content)) {
      findings.push({
        severity: "high",
        title: "Piped Remote Script",
        description: "Executing unvalidated remote scripts via curl | bash is insecure.",
        suggestedFix: "Download, verify checksum/signature, and execute in sandboxed environment.",
      });
      vote = "request_changes";
      summary = "Security review requires changes to remote script invocation.";
    }
  } else if (assignment.role === "reviewer-architecture") {
    // Architecture scan
    if (target.affectedFiles && target.affectedFiles.length > 8) {
      findings.push({
        severity: "medium",
        title: "Large Change Surface",
        description: "Change touches more than 8 files in a single pass.",
        suggestedFix: "Decompose into smaller sequential pull requests.",
      });
      vote = "request_changes";
      summary = "Architecture review requests decomposition of large changeset.";
    }
  }

  return {
    reviewerRole: assignment.role,
    providerId: assignment.providerId,
    modelId: assignment.modelId,
    vote,
    summary,
    findings,
    durationMs: Date.now() - start,
  };
}
