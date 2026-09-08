// Phase 20.4 — Git Safety Guard (spec sections 3, 26, 33, 102, 103, 165).
//
// Every git invocation made by the Engineering Council goes through runGit()
// here. The guard is a denylist over argv, not over a shell string, so there is
// no quoting hole to slip through. Destructive recovery shortcuts are rejected
// before the process is spawned, and a small set of commands is additionally
// forbidden from ever targeting the user's own worktree.
//
// This module deliberately contains no orchestration logic so the safety rules
// stay readable and testable in isolation.

import { SafeImplementationRunner } from "../sdlc/runner";

export class GitSafetyViolation extends Error {
  constructor(
    readonly args: string[],
    readonly rule: string,
  ) {
    super(`Blocked unsafe git command (${rule}): git ${args.join(" ")}`);
    this.name = "GitSafetyViolation";
  }
}

/** Spec section 33 — never run these automatically, anywhere. */
interface DenyRule {
  rule: string;
  matches: (args: string[]) => boolean;
}

function has(args: string[], ...flags: string[]): boolean {
  return flags.some(f => args.includes(f));
}

function isSubcommand(args: string[], name: string): boolean {
  // Skip leading global options like -C <path> or -c k=v.
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-C" || a === "-c") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a === name;
  }
  return false;
}

const DENY_RULES: DenyRule[] = [
  {
    rule: "no `git reset --hard` as an automatic recovery shortcut (s3, s33)",
    matches: args => isSubcommand(args, "reset") && has(args, "--hard"),
  },
  {
    rule: "no `git clean -fd` (s4, s33)",
    matches: args =>
      isSubcommand(args, "clean") &&
      args.some(a => /^-[a-z]*f/i.test(a) || a === "--force"),
  },
  {
    rule: "no force push (s5, s33)",
    matches: args =>
      isSubcommand(args, "push") &&
      (has(args, "--force", "-f") || args.some(a => a.startsWith("--force-with-lease"))),
  },
  {
    rule: "no wholesale `git checkout -- .` discard (s33)",
    matches: args => {
      if (!isSubcommand(args, "checkout")) return false;
      const dashdash = args.indexOf("--");
      if (dashdash === -1) return false;
      const targets = args.slice(dashdash + 1);
      return targets.some(t => t === "." || t === "*" || t === ":/");
    },
  },
  {
    rule: "no wholesale `git restore .` discard (s33)",
    matches: args => {
      if (!isSubcommand(args, "restore")) return false;
      const targets = args.filter((a, i) => !a.startsWith("-") && i > args.indexOf("restore"));
      return targets.some(t => t === "." || t === "*" || t === ":/");
    },
  },
  {
    rule: "no force branch deletion (s33)",
    matches: args => isSubcommand(args, "branch") && has(args, "-D", "--delete--force"),
  },
  {
    rule: "no history rewriting (s69)",
    matches: args =>
      isSubcommand(args, "filter-branch") ||
      isSubcommand(args, "filter-repo") ||
      (isSubcommand(args, "rebase") && has(args, "--root")),
  },
  {
    rule: "no global git config mutation (s102)",
    matches: args =>
      isSubcommand(args, "config") && has(args, "--global", "--system"),
  },
  {
    rule: "no remote URL rewriting (s102)",
    matches: args =>
      isSubcommand(args, "remote") &&
      (args.includes("set-url") || args.includes("add") || args.includes("remove")),
  },
  {
    rule: "no hook bypass (s103)",
    matches: args => has(args, "--no-verify"),
  },
  {
    rule: "no credential helper invocation (s101)",
    matches: args => isSubcommand(args, "credential"),
  },
];

/**
 * Commands that mutate the working tree. These are permitted inside a council
 * worktree but never against the user's own worktree (spec section 26).
 */
const MUTATING_SUBCOMMANDS = new Set([
  "reset",
  "clean",
  "checkout",
  "restore",
  "stash",
  "apply",
  "am",
  "cherry-pick",
  "merge",
  "rebase",
  "commit",
  "add",
  "rm",
  "mv",
]);

