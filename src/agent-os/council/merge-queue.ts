// Phase 20.4 — Merge Queue, Integration Lane & Merge Readiness
// (spec sections 64-72, 75-78, 137-140, 155, 178).
//
// Integration happens in a dedicated worktree, never in the user's checkout.
// MERGE_READY is a *report*, not an action: the final merge into a protected
// branch stays a human decision unless explicitly configured otherwise.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { runGit } from "./git-safety";
import { getChangeSet, latestChangeSetsByTask } from "./changesets";
import { computeReviewConsensus } from "./reviewers";
import {
  latestBundleForChangeset,
  isBundleCurrent,
  createVerificationBundle,
  type CheckSpec,
  runChecks,
} from "./verification";
import { analyzeChangeSetPair, listConflictCases, detectMigrationOrderRisk } from "./conflicts";
import type {
  ChangeSet,
  CheckOutcome,
  CouncilConfig,
  IntegrationRun,
  IntegrationRunStatus,
  IntegrationStrategy,
  MergeCandidate,
  MergeQueueState,
  MergeReadinessReport,
  ReviewDecision,
  VerificationCheck,
} from "./types";

// --- Merge queue ----------------------------------------------------------

export interface EnqueueCandidateInput {
  councilRunId: string;
  changesetIds: string[];
  targetBaseSha: string;
}

