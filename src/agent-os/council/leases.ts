// Phase 20.4 — Task Leases (spec sections 16, 17, 167).
//
// One active lease per (council_run, task). Uniqueness is enforced by a partial
// unique index in SQL, so two schedulers racing on the same task cannot both
// win, even across processes.
//
// Spec section 17: when a lease expires we do NOT immediately hand the task to a
// replacement agent. The lease moves to ORPHAN_INSPECTION and a human/coordinator
// decision (or worktree inspection) is required before retry.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { LeaseStatus, TaskLease } from "./types";

interface LeaseRow {
  id: string;
  council_run_id: string;
  task_key: string;
  agent_run_id: string | null;
  worktree_id: string | null;
  owner: string;
  status: string;
  acquired_at: number;
  expires_at: number;
  heartbeat_at: number;
}

function rowToLease(row: LeaseRow): TaskLease {
  return {
    id: row.id,
    councilRunId: row.council_run_id,
    taskKey: row.task_key,
    agentRunId: row.agent_run_id,
    worktreeId: row.worktree_id,
    owner: row.owner,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    heartbeatAt: row.heartbeat_at,
    status: row.status as LeaseStatus,
  };
}

export interface AcquireLeaseInput {
  councilRunId: string;
  taskKey: string;
  owner: string;
  ttlSeconds: number;
  agentRunId?: string | null;
  worktreeId?: string | null;
}

export type AcquireLeaseResult =
  | { acquired: true; lease: TaskLease }
  | { acquired: false; reason: "held" | "orphan_inspection_required"; existing: TaskLease };

/**
 * Attempt to take the lease. Expired leases are transitioned to
 * ORPHAN_INSPECTION rather than being silently stolen (spec section 17).
 */
export function acquireTaskLease(input: AcquireLeaseInput): AcquireLeaseResult {
  const db = openAgentOsDb();
  const now = Date.now();

  const existing = db
    .query(
      `SELECT * FROM council_task_leases
       WHERE council_run_id = ? AND task_key = ? AND status = 'active'`,
    )
    .get(input.councilRunId, input.taskKey) as LeaseRow | undefined;

  if (existing) {
    if (existing.expires_at > now) {
      return { acquired: false, reason: "held", existing: rowToLease(existing) };
    }
    // Expired: quarantine for inspection instead of reassigning immediately.
    db.run("UPDATE council_task_leases SET status = 'orphan_inspection' WHERE id = ?", [
      existing.id,
    ]);
    return {
      acquired: false,
      reason: "orphan_inspection_required",
      existing: rowToLease({ ...existing, status: "orphan_inspection" }),
    };
  }

  const lease: TaskLease = {
    id: `clease_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    taskKey: input.taskKey,
    agentRunId: input.agentRunId ?? null,
    worktreeId: input.worktreeId ?? null,
    owner: input.owner,
    acquiredAt: now,
    expiresAt: now + input.ttlSeconds * 1000,
    heartbeatAt: now,
    status: "active",
  };

  try {
    db.query(
      `INSERT INTO council_task_leases
         (id, council_run_id, task_key, agent_run_id, worktree_id, owner, status,
          acquired_at, expires_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).run(
      lease.id,
      lease.councilRunId,
      lease.taskKey,
      lease.agentRunId,
      lease.worktreeId,
      lease.owner,
      lease.acquiredAt,
      lease.expiresAt,
      lease.heartbeatAt,
    );
  } catch {
    // Lost the race against the partial unique index.
    const winner = db
      .query(
        `SELECT * FROM council_task_leases
         WHERE council_run_id = ? AND task_key = ? AND status = 'active'`,
      )
      .get(input.councilRunId, input.taskKey) as LeaseRow | undefined;
    if (winner) {
      return { acquired: false, reason: "held", existing: rowToLease(winner) };
    }
    throw new Error(`failed to acquire lease for ${input.taskKey}`);
  }

  return { acquired: true, lease };
}

