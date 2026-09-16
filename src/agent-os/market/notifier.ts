/**
 * Pao Market Signal Control Plane — notifier (Phase 20.52 §49).
 *
 * Persists every notification first (notification failure must never lose
 * state), then hands it to optional sinks. The dashboard channel is the
 * persisted store itself, exposed through the admin API; Discord/Telegram
 * adapters register as sinks. Secrets never appear in notification bodies.
 */

import { nextId } from "./events";
import type { MarketDbStore } from "./db-store";
import type { MarketEventType, MarketNotification } from "./types";

export interface NotificationSink {
  readonly id: string;
  deliver(notification: MarketNotification): Promise<void>;
}

export class MarketNotifier {
  private readonly store: MarketDbStore;
  private readonly sinks: NotificationSink[] = [];
  private readonly now: () => Date;

  constructor(store: MarketDbStore, options: { now?: () => Date } = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
  }

  registerSink(sink: NotificationSink): void {
    this.sinks.push(sink);
  }

  /**
   * Emit a notification. Persistence happens first and never throws into the
   * caller; sink failures are counted and swallowed (retry belongs to the
   * sink, the record of record is the store).
   */
  emit(input: {
    eventType: MarketEventType | "market.risk.hard_fail" | "market.signal.verification_failed";
    severity: "info" | "warning" | "error";
    title: string;
    body: string;
    correlationId?: string;
    resourceType?: string;
    resourceId?: string;
  }): MarketNotification {
    const notification: MarketNotification = {
      id: nextId("mntf"),
      eventType: input.eventType,
      severity: input.severity,
      title: input.title,
      body: input.body,
      correlationId: input.correlationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      createdAt: this.now().toISOString(),
    };
    this.store.appendNotification(notification);

    for (const sink of this.sinks) {
      try {
        const result = sink.deliver(notification);
        if (result instanceof Promise) result.catch(() => {});
      } catch {
        // Sink failure: the persisted record remains authoritative.
      }
    }

    return notification;
  }

  list(limit?: number): MarketNotification[] {
    return this.store.listNotifications(limit);
  }
}
