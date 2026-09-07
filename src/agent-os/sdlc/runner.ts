// Phase 20.2 — Safe Implementation Runner (/implement)
//
// Governs safe command execution, git working tree validation, task lock leases,
// and change manifest tracking.

import { openAgentOsDb } from "../db";
import { randomUUID } from "node:crypto";
import type { SdlcTask, RiskLevel } from "./types";

export interface GitStatusReport {
  isClean: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
  currentBranch: string;
  headCommitSha: string;
}

export interface CommandExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ChangeManifest {
  modifiedFiles: string[];
  addedFiles: string[];
  deletedFiles: string[];
  timestamp: string;
}

export class SafeImplementationRunner {
  /**
   * Acquires an exclusive execution lock for a task to prevent race conditions.
   */
  static acquireTaskLock(taskId: string, cycleId: string, ownerId: string, ttlSeconds = 300): { leaseId: string; expiresAt: number } | null {
    const db = openAgentOsDb();
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;
    const leaseId = `lock_${randomUUID().slice(0, 12)}`;

    // Clean expired locks first
    db.run("DELETE FROM sdlc_locks WHERE expires_at <= ?", [now]);

    try {
      db.query(`
        INSERT INTO sdlc_locks (id, resource_id, owner_id, cycle_id, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(leaseId, taskId, ownerId, cycleId, now, expiresAt);
      return { leaseId, expiresAt };
    } catch {
      // Locked by another runner
      return null;
    }
  }

  /**
   * Releases an acquired task lock.
   */
  static releaseTaskLock(taskId: string, ownerId?: string): void {
    const db = openAgentOsDb();
    if (ownerId) {
      db.run("DELETE FROM sdlc_locks WHERE resource_id = ? AND owner_id = ?", [taskId, ownerId]);
    } else {
      db.run("DELETE FROM sdlc_locks WHERE resource_id = ?", [taskId]);
    }
  }

  /**
   * Checks git working tree status and verifies safety invariants.
   */
  static async checkGitStatus(cwd = process.cwd()): Promise<GitStatusReport> {
    try {
      const proc = Bun.spawn(["git", "status", "--porcelain"], { cwd, stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return {
          isClean: false,
          modifiedFiles: [],
          untrackedFiles: [],
          currentBranch: "unknown",
          headCommitSha: "0000000",
        };
      }

      const lines = stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const status = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (status.includes("?") || status.includes("U")) {
          untracked.push(file);
        } else {
          modified.push(file);
        }
      }

      const headProc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe" });
      const headCommitSha = (await new Response(headProc.stdout).text()).trim() || "HEAD";

      const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdout: "pipe" });
      const currentBranch = (await new Response(branchProc.stdout).text()).trim() || "main";

      return {
        isClean: lines.length === 0,
        modifiedFiles: modified,
        untrackedFiles: untracked,
        currentBranch,
        headCommitSha,
      };
    } catch {
      return {
        isClean: false,
        modifiedFiles: [],
        untrackedFiles: [],
        currentBranch: "unknown",
        headCommitSha: "0000000",
      };
    }
  }

  /**
   * Runs a command with strict timeout and output capture.
   */
  static async runCommand(
    cmd: string[],
    options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}
  ): Promise<CommandExecutionResult> {
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const startTime = Date.now();

    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...options.env },
        signal: controller.signal,
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      clearTimeout(timer);

      return {
        command: cmd.join(" "),
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err) {
      clearTimeout(timer);
      return {
        command: cmd.join(" "),
        exitCode: timedOut ? 124 : 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
        timedOut,
      };
    }
  }

  /**
   * Asserts that high-risk tasks have valid approved permissions.
   */
  static assertApprovalGranted(cycleId: string, riskLevel: RiskLevel): void {
    if (riskLevel !== "HIGH" && riskLevel !== "CRITICAL") return;

    const db = openAgentOsDb();
    const now = Date.now();
    const approval = db.query(`
      SELECT * FROM sdlc_approvals
      WHERE cycle_id = ? AND status = 'approved' AND expires_at > ?
    `).get(cycleId, now) as Record<string, unknown> | undefined;

    if (!approval) {
      throw new Error(`High-risk operation rejected: Cycle ${cycleId} requires human approval before execution.`);
    }
  }
}

export function acquireTaskLock(
  taskId: string,
  ownerId: string,
  ttlMs = 300_000,
  cycleId = "default"
): { acquired: boolean; lockId?: string; expiresAt?: number } {
  const db = openAgentOsDb();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const lockId = `lock_${randomUUID().slice(0, 12)}`;

  // Clean expired locks first
  db.run("DELETE FROM sdlc_locks WHERE expires_at <= ?", [now]);

  // Check if active lock exists on resource_id
  const existing = db.query("SELECT * FROM sdlc_locks WHERE resource_id = ?").get(taskId) as { expires_at: number } | undefined;
  if (existing) {
    if (existing.expires_at <= now) {
      db.run("DELETE FROM sdlc_locks WHERE resource_id = ?", [taskId]);
    } else {
      return { acquired: false };
    }
  }

  try {
    db.query(`
      INSERT INTO sdlc_locks (id, resource_id, owner_id, cycle_id, acquired_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lockId, taskId, ownerId, cycleId, now, expiresAt);
    return { acquired: true, lockId, expiresAt };
  } catch {
    return { acquired: false };
  }
}

export function renewTaskLock(taskId: string, ownerId: string, ttlMs = 300_000): boolean {
  const db = openAgentOsDb();
  const now = Date.now();
  const newExpiresAt = now + ttlMs;

  const res = db.query(`
    UPDATE sdlc_locks
    SET expires_at = ?
    WHERE resource_id = ? AND owner_id = ? AND expires_at > ?
  `).run(newExpiresAt, taskId, ownerId, now);

  return (res.changes ?? 0) > 0;
}

export function releaseTaskLock(taskId: string, ownerId?: string): boolean {
  const db = openAgentOsDb();
  let res;
  if (ownerId) {
    res = db.run("DELETE FROM sdlc_locks WHERE resource_id = ? AND owner_id = ?", [taskId, ownerId]);
  } else {
    res = db.run("DELETE FROM sdlc_locks WHERE resource_id = ?", [taskId]);
  }
  return (res.changes ?? 0) > 0;
}

