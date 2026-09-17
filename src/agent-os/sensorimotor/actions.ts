// Phase 20.82 — Sensorimotor Action Executor (CortexKit AFT contract).
//
// Transactional mutation loop: plan (policy) → checkpoint → execute → observe.
// Every mutating action is checkpointed before it runs; observation records
// the health delta so failed actions roll back deterministically. Abort is
// cooperative via AbortSignal; timeout and bounded retry/backoff are enforced
// per attempt. Policy integration reuses the Phase 05 deny-by-default engine
// and the Phase 20.74 sandbox path guard — no new authority abstractions.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { openAgentOsDb } from "../db";
import { evaluateCapability, type Capability } from "../policy";
import { ToolExecutionSandbox, SandboxSecurityError } from "../mcp-gateway/sandbox";
import { SafeImplementationRunner } from "../sdlc/runner";
import { createPerception, getPerception } from "./perception";
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
    db.run(
      "INSERT INTO sm_audit (id, session_id, action_id, actor_id, event, decision, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        `sma_${randomUUID().slice(0, 16)}`,
        sessionId,
        actionId,
        actorId,
        event,
        decision,
        JSON.stringify(details ?? {}),
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
  patch: { attempt?: number; errorCode?: string; errorMessage?: string; checkpointJson?: string; started?: boolean; finished?: boolean },
): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.run(
    `UPDATE sm_actions SET status = ?${patch.attempt !== undefined ? ", attempt = ?" : ""}${patch.errorCode !== undefined ? ", error_code = ?" : ""}${patch.errorMessage !== undefined ? ", error_message = ?" : ""}${patch.checkpointJson !== undefined ? ", checkpoint_json = ?" : ""}${patch.started ? ", started_at = COALESCE(started_at, ?)" : ""}${patch.finished ? ", finished_at = ?" : ""} WHERE id = ?`,
    [
      status,
      ...(patch.attempt !== undefined ? [patch.attempt] : []),
      ...(patch.errorCode !== undefined ? [patch.errorCode] : []),
      ...(patch.errorMessage !== undefined ? [patch.errorMessage] : []),
      ...(patch.checkpointJson !== undefined ? [patch.checkpointJson] : []),
      ...(patch.started ? [now] : []),
      ...(patch.finished ? [now] : []),
      actionId,
    ],
  );
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

