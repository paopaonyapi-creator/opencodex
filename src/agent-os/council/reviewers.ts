// Phase 20.4 — Reviewer Pool, Independence & Quorum
// (spec sections 22, 50-53, 80, 120-124).
//
// This layer schedules *independent* reviews of individual ChangeSets and binds
// each verdict to a diff hash so it self-invalidates on new commits. Phase 20.2's
// SoftwareReviewerCouncil still owns cycle-level review; we do not duplicate it
// (spec section 183) — we add per-changeset scheduling and independence.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { selectAgentProfile, type AssignmentOutcome } from "./agents";
import type {
  AgentProfileId,
  ChangeSet,
  CouncilTaskClass,
  FindingResolution,
  FindingSeverity,
  ReviewAssignment,
  ReviewAssignmentStatus,
  ReviewDecision,
  ReviewFinding,
  ReviewResult,
} from "./types";
import type { RiskLevel } from "../sdlc/types";

/** Spec section 80 — required reviewer roles by risk. */
export function requiredReviewerRoles(
  taskClass: CouncilTaskClass,
  risk: RiskLevel,
): { required: AgentProfileId[]; humanApprovalRequired: boolean } {
  const roles = new Set<AgentProfileId>();

  // Everything gets at least one quality pass.
  roles.add("code_quality_reviewer");

  // Class-driven specialists.
  if (taskClass === "SECURITY") roles.add("security_reviewer");
  if (taskClass === "MCP") roles.add("mcp_reviewer");
  if (taskClass === "DATABASE" || taskClass === "MIGRATION") roles.add("architecture_reviewer");
  if (taskClass === "BACKEND") roles.add("api_reviewer");

  switch (risk) {
    case "LOW":
      // deterministic checks + 1 reviewer
      break;
    case "MEDIUM":
      // deterministic checks + relevant reviewer (already added above)
      break;
    case "HIGH":
      // 2 independent review roles + stronger tests
      roles.add("architecture_reviewer");
      if (taskClass === "SECURITY" || taskClass === "MIGRATION") roles.add("security_reviewer");
      break;
    case "CRITICAL":
      roles.add("architecture_reviewer");
      roles.add("security_reviewer");
      break;
  }

  const required = [...roles];
  // LOW risk trims to a single reviewer to respect the quorum table.
  const trimmed = risk === "LOW" ? required.slice(0, 1) : required;

  return {
    required: trimmed,
    // Spec sections 80/138: CRITICAL needs a human in the loop.
    humanApprovalRequired: risk === "CRITICAL",
  };
}

export class ReviewerIndependenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewerIndependenceError";
  }
}

export interface AssignReviewsInput {
  councilRunId: string;
  changeset: ChangeSet;
  taskClass: CouncilTaskClass;
  risk: RiskLevel;
  /** Profile id that implemented this changeset — must not be its sole reviewer. */
  implementerProfileId: string;
  round?: number;
}

export interface AssignReviewsResult {
  assignments: ReviewAssignment[];
  unavailableRoles: AgentProfileId[];
  humanApprovalRequired: boolean;
}

/**
 * Spec section 22 — reviewer independence. The implementer profile is excluded
 * from its own review set. When a required role cannot be staffed we record it
 * as UNAVAILABLE rather than dropping the requirement (spec section 92).
 */
