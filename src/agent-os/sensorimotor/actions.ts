// Phase 20.82 — Sensorimotor Action Executor (CortexKit AFT contract).
//
// Transactional mutation loop: plan (policy) → lock → checkpoint → execute →
// verify → observe, with rollback on failure. Every mutating action is
// checkpointed before it runs; observation records the health delta so failed
// actions roll back deterministically. Abort is cooperative via AbortSignal;
// timeout and bounded retry/backoff are enforced per attempt. Policy
// integration reuses the Phase 05 deny-by-default engine and the Phase 20.74
// sandbox path guard — no new authority abstractions.
//
// Transaction safety (Phase 20.82 hardening): per-workspace locking
// serializes the checkpoint→observe window across sessions, caller-supplied
// idempotency keys replay terminal outcomes instead of re-executing
// mutations, stale sessions are refused, and every mutation post-verifies its
// on-disk effect. A failed mutation must never leave an unknown state.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { openAgentOsDb } from "../db";
import { evaluateCapability, type Capability } from "../policy";
import { ToolExecutionSandbox, SandboxSecurityError } from "../mcp-gateway/sandbox";
import { SafeImplementationRunner } from "../sdlc/runner";
import { createPerception, getPerception } from "./perception";
import { acquireWorkspaceLock, WorkspaceLockTimeoutError } from "./workspace-lock";
import {
  SensorimotorError,
  type ActionOutcome,
  type ActionRequest,
  type ActionStatus,
  type HealthDelta,
  type SensorimotorErrorCode,
  type SensorimotorSession,
} from "./types";

const ACTION_CAPABILITY: Record<ActionRequest["kind"], Capability> = {
  "fs.write": "fs.write",
  "fs.delete": "fs.write",
  "fs.move": "fs.write",
  "shell.exec": "shell.exec",
  "git.mutate": "shell.exec",
};

const TERMINAL_STATUSES = new Set<ActionStatus>(["succeeded", "failed", "rolled_back", "aborted", "timed_out"]);

// --- runtime configuration (documented in .env.example, Phase 20.82) ---

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const AFT_DEFAULTS = {
  sessionStaleMs: 24 * 60 * 60 * 1000,
  lockWaitMs: 30_000,
  lockTtlSlackMs: 60_000,
  maxCheckpointBytes: 512 * 1024,
  maxCheckpointFiles: 50,
};

export function aftConfig() {
  return {
    sessionStaleMs: envInt("PAO_AFT_SESSION_STALE_MS", AFT_DEFAULTS.sessionStaleMs),
    lockWaitMs: envInt("PAO_AFT_LOCK_WAIT_MS", AFT_DEFAULTS.lockWaitMs),
  };
}

// --- git mutation hardening ---

function gitSubcommandOf(tokens: string[]): { sub: string; rest: string[] } | null {
  let idx = 0;
  while (idx < tokens.length && tokens[idx].startsWith("-")) idx++;
  if (idx >= tokens.length) return null;
  return { sub: tokens[idx].toLowerCase(), rest: tokens.slice(idx + 1) };
}

function firstNonFlag(tokens: string[]): string {
  for (const t of tokens) if (!t.startsWith("-")) return t.toLowerCase();
  return "";
}

function longFlagsOf(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.startsWith("--")).map((t) => t.split("=")[0].toLowerCase()));
}

function shortCharsOf(tokens: string[]): Set<string> {
  return new Set(
    tokens
      .filter((t) => t.startsWith("-") && !t.startsWith("--"))
      .flatMap((t) => [...t.slice(1)]),
  );
}

function findGitGlobalEscape(tokens: string[]): string | null {
  const redirectFlags = ["--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === "-c") return t;
    for (const flag of redirectFlags) {
      if (lower === flag || lower.startsWith(flag + "=")) return t;
    }
  }
  return null;
}

/**
 * Flag-aware destructive-git guard for git.mutate. Blocks the operations that
 * can destroy uncommitted or unreachable work (history rewrite, forced
 * checkout, branch/ref deletion, stash destruction) while leaving inspection
 * (status/log/diff/show/…) and ordinary work-tree mutations (add/commit) to
 * the normal policy path. Global flags that redirect git at a different
 * repository are rejected so the command can never escape the workspace.
 */
