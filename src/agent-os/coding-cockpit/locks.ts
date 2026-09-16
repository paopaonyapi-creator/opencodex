// Phase 20.39 — One-writer workspace lock (spec §19). Atomicity comes from a
// partial UNIQUE index on cc_locks(workspace_id) WHERE status='ACTIVE' — the
// INSERT itself is the arbitration point, so two racing writers cannot both
// hold the lease. Readers coexist. Healthy leases can never be silently
// stolen; takeover is explicit, audited, and only allowed on the same terms.

import { CockpitError, type WorkspaceWriterLock } from "./types";
import type { CockpitStore } from "./store";

export const DEFAULT_LEASE_SECONDS = Number(process.env.PAO_SESSION_LOCK_LEASE_SECONDS ?? 30);
export const HEARTBEAT_SECONDS = Number(process.env.PAO_SESSION_LOCK_HEARTBEAT_SECONDS ?? 10);

export interface AcquireLockInput {
  workspaceId: string;
  sessionId: string;
  ownerInstanceId: string;
  actor: string;
  leaseSeconds?: number;
}

export interface LockAcquireResult {
  acquired: boolean;
  lock: WorkspaceWriterLock | null;
  conflicting: WorkspaceWriterLock | null;
  reason: string;
}

export class WorkspaceLockManager {
  constructor(
    private readonly store: CockpitStore,
    private readonly audit: (event: { eventType: string; workspaceId: string; sessionId: string; summary: string; severity?: "info" | "warning" | "critical"; metadata?: Record<string, unknown> }) => void,
  ) {}

  /** Read-only sessions never need the lease — they coexist by design. */
  acquire(input: AcquireLockInput): LockAcquireResult {
    this.store.expireLocks(Date.now());
    const existing = this.store.getActiveLock(input.workspaceId);

    if (existing && existing.sessionId === input.sessionId) {
      // Same session re-acquiring its own lease: refresh heartbeat.
      const extended = this.extendLease(existing.id, input.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
      return { acquired: true, lock: extended, conflicting: null, reason: "lease refreshed" };
    }
    if (existing) {
      this.audit({
        eventType: "lock.conflict",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        summary: "writer lease conflict: " + existing.sessionId + " holds the workspace",
        severity: "warning",
        metadata: { holderSessionId: existing.sessionId },
      });
      return {
        acquired: false,
        lock: null,
        conflicting: existing,
        reason: "another writer session holds an active lease",
      };
    }

    const leaseSeconds = Math.max(5, input.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    try {
      const lock = this.store.insertLock({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        ownerInstanceId: input.ownerInstanceId,
        status: "ACTIVE",
        expiresAt,
      });
      this.audit({
        eventType: "lock.acquired",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        summary: "writer lease acquired (expires " + expiresAt + ")",
        metadata: { leaseSeconds },
      });
      return { acquired: true, lock, conflicting: null, reason: "acquired" };
    } catch (error) {
      // Unique-index violation = a racing writer won the insert; fail closed.
      const conflicting = this.store.getActiveLock(input.workspaceId);
      this.audit({
        eventType: "lock.conflict",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        summary: "writer lease lost a race against " + (conflicting?.sessionId ?? "another writer"),
        severity: "warning",
      });
      if (conflicting) {
        return { acquired: false, lock: null, conflicting, reason: "lost acquisition race" };
      }
      throw new CockpitError("INTERNAL_ERROR", "lock acquisition failed", { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  extendLease(lockId: string, leaseSeconds = DEFAULT_LEASE_SECONDS): WorkspaceWriterLock {
    const lock = this.store.getLock(lockId);
    if (!lock || lock.status !== "ACTIVE") {
      throw new CockpitError("LOCK_CONFLICT", "no active lease to heartbeat");
    }
    const expiresAt = new Date(Date.now() + Math.max(5, leaseSeconds) * 1000).toISOString();
    this.store.heartbeatLock(lockId, expiresAt);
    const updated = this.store.getLock(lockId);
    return updated ?? lock;
  }

  release(workspaceId: string, sessionId: string, actor: string): boolean {
    const lock = this.store.getActiveLock(workspaceId);
    if (!lock) return false;
    if (lock.sessionId !== sessionId) {
      throw new CockpitError("LOCK_CONFLICT", "cannot release another session's lease");
    }
    this.store.updateLockStatus(lock.id, "RELEASED");
    this.audit({
      eventType: "lock.released",
      workspaceId,
      sessionId,
      summary: "writer lease released",
      metadata: { actor },
    });
    return true;
  }

  /** Takeover: expired leases are reclaimable; a HEALTHY lease requires the
   *  caller to confirm awareness (UI confirmation gate) and is audited as a
   *  takeover, never a silent steal (spec §19.11). */
  takeover(workspaceId: string, sessionId: string, ownerInstanceId: string, actor: string, opts: { confirmHealthyTakeover?: boolean } = {}): WorkspaceWriterLock {
    this.store.expireLocks(Date.now());
    const existing = this.store.getActiveLock(workspaceId);
    if (existing && existing.sessionId !== sessionId) {
      if (!opts.confirmHealthyTakeover) {
        throw new CockpitError(
          "LOCK_CONFLICT",
          "workspace is held by a healthy writer lease; takeover requires explicit confirmation",
          { holderSessionId: existing.sessionId },
        );
      }
      this.store.updateLockStatus(existing.id, "REVOKED");
      this.audit({
        eventType: "lock.takeover",
        workspaceId,
        sessionId,
        summary: "healthy writer lease revoked by explicit takeover",
        severity: "warning",
        metadata: { revokedSessionId: existing.sessionId, actor },
      });
    }
    const result = this.acquire({ workspaceId, sessionId, ownerInstanceId, actor });
    if (!result.acquired || !result.lock) {
      throw new CockpitError("LOCK_CONFLICT", "takeover failed: " + result.reason);
    }
    return result.lock;
  }

  /** Reclaim an EXPIRED lease — distinct from takeover, always auditable. */
  reclaimExpired(workspaceId: string, sessionId: string, ownerInstanceId: string, actor: string): WorkspaceWriterLock {
    const existing = this.store.getActiveLock(workspaceId);
    if (existing) {
      // expireLocks() above already flipped anything past its expiry to
      // EXPIRED, so an ACTIVE row here is genuinely healthy.
      throw new CockpitError("LOCK_CONFLICT", "lease is healthy; use takeover with confirmation");
    }
    const result = this.acquire({ workspaceId, sessionId, ownerInstanceId, actor });
    if (!result.acquired || !result.lock) {
      throw new CockpitError("LOCK_CONFLICT", "reclaim failed: " + result.reason);
    }
    this.audit({
      eventType: "lock.reclaimed",
      workspaceId,
      sessionId,
      summary: "expired writer lease reclaimed",
      metadata: { actor },
    });
    return result.lock;
  }

  currentHolder(workspaceId: string): WorkspaceWriterLock | null {
    this.store.expireLocks(Date.now());
    return this.store.getActiveLock(workspaceId);
  }
}
