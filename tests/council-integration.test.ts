// Phase 20.4 — Conflict analysis, integration lane, merge readiness
// (spec sections 61-78, 168, 169, 171, 177, 178).
//
// Uses real git operations on a throwaway fixture repo (spec section 163).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { runGit } from "../src/agent-os/council/git-safety";
import { createCouncilWorktree } from "../src/agent-os/council/worktrees";
import { loadCouncilConfig } from "../src/agent-os/council/config";
import { registerChangeSet } from "../src/agent-os/council/changesets";
import {
  trialMerge,
  analyzeChangeSetPair,
  classifyConflictType,
  listConflictCases,
  resolveConflictCase,
  detectMigrationOrderRisk,
} from "../src/agent-os/council/conflicts";
import {
  enqueueMergeCandidate,
  listMergeQueue,
  scoreCandidate,
  updateCandidate,
  supersedeOnBaseChange,
  runIntegration,
  computeMergeReadiness,
  assertMergeAuthorized,
} from "../src/agent-os/council/merge-queue";
import {
  createVerificationBundle,
  evaluateChecksPassed,
  attributeFailures,
  isBundleCurrent,
} from "../src/agent-os/council/verification";
import { assignReviews, recordReviewResult, computeReviewConsensus, requiredReviewerRoles, ReviewerIndependenceError, deduplicateFindings, isReviewStale } from "../src/agent-os/council/reviewers";
import type { ChangeSet, CouncilConfig, VerificationCheck } from "../src/agent-os/council/types";

const tempHomes: string[] = [];
let repo = "";
let config: CouncilConfig;

function openFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "council-int-db-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  require("../src/agent-os/db").openAgentOsDb(dir);
}

