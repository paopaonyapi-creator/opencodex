// Git change capture for the deterministic review runtime.
//
// Captures a unified diff for workspace / commit / range review modes.
// Everything is read-only (`git diff`, `git show`, `git rev-parse`).
//
// Security posture: refs arrive from API callers and are treated as
// untrusted — they are validated against a strict shape that rejects
// leading dashes (option injection) and separators before reaching git.
// Process execution is delegated to the Phase 20.4 council git-safety
// boundary (denylist rules, no push, non-interactive env); this module
// contains no process spawning of its own. Diff parsing lives in
// diff-parser.ts.

import { createHash } from "node:crypto";
import path from "node:path";
import { statSync } from "node:fs";
import { runGit } from "../council/git-safety";
import { parseUnifiedDiff } from "./diff-parser";
import { ReviewError, type DiffFile, type ReviewRequest } from "./types";

const MAX_DIFF_BYTES = 2_000_000;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export interface CapturedDiff {
  repositoryPath: string;
  headSha: string | null;
  diffText: string;
  diffHash: string;
  files: DiffFile[];
}

/** Reject option injection, separators, and empty refs before git ever sees them. */
export function assertSafeRef(ref: string, field: string): string {
  if (!SAFE_REF_PATTERN.test(ref) || ref.includes("..") || ref.endsWith(".lock")) {
    throw new ReviewError("REVIEW_INVALID_REQUEST", 400, field + " fails the safe-ref shape");
  }
  return ref;
}

function resolveRepositoryPath(repositoryPath: string): string {
  const resolved = path.resolve(repositoryPath);
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new ReviewError("REVIEW_REPOSITORY_NOT_FOUND", 404, "repository path not found: " + resolved);
  }
  if (!stat.isDirectory()) {
    throw new ReviewError("REVIEW_REPOSITORY_NOT_FOUND", 404, "repository path is not a directory: " + resolved);
  }
  return resolved;
}

async function runGitReadonly(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(args, { cwd, timeoutMs: 60_000 });
  if (!result.ok) {
    const stderr = result.stderr.trim().substring(0, 400);
    throw new ReviewError("REVIEW_GIT_FAILED", 422, stderr || "git command failed");
  }
  return result.stdout;
}

export async function assertGitRepository(repositoryPath: string): Promise<void> {
  await runGitReadonly(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
}

export async function captureDiff(request: ReviewRequest): Promise<CapturedDiff> {
  const repositoryPath = resolveRepositoryPath(request.repositoryPath);
  await assertGitRepository(repositoryPath);

  let args: string[];
  if (request.mode === "workspace") {
    args = ["diff", "--unified=0", "HEAD", "--"];
  } else if (request.mode === "commit") {
    if (!request.commit) throw new ReviewError("REVIEW_INVALID_REQUEST", 400, "commit mode requires a commit sha");
    args = ["show", "--unified=0", "--format=", assertSafeRef(request.commit, "commit"), "--"];
  } else {
    if (!request.from || !request.to) throw new ReviewError("REVIEW_INVALID_REQUEST", 400, "range mode requires from and to refs");
    // Two endpoints as separate argv entries; git diff <base> <head> reviews
    // every change across the range without building a combined ref string.
    args = ["diff", "--unified=0", assertSafeRef(request.from, "from"), assertSafeRef(request.to, "to"), "--"];
  }

  const headSha = request.mode === "workspace"
    ? (await runGitReadonly(repositoryPath, ["rev-parse", "HEAD"])).trim()
    : null;
  const diffText = await runGitReadonly(repositoryPath, args);
  if (diffText.length > MAX_DIFF_BYTES) {
    throw new ReviewError("REVIEW_DIFF_TOO_LARGE", 413, "diff exceeds the 2MB capture limit");
  }
  const files = parseUnifiedDiff(diffText);
  const diffHash = createHash("sha256").update(diffText).digest("hex");
  return { repositoryPath, headSha, diffText, diffHash, files };
}

// Parsing helpers live in the pure parser module; re-exported here so
// callers have one capture-shaped surface.
export { parseUnifiedDiff, addedLinesWithAnchors } from "./diff-parser";
