/**
 * Pao AI Gateway — Session affinity leases (Phase 20.51).
 *
 * A sticky lease keeps a long-running agent session on the same healthy route
 * to reduce semantic drift between turns. Leases expire on their own TTL and
 * are abandoned (migrated) the moment the route fails or closes its circuit;
 * migration always records ROUTE_LEASE_MIGRATED so the decision trace shows
 * why the session moved.
 */

import type { RouteLease } from "../types";

export interface LeaseStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_TTL_MS = 120 * 60 * 1000;

export class LeaseStore {
  private readonly leases = new Map<string, RouteLease>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: LeaseStoreOptions = {}) {
    this.ttlMs = Math.min(Math.max(options.ttlMs ?? DEFAULT_TTL_MS, 30 * 1000), MAX_TTL_MS);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The live lease for a session, if any. Expired leases are dropped on read.
   */
  get(sessionId: string): RouteLease | undefined {
    const lease = this.leases.get(sessionId);
    if (!lease) return undefined;
    if (this.now() >= Date.parse(lease.expiresAt)) {
      this.leases.delete(sessionId);
      return undefined;
    }
    return lease;
  }

  /**
   * Bind a session to a route. A route that is already the lease target gets
   * its expiry refreshed; a new binding overwrites any prior lease.
   */
  bind(sessionId: string, routeKey: string, sticky = true): RouteLease {
    const existing = this.get(sessionId);
    const createdAt = existing?.createdAt ?? new Date(this.now()).toISOString();
    const lease: RouteLease = {
      sessionId,
      routeKey,
      createdAt,
      expiresAt: new Date(this.now() + this.ttlMs).toISOString(),
      sticky,
    };
    this.leases.set(sessionId, lease);
    return lease;
  }

  /**
   * Drop a lease because its route failed. Returns the abandoned route key so
   * the caller can record ROUTE_LEASE_MIGRATED.
   */
  abandon(sessionId: string): string | undefined {
    const lease = this.get(sessionId);
    if (!lease) return undefined;
    this.leases.delete(sessionId);
    return lease.routeKey;
  }

  /** Routes that currently hold at least one live lease. */
  routeKeys(): string[] {
    const keys = new Set<string>();
    for (const lease of this.leases.values()) {
      if (this.get(lease.sessionId)) keys.add(lease.routeKey);
    }
    return [...keys];
  }

  /** Test seam. */
  clear(): void {
    this.leases.clear();
  }
}
