// Phase 20.4 — Worktree Coordinator (spec sections 25-32, 68, 133-136).
//
// Creates one isolated git worktree per parallel implementation task, pinned to
// the CouncilRun's base commit. Never shares an active worktree, never mutates
// the user's checkout, and never deletes anything it cannot prove it owns.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  branchExists,
  councilBranchName,
  integrationBranchName,
  inspectWorkingTree,
  resolveCommitSha,
  runGit,
  sanitizeRefComponent,
} from "./git-safety";
import { openAgentOsDb } from "../db";
import type { CouncilConfig, WorktreeRecord, WorktreeState } from "./types";

export class WorktreeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "PATH_OCCUPIED"
      | "BRANCH_COLLISION"
      | "BASE_MISSING"
      | "DISK_PRESSURE"
      | "CREATE_FAILED"
      | "NOT_OWNED"
      | "REMOVE_FAILED",
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

/** Marker file proving a directory is an orchestrator-owned worktree (s133). */
export const OWNERSHIP_MARKER = ".pao-council-worktree.json";

export interface WorktreeOwnership {
  councilRunId: string;
  cycleId: string;
  taskKey: string | null;
  worktreeId: string;
  branch: string;
  baseSha: string;
  isIntegration: boolean;
  createdAt: string;
}

export interface CreateWorktreeInput {
  repoRoot: string;
  councilRunId: string;
  cycleId: string;
  taskKey: string | null;
  baseSha: string;
  config: CouncilConfig;
  /** Absolute path of the user's checkout, which must never be touched. */
  protectedWorktree: string;
  slug?: string;
  isIntegration?: boolean;
}

/** Spec section 28 — deterministic worktree path. */
export function councilWorktreePath(input: {
  repoRoot: string;
  worktreeRoot: string;
  cycleId: string;
  taskKey: string | null;
  shortRunId: string;
  isIntegration?: boolean;
}): string {
  const root = isAbsolute(input.worktreeRoot)
    ? input.worktreeRoot
    : join(input.repoRoot, input.worktreeRoot);
  const cycleDir = `cycle-${sanitizeRefComponent(input.cycleId)}`;
  const leaf = input.isIntegration
    ? `integration-${sanitizeRefComponent(input.shortRunId)}`
    : `task-${sanitizeRefComponent(input.taskKey ?? "unknown")}-${sanitizeRefComponent(input.shortRunId)}`;
  return join(root, cycleDir, leaf);
}

function freeDiskBytes(path: string): number | null {
  try {
    // statfs is available on Bun/Node 18+ for POSIX; on Windows it may throw.
    const fs = require("node:fs") as typeof import("node:fs");
    const anyFs = fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } };
    if (typeof anyFs.statfsSync !== "function") return null;
    const st = anyFs.statfsSync(path);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

/**
 * Spec section 31 — pre-flight safety checks before creating a worktree.
 * Returns the resolved path/branch so callers do not recompute them.
 */
export async function preflightWorktree(input: CreateWorktreeInput): Promise<{
  path: string;
  branch: string;
  worktreeId: string;
  baseSha: string;
}> {
  const worktreeId = `cwt_${randomUUID().slice(0, 12)}`;
  const shortRunId = input.councilRunId.slice(-8);

  const baseSha = await resolveCommitSha(input.repoRoot, input.baseSha);
  if (!baseSha) {
    throw new WorktreeError(
      `base commit ${input.baseSha} does not exist in ${input.repoRoot}`,
      "BASE_MISSING",
    );
  }

  const path = councilWorktreePath({
    repoRoot: input.repoRoot,
    worktreeRoot: input.config.worktreeRoot,
    cycleId: input.cycleId,
    taskKey: input.taskKey,
    shortRunId,
    isIntegration: input.isIntegration,
  });

  // Spec section 31: the path must not exist, unless we already own it.
  if (existsSync(path)) {
    const owned = readOwnership(path);
    if (!owned) {
      throw new WorktreeError(
        `refusing to reuse unowned directory ${path} (no ${OWNERSHIP_MARKER})`,
        "PATH_OCCUPIED",
      );
    }
  }

  const branch = input.isIntegration
    ? integrationBranchName(input.config.branchPrefix, input.councilRunId)
    : councilBranchName(
        input.config.branchPrefix,
        input.cycleId,
        input.taskKey ?? "unknown",
        input.slug,
      );

  if (await branchExists(input.repoRoot, branch)) {
    throw new WorktreeError(`branch ${branch} already exists`, "BRANCH_COLLISION");
  }

  // Spec section 136: refuse to add worktrees under disk pressure.
  const free = freeDiskBytes(input.repoRoot);
  if (free !== null && free < input.config.minFreeDiskBytes) {
    throw new WorktreeError(
      `insufficient free disk: ${free} < ${input.config.minFreeDiskBytes}`,
      "DISK_PRESSURE",
    );
  }

  return { path, branch, worktreeId, baseSha };
}

