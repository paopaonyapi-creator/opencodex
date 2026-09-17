// Phase 20.82 — AFT workspace lock (CortexKit AFT contract).
//
// In-process, per-workspace mutex serializing the transactional action window
// (checkpoint → execute → observe) so two sessions can never mutate the same
// workspace concurrently. The lock is held by (sessionId, actionId); a waiter
// that exceeds its wait budget fails with WorkspaceLockTimeoutError instead of
// queueing indefinitely, and a holder that exceeds its TTL is considered
// crashed — the waiter steals the slot so a dead session cannot wedge a
// workspace forever. Single-process scope is deliberate: every mutating path
// in this runtime lives inside the Pao server process.

export interface LockHolder {
  sessionId: string;
  actionId: string;
  acquiredAt: number;
  expiresAt: number;
}

interface LockEntry {
  holder: LockHolder | null;
}

const locks = new Map<string, LockEntry>();

function normalizeRoot(root: string): string {
  return root.replace(/[\\/]+$/, "").toLowerCase();
}

export class WorkspaceLockTimeoutError extends Error {
  constructor(readonly heldBy: LockHolder | null, readonly waitedMs: number) {
    super(`workspace lock busy after ${waitedMs}ms`);
    this.name = "WorkspaceLockTimeoutError";
  }
}

export function currentLockHolder(workspaceRoot: string): LockHolder | null {
  const entry = locks.get(normalizeRoot(workspaceRoot));
  return entry?.holder ? { ...entry.holder } : null;
}

export interface WorkspaceLockOptions {
  workspaceRoot: string;
  sessionId: string;
  actionId: string;
  /** Max time to wait for a contended lock before failing (ms). */
  waitMs: number;
  /** Max time a holder may keep the lock before it becomes stealable (ms). */
  ttlMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires the workspace lock. Rejects with WorkspaceLockTimeoutError when the
 * wait budget is exhausted. The returned release function is idempotent.
 */
export async function acquireWorkspaceLock(opts: WorkspaceLockOptions): Promise<() => void> {
  const key = normalizeRoot(opts.workspaceRoot);
  let entry = locks.get(key);
  if (!entry) {
    entry = { holder: null };
    locks.set(key, entry);
  }

  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    const holder = entry.holder;
    if (!holder) break;
    if (holder.sessionId === opts.sessionId && holder.actionId === opts.actionId) break;
    // Stale-holder steal: the holder exceeded its TTL, so it crashed or was
    // abandoned mid-window. Its mutations are checkpointed and recoverable via
    // the checkpoint record; a wedged lock must not deadlock the workspace.
    if (holder.expiresAt <= Date.now()) {
      entry.holder = null;
      break;
    }
    if (Date.now() >= deadline) {
      throw new WorkspaceLockTimeoutError({ ...holder }, opts.waitMs);
    }
    await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
  }

  entry.holder = {
    sessionId: opts.sessionId,
    actionId: opts.actionId,
    acquiredAt: Date.now(),
    expiresAt: Date.now() + opts.ttlMs,
  };

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holder = entry!.holder;
    // Only clear if we still own it — a stolen lock must not be freed by its
    // original (timed-out) owner.
    if (holder && holder.sessionId === opts.sessionId && holder.actionId === opts.actionId) {
      entry!.holder = null;
    }
  };
}
