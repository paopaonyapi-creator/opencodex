// Phase 20.4 — Git Safety tests (spec sections 33, 163, 164, 165).
//
// Spec section 163: these tests operate on a throwaway fixture repository
// created under the OS temp dir. They never touch the developer's own repo.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertGitArgsSafe,
  GitSafetyViolation,
  runGit,
  isMutatingGitCommand,
  isInsideProtectedWorktree,
  inspectWorkingTree,
  resolveCommitSha,
  branchExists,
  gitSupportsWorktree,
  sanitizeRefComponent,
  councilBranchName,
  integrationBranchName,
} from "../src/agent-os/council/git-safety";

let repo = "";

async function git(args: string[], cwd = repo): Promise<void> {
  const res = await runGit(args, { cwd });
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "pao-council-git-"));
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.email", "fixture@example.com"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "a.txt"), "hello\n");
  await git(["add", "a.txt"]);
  await git(["commit", "-m", "initial"]);
});

afterAll(() => {
  if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
});

describe("denylist blocks destructive git (spec section 33)", () => {
  const blocked: Array<[string, string[]]> = [
    ["reset --hard", ["reset", "--hard", "HEAD"]],
    ["clean -fd", ["clean", "-fd"]],
    ["clean --force", ["clean", "--force"]],
    ["push --force", ["push", "--force", "origin", "main"]],
    ["push -f", ["push", "-f"]],
    ["push --force-with-lease", ["push", "--force-with-lease", "origin", "main"]],
    ["checkout -- .", ["checkout", "--", "."]],
    ["restore .", ["restore", "."]],
    ["branch -D", ["branch", "-D", "some-branch"]],
    ["filter-branch", ["filter-branch", "--all"]],
    ["rebase --root", ["rebase", "--root"]],
    ["config --global", ["config", "--global", "user.email", "x@y.z"]],
    ["config --system", ["config", "--system", "core.editor", "vim"]],
    ["remote set-url", ["remote", "set-url", "origin", "http://evil"]],
    ["commit --no-verify", ["commit", "--no-verify", "-m", "x"]],
    ["credential", ["credential", "fill"]],
  ];

  for (const [name, args] of blocked) {
    it(`blocks ${name}`, () => {
      expect(() => assertGitArgsSafe(args)).toThrow(GitSafetyViolation);
    });
  }

  it("still blocks when hidden behind global options", () => {
    expect(() => assertGitArgsSafe(["-C", "/tmp/x", "reset", "--hard"])).toThrow(GitSafetyViolation);
    expect(() => assertGitArgsSafe(["-c", "core.pager=cat", "clean", "-fd"])).toThrow(
      GitSafetyViolation,
    );
  });

  it("allows safe read-only and scoped commands", () => {
    for (const args of [
      ["status", "--porcelain"],
      ["rev-parse", "HEAD"],
      ["diff", "--numstat"],
      ["worktree", "list"],
      ["merge-tree", "a", "b"],
      ["reset", "--soft", "HEAD~1"],
      ["checkout", "-b", "feature/x"],
      ["restore", "--staged", "one-file.ts"],
      ["config", "--local", "user.name", "Council"],
      ["branch", "-d", "merged-branch"],
    ]) {
      expect(() => assertGitArgsSafe(args)).not.toThrow();
    }
  });
});

