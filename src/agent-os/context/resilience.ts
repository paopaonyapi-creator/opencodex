/**
 * Pao Context Control Plane — backend circuit breaker (Phase 20.53 §70-71).
 *
 * closed     — normal traffic.
 * open       — backend calls refuse fast; retrieval degrades gracefully.
 * half_open  — a single probe is allowed through to test recovery.
 *
 * Authentication/policy failures never retry aggressively and open the
 * breaker immediately (they cannot fix themselves by retrying).
 */

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly now?: () => number;
}

interface BreakerRecord {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastErrorClass: string | null;
}

export class ContextBackendBreaker {
  private record: BreakerRecord = { state: "closed", consecutiveFailures: 0, openedAt: null, lastErrorClass: null };
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: BreakerOptions) {
    this.threshold = options.failureThreshold;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Whether a backend call may proceed; performs open -> half_open promotion. */
  canAttempt(): boolean {
    if (this.record.state === "closed") return true;
    if (this.record.state === "half_open") return true;
    if (this.record.openedAt !== null && this.now() - this.record.openedAt >= this.cooldownMs) {
      this.record.state = "half_open";
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.record = { state: "closed", consecutiveFailures: 0, openedAt: null, lastErrorClass: null };
  }

  recordFailure(errorClass: "retryable" | "non_retryable" | "unreachable"): void {
    const record = this.record;
    record.consecutiveFailures += 1;
    record.lastErrorClass = errorClass;
    // Auth/policy failures open immediately; transport failures use the
    // threshold so a single blip does not drop recall.
    const opensNow = errorClass !== "retryable" || record.consecutiveFailures >= this.threshold;
    if (opensNow) {
      record.state = "open";
      record.openedAt = this.now();
    }
  }

  snapshot(): { state: BreakerState; consecutiveFailures: number; lastErrorClass: string | null } {
    return {
      state: this.record.state,
      consecutiveFailures: this.record.consecutiveFailures,
      lastErrorClass: this.record.lastErrorClass,
    };
  }

  /** Test seam. */
  reset(): void {
    this.record = { state: "closed", consecutiveFailures: 0, openedAt: null, lastErrorClass: null };
  }
}