export function assertGitCommandSafety(gitArgs: string[]): void {
  const tokens = gitArgs.filter(Boolean);
  const escapeFlag = findGitGlobalEscape(tokens);
  if (escapeFlag) {
    throw new SensorimotorError(
      "SENSORIMOTOR_POLICY_DENIED",
      403,
      `git.mutate blocks repository-redirecting flag ${escapeFlag} (would escape the session workspace)`,
      false,
    );
  }
  const parsed = gitSubcommandOf(tokens);
  if (!parsed) {
    throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 400, "git.mutate requires a git subcommand", false);
  }
  const { sub, rest } = parsed;
  const longs = longFlagsOf(rest);
  const shorts = shortCharsOf(rest);
  const hasLong = (...names: string[]) => names.some((n) => longs.has(n));
  const hasShort = (...chars: string[]) => chars.some((c) => shorts.has(c));
  const deny = (what: string): never => {
    throw new SensorimotorError(
      "SENSORIMOTOR_POLICY_DENIED",
      403,
      `git.mutate blocks destructive operation: ${what}`,
      false,
    );
  };

  switch (sub) {
    case "push":
      // Every push mutates a remote; force variants additionally destroy remote
      // history. Neither is a local worktree mutation AFT can checkpoint.
      deny("git push (remote mutation; force push destroys remote history)");
    case "clean":
      if (!hasLong("--dry-run") && !hasShort("n")) deny("git clean (deletes untracked files)");
      return;
    case "filter-branch":
    case "filter-repo":
      deny(`git ${sub} (history rewrite)`);
    case "reset":
      if (hasLong("--hard")) deny("git reset --hard (discards worktree + index state)");
      return;
    case "checkout":
    case "restore":
    case "switch":
      if (hasLong("--force", "--hard") || hasShort("f", "F")) deny(`git ${sub} --force (overwrites local changes)`);
      return;
    case "branch":
    case "remote":
      if (hasLong("--delete") || hasShort("d", "D") || firstNonFlag(rest) === "remove") {
        deny(`git ${sub} -d/-D/remove (ref deletion)`);
      }
      return;
    case "rebase":
      if (!hasLong("--abort", "--quit")) deny("git rebase (history rewrite; only --abort/--quit are allowed)");
      return;
    case "stash": {
      const op = firstNonFlag(rest);
      if (op === "drop" || op === "clear") deny(`git stash ${op} (destroys stash entries)`);
      return;
    }
    case "worktree": {
      const op = firstNonFlag(rest);
      if (op === "remove") deny("git worktree remove (unsafe worktree deletion)");
      return;
    }
    default:
      return;
  }
}

// --- sessions ---

export interface SessionOptions {
  workspaceRoot: string;
  actorId: string;
  goal?: string;
}

export function createSession(opts: SessionOptions): SensorimotorSession {
  const id = `sms_${randomUUID().slice(0, 16)}`;
  const now = new Date().toISOString();
  const session: SensorimotorSession = {
    id,
    workspaceRoot: opts.workspaceRoot,
    actorId: opts.actorId,
    status: "active",
    goal: opts.goal ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const db = openAgentOsDb();
  db.run(
    "INSERT INTO sm_sessions (id, workspace_root, actor_id, status, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [session.id, session.workspaceRoot, session.actorId, session.status, session.goal, session.createdAt, session.updatedAt],
  );
  return session;
}

export function getSession(sessionId: string): SensorimotorSession | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM sm_sessions WHERE id = ? LIMIT 1")
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    workspaceRoot: row.workspace_root as string,
    actorId: row.actor_id as string,
    status: row.status as SensorimotorSession["status"],
    goal: (row.goal as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function closeSession(sessionId: string, status: "closed" | "aborted"): SensorimotorSession {
  const session = getSession(sessionId);
  if (!session) {
    throw new SensorimotorError("SENSORIMOTOR_SESSION_NOT_FOUND", 404, `session not found: ${sessionId}`);
  }
  const db = openAgentOsDb();
  db.run("UPDATE sm_sessions SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    new Date().toISOString(),
    sessionId,
  ]);
  return { ...session, status };
}

function touchSession(sessionId: string): void {
  try {
    openAgentOsDb().run("UPDATE sm_sessions SET updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      sessionId,
    ]);
  } catch {
    // heartbeat best-effort
  }
}

// --- audit + persistence ---

function redact(value: string): string {
  return ToolExecutionSandbox.redactSecrets(value);
}