async function git(args: string[], cwd = repo): Promise<void> {
  const res = await runGit(args, { cwd });
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

async function headSha(cwd = repo): Promise<string> {
  const res = await runGit(["rev-parse", "HEAD"], { cwd });
  return res.stdout.trim();
}

function write(cwd: string, file: string, content: string): void {
  const target = join(cwd, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

beforeEach(async () => {
  openFreshDb();
  repo = mkdtempSync(join(tmpdir(), "council-int-repo-"));
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.email", "fixture@example.com"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "commit.gpgsign", "false"]);
  write(repo, "shared.txt", "line1\nline2\nline3\n");
  write(repo, "other.txt", "other\n");
  await git(["add", "."]);
  await git(["commit", "-m", "initial"]);

  config = {
    ...loadCouncilConfig({}),
    worktreeRoot: join(repo, ".pao", "worktrees"),
    minFreeDiskBytes: 0,
  };
});

afterEach(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
  if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
});

/** Make a worktree, edit a file, commit, and register the changeset. */
async function makeTaskChangeSet(
  runId: string,
  taskKey: string,
  file: string,
  content: string,
  baseSha: string,
): Promise<{ changeset: ChangeSet; worktreePath: string }> {
  const wt = await createCouncilWorktree({
    repoRoot: repo,
    councilRunId: runId,
    cycleId: "cycle-1",
    taskKey,
    baseSha,
    config,
    protectedWorktree: repo,
  });

  write(wt.path, file, content);
  await git(["add", file], wt.path);
  await git(["commit", "-m", `pao: ${taskKey}`], wt.path);
  const head = await headSha(wt.path);

  const { changeset } = await registerChangeSet({
    councilRunId: runId,
    taskKey,
    worktreeId: wt.id,
    worktreePath: wt.path,
    baseSha,
    headSha: head,
    risk: "MEDIUM",
  });

  return { changeset, worktreePath: wt.path };
}

describe("trial merge without touching a working tree (spec section 62)", () => {
  it("reports a clean merge for disjoint changes", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r1", "T1", "fileA.txt", "A\n", base);
    const b = await makeTaskChangeSet("r1", "T2", "fileB.txt", "B\n", base);

    const trial = await trialMerge(repo, base, a.changeset.headSha, b.changeset.headSha);
    expect(trial.unsupported).toBe(false);
    expect(trial.clean).toBe(true);
    expect(trial.treeSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("detects a real content conflict on the same lines", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r1", "T1", "shared.txt", "AAA\nline2\nline3\n", base);
    const b = await makeTaskChangeSet("r1", "T2", "shared.txt", "BBB\nline2\nline3\n", base);

    const trial = await trialMerge(repo, base, a.changeset.headSha, b.changeset.headSha);
    expect(trial.clean).toBe(false);
    expect(trial.conflictedFiles.join(" ")).toContain("shared.txt");
  });

  it("leaves the user's working tree untouched during trial merge (spec section 62)", async () => {
    const base = await headSha();
    write(repo, "user-wip.txt", "user scratch\n");
    const a = await makeTaskChangeSet("r1", "T1", "shared.txt", "AAA\nline2\nline3\n", base);
    const b = await makeTaskChangeSet("r1", "T2", "shared.txt", "BBB\nline2\nline3\n", base);

    await trialMerge(repo, base, a.changeset.headSha, b.changeset.headSha);

    // Still on main, still dirty in exactly the way we left it.
    const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo });
    expect(branch.stdout.trim()).toBe("main");
    expect(existsSync(join(repo, "user-wip.txt"))).toBe(true);
    expect(await headSha()).toBe(base);
  });
});

describe("conflict cases (spec sections 61, 73, 74)", () => {
  it("records an open conflict case for a clashing pair", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r2", "T1", "shared.txt", "AAA\nline2\nline3\n", base);
    const b = await makeTaskChangeSet("r2", "T2", "shared.txt", "BBB\nline2\nline3\n", base);

    const analysis = await analyzeChangeSetPair({
      repoRoot: repo, councilRunId: "r2", baseSha: base,
      a: a.changeset, b: b.changeset,
    });

    expect(analysis.clean).toBe(false);
    expect(analysis.conflictCase).not.toBeNull();
    expect(listConflictCases("r2", "open").length).toBe(1);
  });

  it("records no conflict case for a clean pair", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r3", "T1", "x.txt", "X\n", base);
    const b = await makeTaskChangeSet("r3", "T2", "y.txt", "Y\n", base);

    const analysis = await analyzeChangeSetPair({
      repoRoot: repo, councilRunId: "r3", baseSha: base,
      a: a.changeset, b: b.changeset,
    });
    expect(analysis.clean).toBe(true);
    expect(listConflictCases("r3").length).toBe(0);
  });

  it("classifies lockfile and migration conflicts distinctly", () => {
    expect(classifyConflictType(["bun.lock"])).toBe("LOCKFILE");
    expect(classifyConflictType(["migrations/001.sql"])).toBe("MIGRATION_ORDER");
    expect(classifyConflictType(["src/a.ts"])).toBe("TEXTUAL");
  });

  it("refuses to resolve a conflict without a reviewable changeset (spec section 74)", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r4", "T1", "shared.txt", "AAA\nline2\nline3\n", base);
    const b = await makeTaskChangeSet("r4", "T2", "shared.txt", "BBB\nline2\nline3\n", base);
    const analysis = await analyzeChangeSetPair({
      repoRoot: repo, councilRunId: "r4", baseSha: base, a: a.changeset, b: b.changeset,
    });

    const id = analysis.conflictCase!.id;
    const bad = resolveConflictCase(id, { resolver: "agent", resolutionChangesetId: null });
    expect(bad.ok).toBe(false);
    expect(listConflictCases("r4", "open").length).toBe(1);

    const good = resolveConflictCase(id, { resolver: "agent", resolutionChangesetId: "cchg_fix" });
    expect(good.ok).toBe(true);
    expect(listConflictCases("r4", "open").length).toBe(0);
  });

  it("flags multiple migration-bearing changesets (spec section 108)", () => {
    const cs = (key: string, migrations: string[]): ChangeSet => ({
      id: `cs_${key}`, councilRunId: "r", taskKey: key, worktreeId: "w", agentRunId: null,
      baseSha: "b", headSha: "h", diffHash: "d", filesChanged: migrations, insertions: 1,
      deletions: 0, generatedFiles: [], migrationFiles: migrations, risk: "HIGH",
      scopeDrift: false, scopeDriftPaths: [], revision: 1, createdAt: "",
    });
    const risk = detectMigrationOrderRisk([cs("T1", ["migrations/1.sql"]), cs("T2", ["migrations/2.sql"])]);
    expect(risk.atRisk).toBe(true);
    expect(risk.taskKeys).toEqual(["T1", "T2"]);
  });
});

