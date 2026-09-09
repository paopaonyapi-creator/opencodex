/**
 * Pao AI Gateway — Council Decision Aggregator.
 *
 * Synthesizes reviewer votes, findings, and human approval status
 * into an authoritative CouncilDecision.
 */

import type {
  CouncilDecision,
  CouncilDecisionState,
  ReviewerFeedback,
  RiskLevel,
} from "./types";

export function aggregateCouncilVotes(
  feedbacks: readonly ReviewerFeedback[],
  riskLevel: RiskLevel,
  humanApprovalToken?: string,
): CouncilDecision {
  let approveCount = 0;
  let requestChangesCount = 0;
  let rejectCount = 0;

  const blockingReasons: string[] = [];
  const fixInstructions: string[] = [];

  for (const fb of feedbacks) {
    if (fb.vote === "approve") {
      approveCount++;
    } else if (fb.vote === "request_changes") {
      requestChangesCount++;
      if (fb.summary) fixInstructions.push(`[${fb.reviewerRole}] ${fb.summary}`);
    } else if (fb.vote === "reject") {
      rejectCount++;
      blockingReasons.push(`[${fb.reviewerRole}] Rejected: ${fb.summary}`);
    }

    for (const finding of fb.findings) {
      if (finding.severity === "critical" || finding.severity === "high") {
        blockingReasons.push(`[${fb.reviewerRole} - ${finding.severity.toUpperCase()}] ${finding.title}: ${finding.description}`);
      }
      if (finding.suggestedFix) {
        fixInstructions.push(`Fix for "${finding.title}": ${finding.suggestedFix}`);
      }
    }
  }

  // R5 fail-closed human approval check
  const humanApprovalGranted = Boolean(
    humanApprovalToken && (humanApprovalToken.startsWith("pao-approved-") || humanApprovalToken === "admin-explicit-confirm"),
  );

  let state: CouncilDecisionState;

  if (rejectCount > 0) {
    state = "rejected";
  } else if (riskLevel === "R5" && !humanApprovalGranted) {
    state = "pending_human_approval";
    blockingReasons.push("Risk level R5 requires explicit human approval token before execution.");
  } else if (requestChangesCount > 0) {
    state = "changes_requested";
  } else {
    state = "approved";
  }

  return {
    state,
    riskLevel,
    votes: {
      approve: approveCount,
      requestChanges: requestChangesCount,
      reject: rejectCount,
    },
    feedback: feedbacks,
    blockingReasons,
    fixInstructions,
    humanApprovalGranted: riskLevel === "R5" ? humanApprovalGranted : undefined,
  };
}
