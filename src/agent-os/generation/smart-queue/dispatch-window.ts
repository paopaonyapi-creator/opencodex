// Phase 20.1 — Dispatch Window & Atomic Slot Leasing
//
// Limits in-flight prompt submissions to ComfyUI (1 running + 1 prefetch per GPU),
// keeping the remaining backlog in SQLite so jobs can be safely cancelled, re-routed,
// or prioritized without polluting ComfyUI's internal queue.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { DispatchSlot } from "./types";

export interface DispatchWindowOptions {
  maxPrefetchJobsPerProvider?: number; // default: 2 (1 running + 1 prefetch)
  leaseTtlSeconds?: number;             // default: 300s
}

export class DispatchWindowManager {
  readonly maxPrefetchJobsPerProvider: number;
  readonly leaseTtlSeconds: number;
  private isPaused = false;

  constructor(options: DispatchWindowOptions = {}) {
    this.maxPrefetchJobsPerProvider = options.maxPrefetchJobsPerProvider ?? 2;
    this.leaseTtlSeconds = options.leaseTtlSeconds ?? 300;
  }

  pauseDispatch(): void {
    this.isPaused = true;
  }

  resumeDispatch(): void {
    this.isPaused = false;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Attempts to acquire an available slot (0 or 1) on the specified provider.
   */
  acquireSlot(
    providerId: string,
    jobId: string,
    attemptId: string,
    maxSlots = this.maxPrefetchJobsPerProvider,
  ): { slotIndex: number; leaseId: string } | null {
    if (this.isPaused) return null;

    const db = openAgentOsDb();
    const now = Date.now();
    const expiresAt = now + this.leaseTtlSeconds * 1000;

    // Clean up expired leases first
    db.query("DELETE FROM gen_dispatch_leases WHERE expires_at <= ?").run(now);

    // Find first available slotIndex in [0, maxSlots - 1]
    for (let slotIndex = 0; slotIndex < maxSlots; slotIndex++) {
      const leaseId = `lease_${randomUUID().slice(0, 12)}`;
      try {
        const res = db.query(`
          INSERT INTO gen_dispatch_leases
            (id, provider_id, slot_index, job_id, attempt_id, acquired_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(leaseId, providerId, slotIndex, jobId, attemptId, now, expiresAt);

        if (res.changes > 0) {
          return { slotIndex, leaseId };
        }
      } catch {
        // Unique index collision on (provider_id, slot_index) means slot is occupied
        continue;
      }
    }

    return null; // All slots occupied
  }

  /**
   * Extends the heartbeat on an acquired slot lease.
   */
  heartbeatSlot(leaseId: string): void {
    const db = openAgentOsDb();
    const now = Date.now();
    const expiresAt = now + this.leaseTtlSeconds * 1000;
    db.query("UPDATE gen_dispatch_leases SET expires_at = ? WHERE id = ?").run(expiresAt, leaseId);
  }

  /**
   * Releases a slot lease by leaseId.
   */
  releaseSlot(leaseId: string): void {
    const db = openAgentOsDb();
    db.query("DELETE FROM gen_dispatch_leases WHERE id = ?").run(leaseId);
  }

  /**
   * Releases any slots occupied by a specific job.
   */
  releaseJobSlots(jobId: string): void {
    const db = openAgentOsDb();
    db.query("DELETE FROM gen_dispatch_leases WHERE job_id = ?").run(jobId);
  }

  /**
   * Returns how many slots are currently available on a provider.
   */
  getAvailableSlots(providerId: string, maxSlots = this.maxPrefetchJobsPerProvider): number {
    if (this.isPaused) return 0;
    const db = openAgentOsDb();
    const now = Date.now();
    const occupied = (db.query(`
      SELECT COUNT(*) AS c FROM gen_dispatch_leases
      WHERE provider_id = ? AND expires_at > ?
    `).get(providerId, now) as { c: number }).c;

    return Math.max(maxSlots - occupied, 0);
  }

  /**
   * Returns all active leases, optionally filtered by provider.
   */
  getActiveLeases(providerId?: string): DispatchSlot[] {
    const db = openAgentOsDb();
    const now = Date.now();
    const whereSql = providerId ? "WHERE provider_id = ? AND expires_at > ?" : "WHERE expires_at > ?";
    const params = providerId ? [providerId, now] : [now];

    const rows = db.query(`
      SELECT provider_id, slot_index, job_id, attempt_id, acquired_at, expires_at
      FROM gen_dispatch_leases ${whereSql}
      ORDER BY provider_id ASC, slot_index ASC
    `).all(...params) as Array<{
      provider_id: string;
      slot_index: number;
      job_id: string;
      attempt_id: string;
      acquired_at: number;
      expires_at: number;
    }>;

    return rows.map(r => ({
      providerId: r.provider_id,
      slotIndex: r.slot_index,
      jobId: r.job_id,
      attemptId: r.attempt_id,
      acquiredAt: r.acquired_at,
      expiresAt: r.expires_at,
    }));
  }
}