/** Spec section 66 — score decides queue order: safest and smallest first. */
export function scoreCandidate(changesets: ChangeSet[]): number {
  let score = 100;

  for (const cs of changesets) {
    if (cs.migrationFiles.length > 0) score -= 25;
    if (cs.risk === "CRITICAL") score -= 30;
    else if (cs.risk === "HIGH") score -= 15;
    else if (cs.risk === "MEDIUM") score -= 5;
    if (cs.scopeDrift) score -= 10;

    const churn = cs.insertions + cs.deletions;
    if (churn > 1000) score -= 15;
    else if (churn > 300) score -= 8;
    else if (churn > 100) score -= 3;

    if (cs.filesChanged.length > 30) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function enqueueMergeCandidate(input: EnqueueCandidateInput): MergeCandidate {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const changesets = input.changesetIds
    .map(id => getChangeSet(id))
    .filter((c): c is ChangeSet => c !== null);

  const score = scoreCandidate(changesets);

  const positionRow = db
    .query("SELECT COALESCE(MAX(position), 0) AS p FROM council_merge_candidates WHERE council_run_id = ?")
    .get(input.councilRunId) as { p: number };

  const candidate: MergeCandidate = {
    id: `cmc_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    changesetIds: input.changesetIds,
    targetBaseSha: input.targetBaseSha,
    status: "PENDING",
    conflictStatus: "NONE",
    verificationStatus: "NOT_RUN",
    reviewStatus: "PENDING",
    approvalStatus: "not_required",
    score,
    position: positionRow.p + 1,
    createdAt: now,
  };

  db.query(
    `INSERT INTO council_merge_candidates
       (id, council_run_id, changeset_ids_json, target_base_sha, status, conflict_status,
        verification_status, review_status, approval_status, score, position, created_at)
     VALUES (?, ?, ?, ?, 'PENDING', 'NONE', 'NOT_RUN', 'PENDING', 'not_required', ?, ?, ?)`,
  ).run(
    candidate.id,
    candidate.councilRunId,
    JSON.stringify(candidate.changesetIds),
    candidate.targetBaseSha,
    candidate.score,
    candidate.position,
    candidate.createdAt,
  );

  return candidate;
}

function rowToCandidate(r: Record<string, unknown>): MergeCandidate {
  return {
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    changesetIds: JSON.parse(r.changeset_ids_json as string) as string[],
    targetBaseSha: r.target_base_sha as string,
    status: r.status as MergeQueueState,
    conflictStatus: r.conflict_status as MergeCandidate["conflictStatus"],
    verificationStatus: r.verification_status as CheckOutcome,
    reviewStatus: r.review_status as MergeCandidate["reviewStatus"],
    approvalStatus: r.approval_status as MergeCandidate["approvalStatus"],
    score: r.score as number,
    position: r.position as number,
    createdAt: r.created_at as string,
  };
}

/** Spec section 66 — ordering: score desc, then FIFO by position. */
export function listMergeQueue(councilRunId: string): MergeCandidate[] {
  const db = openAgentOsDb();
  const rows = db
    .query(
      `SELECT * FROM council_merge_candidates
       WHERE council_run_id = ? ORDER BY score DESC, position ASC`,
    )
    .all(councilRunId) as Array<Record<string, unknown>>;
  return rows.map(rowToCandidate);
}

export function updateCandidate(
  candidateId: string,
  patch: Partial<
    Pick<
      MergeCandidate,
      "status" | "conflictStatus" | "verificationStatus" | "reviewStatus" | "approvalStatus"
    >
  >,
): void {
  const db = openAgentOsDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.status) { sets.push("status = ?"); vals.push(patch.status); }
  if (patch.conflictStatus) { sets.push("conflict_status = ?"); vals.push(patch.conflictStatus); }
  if (patch.verificationStatus) { sets.push("verification_status = ?"); vals.push(patch.verificationStatus); }
  if (patch.reviewStatus) { sets.push("review_status = ?"); vals.push(patch.reviewStatus); }
  if (patch.approvalStatus) { sets.push("approval_status = ?"); vals.push(patch.approvalStatus); }
  if (sets.length === 0) return;

  vals.push(candidateId);
  db.run(`UPDATE council_merge_candidates SET ${sets.join(", ")} WHERE id = ?`, vals as never[]);
}

/**
 * Spec section 178 — if the target branch moved, every candidate validated
 * against the old base is superseded and must be re-verified.
 */
export function supersedeOnBaseChange(
  councilRunId: string,
  newBaseSha: string,
): MergeCandidate[] {
  const db = openAgentOsDb();
  const affected = listMergeQueue(councilRunId).filter(
    c => c.targetBaseSha !== newBaseSha && c.status !== "SUPERSEDED",
  );
  for (const c of affected) {
    db.run("UPDATE council_merge_candidates SET status = 'SUPERSEDED' WHERE id = ?", [c.id]);
  }
  return affected;
}

// --- Integration lane -----------------------------------------------------

export interface IntegrationInput {
  councilRunId: string;
  integrationWorktreePath: string;
  integrationWorktreeId: string;
  baseSha: string;
  /** Ordered changesets to apply (see planner.computeIntegrationOrder). */
  changesets: ChangeSet[];
  strategy?: IntegrationStrategy;
  config: CouncilConfig;
  protectedWorktree: string;
}

export interface IntegrationOutcome {
  integrationRun: IntegrationRun;
  conflictedChangesetId: string | null;
  appliedChangesetIds: string[];
}

/**
 * Spec sections 68/69/71 — apply changesets one at a time in the integration
 * worktree. Stops at the first conflict and reports it rather than forcing.
 */
export async function runIntegration(
  input: IntegrationInput,
): Promise<IntegrationOutcome> {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const strategy = input.strategy ?? "SEQUENTIAL_APPLY";
  const id = `cir_${randomUUID().slice(0, 12)}`;

  const integrationRun: IntegrationRun = {
    id,
    councilRunId: input.councilRunId,
    worktreeId: input.integrationWorktreeId,
    strategy,
    baseSha: input.baseSha,
    headSha: null,
    candidateIds: [],
    appliedChangesetIds: [],
    status: "RUNNING",
    verificationBundleId: null,
    failureReason: null,
    createdAt: now,
    endedAt: null,
  };

  db.query(
    `INSERT INTO council_integration_runs
       (id, council_run_id, worktree_id, strategy, base_sha, head_sha, candidate_ids_json,
        applied_changeset_ids_json, status, verification_bundle_id, failure_reason, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, NULL, '[]', '[]', 'RUNNING', NULL, NULL, ?, NULL)`,
  ).run(id, input.councilRunId, input.integrationWorktreeId, strategy, input.baseSha, now);

  const applied: string[] = [];
  let conflictedChangesetId: string | null = null;
  let failureReason: string | null = null;

  // Reset the integration worktree to the pinned base. --hard is banned by the
  // safety guard, so we check out the base commit explicitly instead.
  const checkout = await runGit(["checkout", "--detach", input.baseSha], {
    cwd: input.integrationWorktreePath,
    protectedWorktree: input.protectedWorktree,
    timeoutMs: input.config.commandTimeoutMs,
  });
  if (!checkout.ok) {
    failureReason = `failed to position integration worktree at ${input.baseSha}: ${checkout.stderr}`;
  }

  if (!failureReason) {
    for (const cs of input.changesets) {
      // cherry-pick the changeset's commit range onto the integration head.
      const res = await runGit(
        ["cherry-pick", "--allow-empty", `${cs.baseSha}..${cs.headSha}`],
        {
          cwd: input.integrationWorktreePath,
          protectedWorktree: input.protectedWorktree,
          timeoutMs: input.config.commandTimeoutMs,
        },
      );

      if (res.ok) {
        applied.push(cs.id);
        continue;
      }

      conflictedChangesetId = cs.id;
      failureReason = `cherry-pick of ${cs.taskKey} (${cs.id}) conflicted: ${
        res.stderr || res.stdout
      }`;

      // Abort the in-progress pick so the worktree returns to a known state.
      // This is scoped recovery, not a blanket reset.
      await runGit(["cherry-pick", "--abort"], {
        cwd: input.integrationWorktreePath,
        protectedWorktree: input.protectedWorktree,
      });
      break;
    }
  }

  const headRes = await runGit(["rev-parse", "HEAD"], {
    cwd: input.integrationWorktreePath,
  });
  const headSha = headRes.ok ? headRes.stdout.trim() : null;

  const status: IntegrationRunStatus = failureReason
    ? conflictedChangesetId
      ? "CONFLICTED"
      : "FAILED"
    : "VERIFYING";

  db.run(
    `UPDATE council_integration_runs
     SET status = ?, head_sha = ?, applied_changeset_ids_json = ?, failure_reason = ?, ended_at = ?
     WHERE id = ?`,
    [
      status,
      headSha,
      JSON.stringify(applied),
      failureReason,
      failureReason ? new Date().toISOString() : null,
      id,
    ],
  );

  return {
    integrationRun: {
      ...integrationRun,
      status,
      headSha,
      appliedChangesetIds: applied,
      failureReason,
    },
    conflictedChangesetId,
    appliedChangesetIds: applied,
  };
}

/** Spec section 72 — full verification on the integrated result. */
export async function verifyIntegration(
  integrationRun: IntegrationRun,
  options: {
    worktreePath: string;
    councilRunId: string;
    checks?: CheckSpec[];
    baseline?: Map<string, CheckOutcome>;
    timeoutMs?: number;
  },
): Promise<{ bundleId: string; passed: boolean; checks: VerificationCheck[] }> {
  const db = openAgentOsDb();

  const checks = await runChecks({
    cwd: options.worktreePath,
    checks: options.checks,
    baseline: options.baseline,
    timeoutMs: options.timeoutMs,
  });

  const bundle = createVerificationBundle({
    councilRunId: options.councilRunId,
    scope: "INTEGRATION",
    commitSha: integrationRun.headSha ?? integrationRun.baseSha,
    checks,
    integrationRunId: integrationRun.id,
  });

  db.run(
    "UPDATE council_integration_runs SET status = ?, verification_bundle_id = ?, ended_at = ? WHERE id = ?",
    [
      bundle.passed ? "PASSED" : "FAILED",
      bundle.id,
      new Date().toISOString(),
      integrationRun.id,
    ],
  );

  return { bundleId: bundle.id, passed: bundle.passed, checks };
}

export function getIntegrationRun(id: string): IntegrationRun | null {
  const db = openAgentOsDb();
  const r = db.query("SELECT * FROM council_integration_runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    worktreeId: (r.worktree_id as string | null) ?? null,
    strategy: r.strategy as IntegrationStrategy,
    baseSha: r.base_sha as string,
    headSha: (r.head_sha as string | null) ?? null,
    candidateIds: JSON.parse(r.candidate_ids_json as string) as string[],
    appliedChangesetIds: JSON.parse(r.applied_changeset_ids_json as string) as string[],
    status: r.status as IntegrationRunStatus,
    verificationBundleId: (r.verification_bundle_id as string | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
    createdAt: r.created_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
  };
}

// --- Merge readiness (spec section 65) -----------------------------------

export interface MergeReadinessInput {
  councilRunId: string;
  baseSha: string;
  integrationRun?: IntegrationRun | null;
  approvalRequired?: boolean;
  approvalStatus?: string;
}

/**
 * Spec section 65 — rule-based, evidence-backed. Every blocking reason is
 * derived from a stored artifact, never from a model's opinion.
 */
export function computeMergeReadiness(
  input: MergeReadinessInput,
): MergeReadinessReport {
  const blockingReasons: string[] = [];
  const knownLimitations: string[] = [];

  const latest = latestChangeSetsByTask(input.councilRunId);
  const changesets = [...latest.values()];

  const reviewSummary = { total: 0, passed: 0, changesRequired: 0, blocked: 0, stale: 0 };
  let openBlockingFindings = 0;
  const verificationBundleIds: string[] = [];

  for (const cs of changesets) {
    const consensus = computeReviewConsensus(cs);
    reviewSummary.total++;
    reviewSummary.stale += consensus.staleCount;
    openBlockingFindings += consensus.blockingFindings.length;

    switch (consensus.decision) {
      case "PASS":
      case "PASS_WITH_NOTES":
        reviewSummary.passed++;
        break;
      case "CHANGES_REQUIRED":
        reviewSummary.changesRequired++;
        blockingReasons.push(`${cs.taskKey}: review requires changes`);
        break;
      case "BLOCK":
        reviewSummary.blocked++;
        blockingReasons.push(`${cs.taskKey}: review BLOCKED`);
        break;
      case "PENDING":
        blockingReasons.push(
          `${cs.taskKey}: review incomplete (${consensus.completedRequired}/${consensus.totalRequired})`,
        );
        break;
      case "UNAVAILABLE":
        blockingReasons.push(`${cs.taskKey}: required reviewer unavailable`);
        break;
    }

    if (consensus.unavailableRoles.length > 0) {
      knownLimitations.push(
        `${cs.taskKey}: reviewer roles unavailable: ${consensus.unavailableRoles.join(", ")}`,
      );
    }

    // Per-changeset verification must exist and match the current head.
    const bundle = latestBundleForChangeset(cs.id);
    if (!bundle) {
      blockingReasons.push(`${cs.taskKey}: no verification evidence`);
    } else {
      verificationBundleIds.push(bundle.id);
      if (!isBundleCurrent(bundle, cs.headSha)) {
        blockingReasons.push(`${cs.taskKey}: verification is stale for current head`);
      } else if (!bundle.passed) {
        blockingReasons.push(`${cs.taskKey}: verification failed`);
      }
    }

    if (cs.scopeDrift) {
      knownLimitations.push(
        `${cs.taskKey}: touched ${cs.scopeDriftPaths.length} file(s) outside declared scope`,
      );
    }
  }

  // Unresolved conflicts block outright (spec section 73).
  const openConflicts = listConflictCases(input.councilRunId, "open");
  if (openConflicts.length > 0) {
    blockingReasons.push(`${openConflicts.length} unresolved conflict case(s)`);
  }

  // Migration ordering risk is a limitation the human must see (spec section 108).
  const migrationRisk = detectMigrationOrderRisk(changesets);
  if (migrationRisk.atRisk) {
    knownLimitations.push(
      `multiple migration-bearing tasks (${migrationRisk.taskKeys.join(", ")}); ordering must be confirmed`,
    );
  }

  // Integration evidence.
  let integrationSha: string | null = null;
  if (!input.integrationRun) {
    blockingReasons.push("no integration run recorded");
  } else {
    integrationSha = input.integrationRun.headSha;
    if (input.integrationRun.status === "CONFLICTED") {
      blockingReasons.push("integration conflicted");
    } else if (input.integrationRun.status !== "PASSED") {
      blockingReasons.push(`integration not verified (status ${input.integrationRun.status})`);
    }
    if (input.integrationRun.baseSha !== input.baseSha) {
      blockingReasons.push("integration ran against a stale base commit");
    }
  }

  if (changesets.length === 0) blockingReasons.push("no changesets to merge");

  const approvalRequired = input.approvalRequired ?? false;
  const approvalStatus = input.approvalStatus ?? (approvalRequired ? "pending" : "not_required");
  if (approvalRequired && approvalStatus !== "approved") {
    blockingReasons.push(`human approval ${approvalStatus}`);
  }

  const ready = blockingReasons.length === 0;
  const denominator = Math.max(1, reviewSummary.total);
  const score = ready
    ? 100
    : Math.max(0, Math.round((reviewSummary.passed / denominator) * 60));

  return {
    councilRunId: input.councilRunId,
    ready,
    baseSha: input.baseSha,
    integrationSha,
    score,
    blockingReasons,
    taskKeys: changesets.map(c => c.taskKey).sort(),
    changesetIds: changesets.map(c => c.id),
    verificationBundleIds,
    reviewSummary,
    openBlockingFindings,
    unresolvedConflicts: openConflicts.length,
    approvalRequired,
    approvalStatus,
    knownLimitations,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Spec sections 75/76/155 — the final merge. Refuses a protected target unless
 * explicitly enabled; MERGE_READY alone never authorizes the write.
 */
export function assertMergeAuthorized(
  report: MergeReadinessReport,
  targetBranch: string,
  config: CouncilConfig,
  isProtected: boolean,
): { authorized: boolean; reason: string } {
  if (!report.ready) {
    return { authorized: false, reason: `not merge-ready: ${report.blockingReasons.join("; ")}` };
  }
  if (isProtected && !config.autoMergeProtectedBranch) {
    return {
      authorized: false,
      reason: `${targetBranch} is protected; automatic merge is disabled (s75, s76)`,
    };
  }
  return { authorized: true, reason: "merge authorized" };
}