export function writeOwnership(path: string, ownership: WorktreeOwnership): void {
  mkdirSync(path, { recursive: true });
  const fs = require("node:fs") as typeof import("node:fs");
  fs.writeFileSync(join(path, OWNERSHIP_MARKER), `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
}

export function readOwnership(path: string): WorktreeOwnership | null {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync(join(path, OWNERSHIP_MARKER), "utf8");
    const parsed = JSON.parse(raw) as WorktreeOwnership;
    return parsed && typeof parsed.worktreeId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Spec sections 25/26/27 — create an isolated worktree on a fresh branch from
 * the pinned base commit. The user's checkout is never a target here: we only
 * ever run `worktree add`, which does not modify the source working tree.
 */
export async function createCouncilWorktree(
  input: CreateWorktreeInput,
): Promise<WorktreeRecord> {
  const { path, branch, worktreeId, baseSha } = await preflightWorktree(input);
  const now = new Date().toISOString();

  mkdirSync(resolve(path, ".."), { recursive: true });

  const res = await runGit(["worktree", "add", "-b", branch, path, baseSha], {
    cwd: input.repoRoot,
    protectedWorktree: input.protectedWorktree,
    timeoutMs: input.config.commandTimeoutMs,
  });

  if (!res.ok) {
    throw new WorktreeError(
      `git worktree add failed for ${branch}: ${res.stderr || res.stdout}`,
      "CREATE_FAILED",
    );
  }

  writeOwnership(path, {
    councilRunId: input.councilRunId,
    cycleId: input.cycleId,
    taskKey: input.taskKey,
    worktreeId,
    branch,
    baseSha,
    isIntegration: input.isIntegration ?? false,
    createdAt: now,
  });

  try {
    const db = openAgentOsDb();
    db.query(`INSERT INTO council_worktrees (
      id, council_run_id, cycle_id, task_key, path, branch, base_sha, head_sha,
      status, is_integration, cleanup_status, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      worktreeId,
      input.councilRunId,
      input.cycleId,
      input.taskKey,
      path,
      branch,
      baseSha,
      baseSha,
      "READY",
      input.isIntegration ? 1 : 0,
      null,
      now,
      now,
    );
  } catch {
    // Non-fatal if DB not yet initialized in isolated unit tests
  }

  return {
    id: worktreeId,
    councilRunId: input.councilRunId,
    cycleId: input.cycleId,
    taskKey: input.taskKey,
    path,
    branch,
    baseSha,
    headSha: baseSha,
    status: "READY",
    isIntegration: input.isIntegration ?? false,
    createdAt: now,
    lastSeenAt: now,
    cleanupStatus: null,
  };
}

export function listCouncilWorktrees(councilRunId: string): WorktreeRecord[] {
  try {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM council_worktrees WHERE council_run_id = ?").all(councilRunId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      councilRunId: String(r.council_run_id),
      cycleId: String(r.cycle_id),
      taskKey: r.task_key ? String(r.task_key) : null,
      path: String(r.path),
      branch: String(r.branch),
      baseSha: String(r.base_sha),
      headSha: r.head_sha ? String(r.head_sha) : null,
      status: String(r.status) as WorktreeState,
      isIntegration: Boolean(r.is_integration),
      createdAt: String(r.created_at),
      lastSeenAt: String(r.last_seen_at),
      cleanupStatus: r.cleanup_status ? (String(r.cleanup_status) as never) : null,
    }));
  } catch {
    return [];
  }
}

/** Refresh observed state of a worktree from disk + git (spec section 30). */
export async function observeWorktree(
  record: WorktreeRecord,
): Promise<{ status: WorktreeState; headSha: string | null; dirtyFiles: string[] }> {
  if (!existsSync(record.path)) {
    return { status: "ORPHANED", headSha: null, dirtyFiles: [] };
  }

  try {
    const inspection = await inspectWorkingTree(record.path);
    const dirtyFiles = [...inspection.modifiedFiles, ...inspection.untrackedFiles].filter(
      f => !f.includes(OWNERSHIP_MARKER),
    );

    let status: WorktreeState;
    if (dirtyFiles.length > 0) status = "DIRTY";
    else if (inspection.headSha !== record.baseSha) status = "COMMITTED";
    else status = "READY";

    return { status, headSha: inspection.headSha, dirtyFiles };
  } catch {
    return { status: "FAILED", headSha: null, dirtyFiles: [] };
  }
}

/**
 * Spec sections 133/135 — remove a worktree only when we can prove ownership
 * and the caller has confirmed the work is preserved. Never force-deletes an
 * unknown directory.
 */