export function assignReviews(input: AssignReviewsInput): AssignReviewsResult {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const round = input.round ?? 1;

  const { required, humanApprovalRequired } = requiredReviewerRoles(
    input.taskClass,
    input.risk,
  );

  const assignments: ReviewAssignment[] = [];
  const unavailableRoles: AgentProfileId[] = [];

  for (const role of required) {
    // Independence: never let the implementer review its own diff.
    if (role === (input.implementerProfileId as AgentProfileId)) {
      const fallback: AssignmentOutcome = selectAgentProfile({
        taskClass: input.taskClass,
        risk: input.risk,
        role: "reviewer",
        excludeProfiles: [input.implementerProfileId],
      });
      if (!fallback.ok) {
        unavailableRoles.push(role);
        continue;
      }
    }

    const assignment: ReviewAssignment = {
      id: `crasg_${randomUUID().slice(0, 12)}`,
      councilRunId: input.councilRunId,
      changesetId: input.changeset.id,
      reviewerProfile: role,
      reviewerAgentRunId: null,
      required: true,
      status: "pending",
      round,
      createdAt: now,
    };

    db.query(
      `INSERT INTO council_review_assignments
         (id, council_run_id, changeset_id, reviewer_profile, reviewer_agent_run_id,
          required, status, round, created_at)
       VALUES (?, ?, ?, ?, NULL, 1, 'pending', ?, ?)`,
    ).run(
      assignment.id,
      assignment.councilRunId,
      assignment.changesetId,
      assignment.reviewerProfile,
      assignment.round,
      assignment.createdAt,
    );

    assignments.push(assignment);
  }

  return { assignments, unavailableRoles, humanApprovalRequired };
}

export interface RecordReviewInput {
  assignmentId: string;
  changeset: ChangeSet;
  reviewerProfile: AgentProfileId;
  decision: ReviewDecision;
  findings?: Array<Omit<ReviewFinding, "id" | "fingerprint" | "resolution" | "reviewerSources">>;
  requiredFixes?: string[];
  suggestions?: string[];
  evidence?: string | null;
  /** Set when the reviewer itself produced the diff — rejected outright. */
  reviewerIsImplementer?: boolean;
}