describe("integration lane (spec sections 68, 69, 71)", () => {
  it("applies disjoint changesets into the integration worktree", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r5", "T1", "fileA.txt", "A\n", base);
    const b = await makeTaskChangeSet("r5", "T2", "fileB.txt", "B\n", base);

    const integ = await createCouncilWorktree({
      repoRoot: repo, councilRunId: "r5", cycleId: "cycle-1", taskKey: null,
      baseSha: base, config, protectedWorktree: repo, isIntegration: true,
    });

    const outcome = await runIntegration({
      councilRunId: "r5",
      integrationWorktreePath: integ.path,
      integrationWorktreeId: integ.id,
      baseSha: base,
      changesets: [a.changeset, b.changeset],
      config,
      protectedWorktree: repo,
    });

    expect(outcome.appliedChangesetIds.length).toBe(2);
    expect(outcome.conflictedChangesetId).toBeNull();
    expect(existsSync(join(integ.path, "fileA.txt"))).toBe(true);
    expect(existsSync(join(integ.path, "fileB.txt"))).toBe(true);
  });

  it("stops at the first conflict and reports it instead of forcing", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r6", "T1", "shared.txt", "AAA\nline2\nline3\n", base);
    const b = await makeTaskChangeSet("r6", "T2", "shared.txt", "BBB\nline2\nline3\n", base);

    const integ = await createCouncilWorktree({
      repoRoot: repo, councilRunId: "r6", cycleId: "cycle-1", taskKey: null,
      baseSha: base, config, protectedWorktree: repo, isIntegration: true,
    });

    const outcome = await runIntegration({
      councilRunId: "r6",
      integrationWorktreePath: integ.path,
      integrationWorktreeId: integ.id,
      baseSha: base,
      changesets: [a.changeset, b.changeset],
      config,
      protectedWorktree: repo,
    });

    expect(outcome.integrationRun.status).toBe("CONFLICTED");
    expect(outcome.conflictedChangesetId).toBe(b.changeset.id);
    expect(outcome.appliedChangesetIds).toEqual([a.changeset.id]);
    expect(outcome.integrationRun.failureReason).toContain("conflict");
  });

  it("never integrates into the user's checkout (spec section 26)", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r7", "T1", "fileA.txt", "A\n", base);
    const integ = await createCouncilWorktree({
      repoRoot: repo, councilRunId: "r7", cycleId: "cycle-1", taskKey: null,
      baseSha: base, config, protectedWorktree: repo, isIntegration: true,
    });

    await runIntegration({
      councilRunId: "r7", integrationWorktreePath: integ.path, integrationWorktreeId: integ.id,
      baseSha: base, changesets: [a.changeset], config, protectedWorktree: repo,
    });

    // User's checkout must not have gained the integrated file.
    expect(existsSync(join(repo, "fileA.txt"))).toBe(false);
    expect(await headSha()).toBe(base);
  });
});

describe("merge queue ordering & supersede (spec sections 66, 178)", () => {
  it("scores a risky, drifting, migration-bearing changeset lower", () => {
    const safe: ChangeSet = {
      id: "cs1", councilRunId: "r", taskKey: "T1", worktreeId: "w", agentRunId: null,
      baseSha: "b", headSha: "h", diffHash: "d", filesChanged: ["a.ts"], insertions: 10,
      deletions: 2, generatedFiles: [], migrationFiles: [], risk: "LOW",
      scopeDrift: false, scopeDriftPaths: [], revision: 1, createdAt: "",
    };
    const risky: ChangeSet = {
      ...safe, id: "cs2", risk: "CRITICAL", migrationFiles: ["migrations/1.sql"],
      scopeDrift: true, insertions: 2000,
    };
    expect(scoreCandidate([safe])).toBeGreaterThan(scoreCandidate([risky]));
  });

  it("orders the queue by score then FIFO", () => {
    const a = enqueueMergeCandidate({ councilRunId: "rq", changesetIds: [], targetBaseSha: "base1" });
    const b = enqueueMergeCandidate({ councilRunId: "rq", changesetIds: [], targetBaseSha: "base1" });
    const queue = listMergeQueue("rq");
    expect(queue.length).toBe(2);
    expect(queue[0]!.position).toBeLessThan(queue[1]!.position);
    void a; void b;
  });

  it("supersedes candidates when the target base moves (spec section 178)", () => {
    enqueueMergeCandidate({ councilRunId: "rq2", changesetIds: [], targetBaseSha: "oldbase" });
    const affected = supersedeOnBaseChange("rq2", "newbase");
    expect(affected.length).toBe(1);
    expect(listMergeQueue("rq2")[0]!.status).toBe("SUPERSEDED");
  });

  it("tracks candidate gate status updates", () => {
    const c = enqueueMergeCandidate({ councilRunId: "rq3", changesetIds: [], targetBaseSha: "b" });
    updateCandidate(c.id, { status: "READY", verificationStatus: "PASS", reviewStatus: "PASS" });
    const updated = listMergeQueue("rq3")[0]!;
    expect(updated.status).toBe("READY");
    expect(updated.verificationStatus).toBe("PASS");
  });
});

