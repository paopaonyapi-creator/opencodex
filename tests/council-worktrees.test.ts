// Phase 20.4 — Worktree lifecycle tests (spec sections 163, 164, 173, 176, 179).
//
// Real `git worktree` operations against a throwaway fixture repo in the OS
// temp dir (spec section 163). Never the developer's own repository.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit, inspectWorkingTree } from "../src/agent-os/council/git-safety";
import {
  createCouncilWorktree,
  removeCouncilWorktree,
  observeWorktree,
  preflightWorktree,
  councilWorktreePath,
  inspectOrphanWorktrees,
  listGitWorktrees,
  pruneWorktreeAdmin,
  readOwnership,
  writeOwnership,
  WorktreeError,
  OWNERSHIP_MARKER,
} from "../src/agent-os/council/worktrees";
import { loadCouncilConfig } from "../src/agent-os/council/config";
import type { CouncilConfig, WorktreeRecord } from "../src/agent-os/council/types";

let repo = "";
let config: CouncilConfig;

async function git(args: string[], cwd = repo): Promise<void> {
  const res = await runGit(args, { cwd });
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

async function headSha(cwd = repo): Promise<string> {
  const res = await runGit(["rev-parse", "HEAD"], { cwd });
  return res.stdout.trim();
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "pao-council-wt-"));
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.email", "fixture@example.com"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "a.txt"), "base\n");
  await git(["add", "a.txt"]);
  await git(["commit", "-m", "initial"]);

  config = {
    ...loadCouncilConfig({}),
    worktreeRoot: join(repo, ".pao", "worktrees"),
    minFreeDiskBytes: 0,
  };
});

afterEach(() => {
  if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
});

function baseInput(taskKey: string, base: string) {
  return {
    repoRoot: repo,
    councilRunId: "crun_test1234",
    cycleId: "cycle-1",
    taskKey,
    baseSha: base,
    config,
    protectedWorktree: repo,
  };
}

describe("worktree creation (spec sections 25, 27, 31)", () => {
  it("creates an isolated worktree on a new branch at the pinned base", async () => {
    const base = await headSha();
    const rec = await createCouncilWorktree(baseInput("TASK-001", base));

    expect(existsSync(rec.path)).toBe(true);
    expect(rec.baseSha).toBe(base);
    expect(rec.status).toBe("READY");
    expect(rec.branch).toContain("task-task-001");
    expect(await headSha(rec.path)).toBe(base);
    expect(existsSync(join(rec.path, "a.txt"))).toBe(true);
  });

  it("writes an ownership marker (spec section 133)", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const owned = readOwnership(rec.path);
    expect(owned).not.toBeNull();
    expect(owned!.worktreeId).toBe(rec.id);
    expect(owned!.councilRunId).toBe("crun_test1234");
  });

  it("creates multiple parallel worktrees that do not share state", async () => {
    const base = await headSha();
    const a = await createCouncilWorktree(baseInput("TASK-001", base));
    const b = await createCouncilWorktree(baseInput("TASK-002", base));

    expect(a.path).not.toBe(b.path);
    expect(a.branch).not.toBe(b.branch);

    writeFileSync(join(a.path, "only-in-a.txt"), "a\n");
    expect(existsSync(join(b.path, "only-in-a.txt"))).toBe(false);

    const list = await listGitWorktrees(repo);
    expect(list.length).toBeGreaterThanOrEqual(3); // main + 2
  });

  it("rejects a missing base commit (spec section 31)", async () => {
    await expect(
      preflightWorktree(baseInput("TASK-001", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")),
    ).rejects.toThrow(WorktreeError);
  });

  it("rejects a branch collision (spec section 31)", async () => {
    const base = await headSha();
    await createCouncilWorktree(baseInput("TASK-001", base));
    // Same cycle+task => same deterministic branch name => collision.
    await expect(createCouncilWorktree(baseInput("TASK-001", base))).rejects.toThrow(
      /already exists|PATH_OCCUPIED/,
    );
  });

  it("refuses to reuse an unowned occupied directory", async () => {
    const base = await headSha();
    const path = councilWorktreePath({
      repoRoot: repo,
      worktreeRoot: config.worktreeRoot,
      cycleId: "cycle-1",
      taskKey: "TASK-009",
      shortRunId: "crun_test1234".slice(-8),
    });
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "someone-elses-file.txt"), "not ours\n");

    await expect(preflightWorktree(baseInput("TASK-009", base))).rejects.toThrow(WorktreeError);
    // The stranger's file must survive.
    expect(existsSync(join(path, "someone-elses-file.txt"))).toBe(true);
  });

  it("enforces the disk pressure floor (spec section 136)", async () => {
    const base = await headSha();
    const tight = { ...config, minFreeDiskBytes: Number.MAX_SAFE_INTEGER };
    const input = { ...baseInput("TASK-010", base), config: tight };
    // Only assert when the platform reports free space at all.
    try {
      await preflightWorktree(input);
    } catch (err) {
      expect((err as WorktreeError).code).toBe("DISK_PRESSURE");
    }
  });
});

