// Phase 20.61 — Workspace isolation via git worktrees (spec §4).
//
// Coding workers never share a checkout: each task/role pair gets a dedicated
// branch `pao/amux/<task-id>/<role>` and a dedicated worktree under the
// configured workspace root. git is invoked with argv arrays (no shell), and
// ids/roles are charset-validated before they ever reach a branch name.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentRuntimeHttpError } from "./types";

const execFileAsync = promisify(execFile);

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

function assertSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 400, label + " contains characters that are not safe for a git branch or path: " + value);
  }
  return value;
}

export interface WorktreeHandle {
  path: string;
  branch: string;
}

export function worktreeBranchFor(taskId: string, role: string): string {
  return "pao/amux/" + assertSegment(taskId, "taskId") + "/" + assertSegment(role, "role");
}

export function worktreePathFor(workspaceRoot: string, taskId: string, role: string): string {
  assertSegment(taskId, "taskId");
  assertSegment(role, "role");
  if (!workspaceRoot) {
    throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 409, "no agent workspace root configured (PAO_AGENT_RUNTIME_WORKSPACE_ROOT)");
  }
  return join(workspaceRoot, "task-" + taskId + "-" + role);
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], { timeout: 30_000, windowsHide: true });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 409, "git " + args[0] + " failed: " + message.slice(0, 300));
  }
}

/** Create the isolated branch + worktree for a task/role (idempotent). */
export async function createWorktree(input: {
  repoRoot: string;
  workspaceRoot: string;
  taskId: string;
  role: string;
}): Promise<WorktreeHandle> {
  if (!existsSync(input.repoRoot)) {
    throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 400, "repoRoot does not exist: " + input.repoRoot);
  }
  const branch = worktreeBranchFor(input.taskId, input.role);
  const path = worktreePathFor(input.workspaceRoot, input.taskId, input.role);
  if (existsSync(path)) {
    // Idempotent re-entry: verify the existing worktree is on our branch.
    const current = (await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (current !== branch) {
      throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 409, "existing worktree is on an unexpected branch: " + current);
    }
    return { path, branch };
  }
  mkdirSync(input.workspaceRoot, { recursive: true });
  await git(input.repoRoot, ["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

/** Remove a task worktree (task completion / cancellation cleanup). */
export async function removeWorktree(input: { repoRoot: string; path: string; branch: string }): Promise<void> {
  if (!existsSync(input.path)) return;
  await git(input.repoRoot, ["worktree", "remove", "--force", input.path]);
  // Branch retention is deliberate: merge candidates outlive the worktree.
  void input.branch;
}

/** Changed-file list relative to the repo default branch (evidence input). */
export async function changedFiles(input: { worktreePath: string; baseRef: string }): Promise<string[]> {
  const output = await git(input.worktreePath, ["diff", "--name-only", input.baseRef]);
  return output.split("\n").map((s) => s.trim()).filter(Boolean);
}