describe("verification bundles & attribution (spec sections 59, 115, 116)", () => {
  function check(over: Partial<VerificationCheck>): VerificationCheck {
    return {
      name: "typecheck", command: "bun run typecheck", outcome: "PASS", exitCode: 0,
      outputSummary: "", logRef: null, durationMs: 1, origin: "PRE_EXISTING",
      timestamp: "", ...over,
    };
  }

  it("passes when all checks pass", () => {
    expect(evaluateChecksPassed([check({}), check({ name: "tests" })])).toBe(true);
  });

  it("fails when a failure was INTRODUCED", () => {
    expect(evaluateChecksPassed([check({ outcome: "FAIL", origin: "INTRODUCED" })])).toBe(false);
  });

  it("does not blame the agent for a PRE_EXISTING failure (spec section 116)", () => {
    expect(evaluateChecksPassed([check({ outcome: "FAIL", origin: "PRE_EXISTING" })])).toBe(true);
  });

  it("treats an unattributed failure as blocking", () => {
    expect(evaluateChecksPassed([check({ outcome: "FAIL", origin: "UNKNOWN" })])).toBe(false);
  });

  it("separates introduced from pre-existing failures", () => {
    const checks = [
      check({ name: "a", outcome: "FAIL", origin: "INTRODUCED" }),
      check({ name: "b", outcome: "FAIL", origin: "PRE_EXISTING" }),
      check({ name: "c", outcome: "FLAKY_SUSPECTED", origin: "UNKNOWN" }),
    ];
    const attribution = attributeFailures(checks);
    expect(attribution.introduced.map(c => c.name)).toEqual(["a"]);
    expect(attribution.preExisting.map(c => c.name)).toEqual(["b"]);
    expect(attribution.flaky.map(c => c.name)).toEqual(["c"]);
  });

  it("binds a bundle to its commit (spec section 60)", () => {
    const bundle = createVerificationBundle({
      councilRunId: "rv", scope: "CHANGESET", commitSha: "abc123", checks: [check({})],
    });
    expect(isBundleCurrent(bundle, "abc123")).toBe(true);
    expect(isBundleCurrent(bundle, "def456")).toBe(false);
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("reviewer quorum & independence (spec sections 22, 80)", () => {
  it("requires more reviewers as risk rises", () => {
    expect(requiredReviewerRoles("BACKEND", "LOW").required.length).toBe(1);
    expect(requiredReviewerRoles("BACKEND", "HIGH").required.length).toBeGreaterThan(1);
    expect(requiredReviewerRoles("SECURITY", "CRITICAL").required).toContain("security_reviewer");
  });

  it("requires human approval for CRITICAL risk", () => {
    expect(requiredReviewerRoles("BACKEND", "CRITICAL").humanApprovalRequired).toBe(true);
    expect(requiredReviewerRoles("BACKEND", "LOW").humanApprovalRequired).toBe(false);
  });

  it("refuses a review authored by the implementer (spec section 22)", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r8", "T1", "fileA.txt", "A\n", base);
    const { assignments } = assignReviews({
      councilRunId: "r8", changeset: a.changeset, taskClass: "BACKEND",
      risk: "MEDIUM", implementerProfileId: "backend_implementer",
    });

    expect(() =>
      recordReviewResult({
        assignmentId: assignments[0]!.id,
        changeset: a.changeset,
        reviewerProfile: assignments[0]!.reviewerProfile,
        decision: "PASS",
        reviewerIsImplementer: true,
      }),
    ).toThrow(ReviewerIndependenceError);
  });

  it("keeps a changeset PENDING until all required reviews land", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r9", "T1", "fileA.txt", "A\n", base);
    assignReviews({
      councilRunId: "r9", changeset: a.changeset, taskClass: "SECURITY",
      risk: "HIGH", implementerProfileId: "backend_implementer",
    });
    expect(computeReviewConsensus(a.changeset).decision).toBe("PENDING");
  });

  it("reaches PASS when every required reviewer approves", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r10", "T1", "fileA.txt", "A\n", base);
    const { assignments } = assignReviews({
      councilRunId: "r10", changeset: a.changeset, taskClass: "DOCS",
      risk: "LOW", implementerProfileId: "docs_engineer",
    });
    for (const asg of assignments) {
      recordReviewResult({
        assignmentId: asg.id, changeset: a.changeset,
        reviewerProfile: asg.reviewerProfile, decision: "PASS",
      });
    }
    expect(computeReviewConsensus(a.changeset).decision).toBe("PASS");
  });

  it("blocks on a CRITICAL finding", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r11", "T1", "fileA.txt", "A\n", base);
    const { assignments } = assignReviews({
      councilRunId: "r11", changeset: a.changeset, taskClass: "DOCS",
      risk: "LOW", implementerProfileId: "docs_engineer",
    });
    recordReviewResult({
      assignmentId: assignments[0]!.id, changeset: a.changeset,
      reviewerProfile: assignments[0]!.reviewerProfile, decision: "CHANGES_REQUIRED",
      findings: [{
        severity: "CRITICAL", category: "security", file: "fileA.txt", line: 1,
        title: "hardcoded credential", description: "d", evidence: null,
        suggestedFix: "use env", blocking: true,
      }],
    });
    const consensus = computeReviewConsensus(a.changeset);
    expect(consensus.decision).toBe("CHANGES_REQUIRED");
    expect(consensus.blockingFindings.length).toBe(1);
  });

  it("marks a review stale when the diff changes (spec section 53)", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r12", "T1", "fileA.txt", "A\n", base);
    const { assignments } = assignReviews({
      councilRunId: "r12", changeset: a.changeset, taskClass: "DOCS",
      risk: "LOW", implementerProfileId: "docs_engineer",
    });
    const result = recordReviewResult({
      assignmentId: assignments[0]!.id, changeset: a.changeset,
      reviewerProfile: assignments[0]!.reviewerProfile, decision: "PASS",
    });

    const moved: ChangeSet = { ...a.changeset, diffHash: "different", headSha: "newhead" };
    expect(isReviewStale(result, moved)).toBe(true);
    expect(computeReviewConsensus(moved).decision).not.toBe("PASS");
  });

  it("dedupes identical findings across reviewers but keeps sources", () => {
    const mk = (profile: string) => ({
      id: "x", assignmentId: "a", changesetId: "c",
      reviewerProfile: profile as never, decision: "CHANGES_REQUIRED" as const,
      severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
      findings: [{
        id: "f", severity: "HIGH" as const, category: "perf", file: "a.ts", line: 5,
        title: "n+1 query", description: "d", evidence: null, suggestedFix: null,
        blocking: true, fingerprint: "same-fp", resolution: "OPEN" as const,
        reviewerSources: [profile],
      }],
      requiredFixes: [], suggestions: [], evidence: null,
      reviewedDiffHash: "d", reviewedHeadSha: "h", createdAt: "",
    });
    const deduped = deduplicateFindings([mk("architecture_reviewer"), mk("api_reviewer")]);
    expect(deduped.length).toBe(1);
    expect(deduped[0]!.reviewerSources.length).toBe(2);
  });
});

