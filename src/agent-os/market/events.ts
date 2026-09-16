/**
 * Pao Market Signal Control Plane — typed event bus (Phase 20.52).
 *
 * In-process pub/sub with a persisted trail. Every event carries a correlation
 * ID minted at ingress; subscribers must not throw into the publisher.
 */

import type { Actor, MarketEvent, MarketEventType } from "./types";

export type MarketEventPayloadMap = {
  "market.signal.received": { providerId: string; deliveryId?: string };
  "market.signal.verification_failed": { providerId: string; reason: string };
  "market.signal.verified": { signalId: string; providerId: string };
  "market.signal.duplicate": { providerId: string; deliveryId?: string };
  "market.signal.normalized": { signalId: string; symbol: string; providerId: string };
  "market.analysis.requested": { signalId: string };
  "market.analysis.completed": { signalId: string; analysisId: string };
  "market.analysis.failed": { signalId: string; reason: string };
  "market.risk.requested": { signalId: string };
  "market.risk.passed": { signalId: string; assessmentId: string };
  "market.risk.failed": { signalId: string; assessmentId: string; codes: string[] };
  "market.proposal.created": { proposalId: string; signalId: string };
  "market.approval.requested": { approvalId: string; proposalId: string };
  "market.approval.approved": { approvalId: string; proposalId: string; approvedBy: string };
  "market.approval.rejected": { approvalId: string; proposalId: string; rejectedBy: string };
  "market.approval.expired": { approvalId: string; proposalId: string };
  "paper.order.created": { orderId: string; proposalId: string };
  "paper.order.executed": { orderId: string; proposalId: string; filledPrice: number };
  "paper.order.failed": { proposalId: string; reason: string };
  "market.trade.opened": { orderId: string; symbol: string };
  "market.trade.closed": { orderId: string; netPnl: number };
  "market.provider.degraded": { providerId: string; failureRate: number };
  "market.provider.recovered": { providerId: string };
  "market.circuit_breaker.triggered": { from: string; to: string; triggerCode?: string };
  "market.circuit_breaker.reset": { to: string };
  "market.notification.emitted": { notificationId: string; eventType: string };
};

type Handler = (event: MarketEvent<never>) => void | Promise<void>;

let eventCounter = 0;

export function nextEventId(prefix: string): string {
  eventCounter += 1;
  return `${prefix}-${Date.now()}-${eventCounter}`;
}

export function nextId(prefix: string): string {
  return nextEventId(prefix);
}

function randomToken(): string {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36);
}

export function correlationId(): string {
  return `mkt-${Date.now().toString(36)}-${randomToken()}`;
}

export class MarketEventBus {
  private readonly handlers = new Map<MarketEventType, Set<Handler>>();
  private readonly trail: MarketEvent<never>[] = [];
  private readonly persist?: (event: MarketEvent<never>) => void;

  constructor(options: { persist?: (event: MarketEvent<never>) => void } = {}) {
    this.persist = options.persist;
  }

  subscribe<T extends MarketEventType>(type: T, handler: (event: MarketEvent<MarketEventPayloadMap[T]>) => void | Promise<void>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as Handler;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  publish<T extends MarketEventType>(input: {
    type: T;
    payload: MarketEventPayloadMap[T];
    correlationId: string;
    causationId?: string;
    actor?: Actor;
    occurredAt?: string;
  }): MarketEvent<MarketEventPayloadMap[T]> {
    const event: MarketEvent<MarketEventPayloadMap[T]> = {
      eventId: nextEventId("mev"),
      type: input.type,
      version: 1,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: input.actor,
      payload: input.payload,
    };

    const subscribers = this.handlers.get(input.type);
    if (subscribers) {
      for (const handler of subscribers) {
        try {
          const result = handler(event as never);
          // Async subscriber failures are isolated: the publisher never awaits
          // them into its own control flow, and a rejection is contained.
          if (result instanceof Promise) result.catch(() => {});
        } catch {
          // Subscriber errors must not break the pipeline.
        }
      }
    }

    try {
      this.persist?.(event as never);
    } catch {
      // Event persistence failures must not break the pipeline; the audit log
      // is the secondary record.
    }

    this.trail.push(event as never);
    if (this.trail.length > 2000) this.trail.shift();
    return event;
  }

  recent(limit = 100): MarketEvent<never>[] {
    return this.trail.slice(-limit);
  }
}