describe("runGit enforcement", () => {
  it("refuses push unless explicitly allowed (spec section 77)", async () => {
    await expect(runGit(["push", "origin", "main"], { cwd: repo })).rejects.toThrow(
      GitSafetyViolation,
    );
  });

  it("throws rather than executing a denied command", async () => {
    await expect(runGit(["reset", "--hard"], { cwd: repo })).rejects.toThrow(GitSafetyViolation);
    // Fixture must be undamaged.
    const inspect = await inspectWorkingTree(repo);
    expect(inspect.headSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("user worktree protection (spec sections 26, 176)", () => {
  it("identifies paths inside the protected root", () => {
    expect(isInsideProtectedWorktree("C:/repo", "C:/repo")).toBe(true);
    expect(isInsideProtectedWorktree("C:/repo/src", "C:/repo")).toBe(true);
    expect(isInsideProtectedWorktree("C:/other", "C:/repo")).toBe(false);
  });

  it("treats council worktrees under .pao/.claude/.tmp as separate checkouts", () => {
    expect(isInsideProtectedWorktree("C:/repo/.pao/worktrees/task-1", "C:/repo")).toBe(false);
    expect(isInsideProtectedWorktree("C:/repo/.claude/worktrees/x", "C:/repo")).toBe(false);
    expect(isInsideProtectedWorktree("C:/repo/.tmp/worktrees/y", "C:/repo")).toBe(false);
  });

  it("classifies mutating vs read-only subcommands", () => {
    expect(isMutatingGitCommand(["commit", "-m", "x"])).toBe(true);
    expect(isMutatingGitCommand(["merge", "branch"])).toBe(true);
    expect(isMutatingGitCommand(["status", "--porcelain"])).toBe(false);
    expect(isMutatingGitCommand(["rev-parse", "HEAD"])).toBe(false);
  });

  it("blocks a mutating command aimed at the user's worktree", async () => {
    await expect(
      runGit(["add", "."], { cwd: repo, protectedWorktree: repo }),
    ).rejects.toThrow(GitSafetyViolation);
  });

  it("permits read-only inspection of the user's worktree", async () => {
    const res = await runGit(["status", "--porcelain"], {
      cwd: repo,
      protectedWorktree: repo,
    });
    expect(res.ok).toBe(true);
  });

  it("leaves a dirty user tree untouched when inspected", async () => {
    writeFileSync(join(repo, "dirty.txt"), "uncommitted work\n");
    const before = await inspectWorkingTree(repo);
    expect(before.hasUncommittedChanges).toBe(true);
    expect(before.untrackedFiles).toContain("dirty.txt");

    // Inspection must not clean, stash, or reset anything.
    const after = await inspectWorkingTree(repo);
    expect(after.untrackedFiles).toContain("dirty.txt");
    expect(existsSync(join(repo, "dirty.txt"))).toBe(true);

    rmSync(join(repo, "dirty.txt"));
  });
});

describe("repository inspection helpers (spec sections 31, 182)", () => {
  it("resolves HEAD to a 40-char sha and rejects unknown revs", async () => {
    const sha = await resolveCommitSha(repo, "HEAD");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await resolveCommitSha(repo, "no-such-rev-xyz")).toBeNull();
  });

  it("detects branch existence", async () => {
    expect(await branchExists(repo, "main")).toBe(true);
    expect(await branchExists(repo, "does-not-exist")).toBe(false);
  });

  it("confirms git worktree support", async () => {
    expect(await gitSupportsWorktree(repo)).toBe(true);
  });

  it("reports a clean tree as clean", async () => {
    const inspect = await inspectWorkingTree(repo);
    expect(inspect.isClean).toBe(true);
    expect(inspect.currentBranch).toBe("main");
  });
});

describe("deterministic naming (spec sections 28, 29)", () => {
  it("sanitizes characters git refuses in refs", () => {
    expect(sanitizeRefComponent("Feature/Bad Name~^:?*[]")).not.toMatch(/[~^:?*[\]\s]/);
    expect(sanitizeRefComponent("..dots..")).not.toContain("..");
    expect(sanitizeRefComponent("")).toBe("unnamed");
  });

  it("caps component length to keep refs manageable", () => {
    expect(sanitizeRefComponent("x".repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it("builds deterministic branch names", () => {
    const a = councilBranchName("pao", "cycle-123", "TASK-456", "backend auth");
    const b = councilBranchName("pao", "cycle-123", "TASK-456", "backend auth");
    expect(a).toBe(b);
    expect(a).toBe("pao/cycle-cycle-123/task-task-456/backend-auth");
  });

  it("builds a distinct integration branch name", () => {
    expect(integrationBranchName("pao", "run_abc")).toBe("pao/integration/run_abc");
  });
});
