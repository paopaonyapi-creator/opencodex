// Phase 20.37 — worktree isolation manager (§21). Git operations run through
// the Phase 20.24 allowlisted process runner (argv discipline, timeouts, no
// shell). Safety rules: never auto-stash, never delete/modify a dirty
// worktree, dirty worktrees are PRESERVED, allocation uses deterministic
// naming, base revision is recorded, and release verifies cleanliness.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runProcessSafely } from "../media-acquisition/process-runner";
import { BusinessError } from "../business-builder/sources";
import type { WorktreeRecord } from "./types";

function newWorktreeId(): string {
  return "owt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

async function git(repoRoot: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await runProcessSafely({ binary: process.platform === "win32" ? "git.exe" : "git", args, cwd: repoRoot, timeoutMs });
  return { ok: result.exitCode === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export class WorktreeManager {
  constructor(
    private store: { insertWorktree(record: WorktreeRecord): void; getWorktree(id: string): WorktreeRecord | null; updateWorktree(id: string, patch: { status?: WorktreeRecord["status"]; isDirty?: boolean; releasedAt?: string | null; runId?: string | null }): WorktreeRecord | null },
    private worktreeRoot: string,
  ) {}

  /** Allocates an isolated worktree for a run. Refuses when the repo is not
   *  git-backed; callers fall back to single-workspace mode (§42). */
  async allocate(repoRoot: string, runId: string, agentSlug: string): Promise<WorktreeRecord> {
    if (!existsSync(join(repoRoot, ".git"))) {
      throw new BusinessError("WORKTREE_UNAVAILABLE", "repository is not git-backed; worktree isolation unavailable");
    }
    const head = await git(repoRoot, ["rev-parse", "HEAD"]);
    if (!head.ok) throw new BusinessError("WORKTREE_UNAVAILABLE", "cannot resolve HEAD: " + head.stderr);
    const shortRun = runId.replace(/[^a-z0-9-]/gi, "").slice(-12);
    const branchName = `pao/agent/${shortRun}/${agentSlug}`;
    const path = join(this.worktreeRoot, shortRun, agentSlug);
    const id = newWorktreeId();
    const record: WorktreeRecord = {
      id, runId, repoRoot, worktreePath: path, branchName,
      baseRevision: head.stdout, status: "ALLOCATING", isDirty: false,
      createdAt: new Date().toISOString(), releasedAt: null,
    };
    this.store.insertWorktree(record);
    const added = await git(repoRoot, ["worktree", "add", "-b", branchName, path, head.stdout]);
    if (!added.ok) {
      this.store.updateWorktree(id, { status: "ERROR" });
      throw new BusinessError("WORKTREE_UNAVAILABLE", "git worktree add failed: " + added.stderr);
    }
    return this.store.updateWorktree(id, { status: "READY", runId })!;
  }

  /** Marks a worktree in use (isDirty snapshot recorded). */
  markInUse(id: string, isDirty: boolean): WorktreeRecord | null {
    return this.store.updateWorktree(id, { status: "IN_USE", isDirty });
  }

  /** PRESERVED when dirty (§21): never cleaned up automatically. */
  preserve(id: string): WorktreeRecord | null {
    return this.store.updateWorktree(id, { status: "PRESERVED", isDirty: true });
  }

  /** Release verifies cleanliness first; dirty worktrees are refused. */
  async release(id: string): Promise<WorktreeRecord> {
    const record = this.store.getWorktree(id);
    if (!record) throw new BusinessError("NOT_FOUND", `worktree not found: ${id}`);
    if (record.status === "PRESERVED") {
      throw new BusinessError("WORKTREE_DIRTY", "dirty worktree is PRESERVED and cannot be auto-released (§21)");
    }
    if (record.status === "RELEASED") return record;
    const status = await git(record.repoRoot, ["-C", record.worktreePath, "status", "--porcelain"]);
    const dirty = status.stdout.length > 0;
    if (dirty) {
      this.store.updateWorktree(id, { status: "PRESERVED", isDirty: true });
      throw new BusinessError("WORKTREE_DIRTY", "worktree has uncommitted changes; marked PRESERVED (§21)");
    }
    const removed = await git(record.repoRoot, ["worktree", "remove", record.worktreePath]);
    if (!removed.ok) {
      this.store.updateWorktree(id, { status: "ERROR" });
      throw new BusinessError("WORKTREE_UNAVAILABLE", "git worktree remove failed: " + removed.stderr);
    }
    await git(record.repoRoot, ["branch", "-d", record.branchName ?? ""]);
    return this.store.updateWorktree(id, { status: "RELEASED", isDirty: false, releasedAt: new Date().toISOString() })!;
  }
}
