// Phase 20.57 — git transport for skill imports. Threat model: the repository
// URL and ref originate from untrusted callers, so both are shape-validated
// before execution and passed as a literal binary + literal flag argv with
// `shell: false` (repo precedent: agent-observability/process-evidence.ts).
// No shell string is ever constructed.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { SkillGateHttpError } from "./types";

const SKILL_ENTRY = "SKILL.md";

/** A repository URL must be a remote (scheme or scp-like form), never a CLI option. */
function assertSafeRemote(url: string): void {
  const safe = /^(https:\/\/|http:\/\/|git:\/\/|ssh:\/\/|git@)[^\s]*$/.test(url);
  if (!safe) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 400, "repository URL is not an accepted remote form");
  }
}

function assertSafeRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes("..")) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 400, "git ref is not an accepted form");
  }
}

export interface GitCloneInput {
  repositoryUrl: string;
  ref?: string | null;
  subPath?: string | null;
  workRoot: string;
}

export interface GitCloneResult {
  sourceDir: string;
  workDir: string;
  commit: string | null;
}

/**
 * Clone a repository (depth 1) and return the skill folder inside it. The
 * `--` end-of-options marker makes git treat every following argv element as a
 * path/URL operand, never as an option.
 */
export function gitCloneSkill(input: GitCloneInput): GitCloneResult {
  assertSafeRemote(input.repositoryUrl);
  if (input.ref) assertSafeRef(input.ref);
  const workDir = join(input.workRoot, `git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workDir, { recursive: true });
  const argv: string[] = ["clone", "--depth", "1", "--single-branch"];
  if (input.ref) argv.push("--branch", input.ref);
  argv.push("--", input.repositoryUrl, workDir);
  const cloned = spawnSync("git", argv, {
    encoding: "buffer",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (cloned.status !== 0) {
    rmSync(workDir, { recursive: true, force: true });
    throw new SkillGateHttpError("GIT_CLONE_FAILED", 502, "git clone failed for the requested repository");
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workDir,
    encoding: "buffer",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  const commit = head.status === 0 ? head.stdout.toString("utf8").trim() || null : null;
  const sourceDir = input.subPath ? join(workDir, input.subPath) : workDir;
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    rmSync(workDir, { recursive: true, force: true });
    throw new SkillGateHttpError("VALIDATION_ERROR", 422, "path not found in repository");
  }
  if (!existsSync(join(sourceDir, SKILL_ENTRY))) {
    rmSync(workDir, { recursive: true, force: true });
    throw new SkillGateHttpError("VALIDATION_ERROR", 422, "skill folder has no SKILL.md at the requested path");
  }
  return { sourceDir, workDir, commit };
}

/** Remove a finished clone workspace (called after snapshot staging). */
export function cleanupGitWorkDir(workDir: string): void {
  rmSync(workDir, { recursive: true, force: true });
}
