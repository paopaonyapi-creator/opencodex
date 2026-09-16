/**
 * Pao Market Signal Control Plane — global circuit breaker (Phase 20.52 §20).
 *
 * ACTIVE  — normal operation.
 * PAUSED  — no new proposals advance to execution; ingestion continues for
 *           audit when policy permits.
 * LOCKED  — operator-mandated full stop; nothing advances and only an
 *           operator can release it.
 */

import type { ActorRef, CircuitBreakerRecord, CircuitBreakerStateName } from "../types";

export interface CircuitBreakerDeps {
  readonly store: { saveCircuitBreaker(record: CircuitBreakerRecord): void; latestCircuitBreakerState(): CircuitBreakerRecord };
  readonly onTransition?: (from: CircuitBreakerStateName, to: CircuitBreakerStateName, record: CircuitBreakerRecord) => void;
  readonly now?: () => Date;
}

export class GlobalCircuitBreaker {
  private readonly store: CircuitBreakerDeps["store"];
  private readonly onTransition: CircuitBreakerDeps["onTransition"];
  private readonly now: () => Date;

  constructor(deps: CircuitBreakerDeps) {
    this.store = deps.store;
    this.onTransition = deps.onTransition;
    this.now = deps.now ?? (() => new Date());
  }

  current(): CircuitBreakerRecord {
    return this.store.latestCircuitBreakerState();
  }

  isExecutionAllowed(): boolean {
    return this.current().state === "ACTIVE";
  }

  transition(
    to: CircuitBreakerStateName,
    actor: ActorRef,
    input: { reason?: string; triggerCode?: string } = {},
  ): CircuitBreakerRecord {
    const from = this.current();
    if (from.state === to) return from;
    // A LOCKED state can only be released by an operator (type "user");
    // automated actors cannot unlock the breaker.
    if (from.state === "LOCKED" && to !== "LOCKED" && actor.type !== "user") {
      throw new Error("MARKET_CIRCUIT_BREAKER_LOCKED: only an operator may release a locked breaker");
    }
    const record: CircuitBreakerRecord = {
      state: to,
      reason: input.reason,
      triggerCode: input.triggerCode,
      changedAt: this.now().toISOString(),
      actor,
    };
    this.store.saveCircuitBreaker(record);
    try {
      this.onTransition?.(from.state, to, record);
    } catch {
      // Notification failures never block the breaker.
    }
    return record;
  }
}