function subcommandOf(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-C" || a === "-c") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

export function isMutatingGitCommand(args: string[]): boolean {
  const sub = subcommandOf(args);
  return sub !== null && MUTATING_SUBCOMMANDS.has(sub);
}

/** Throws GitSafetyViolation when argv trips any denylist rule. */
export function assertGitArgsSafe(args: string[]): void {
  for (const rule of DENY_RULES) {
    if (rule.matches(args)) throw new GitSafetyViolation(args, rule.rule);
  }
}

export interface GitRunOptions {
  cwd: string;
  timeoutMs?: number;
  /**
   * Absolute path of the user's own worktree. When provided, any mutating
   * command whose cwd resolves inside it is rejected (spec section 26).
   */
  protectedWorktree?: string | null;
  /** Set true only for push, and only when config explicitly allows it. */
  allowPush?: boolean;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isInsideProtectedWorktree(cwd: string, protectedRoot: string): boolean {
  const c = normalizePath(cwd);
  const r = normalizePath(protectedRoot);
  if (c === r) return true;
  // A council worktree living under <root>/.pao or <root>/.claude is a distinct
  // checkout, so only treat it as protected when it is not itself a worktree dir.
  if (!c.startsWith(`${r}/`)) return false;
  const rel = c.slice(r.length + 1);
  return !rel.startsWith(".pao/") && !rel.startsWith(".claude/") && !rel.startsWith(".tmp/");
}

export interface GitResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
}

/** The single sanctioned entry point for every council git call. */
export async function runGit(args: string[], options: GitRunOptions): Promise<GitResult> {
  assertGitArgsSafe(args);

  const sub = subcommandOf(args);

  if (sub === "push" && !options.allowPush) {
    throw new GitSafetyViolation(args, "remote push disabled by default (s77)");
  }

  if (options.protectedWorktree && isMutatingGitCommand(args)) {
    if (isInsideProtectedWorktree(options.cwd, options.protectedWorktree)) {
      throw new GitSafetyViolation(
        args,
        `refusing to mutate the user's worktree at ${options.protectedWorktree} (s26)`,
      );
    }
  }

  const res = await SafeImplementationRunner.runCommand(["git", ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 60_000,
    // Keep git non-interactive: never block waiting for credentials.
    env: {
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });

  return {
    ok: res.exitCode === 0,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
    command: res.command,
  };
}

/** Spec section 26 — read-only inspection of a working tree. */
export interface WorkingTreeInspection {
  isClean: boolean;
  hasUncommittedChanges: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
  currentBranch: string;
  headSha: string;
}

export async function inspectWorkingTree(cwd: string): Promise<WorkingTreeInspection> {
  const status = await runGit(["status", "--porcelain"], { cwd });
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of status.stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (code.startsWith("??")) untracked.push(file);
    else modified.push(file);
  }

  const head = await runGit(["rev-parse", "HEAD"], { cwd });
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });

  return {
    isClean: modified.length === 0 && untracked.length === 0,
    hasUncommittedChanges: modified.length > 0 || untracked.length > 0,
    modifiedFiles: modified,
    untrackedFiles: untracked,
    currentBranch: branch.stdout.trim() || "HEAD",
    headSha: head.stdout.trim(),
  };
}

/** Verify a commit-ish exists and resolve it to a full SHA (spec section 31). */
export async function resolveCommitSha(cwd: string, rev: string): Promise<string | null> {
  const res = await runGit(["rev-parse", "--verify", `${rev}^{commit}`], { cwd });
  if (!res.ok) return null;
  const sha = res.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const res = await runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd },
  );
  return res.exitCode === 0;
}

export async function gitSupportsWorktree(cwd: string): Promise<boolean> {
  const res = await runGit(["worktree", "list"], { cwd });
  return res.ok;
}

/** Spec section 104 — detect submodules so we never recurse into them blindly. */
export async function hasSubmodules(cwd: string): Promise<boolean> {
  const res = await runGit(["config", "--file", ".gitmodules", "--list"], { cwd });
  return res.ok && res.stdout.trim().length > 0;
}

/** Spec sections 28/29 — deterministic, filesystem-safe naming. */
export function sanitizeRefComponent(input: string): string {
  const cleaned = input
    .replace(/[\\~^:?*[\]@{}\s]+/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/^[.\-/]+|[.\-/]+$/g, "")
    .replace(/\/+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return cleaned.slice(0, 48) || "unnamed";
}

export function councilBranchName(
  prefix: string,
  cycleId: string,
  taskKey: string,
  slug?: string,
): string {
  const parts = [
    sanitizeRefComponent(prefix),
    `cycle-${sanitizeRefComponent(cycleId)}`,
    `task-${sanitizeRefComponent(taskKey)}`,
  ];
  if (slug) parts.push(sanitizeRefComponent(slug));
  return parts.join("/");
}

export function integrationBranchName(prefix: string, councilRunId: string): string {
  return `${sanitizeRefComponent(prefix)}/integration/${sanitizeRefComponent(councilRunId)}`;
}
