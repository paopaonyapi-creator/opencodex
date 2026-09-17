/**
 * Phase 20.85 — Provider Circuit Breaker Engine
 * Tracks error rates, timeouts, and manages automated open/closed/half-open state transitions.
 */

import { openAgentOsDb } from "../db";
import type { CircuitState } from "./types";

export class CircuitBreakerEngine {
  private inMemoryStates = new Map<string, CircuitState>();
  private readonly failureThreshold = 3;
  private readonly cooldownMs = 30000; // 30 seconds

  constructor() {
    this.loadFromDb();
  }

  public isAvailable(provider: string): boolean {
    const state = this.getState(provider);
    if (state.state === "closed") return true;

    if (state.state === "open") {
      const now = Date.now();
      const cooldownUntil = state.cooldownUntil ? new Date(state.cooldownUntil).getTime() : 0;
      if (now >= cooldownUntil) {
        // Transition to half-open to probe
        state.state = "half_open";
        this.saveState(state);
        return true;
      }
      return false;
    }

    // Half-open: allow limited probe traffic
    return true;
  }

  public recordSuccess(provider: string): void {
    const state = this.getState(provider);
    if (state.state === "half_open" || state.failureCount > 0) {
      state.state = "closed";
      state.failureCount = 0;
      state.openedAt = undefined;
      state.cooldownUntil = undefined;
      state.lastReason = undefined;
      this.saveState(state);
    }
  }

  public recordFailure(provider: string, reason?: string): void {
    const state = this.getState(provider);
    state.failureCount += 1;
    state.lastReason = reason;

    if (state.failureCount >= this.failureThreshold || state.state === "half_open") {
      state.state = "open";
      const now = new Date();
      state.openedAt = now.toISOString();
      state.cooldownUntil = new Date(now.getTime() + this.cooldownMs).toISOString();
    }

    this.saveState(state);
  }

  public manualReset(provider: string, justification: string): CircuitState {
    const state = this.getState(provider);
    state.state = "closed";
    state.failureCount = 0;
    state.openedAt = undefined;
    state.cooldownUntil = undefined;
    state.lastReason = `Manual reset: ${justification}`;
    this.saveState(state);
    return { ...state };
  }

  public getState(provider: string): CircuitState {
    let state = this.inMemoryStates.get(provider);
    if (!state) {
      state = {
        provider,
        state: "closed",
        failureCount: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.inMemoryStates.set(provider, state);
    }
    return state;
  }

  public listCircuits(): CircuitState[] {
    return Array.from(this.inMemoryStates.values());
  }

  private saveState(state: CircuitState): void {
    state.lastUpdated = new Date().toISOString();
    this.inMemoryStates.set(state.provider, { ...state });

    try {
      const db = openAgentOsDb();
      const sql = "INSERT INTO gw_circuits (provider, state, failure_count, opened_at, cooldown_until, last_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET state = excluded.state, failure_count = excluded.failure_count, opened_at = excluded.opened_at, cooldown_until = excluded.cooldown_until, last_reason = excluded.last_reason, updated_at = excluded.updated_at";
      db.run(sql, [
        state.provider,
        state.state,
        state.failureCount,
        state.openedAt ?? null,
        state.cooldownUntil ?? null,
        state.lastReason ?? null,
        state.lastUpdated,
      ]);
    } catch {
      // In-memory state remains intact if db lock or test mode
    }
  }

  private loadFromDb(): void {
    try {
      const db = openAgentOsDb();
      const rows = db.query("SELECT * FROM gw_circuits").all() as Array<{
        provider: string;
        state: "closed" | "open" | "half_open";
        failure_count: number;
        opened_at: string | null;
        cooldown_until: string | null;
        last_reason: string | null;
        updated_at: string;
      }>;

      for (const row of rows) {
        this.inMemoryStates.set(row.provider, {
          provider: row.provider,
          state: row.state,
          failureCount: row.failure_count,
          openedAt: row.opened_at ?? undefined,
          cooldownUntil: row.cooldown_until ?? undefined,
          lastReason: row.last_reason ?? undefined,
          lastUpdated: row.updated_at,
        });
      }
    } catch {
      // Ignore if database is not yet migrated in cold environments
    }
  }
}