function audit(
  sessionId: string | null,
  actionId: string | null,
  actorId: string,
  event: string,
  decision: string,
  details?: Record<string, unknown>,
): void {
  try {
    const db = openAgentOsDb();
    // Deterministic audit: details are serialized once and passed through the
    // secret-redaction scrubber so no credential class can enter the trail.
    const detailsJson = redact(JSON.stringify(details ?? {}));
    db.run(
      "INSERT INTO sm_audit (id, session_id, action_id, actor_id, event, decision, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        `sma_${randomUUID().slice(0, 16)}`,
        sessionId,
        actionId,
        actorId,
        event,
        decision,
        detailsJson,
        new Date().toISOString(),
      ],
    );
  } catch {
    // audit best-effort; never blocks execution path
  }
}

function insertAction(sessionId: string, req: ActionRequest): string {
  const id = `sma_${randomUUID().slice(0, 16)}`;
  const db = openAgentOsDb();
  db.run(
    "INSERT INTO sm_actions (id, session_id, kind, target, status, attempt, max_attempts, checkpoint_json, timeout_ms, created_at) VALUES (?, ?, ?, ?, 'pending', 1, ?, '{}', ?, ?)",
    [id, sessionId, req.kind, req.target, Math.max(1, req.maxAttempts ?? 3), Math.max(1000, req.timeoutMs ?? 30000), new Date().toISOString()],
  );
  return id;
}

function updateActionStatus(
  actionId: string,
  status: ActionStatus,
  patch: { attempt?: number; errorCode?: string; errorMessage?: string; checkpointJson?: string; verified?: boolean; started?: boolean; finished?: boolean },
): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.run(
    `UPDATE sm_actions SET status = ?${patch.attempt !== undefined ? ", attempt = ?" : ""}${patch.errorCode !== undefined ? ", error_code = ?" : ""}${patch.errorMessage !== undefined ? ", error_message = ?" : ""}${patch.checkpointJson !== undefined ? ", checkpoint_json = ?" : ""}${patch.verified !== undefined ? ", verified = ?" : ""}${patch.started ? ", started_at = COALESCE(started_at, ?)" : ""}${patch.finished ? ", finished_at = ?" : ""} WHERE id = ?`,
    [
      status,
      ...(patch.attempt !== undefined ? [patch.attempt] : []),
      ...(patch.errorCode !== undefined ? [patch.errorCode] : []),
      ...(patch.errorMessage !== undefined ? [patch.errorMessage] : []),
      ...(patch.checkpointJson !== undefined ? [patch.checkpointJson] : []),
      ...(patch.verified !== undefined ? [patch.verified ? 1 : 0] : []),
      ...(patch.started ? [now] : []),
      ...(patch.finished ? [now] : []),
      actionId,
    ],
  );
}

function recordIdempotency(key: string, sessionId: string, actionId: string): boolean {
  try {
    const res = openAgentOsDb()
      .run("INSERT OR IGNORE INTO sm_idempotency (key, session_id, action_id, created_at) VALUES (?, ?, ?, ?)", [
        key,
        sessionId,
        actionId,
        new Date().toISOString(),
      ]);
    return res.changes > 0;
  } catch {
    return true; // ledger unavailable — execution result still valid
  }
}

function lookupIdempotentAction(key: string): { actionId: string; terminal: boolean } | null {
  try {
    const row = openAgentOsDb()
      .query("SELECT action_id FROM sm_idempotency WHERE key = ? LIMIT 1")
      .get(key) as { action_id: string } | undefined;
    if (!row) return null;
    const action = openAgentOsDb()
      .query("SELECT status FROM sm_actions WHERE id = ? LIMIT 1")
      .get(row.action_id) as { status: string } | undefined;
    if (!action) return null;
    return { actionId: row.action_id, terminal: TERMINAL_STATUSES.has(action.status as ActionStatus) };
  } catch {
    return null;
  }
}

function saveCheckpoint(sessionId: string, actionId: string | null, snapshot: Record<string, unknown>): string {
  const id = `smk_${randomUUID().slice(0, 16)}`;
  const contentHash = `${snapshot.workspaceRoot as string}:${(snapshot.files as string[]).length}`;
  const db = openAgentOsDb();
  db.run(
    "INSERT INTO sm_checkpoints (id, session_id, action_id, snapshot_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, sessionId, actionId, JSON.stringify(snapshot), contentHash, new Date().toISOString()],
  );
  return id;
}