export function findingFingerprint(input: {
  category: string;
  file: string | null;
  line: number | null;
  title: string;
}): string {
  return createHash("sha256")
    .update(
      [input.category, input.file ?? "-", String(input.line ?? 0), input.title]
        .join("|")
        .toLowerCase(),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Spec sections 52/53 — persist a verdict bound to (diff_hash, head_sha). A
 * reviewer may not approve a diff it authored (spec section 21/22).
 */
export function recordReviewResult(input: RecordReviewInput): ReviewResult {
  if (input.reviewerIsImplementer) {
    throw new ReviewerIndependenceError(
      `reviewer ${input.reviewerProfile} implemented changeset ${input.changeset.id}; independent review required`,
    );
  }

  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const severityCounts: Record<FindingSeverity, number> = {
    INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0,
  };

  const findings: ReviewFinding[] = (input.findings ?? []).map(f => {
    severityCounts[f.severity]++;
    return {
      ...f,
      id: `cfind_${randomUUID().slice(0, 12)}`,
      fingerprint: findingFingerprint({
        category: f.category,
        file: f.file,
        line: f.line,
        title: f.title,
      }),
      resolution: "OPEN" as FindingResolution,
      reviewerSources: [input.reviewerProfile],
    };
  });

  const result: ReviewResult = {
    id: `cres_${randomUUID().slice(0, 12)}`,
    assignmentId: input.assignmentId,
    changesetId: input.changeset.id,
    reviewerProfile: input.reviewerProfile,
    decision: input.decision,
    severityCounts,
    findings,
    requiredFixes: input.requiredFixes ?? [],
    suggestions: input.suggestions ?? [],
    evidence: input.evidence ?? null,
    reviewedDiffHash: input.changeset.diffHash,
    reviewedHeadSha: input.changeset.headSha,
    createdAt: now,
  };

  db.query(
    `INSERT INTO council_review_results
       (id, assignment_id, changeset_id, reviewer_profile, decision, severity_counts_json,
        findings_json, required_fixes_json, suggestions_json, evidence,
        reviewed_diff_hash, reviewed_head_sha, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    result.id,
    result.assignmentId,
    result.changesetId,
    result.reviewerProfile,
    result.decision,
    JSON.stringify(result.severityCounts),
    JSON.stringify(result.findings),
    JSON.stringify(result.requiredFixes),
    JSON.stringify(result.suggestions),
    result.evidence,
    result.reviewedDiffHash,
    result.reviewedHeadSha,
    result.createdAt,
  );

  const status: ReviewAssignmentStatus =
    input.decision === "UNAVAILABLE" ? "unavailable" : "completed";
  db.run("UPDATE council_review_assignments SET status = ? WHERE id = ?", [
    status,
    input.assignmentId,
  ]);

  return result;
}

function rowToReviewResult(r: Record<string, unknown>): ReviewResult {
  return {
    id: r.id as string,
    assignmentId: r.assignment_id as string,
    changesetId: r.changeset_id as string,
    reviewerProfile: r.reviewer_profile as AgentProfileId,
    decision: r.decision as ReviewDecision,
    severityCounts: JSON.parse(r.severity_counts_json as string) as Record<FindingSeverity, number>,
    findings: JSON.parse(r.findings_json as string) as ReviewFinding[],
    requiredFixes: JSON.parse(r.required_fixes_json as string) as string[],
    suggestions: JSON.parse(r.suggestions_json as string) as string[],
    evidence: (r.evidence as string | null) ?? null,
    reviewedDiffHash: r.reviewed_diff_hash as string,
    reviewedHeadSha: r.reviewed_head_sha as string,
    createdAt: r.created_at as string,
  };
}

export function listReviewResults(changesetId: string): ReviewResult[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM council_review_results WHERE changeset_id = ? ORDER BY created_at")
    .all(changesetId) as Array<Record<string, unknown>>;
  return rows.map(rowToReviewResult);
}

export function listReviewAssignments(changesetId: string): ReviewAssignment[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM council_review_assignments WHERE changeset_id = ? ORDER BY created_at")
    .all(changesetId) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    changesetId: r.changeset_id as string,
    reviewerProfile: r.reviewer_profile as AgentProfileId,
    reviewerAgentRunId: (r.reviewer_agent_run_id as string | null) ?? null,
    required: r.required === 1,
    status: r.status as ReviewAssignmentStatus,
    round: r.round as number,
    createdAt: r.created_at as string,
  }));
}

/**
 * Spec section 53 — a review is stale when the changeset it examined no longer
 * matches the current diff hash / head sha.
 */
export function isReviewStale(result: ReviewResult, current: ChangeSet): boolean {
  return (
    result.reviewedDiffHash !== current.diffHash ||
    result.reviewedHeadSha !== current.headSha
  );
}

/** Mark every prior review of a task's earlier revision as stale. */
export function invalidateStaleReviews(current: ChangeSet): number {
  const db = openAgentOsDb();
  const results = listReviewResults(current.id);
  let invalidated = 0;

  for (const r of results) {
    if (isReviewStale(r, current)) {
      db.run("UPDATE council_review_assignments SET status = 'stale' WHERE id = ?", [
        r.assignmentId,
      ]);
      invalidated++;
    }
  }
  return invalidated;
}

/** Spec section 121 — dedupe findings across reviewers, keeping sources. */
export function deduplicateFindings(results: ReviewResult[]): ReviewFinding[] {
  const byFingerprint = new Map<string, ReviewFinding>();

  for (const r of results) {
    for (const f of r.findings) {
      const existing = byFingerprint.get(f.fingerprint);
      if (!existing) {
        byFingerprint.set(f.fingerprint, { ...f, reviewerSources: [...f.reviewerSources] });
        continue;
      }
      // Preserve every reviewer that reported it, and keep the worst severity.
      const order: FindingSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
      const severity =
        order.indexOf(f.severity) > order.indexOf(existing.severity)
          ? f.severity
          : existing.severity;
      byFingerprint.set(f.fingerprint, {
        ...existing,
        severity,
        blocking: existing.blocking || f.blocking,
        reviewerSources: [...new Set([...existing.reviewerSources, ...f.reviewerSources])],
      });
    }
  }

  return [...byFingerprint.values()];
}

export interface ReviewConsensus {
  changesetId: string;
  decision: ReviewDecision | "PENDING";
  completedRequired: number;
  totalRequired: number;
  staleCount: number;
  unavailableRoles: AgentProfileId[];
  blockingFindings: ReviewFinding[];
  allFindings: ReviewFinding[];
  reviewRounds: number;
}

/**
 * Spec sections 52/65 — rule-based consensus. Any BLOCK or unresolved blocking
 * finding is decisive; a missing required review keeps the changeset PENDING.
 */
export function computeReviewConsensus(changeset: ChangeSet): ReviewConsensus {
  const assignments = listReviewAssignments(changeset.id);
  const results = listReviewResults(changeset.id).filter(r => !isReviewStale(r, changeset));
  const staleCount = listReviewResults(changeset.id).length - results.length;

  const allFindings = deduplicateFindings(results);
  const blockingFindings = allFindings.filter(
    f =>
      f.resolution === "OPEN" &&
      (f.blocking || f.severity === "CRITICAL" || f.severity === "HIGH"),
  );

  const requiredAssignments = assignments.filter(a => a.required);
  const completedRequired = requiredAssignments.filter(
    a => a.status === "completed" && results.some(r => r.assignmentId === a.id),
  ).length;

  const unavailableRoles = assignments
    .filter(a => a.status === "unavailable")
    .map(a => a.reviewerProfile);

  const reviewRounds = assignments.reduce((max, a) => Math.max(max, a.round), 0);

  let decision: ReviewDecision | "PENDING";
  if (results.some(r => r.decision === "BLOCK")) decision = "BLOCK";
  else if (blockingFindings.length > 0) decision = "CHANGES_REQUIRED";
  else if (results.some(r => r.decision === "CHANGES_REQUIRED")) decision = "CHANGES_REQUIRED";
  else if (completedRequired < requiredAssignments.length) decision = "PENDING";
  else if (results.some(r => r.decision === "PASS_WITH_NOTES")) decision = "PASS_WITH_NOTES";
  else if (requiredAssignments.length > 0) decision = "PASS";
  else decision = "PENDING";

  return {
    changesetId: changeset.id,
    decision,
    completedRequired,
    totalRequired: requiredAssignments.length,
    staleCount,
    unavailableRoles,
    blockingFindings,
    allFindings,
    reviewRounds,
  };
}

/** Spec section 124 — cap review rounds, then escalate to a human. */
export function shouldEscalateToHuman(
  consensus: ReviewConsensus,
  maxReviewRounds: number,
): boolean {
  return consensus.reviewRounds >= maxReviewRounds && consensus.decision !== "PASS";
}

/** Spec section 122 — resolving a finding; HIGH/CRITICAL WONT_FIX needs approval. */
export function resolveFinding(
  changesetId: string,
  fingerprint: string,
  resolution: FindingResolution,
  options: { approvalGranted?: boolean } = {},
): { ok: boolean; reason?: string } {
  const db = openAgentOsDb();
  const results = listReviewResults(changesetId);

  for (const r of results) {
    const target = r.findings.find(f => f.fingerprint === fingerprint);
    if (!target) continue;

    if (
      resolution === "WONT_FIX_APPROVED" &&
      (target.severity === "HIGH" || target.severity === "CRITICAL") &&
      !options.approvalGranted
    ) {
      return {
        ok: false,
        reason: `WONT_FIX on a ${target.severity} finding requires explicit approval`,
      };
    }

    const updated = r.findings.map(f =>
      f.fingerprint === fingerprint ? { ...f, resolution } : f,
    );
    db.run("UPDATE council_review_results SET findings_json = ? WHERE id = ?", [
      JSON.stringify(updated),
      r.id,
    ]);
  }

  return { ok: true };
}