describe("merge readiness is evidence-gated (spec sections 65, 75, 177)", () => {
  it("is not ready with no changesets", () => {
    const report = computeMergeReadiness({ councilRunId: "empty", baseSha: "b" });
    expect(report.ready).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("no changesets");
  });

  it("blocks when verification evidence is missing", async () => {
    const base = await headSha();
    await makeTaskChangeSet("r13", "T1", "fileA.txt", "A\n", base);
    const report = computeMergeReadiness({ councilRunId: "r13", baseSha: base });
    expect(report.ready).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("no verification evidence");
  });

  it("blocks when reviews are incomplete even if verification passed", async () => {
    const base = await headSha();
    const a = await makeTaskChangeSet("r14", "T1", "fileA.txt", "A\n", base);
    createVerificationBundle({
      councilRunId: "r14", scope: "CHANGESET", commitSha: a.changeset.headSha,
      changesetId: a.changeset.id,
      checks: [{
        name: "typecheck", command: "c", outcome: "PASS", exitCode: 0, outputSummary: "",
        logRef: null, durationMs: 1, origin: "PRE_EXISTING", timestamp: "",
      }],
    });
    assignReviews({
      councilRunId: "r14", changeset: a.changeset, taskClass: "BACKEND",
      risk: "MEDIUM", implementerProfileId: "backend_implementer",
    });

    const report = computeMergeReadiness({ councilRunId: "r14", baseSha: base });
    expect(report.ready).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("review incomplete");
  });

  it("blocks an unapproved CRITICAL run", async () => {
    const base = await headSha();
    await makeTaskChangeSet("r15", "T1", "fileA.txt", "A\n", base);
    const report = computeMergeReadiness({
      councilRunId: "r15", baseSha: base,
      approvalRequired: true, approvalStatus: "pending",
    });
    expect(report.ready).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("human approval pending");
  });

  it("refuses to authorize a merge into a protected branch (spec sections 75, 76)", () => {
    const readyReport = {
      councilRunId: "r", ready: true, baseSha: "b", integrationSha: "h", score: 100,
      blockingReasons: [], taskKeys: [], changesetIds: [], verificationBundleIds: [],
      reviewSummary: { total: 1, passed: 1, changesRequired: 0, blocked: 0, stale: 0 },
      openBlockingFindings: 0, unresolvedConflicts: 0, approvalRequired: false,
      approvalStatus: "not_required", knownLimitations: [], generatedAt: "",
    };
    const blocked = assertMergeAuthorized(readyReport, "main", config, true);
    expect(blocked.authorized).toBe(false);
    expect(blocked.reason).toContain("protected");

    const allowed = assertMergeAuthorized(readyReport, "feature/x", config, false);
    expect(allowed.authorized).toBe(true);
  });

  it("never authorizes a merge that is not ready", () => {
    const notReady = {
      councilRunId: "r", ready: false, baseSha: "b", integrationSha: null, score: 10,
      blockingReasons: ["verification failed"], taskKeys: [], changesetIds: [],
      verificationBundleIds: [],
      reviewSummary: { total: 1, passed: 0, changesRequired: 1, blocked: 0, stale: 0 },
      openBlockingFindings: 1, unresolvedConflicts: 0, approvalRequired: false,
      approvalStatus: "not_required", knownLimitations: [], generatedAt: "",
    };
    expect(assertMergeAuthorized(notReady, "feature/x", config, false).authorized).toBe(false);
  });

  it("surfaces scope drift as a known limitation rather than hiding it", async () => {
    const base = await headSha();
    const wt = await createCouncilWorktree({
      repoRoot: repo, councilRunId: "r16", cycleId: "cycle-1", taskKey: "T1",
      baseSha: base, config, protectedWorktree: repo,
    });
    write(wt.path, "unexpected.txt", "drift\n");
    await git(["add", "unexpected.txt"], wt.path);
    await git(["commit", "-m", "drift"], wt.path);
    const head = await headSha(wt.path);

    await registerChangeSet({
      councilRunId: "r16", taskKey: "T1", worktreeId: wt.id, worktreePath: wt.path,
      baseSha: base, headSha: head, risk: "MEDIUM",
      manifest: {
        taskKey: "T1", expectedReadPaths: ["src/"], expectedWritePaths: ["src/"],
        possibleGeneratedPaths: [], forbiddenPaths: [".git/", ".env"],
      },
    });

    const report = computeMergeReadiness({ councilRunId: "r16", baseSha: base });
    expect(report.knownLimitations.join(" ")).toContain("outside declared scope");
  });
});