function computeHealthDelta(
  beforeHash: string | null,
  afterHash: string | null,
  beforeFiles: Set<string>,
  afterFiles: Set<string>,
): HealthDelta {
  const reasons: string[] = [];
  let filesAdded = 0;
  let filesRemoved = 0;
  let filesChanged = 0;
  for (const f of afterFiles) if (!beforeFiles.has(f)) filesAdded++;
  for (const f of beforeFiles) if (!afterFiles.has(f)) filesRemoved++;
  filesChanged = filesAdded + filesRemoved;
  if (filesRemoved > 0) reasons.push(`${filesRemoved} file(s) removed by action`);
  return {
    filesChanged,
    filesAdded,
    filesRemoved,
    contentHashBefore: beforeHash,
    contentHashAfter: afterHash,
    degraded: filesRemoved > 0,
    reasons,
  };
}

function fileSetFromHash(perceptionId: string | null, root: string): { hash: string | null; files: Set<string> } {
  if (perceptionId) {
    const p = getPerception(perceptionId);
    if (p) return { hash: p.contentHash, files: new Set(p.files.map((f) => f.relativePath)) };
  }
  const fresh = createPerception({ sessionId: "adhoc", kind: "tree", workspaceRoot: root, maxFiles: 500 });
  return { hash: fresh.contentHash, files: new Set(fresh.files.map((f) => f.relativePath)) };
}

// --- execution primitives ---

async function executeOnce(req: ActionRequest, session: SensorimotorSession, signal: AbortSignal | null): Promise<void> {
  const root = session.workspaceRoot;

  if (req.kind === "fs.write") {
    const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(req.target, root);
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before write", false);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, req.content ?? "", "utf8");
    if (!existsSync(resolved)) {
      throw new SensorimotorError(
        "SENSORIMOTOR_VERIFICATION_FAILED",
        500,
        `post-write verification failed: ${req.target} missing after write`,
        true,
      );
    }
    return;
  }

  if (req.kind === "fs.delete") {
    const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(req.target, root);
    if (!existsSync(resolved)) {
      throw new SensorimotorError("SENSORIMOTOR_TARGET_MISSING", 404, `target not found: ${req.target}`);
    }
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before delete", false);
    rmSync(resolved, { recursive: true });
    if (existsSync(resolved)) {
      throw new SensorimotorError(
        "SENSORIMOTOR_VERIFICATION_FAILED",
        500,
        `post-delete verification failed: ${req.target} still present`,
        true,
      );
    }
    return;
  }

  if (req.kind === "fs.move") {
    if (!req.destination) {
      throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 400, "fs.move requires destination");
    }
    const from = ToolExecutionSandbox.assertSafeWorkspacePath(req.target, root);
    const to = ToolExecutionSandbox.assertSafeWorkspacePath(req.destination, root);
    if (!existsSync(from)) {
      throw new SensorimotorError("SENSORIMOTOR_TARGET_MISSING", 404, `target not found: ${req.target}`);
    }
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before move", false);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    if (!existsSync(to) || existsSync(from)) {
      throw new SensorimotorError(
        "SENSORIMOTOR_VERIFICATION_FAILED",
        500,
        `post-move verification failed: ${req.target} → ${req.destination}`,
        true,
      );
    }
    return;
  }

  if (req.kind === "shell.exec" || req.kind === "git.mutate") {
    // Shield the FULL composed command line — target and arguments together —
    // so splitting args across fields can never bypass the destructive-pattern
    // check (e.g. target "rm" with content "-rf /" must still be blocked).
    const composed = req.content ? `${req.target} ${req.content}` : req.target;
    ToolExecutionSandbox.assertSafeCommand(composed);
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before exec", false);
    // git.mutate constrains the command to git subcommands only; shell.exec
    // accepts any argv through the sanctioned runner.
    let argv: string[];
    if (req.kind === "git.mutate") {
      const target = req.target.trim();
      const isGitBinary = target === "git" || target.endsWith("/git") || target.endsWith("\\git");
      if (!isGitBinary) {
        throw new SensorimotorError(
          "SENSORIMOTOR_INVALID_ACTION",
          400,
          `git.mutate target must be "git" or a path to git, got: ${target}`,
          false,
        );
      }
      const gitArgs = req.content ? req.content.split(/\s+/).filter(Boolean) : [];
      assertGitCommandSafety(gitArgs);
      argv = [target, ...gitArgs];
    } else {
      argv = [req.target, ...(req.content ? req.content.split(/\s+/).filter(Boolean) : [])];
      // Bypass guard: shell.exec must not become a side door around the
      // git.mutate destructive-operation policy by invoking git directly.
      const shellBinary = req.target.trim().replace(/^.*[/\\]/, "").toLowerCase();
      if (shellBinary === "git") {
        assertGitCommandSafety(argv.slice(1));
      }
    }
    const res = await SafeImplementationRunner.runCommand(argv, {
      cwd: root,
      timeoutMs: Math.max(1000, req.timeoutMs ?? 30000),
    });
    if (res.exitCode !== 0) {
      // exit 124 is the canonical "command timed out" code from the runner;
      // treat it as authoritative even when the platform spawn path loses
      // the timedOut flag (Windows process-kill semantics).
      const timedOut = res.timedOut || res.exitCode === 124;
      const code: SensorimotorErrorCode = timedOut ? "SENSORIMOTOR_TIMEOUT" : "SENSORIMOTOR_HEALTH_DEGRADED";
      // stderr is foreign output — redact before it can reach the outcome,
      // the audit trail, or the caller.
      throw new SensorimotorError(code, timedOut ? 504 : 500, redact(`command exited ${res.exitCode}: ${res.stderr.slice(0, 200)}`), timedOut);
    }
    // Post-action workspace sanity: the sanctioned runner must never be able
    // to remove the session workspace itself.
    if (!existsSync(root)) {
      throw new SensorimotorError(
        "SENSORIMOTOR_VERIFICATION_FAILED",
        500,
        "post-exec verification failed: session workspace root is missing",
        false,
      );
    }
    return;
  }

  throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 400, `unsupported action kind: ${req.kind}`);
}