export async function removeCouncilWorktree(
  record: WorktreeRecord,
  options: {
    repoRoot: string;
    protectedWorktree: string;
    config: CouncilConfig;
    /** Caller asserts the changes are integrated or intentionally discarded. */
    workPreserved: boolean;
    /** Also delete the task branch. Off by default (spec section 134). */
    deleteBranch?: boolean;
  },
): Promise<{ removed: boolean; reason: string }> {
  if (!options.workPreserved) {
    return { removed: false, reason: "work not confirmed preserved; keeping worktree" };
  }

  if (!existsSync(record.path)) {
    return { removed: true, reason: "path already gone" };
  }

  const ownership = readOwnership(record.path);
  if (!ownership || ownership.worktreeId !== record.id) {
    throw new WorktreeError(
      `refusing to remove ${record.path}: ownership marker missing or mismatched`,
      "NOT_OWNED",
    );
  }

  const observed = await observeWorktree(record);
  if (observed.status === "DIRTY" && options.config.keepFailedWorktrees) {
    return { removed: false, reason: "worktree is dirty; preserved for inspection" };
  }

  // `worktree remove` refuses on dirty trees unless forced; we do not force
  // unless the tree is clean, so uncommitted agent work is never silently lost.
  const args = ["worktree", "remove", record.path];
  if (observed.status !== "DIRTY") args.push("--force");

  const res = await runGit(args, {
    cwd: options.repoRoot,
    protectedWorktree: options.protectedWorktree,
    timeoutMs: options.config.commandTimeoutMs,
  });

  if (!res.ok) {
    throw new WorktreeError(
      `git worktree remove failed for ${record.path}: ${res.stderr || res.stdout}`,
      "REMOVE_FAILED",
    );
  }

  if (options.deleteBranch) {
    // -d only: refuses to delete unmerged work. Never -D (spec section 33).
    await runGit(["branch", "-d", record.branch], {
      cwd: options.repoRoot,
      protectedWorktree: options.protectedWorktree,
    });
  }

  return { removed: true, reason: "removed" };
}

/** Spec section 17/132/133 — orphan inspection, never blind deletion. */
export interface OrphanReport {
  path: string;
  ownership: WorktreeOwnership | null;
  knownToDb: boolean;
  recommendation: "ADOPT" | "QUARANTINE_FOR_REVIEW" | "LEAVE_UNTOUCHED";
  reason: string;
}

export function inspectOrphanWorktrees(
  repoRoot: string,
  config: CouncilConfig,
  knownWorktreeIds: Set<string>,
): OrphanReport[] {
  const root = isAbsolute(config.worktreeRoot)
    ? config.worktreeRoot
    : join(repoRoot, config.worktreeRoot);

  if (!existsSync(root)) return [];

  const reports: OrphanReport[] = [];

  for (const cycleDir of safeReadDir(root)) {
    const cyclePath = join(root, cycleDir);
    if (!isDirectory(cyclePath)) continue;

    for (const leaf of safeReadDir(cyclePath)) {
      const path = join(cyclePath, leaf);
      if (!isDirectory(path)) continue;

      const ownership = readOwnership(path);
      if (!ownership) {
        reports.push({
          path,
          ownership: null,
          knownToDb: false,
          // Spec section 134: uncertain ownership means hands off.
          recommendation: "LEAVE_UNTOUCHED",
          reason: `no ${OWNERSHIP_MARKER}; not provably orchestrator-owned`,
        });
        continue;
      }

      const knownToDb = knownWorktreeIds.has(ownership.worktreeId);
      reports.push({
        path,
        ownership,
        knownToDb,
        recommendation: knownToDb ? "ADOPT" : "QUARANTINE_FOR_REVIEW",
        reason: knownToDb
          ? "matches a tracked worktree record"
          : "owned marker present but no matching DB record; inspect before reuse",
      });
    }
  }

  return reports;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Spec section 32 — prune stale git worktree administrative entries. */
export async function pruneWorktreeAdmin(
  repoRoot: string,
  protectedWorktree: string,
): Promise<boolean> {
  const res = await runGit(["worktree", "prune"], {
    cwd: repoRoot,
    protectedWorktree,
  });
  return res.ok;
}

/** List git's own view of worktrees, for reconciliation (spec section 132). */
export async function listGitWorktrees(
  repoRoot: string,
): Promise<Array<{ path: string; branch: string | null; head: string | null }>> {
  const res = await runGit(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (!res.ok) return [];

  const out: Array<{ path: string; branch: string | null; head: string | null }> = [];
  let current: { path: string; branch: string | null; head: string | null } | null = null;

  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) out.push(current);
      current = { path: line.slice("worktree ".length).trim(), branch: null, head: null };
    } else if (line.startsWith("HEAD ") && current) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace("refs/heads/", "");
    }
  }
  if (current) out.push(current);
  return out;
}