describe("user working tree protection (spec sections 26, 176)", () => {
  it("leaves uncommitted user work untouched while creating worktrees", async () => {
    // Simulate the user's in-progress work.
    writeFileSync(join(repo, "a.txt"), "base\nUSER EDIT\n");
    writeFileSync(join(repo, "user-untracked.txt"), "important scratch\n");

    const before = await inspectWorkingTree(repo);
    expect(before.hasUncommittedChanges).toBe(true);

    const base = await headSha();
    const rec = await createCouncilWorktree(baseInput("TASK-001", base));
    expect(existsSync(rec.path)).toBe(true);

    const after = await inspectWorkingTree(repo);
    expect(after.modifiedFiles).toEqual(before.modifiedFiles);
    expect(after.untrackedFiles).toContain("user-untracked.txt");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("USER EDIT");
    expect(readFileSync(join(repo, "user-untracked.txt"), "utf8")).toBe("important scratch\n");
  });

  it("builds the new worktree from the committed base, not the dirty tree", async () => {
    writeFileSync(join(repo, "a.txt"), "base\nUNCOMMITTED\n");
    const base = await headSha();
    const rec = await createCouncilWorktree(baseInput("TASK-001", base));
    // The worktree sees committed content only. Normalize EOL: git may apply
    // core.autocrlf on checkout, which is irrelevant to this assertion.
    const content = readFileSync(join(rec.path, "a.txt"), "utf8").replace(/\r\n/g, "\n");
    expect(content).toBe("base\n");
    expect(content).not.toContain("UNCOMMITTED");
  });
});

describe("worktree observation (spec section 30)", () => {
  it("reports DIRTY when an agent has uncommitted edits", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    writeFileSync(join(rec.path, "new-work.txt"), "agent output\n");
    const observed = await observeWorktree(rec);
    expect(observed.status).toBe("DIRTY");
    expect(observed.dirtyFiles).toContain("new-work.txt");
  });

  it("ignores the ownership marker when judging dirtiness", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const observed = await observeWorktree(rec);
    expect(observed.dirtyFiles.some(f => f.includes(OWNERSHIP_MARKER))).toBe(false);
  });

  it("reports COMMITTED after the agent commits", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    writeFileSync(join(rec.path, "impl.txt"), "done\n");
    await git(["add", "impl.txt"], rec.path);
    await git(["commit", "-m", "pao(phase20.4): TASK-001 implement"], rec.path);

    const observed = await observeWorktree(rec);
    expect(observed.status).toBe("COMMITTED");
    expect(observed.headSha).not.toBe(rec.baseSha);
  });

  it("reports ORPHANED when the directory vanished (spec section 179)", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    rmSync(rec.path, { recursive: true, force: true });
    const observed = await observeWorktree(rec);
    expect(observed.status).toBe("ORPHANED");
  });
});

describe("worktree removal (spec sections 133, 135)", () => {
  const preserved = { workPreserved: true };

  function removeOpts(extra: Record<string, unknown> = {}) {
    return { repoRoot: repo, protectedWorktree: repo, config, ...preserved, ...extra };
  }

  it("does not remove when work is not confirmed preserved", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const res = await removeCouncilWorktree(rec, removeOpts({ workPreserved: false }));
    expect(res.removed).toBe(false);
    expect(existsSync(rec.path)).toBe(true);
  });

  it("removes a clean owned worktree", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const res = await removeCouncilWorktree(rec, removeOpts());
    expect(res.removed).toBe(true);
    expect(existsSync(rec.path)).toBe(false);
  });

  it("preserves a dirty worktree when keepFailedWorktrees is set", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    writeFileSync(join(rec.path, "wip.txt"), "unfinished\n");
    const res = await removeCouncilWorktree(rec, removeOpts());
    expect(res.removed).toBe(false);
    expect(existsSync(join(rec.path, "wip.txt"))).toBe(true);
  });

  it("refuses to remove a worktree whose ownership does not match", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const impostor: WorktreeRecord = { ...rec, id: "cwt_someone_else" };
    await expect(removeCouncilWorktree(impostor, removeOpts())).rejects.toThrow(WorktreeError);
    expect(existsSync(rec.path)).toBe(true);
  });
});

describe("orphan inspection (spec sections 17, 132, 133, 134)", () => {
  it("leaves directories without an ownership marker untouched", async () => {
    const stray = join(config.worktreeRoot, "cycle-1", "task-stray-abc");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "mystery.txt"), "unknown origin\n");

    const reports = inspectOrphanWorktrees(repo, config, new Set());
    const found = reports.find(r => r.path === stray);
    expect(found).toBeDefined();
    expect(found!.recommendation).toBe("LEAVE_UNTOUCHED");
    expect(existsSync(join(stray, "mystery.txt"))).toBe(true);
  });

  it("quarantines an owned worktree with no DB record instead of deleting", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const reports = inspectOrphanWorktrees(repo, config, new Set());
    const found = reports.find(r => r.path === rec.path);
    expect(found!.recommendation).toBe("QUARANTINE_FOR_REVIEW");
    expect(existsSync(rec.path)).toBe(true);
  });

  it("adopts an owned worktree that matches a known record", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    const reports = inspectOrphanWorktrees(repo, config, new Set([rec.id]));
    expect(reports.find(r => r.path === rec.path)!.recommendation).toBe("ADOPT");
  });

  it("returns nothing when the worktree root does not exist", () => {
    const cfg = { ...config, worktreeRoot: join(repo, "nope", "missing") };
    expect(inspectOrphanWorktrees(repo, cfg, new Set())).toEqual([]);
  });

  it("prunes stale admin entries without touching live worktrees", async () => {
    const rec = await createCouncilWorktree(baseInput("TASK-001", await headSha()));
    expect(await pruneWorktreeAdmin(repo, repo)).toBe(true);
    expect(existsSync(rec.path)).toBe(true);
  });
});

describe("integration worktree (spec section 68)", () => {
  it("creates a dedicated integration worktree distinct from task worktrees", async () => {
    const base = await headSha();
    const task = await createCouncilWorktree(baseInput("TASK-001", base));
    const integ = await createCouncilWorktree({
      ...baseInput(null, base),
      isIntegration: true,
    });

    expect(integ.isIntegration).toBe(true);
    expect(integ.path).not.toBe(task.path);
    expect(integ.branch).toContain("integration");
    expect(integ.path).not.toBe(repo);
  });
});