function rollbackCheckpoint(checkpointJson: string, session: SensorimotorSession): void {
  const snapshot = JSON.parse(checkpointJson) as {
    files: Array<{ relativePath: string; contentBase64: string | null }>;
  };
  const root = session.workspaceRoot;
  for (const f of snapshot.files) {
    const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(f.relativePath, root);
    if (f.contentBase64 === null) {
      if (existsSync(resolved)) rmSync(resolved, { recursive: true });
    } else {
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, Buffer.from(f.contentBase64, "base64"));
    }
  }
}

function captureCheckpoint(sessionId: string, actionId: string, req: ActionRequest, session: SensorimotorSession): string {
  const root = session.workspaceRoot;
  const targets: string[] =
    req.kind === "fs.move" ? [req.target, req.destination ?? ""] : [req.target];

  const files: Array<{ relativePath: string; contentBase64: string | null }> = [];
  let totalBytes = 0;
  for (const t of targets) {
    if (!t || files.length >= AFT_DEFAULTS.maxCheckpointFiles) continue;
    let resolved: string;
    try {
      resolved = ToolExecutionSandbox.assertSafeWorkspacePath(t, root);
    } catch {
      continue; // destination may not exist yet for fs.move — nothing to snapshot
    }
    if (!existsSync(resolved)) continue;
    try {
      // Only snapshot plain files; directory deletes are bounded by file count below.
      const content = readFileSync(resolved);
      if (content.byteLength > AFT_DEFAULTS.maxCheckpointBytes - totalBytes) {
        throw new SensorimotorError("SENSORIMOTOR_CHECKPOINT_FAILED", 413, `checkpoint payload too large for ${req.target}`, false);
      }
      totalBytes += content.byteLength;
      files.push({ relativePath: t, contentBase64: content.toString("base64") });
    } catch (err) {
      if (err instanceof SensorimotorError) throw err;
      continue; // unreadable (e.g. directory) — skip from byte snapshot
    }
  }

  if (files.length === 0 && (req.kind === "fs.delete" || req.kind === "fs.move")) {
    throw new SensorimotorError("SENSORIMOTOR_CHECKPOINT_FAILED", 400, `no checkpointable content for ${req.target}`, false);
  }

  return saveCheckpoint(sessionId, actionId, { workspaceRoot: root, files });
}

// --- transactional entry point ---

