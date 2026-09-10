// Phase 20.16 — Multi-AI Control Plane: Reviewer Council v2.
//
// The load-bearing rule is that a CRITICAL finding blocks application in CODE, not
// in a report a human might skim. The second rule is that disagreement between
// reviewers is RECORDED rather than majority-voted away: with two reviewers a tie is
// not an answer, and a 2-of-3 majority can still be wrong when the minority holds the
// evidence. A disagreement becomes an explicit item for the operator.

import { randomUUID } from "node:crypto";
import {
  type AgentIdentity,
  type ReviewConsensus,
  type ReviewDisagreement,
  type ReviewIssue,
  type ReviewSeverity,
  type ReviewSubmission,
  type ReviewVerdict,
  nowIso,
} from "./types";

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function maxSeverity(a: ReviewSeverity, b: ReviewSeverity): ReviewSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Stable identity for an issue, so two reviewers reporting the same defect at the
 * same place collapse into one item instead of inflating the count.
 */
export function issueFingerprint(issue: Pick<ReviewIssue, "title" | "file" | "severity">): string {
  const normalized = (issue.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [issue.file ?? "", normalized, issue.severity].join("|");
}

export function createReview(input: {
  taskId: string;
  reviewer: AgentIdentity;
  role: ReviewSubmission["role"];
  verdict: ReviewVerdict;
  severity: ReviewSeverity;
  issues?: readonly ReviewIssue[];
  suggestions?: readonly string[];
  confidence?: number;
}): ReviewSubmission {
  const issues = (input.issues ?? []).map((issue) => ({
    ...issue,
    fingerprint: issue.fingerprint || issueFingerprint(issue),
  }));
  // A verdict cannot be softer than the findings it reports. An "approve" carrying a
  // critical issue is a contradiction, and silently trusting the verdict field is how
  // a blocking defect gets waved through.
  const derivedSeverity = issues.reduce<ReviewSeverity>(
    (acc, issue) => maxSeverity(acc, issue.severity),
    input.severity,
  );
  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const verdict: ReviewVerdict = hasCritical && input.verdict === "approve" ? "changes_requested" : input.verdict;

  return {
    id: "rev_" + randomUUID(),
    task_id: input.taskId,
    reviewer: input.reviewer,
    role: input.role,
    verdict,
    severity: derivedSeverity,
    issues,
    suggestions: input.suggestions ?? [],
    confidence: input.confidence ?? 0.5,
    created_at: nowIso(),
  };
}

/**
 * Compute the council's decision for a set of reviews.
 *
 * Order of precedence is deliberate: a reject or any unresolved critical issue ends
 * the matter before agreement is even considered. Only when nothing is blocking does
 * the majority carry any weight, and disagreement is reported alongside it either way.
 */
export function computeConsensus(taskId: string, reviews: readonly ReviewSubmission[]): ReviewConsensus {
  if (reviews.length === 0) {
    return {
      task_id: taskId,
      decision: "pending",
      severity: "low",
      blocked: true,
      blockingReasons: ["No reviewer has reported on this task yet."],
      reviewers: [],
      issueCount: 0,
      disagreements: [],
    };
  }

  const blockingReasons: string[] = [];

  // Deduplicate by fingerprint, keeping the highest severity reported for each.
  const byFingerprint = new Map<string, ReviewIssue>();
  for (const review of reviews) {
    for (const issue of review.issues) {
      const key = issue.fingerprint || issueFingerprint(issue);
      const existing = byFingerprint.get(key);
      if (!existing || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[existing.severity]) {
        byFingerprint.set(key, issue);
      }
    }
  }
  const issues = [...byFingerprint.values()];

  for (const issue of issues) {
    if (issue.severity === "critical") {
      blockingReasons.push("CRITICAL: " + issue.title);
    }
  }

  const severity = issues.reduce<ReviewSeverity>((acc, issue) => maxSeverity(acc, issue.severity), "low");
  const rejected = reviews.some((review) => review.verdict === "reject");
  if (rejected) blockingReasons.push("At least one reviewer rejected the change.");

  const blockers = blockingReasons;
  const blocked = blockers.length > 0;

  const changesRequested = reviews.some((review) => review.verdict === "changes_requested");
  const decision: ReviewVerdict | "pending" = blocked
    ? rejected
      ? "reject"
      : "changes_requested"
    : changesRequested
      ? "changes_requested"
      : "approve";

  return {
    task_id: taskId,
    decision,
    severity,
    blocked,
    blockingReasons: blockers,
    reviewers: reviews.map((review) => review.reviewer),
    issueCount: issues.length,
    disagreements: detectDisagreements(reviews),
  };
}

/**
 * Surface points where reviewers reached different verdicts.
 *
 * A split is reported as its own item with the risk of each side being wrong, rather
 * than resolved by counting votes. With two reviewers a tie has no majority at all,
 * and with three an evidence-backed minority would be erased by arithmetic.
 */
export function detectDisagreements(reviews: readonly ReviewSubmission[]): ReviewDisagreement[] {
  if (reviews.length < 2) return [];
  const verdicts = new Set(reviews.map((review) => review.verdict));
  if (verdicts.size < 2) return [];

  const positions = reviews.map((review) => ({
    reviewer: review.reviewer,
    position:
      review.verdict +
      " (severity " + review.severity + ", confidence " + review.confidence.toFixed(2) + ")" +
      (review.issues.length > 0 ? " - " + review.issues.map((issue) => issue.title).join("; ") : ""),
  }));

  return [
    {
      topic: "Overall verdict for task " + reviews[0]!.task_id,
      positions,
      riskIfWrong: reviews
        .filter((review) => review.verdict === "approve")
        .map((review) => "If " + review.reviewer + " is wrong, a defect it approved ships.")
        .concat(
          reviews
            .filter((review) => review.verdict !== "approve")
            .map((review) => "If " + review.reviewer + " is wrong, a sound change is held back."),
        ),
    },
  ];
}

/** True when the council's decision forbids applying the change. */
export function isApplicationBlocked(consensus: ReviewConsensus): boolean {
  return consensus.blocked || consensus.decision !== "approve";
}