/** Extend an active lease. Returns false when the lease is gone or not ours. */
export function heartbeatTaskLease(
  leaseId: string,
  owner: string,
  ttlSeconds: number,
): boolean {
  const db = openAgentOsDb();
  const now = Date.now();
  const res = db
    .query(
      `UPDATE council_task_leases
       SET heartbeat_at = ?, expires_at = ?
       WHERE id = ? AND owner = ? AND status = 'active' AND expires_at > ?`,
    )
    .run(now, now + ttlSeconds * 1000, leaseId, owner, now);
  return (res.changes ?? 0) > 0;
}

export function releaseTaskLease(leaseId: string, owner?: string): boolean {
  const db = openAgentOsDb();
  const res = owner
    ? db.run("UPDATE council_task_leases SET status = 'released' WHERE id = ? AND owner = ?", [
        leaseId,
        owner,
      ])
    : db.run("UPDATE council_task_leases SET status = 'released' WHERE id = ?", [leaseId]);
  return (res.changes ?? 0) > 0;
}

export function getTaskLease(leaseId: string): TaskLease | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_task_leases WHERE id = ?").get(leaseId) as
    | LeaseRow
    | undefined;
  return row ? rowToLease(row) : null;
}

export function listTaskLeases(
  councilRunId: string,
  status?: LeaseStatus,
): TaskLease[] {
  const db = openAgentOsDb();
  const rows = status
    ? (db
        .query(
          "SELECT * FROM council_task_leases WHERE council_run_id = ? AND status = ? ORDER BY acquired_at",
        )
        .all(councilRunId, status) as LeaseRow[])
    : (db
        .query(
          "SELECT * FROM council_task_leases WHERE council_run_id = ? ORDER BY acquired_at",
        )
        .all(councilRunId) as LeaseRow[]);
  return rows.map(rowToLease);
}

/**
 * Sweep expired active leases into ORPHAN_INSPECTION (spec sections 17, 132).
 * Returns the leases that need inspection. Never launches replacements.
 */
export function sweepExpiredLeases(councilRunId?: string): TaskLease[] {
  const db = openAgentOsDb();
  const now = Date.now();

  const rows = councilRunId
    ? (db
        .query(
          `SELECT * FROM council_task_leases
           WHERE status = 'active' AND expires_at <= ? AND council_run_id = ?`,
        )
        .all(now, councilRunId) as LeaseRow[])
    : (db
        .query("SELECT * FROM council_task_leases WHERE status = 'active' AND expires_at <= ?")
        .all(now) as LeaseRow[]);

  for (const row of rows) {
    db.run("UPDATE council_task_leases SET status = 'orphan_inspection' WHERE id = ?", [row.id]);
  }

  return rows.map(r => rowToLease({ ...r, status: "orphan_inspection" }));
}

/**
 * Explicitly clear an orphan-inspection lease after a coordinator has examined
 * the worktree. Only after this may the task be retried (spec section 17).
 */
export function resolveOrphanLease(
  leaseId: string,
  resolution: "released" | "expired",
): boolean {
  const db = openAgentOsDb();
  const res = db.run(
    "UPDATE council_task_leases SET status = ? WHERE id = ? AND status = 'orphan_inspection'",
    [resolution, leaseId],
  );
  return (res.changes ?? 0) > 0;
}

/** True when a task currently has no blocking lease and may be scheduled. */
export function isTaskSchedulable(councilRunId: string, taskKey: string): boolean {
  const db = openAgentOsDb();
  const now = Date.now();
  const blocking = db
    .query(
      `SELECT COUNT(*) AS n FROM council_task_leases
       WHERE council_run_id = ? AND task_key = ?
         AND (status = 'orphan_inspection' OR (status = 'active' AND expires_at > ?))`,
    )
    .get(councilRunId, taskKey, now) as { n: number };
  return blocking.n === 0;
}