async function executeOnce(req: ActionRequest, session: SensorimotorSession, signal: AbortSignal | null): Promise<void> {
  const root = session.workspaceRoot;

  if (req.kind === "fs.write") {
    const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(req.target, root);
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before write", false);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, req.content ?? "", "utf8");
    return;
  }

  if (req.kind === "fs.delete") {
    const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(req.target, root);
    if (!existsSync(resolved)) {
      throw new SensorimotorError("SENSORIMOTOR_TARGET_MISSING", 404, `target not found: ${req.target}`);
    }
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before delete", false);
    rmSync(resolved, { recursive: true });
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
    return;
  }

  if (req.kind === "shell.exec") {
    // Shield the FULL composed command line — target and arguments together —
    // so splitting args across fields can never bypass the destructive-pattern
    // check (e.g. target "rm" with content "-rf /" must still be blocked).
    const composed = req.content ? `${req.target} ${req.content}` : req.target;
    ToolExecutionSandbox.assertSafeCommand(composed);
    if (signal?.aborted) throw new SensorimotorError("SENSORIMOTOR_ABORTED", 409, "aborted before exec", false);
    // shell.exec means a whitelisted argv array via the sanctioned runner.
    const argv = [req.target, ...(req.content ? req.content.split(/\s+/).filter(Boolean) : [])];
    const res = await SafeImplementationRunner.runCommand(argv, {
      cwd: root,
      timeoutMs: Math.max(1000, req.timeoutMs ?? 30000),
    });
    if (res.exitCode !== 0) {
      // exit 124 is the canonical "command timed out" code from the runner;
      // treat it as authoritative even when the platform spawn path loses
      // the timedOut flag (Windows process-kill semantics).
      const timedOut = res.timedOut || res.exitCode === 124;
      const code = timedOut ? "SENSORIMOTOR_TIMEOUT" : "SENSORIMOTOR_HEALTH_DEGRADED";
      throw new SensorimotorError(code, timedOut ? 504 : 500, `command exited ${res.exitCode}: ${res.stderr.slice(0, 200)}`, timedOut);
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

const CHECKPOINT_MAX_BYTES = 512 * 1024;
const CHECKPOINT_MAX_FILES = 50;

function captureCheckpoint(sessionId: string, actionId: string, req: ActionRequest, session: SensorimotorSession): string {
  const root = session.workspaceRoot;
  const targets: string[] =
    req.kind === "fs.move" ? [req.target, req.destination ?? ""] : [req.target];

  const files: Array<{ relativePath: string; contentBase64: string | null }> = [];
  let totalBytes = 0;
  for (const t of targets) {
    if (!t || files.length >= CHECKPOINT_MAX_FILES) continue;
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
      if (content.byteLength > CHECKPOINT_MAX_BYTES - totalBytes) {
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

  const actionId = insertAction(req.sessionId, req);
  const started = Date.now();
  const maxAttempts = Math.max(1, req.maxAttempts ?? 3);
  const timeoutMs = Math.max(1000, req.timeoutMs ?? 30000);

  const before = fileSetFromHash(null, session.workspaceRoot);

  const fail = (status: ActionStatus, code: SensorimotorErrorCode, message: string, rolledBack = false): ActionOutcome => {
    updateActionStatus(actionId, status, { finished: true, errorCode: code, errorMessage: message });
    audit(req.sessionId, actionId, session.actorId, "action_finished", status, { code, message, rolledBack });
    return {
      actionId,
      sessionId: req.sessionId,
      kind: req.kind,
      target: req.target,
      status,
      attempt: 1,
      maxAttempts,
      checkpointId: null,
      rolledBack,
      observation: null,
      error: { code, message },
      durationMs: Date.now() - started,
    };
  };

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

  // Stage 2 — checkpoint (only for actions that mutate existing content)
  let checkpointId: string | null = null;
  let checkpointJson = "{}";
  if (req.kind === "fs.write" || req.kind === "fs.delete" || req.kind === "fs.move") {
    try {
      checkpointId = captureCheckpoint(req.sessionId, actionId, req, session);
      const row = openAgentOsDb()
        .query("SELECT checkpoint_json FROM sm_actions WHERE id = ?")
        .get(actionId) as { checkpoint_json: string } | undefined;
      void row;
      const cpRow = openAgentOsDb()
        .query("SELECT snapshot_json FROM sm_checkpoints WHERE id = ?")
        .get(checkpointId) as { snapshot_json: string } | undefined;
      checkpointJson = cpRow?.snapshot_json ?? "{}";
      updateActionStatus(actionId, "checkpointed", {});
    } catch (err) {
      if (err instanceof SensorimotorError) {
        return fail("failed", err.code, err.message);
      }
      return fail("failed", "SENSORIMOTOR_CHECKPOINT_FAILED", err instanceof Error ? err.message : "checkpoint failed");
    }
  }

  // Stage 3 — execute with bounded retry/backoff, timeout, cooperative abort
  let attempt = 0;
  let lastError: SensorimotorError | null = null;
  while (attempt < maxAttempts) {
    attempt++;
    if (options.signal?.aborted) {
      updateActionStatus(actionId, "aborted", { attempt, finished: true, errorCode: "SENSORIMOTOR_ABORTED", errorMessage: "aborted by caller" });
      return {
        actionId, sessionId: req.sessionId, kind: req.kind, target: req.target,
        status: "aborted", attempt, maxAttempts, checkpointId, rolledBack: false,
        observation: null, error: { code: "SENSORIMOTOR_ABORTED", message: "aborted by caller" },
        durationMs: Date.now() - started,
      };
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
        lastError = new SensorimotorError("SENSORIMOTOR_PATH_OUTSIDE_WORKSPACE", 403, err.message, false);
        break; // sandbox violations are never retryable
      }
      if (err instanceof SensorimotorError) {
        lastError = err;
        if (err.code === "SENSORIMOTOR_ABORTED" || err.code === "SENSORIMOTOR_TARGET_MISSING" || err.code === "SENSORIMOTOR_INVALID_ACTION") break;
      } else {
        lastError = new SensorimotorError("SENSORIMOTOR_HEALTH_DEGRADED", 500, err instanceof Error ? err.message : String(err), true);
      }
      if (attempt < maxAttempts) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt - 1), 1600);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  // Stage 4 — observe + conditional rollback
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
        audit(req.sessionId, actionId, session.actorId, "action_rolled_back", lastError.code, { attempt });
        return {
          actionId, sessionId: req.sessionId, kind: req.kind, target: req.target,
          status: "rolled_back", attempt, maxAttempts, checkpointId, rolledBack: true,
          observation: { outcome: "rolled_back", healthDelta },
          error: { code: lastError.code, message: lastError.message },
          durationMs: Date.now() - started,
        };
      } catch (rbErr) {
        const message = rbErr instanceof Error ? rbErr.message : String(rbErr);
        updateActionStatus(actionId, "failed", { attempt, finished: true, errorCode: "SENSORIMOTOR_ROLLBACK_FAILED", errorMessage: message });
        audit(req.sessionId, actionId, session.actorId, "rollback_failed", "SENSORIMOTOR_ROLLBACK_FAILED", { attempt, message });
        return {
          actionId, sessionId: req.sessionId, kind: req.kind, target: req.target,
          status: "failed", attempt, maxAttempts, checkpointId, rolledBack: false,
          observation: null,
          error: { code: "SENSORIMOTOR_ROLLBACK_FAILED", message: `rollback failed after ${lastError.code}: ${message}` },
          durationMs: Date.now() - started,
        };
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
    audit(req.sessionId, actionId, session.actorId, "action_finished", status, { code: lastError.code, attempt });
    return {
      actionId, sessionId: req.sessionId, kind: req.kind, target: req.target,
      status, attempt, maxAttempts, checkpointId, rolledBack: false,
      observation: null, error: { code: lastError.code, message: lastError.message },
      durationMs: Date.now() - started,
    };
  }

  // success path — record observation with health delta
  const after = fileSetFromHash(null, session.workspaceRoot);
  const healthDelta = computeHealthDelta(before.hash, after.hash, before.files, after.files);
  openAgentOsDb().run(
    "INSERT INTO sm_observations (id, action_id, session_id, outcome, health_delta_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [`smo_${randomUUID().slice(0, 16)}`, actionId, req.sessionId, "success", JSON.stringify(healthDelta), after.hash, new Date().toISOString()],
  );
  updateActionStatus(actionId, "succeeded", { attempt, finished: true });
  audit(req.sessionId, actionId, session.actorId, "action_finished", "succeeded", { attempt, filesChanged: healthDelta.filesChanged });

  return {
    actionId, sessionId: req.sessionId, kind: req.kind, target: req.target,
    status: "succeeded", attempt, maxAttempts, checkpointId, rolledBack: false,
    observation: { outcome: "success", healthDelta },
    error: null,
    durationMs: Date.now() - started,
  };
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
  return {
    actionId: row.id as string,
    sessionId: row.session_id as string,
    kind: row.kind as ActionOutcome["kind"],
    target: row.target as string,
    status: row.status as ActionStatus,
    attempt: row.attempt as number,
    maxAttempts: row.max_attempts as number,
    checkpointId: null,
    rolledBack: row.status === "rolled_back",
    observation: obsRow
      ? {
          outcome: obsRow.outcome as "success" | "failed" | "aborted" | "rolled_back",
          healthDelta: JSON.parse(obsRow.health_delta_json as string) as HealthDelta,
        }
      : null,
    error: row.error_code
      ? { code: row.error_code as import("./types").SensorimotorErrorCode, message: (row.error_message as string) ?? "" }
      : null,
    durationMs: 0,
  };
}