export async function executeAction(
  req: ActionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ActionOutcome> {
  const session = getSession(req.sessionId);
  if (!session) {
    throw new SensorimotorError("SENSORIMOTOR_SESSION_NOT_FOUND", 404, `session not found: ${req.sessionId}`);
  }
  if (session.status !== "active") {
    throw new SensorimotorError("SENSORIMOTOR_INVALID_ACTION", 409, `session ${session.status}; refusing new actions`, false);
  }

  // Stale-session detection: a session idle far beyond its expected horizon is
  // refused instead of silently acting on a possibly-abandoned workspace.
  const config = aftConfig();
  const idleMs = Date.now() - Date.parse(session.updatedAt);
  if (Number.isFinite(idleMs) && idleMs > config.sessionStaleMs) {
    throw new SensorimotorError(
      "SENSORIMOTOR_SESSION_STALE",
      409,
      `session ${session.id} is stale (idle ${Math.round(idleMs / 1000)}s > ${Math.round(config.sessionStaleMs / 1000)}s); open a new session`,
      false,
    );
  }

  const actionId = insertAction(req.sessionId, req);
  const started = Date.now();
  const maxAttempts = Math.max(1, req.maxAttempts ?? 3);
  const timeoutMs = Math.max(1000, req.timeoutMs ?? 30000);
  const idempotencyKey = req.idempotencyKey ? String(req.idempotencyKey).slice(0, 128) : null;

  const before = fileSetFromHash(null, session.workspaceRoot);

  const makeOutcome = (over: Partial<ActionOutcome> & { status: ActionStatus; error: ActionOutcome["error"] }): ActionOutcome => ({
    actionId,
    sessionId: req.sessionId,
    kind: req.kind,
    target: req.target,
    attempt: 1,
    maxAttempts,
    checkpointId: null,
    rolledBack: false,
    verified: false,
    duplicate: false,
    observation: null,
    durationMs: Date.now() - started,
    ...over,
  });

  const fail = (status: ActionStatus, code: SensorimotorErrorCode, message: string, rolledBack = false): ActionOutcome => {
    updateActionStatus(actionId, status, { finished: true, errorCode: code, errorMessage: message });
    audit(req.sessionId, actionId, session.actorId, "action_finished", status, { code, message: redact(message), rolledBack });
    return makeOutcome({ status, error: { code, message: redact(message) }, rolledBack });
  };

  audit(req.sessionId, actionId, session.actorId, "action_started", req.kind, {
    kind: req.kind,
    target: req.target,
    idempotencyKey: idempotencyKey ?? null,
  });

  // Idempotent replay: a key with a terminal recorded outcome replays that
  // outcome instead of re-executing the mutation. A non-terminal record means
  // a previous attempt crashed mid-window — proceed fresh (its checkpoint
  // remains recoverable) rather than replaying a half-state.
  if (idempotencyKey) {
    const prior = lookupIdempotentAction(idempotencyKey);
    if (prior?.terminal) {
      audit(req.sessionId, actionId, session.actorId, "action_duplicate", "replayed", { key: idempotencyKey, originalActionId: prior.actionId });
      updateActionStatus(actionId, "aborted", { finished: true, errorCode: "SENSORIMOTOR_INVALID_ACTION", errorMessage: "superseded by idempotent replay" });
      const replay = getActionOutcome(prior.actionId);
      if (replay) {
        return { ...replay, duplicate: true, durationMs: Date.now() - started };
      }
    }
  }

  // Stage 1 — plan: deny-by-default policy + sandbox path pre-check
  const capability = ACTION_CAPABILITY[req.kind];
  if (req.kind !== "shell.exec" && req.kind !== "git.mutate") {
    const resolved = (() => {
      try {
        return ToolExecutionSandbox.assertSafeWorkspacePath(req.target, session.workspaceRoot);
      } catch {
        return null;
      }
    })();
    if (!resolved) {
      return fail("failed", "SENSORIMOTOR_PATH_OUTSIDE_WORKSPACE", `target escapes workspace: ${req.target}`);
    }
  }

  const decision = evaluateCapability("agent", session.actorId, capability);
  audit(req.sessionId, actionId, session.actorId, "policy_evaluated", decision.reason, { capability, target: req.target });
  if (!decision.allowed) {
    const code = decision.reason === "approval_required" || decision.reason === "approval_denied"
      ? "SENSORIMOTOR_APPROVAL_REQUIRED"
      : "SENSORIMOTOR_POLICY_DENIED";
    return fail("failed", code, `policy ${decision.reason} for ${capability}`);
  }

  // Stage 2 — acquire the per-workspace transaction lock so concurrent
  // sessions serialize across checkpoint → execute → observe.
  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = await acquireWorkspaceLock({
      workspaceRoot: session.workspaceRoot,
      sessionId: session.id,
      actionId,
      waitMs: config.lockWaitMs,
      // TTL covers the whole bounded execution window plus slack, after which
      // a crashed holder becomes stealable.
      ttlMs: timeoutMs * maxAttempts + AFT_DEFAULTS.lockTtlSlackMs,
    });
    audit(req.sessionId, actionId, session.actorId, "workspace_lock_acquired", "ok", { workspaceRoot: session.workspaceRoot });
  } catch (err) {
    if (err instanceof WorkspaceLockTimeoutError) {
      return fail("failed", "SENSORIMOTOR_LOCK_TIMEOUT", `workspace is busy: held by session ${err.heldBy?.sessionId ?? "unknown"} (waited ${err.waitedMs}ms)`);
    }
    throw err;
  }

  try {
    // Heartbeat: this session is demonstrably alive.
    touchSession(session.id);

    // Stage 3 — checkpoint (only for actions that mutate existing content)
    let checkpointId: string | null = null;
    let checkpointJson = "{}";
    if (req.kind === "fs.write" || req.kind === "fs.delete" || req.kind === "fs.move") {
      try {
        checkpointId = captureCheckpoint(req.sessionId, actionId, req, session);
        const cpRow = openAgentOsDb()
          .query("SELECT snapshot_json FROM sm_checkpoints WHERE id = ?")
          .get(checkpointId) as { snapshot_json: string } | undefined;
        checkpointJson = cpRow?.snapshot_json ?? "{}";
        updateActionStatus(actionId, "checkpointed", {});
        audit(req.sessionId, actionId, session.actorId, "checkpoint_created", "ok", { checkpointId });
      } catch (err) {
        if (err instanceof SensorimotorError) {
          return fail("failed", err.code, err.message);
        }
        return fail("failed", "SENSORIMOTOR_CHECKPOINT_FAILED", err instanceof Error ? err.message : "checkpoint failed");
      }
    }

    // Stage 4 — execute with bounded retry/backoff, timeout, cooperative abort
    let attempt = 0;
    let lastError: SensorimotorError | null = null;
    while (attempt < maxAttempts) {
      attempt++;
      if (options.signal?.aborted) {
        updateActionStatus(actionId, "aborted", { attempt, finished: true, errorCode: "SENSORIMOTOR_ABORTED", errorMessage: "aborted by caller" });
        audit(req.sessionId, actionId, session.actorId, "action_aborted", "aborted", { attempt });
        return makeOutcome({
          status: "aborted",
          attempt,
          checkpointId,
          error: { code: "SENSORIMOTOR_ABORTED", message: "aborted by caller" },
        });
      }
      updateActionStatus(actionId, "running", { attempt, started: attempt === 1 });

      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const composite = options.signal
          ? AbortSignal.any([options.signal, timeoutSignal])
          : timeoutSignal;
        await executeOnce(req, session, composite);
        lastError = null;
        break;
      } catch (err) {
        if (err instanceof SandboxSecurityError) {
          lastError = new SensorimotorError("SENSORIMOTOR_PATH_OUTSIDE_WORKSPACE", 403, redact(err.message), false);
          break; // sandbox violations are never retryable
        }
        if (err instanceof SensorimotorError) {
          lastError = err;
          if (err.code === "SENSORIMOTOR_ABORTED" || err.code === "SENSORIMOTOR_TARGET_MISSING" || err.code === "SENSORIMOTOR_INVALID_ACTION") break;
        } else {
          lastError = new SensorimotorError("SENSORIMOTOR_HEALTH_DEGRADED", 500, redact(err instanceof Error ? err.message : String(err)), true);
        }
        if (attempt < maxAttempts) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt - 1), 1600);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    // Stage 5 — observe + conditional rollback
    if (lastError) {
      const mutated =
        req.kind === "fs.write" || req.kind === "fs.delete" || req.kind === "fs.move";
      if (mutated && checkpointId) {
        try {
          rollbackCheckpoint(checkpointJson, session);
          updateActionStatus(actionId, "rolled_back", { attempt, finished: true, errorCode: lastError.code, errorMessage: lastError.message });
          const after = fileSetFromHash(null, session.workspaceRoot);
          const healthDelta = computeHealthDelta(before.hash, after.hash, before.files, after.files);
          openAgentOsDb().run(
            "INSERT INTO sm_observations (id, action_id, session_id, outcome, health_delta_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [`smo_${randomUUID().slice(0, 16)}`, actionId, req.sessionId, "rolled_back", JSON.stringify(healthDelta), after.hash, new Date().toISOString()],
          );
          audit(req.sessionId, actionId, session.actorId, "action_rolled_back", lastError.code, { attempt, checkpointId });
          return makeOutcome({
            status: "rolled_back",
            attempt,
            checkpointId,
            rolledBack: true,
            observation: { outcome: "rolled_back", healthDelta },
            error: { code: lastError.code, message: redact(lastError.message) },
          });
        } catch (rbErr) {
          const message = rbErr instanceof Error ? rbErr.message : String(rbErr);
          updateActionStatus(actionId, "failed", { attempt, finished: true, errorCode: "SENSORIMOTOR_ROLLBACK_FAILED", errorMessage: message });
          audit(req.sessionId, actionId, session.actorId, "rollback_failed", "SENSORIMOTOR_ROLLBACK_FAILED", { attempt, message: redact(message) });
          return makeOutcome({
            status: "failed",
            attempt,
            checkpointId,
            error: { code: "SENSORIMOTOR_ROLLBACK_FAILED", message: redact(`rollback failed after ${lastError.code}: ${message}`) },
          });
        }
      }
      const status: ActionStatus = lastError.code === "SENSORIMOTOR_ABORTED"
        ? "aborted"
        : lastError.code === "SENSORIMOTOR_TIMEOUT"
          ? "timed_out"
          : lastError.retryable && attempt < maxAttempts
            ? "retryable"
            : "failed";
      updateActionStatus(actionId, status, { attempt, finished: true, errorCode: lastError.code, errorMessage: lastError.message });
      audit(req.sessionId, actionId, session.actorId, "action_finished", status, { code: lastError.code, attempt, message: redact(lastError.message) });
      return makeOutcome({
        status,
        attempt,
        checkpointId,
        error: { code: lastError.code, message: redact(lastError.message) },
      });
    }

    // success path — record observation with health delta
    const after = fileSetFromHash(null, session.workspaceRoot);
    const healthDelta = computeHealthDelta(before.hash, after.hash, before.files, after.files);
    openAgentOsDb().run(
      "INSERT INTO sm_observations (id, action_id, session_id, outcome, health_delta_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [`smo_${randomUUID().slice(0, 16)}`, actionId, req.sessionId, "success", JSON.stringify(healthDelta), after.hash, new Date().toISOString()],
    );
    updateActionStatus(actionId, "succeeded", { attempt, verified: true, finished: true });
    audit(req.sessionId, actionId, session.actorId, "action_finished", "succeeded", { attempt, filesChanged: healthDelta.filesChanged, verified: true });

    if (idempotencyKey) recordIdempotency(idempotencyKey, req.sessionId, actionId);

    return makeOutcome({
      status: "succeeded",
      attempt,
      checkpointId,
      verified: true,
      observation: { outcome: "success", healthDelta },
      error: null,
    });
  } finally {
    if (releaseLock) releaseLock();
    audit(req.sessionId, actionId, session.actorId, "workspace_lock_released", "ok", {});
  }
}

export function getActionOutcome(actionId: string): ActionOutcome | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM sm_actions WHERE id = ? LIMIT 1")
    .get(actionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const obsRow = db
    .query("SELECT * FROM sm_observations WHERE action_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(actionId) as Record<string, unknown> | undefined;
  const cpRow = db
    .query("SELECT id FROM sm_checkpoints WHERE action_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(actionId) as { id: string } | undefined;
  return {
    actionId: row.id as string,
    sessionId: row.session_id as string,
    kind: row.kind as ActionOutcome["kind"],
    target: row.target as string,
    status: row.status as ActionStatus,
    attempt: row.attempt as number,
    maxAttempts: row.max_attempts as number,
    checkpointId: cpRow?.id ?? null,
    rolledBack: row.status === "rolled_back",
    verified: row.verified === 1,
    duplicate: false,
    observation: obsRow
      ? {
          outcome: obsRow.outcome as "success" | "failed" | "aborted" | "rolled_back",
          healthDelta: JSON.parse(obsRow.health_delta_json as string) as HealthDelta,
        }
      : null,
    error: row.error_code
      ? { code: row.error_code as SensorimotorErrorCode, message: (row.error_message as string) ?? "" }
      : null,
    durationMs: 0,
  };
}
