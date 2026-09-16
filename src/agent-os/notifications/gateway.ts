// Phase 20.23 — provider-neutral event admission, policy, routing and noise control.

import { createHash, randomUUID } from "node:crypto";
import { NotificationStore } from "./store";
import { validateAndNormalizeNotificationInput } from "./validation";
import type {
  NotificationAggregation,
  NotificationEmitReceipt,
  NotificationEventInput,
  NotificationPriority,
  NotificationSeverity,
  NotificationSubscription,
} from "./types";

export interface NotificationGatewayConfig {
  enabled: boolean;
  maxPayloadBytes: number;
  maxAttempts: number;
  dedupeWindowMs: number;
  aggregationWindowMs: number;
}

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  debug: 0,
  info: 1,
  success: 2,
  warning: 3,
  error: 4,
  critical: 5,
};

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

function eventPatternMatches(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return eventType === pattern.slice(0, -2) || eventType.startsWith(pattern.slice(0, -1));
  return eventType === pattern;
}

function subscriptionMatches(
  subscription: NotificationSubscription,
  event: { eventType: string; source: string; severity: NotificationSeverity; priority: NotificationPriority },
): boolean {
  if (!subscription.enabled || !eventPatternMatches(subscription.eventPattern, event.eventType)) return false;
  if (subscription.source && subscription.source !== event.source) return false;
  if (subscription.minSeverity && SEVERITY_ORDER[event.severity] < SEVERITY_ORDER[subscription.minSeverity]) return false;
  if (subscription.maxPriority && PRIORITY_ORDER[event.priority] > PRIORITY_ORDER[subscription.maxPriority]) return false;
  return true;
}

function idempotencyKey(eventId: string, destinationId: string): string {
  return createHash("sha256").update(`${eventId}\0${destinationId}\0notification-template-v1`).digest("hex");
}

function initialAggregationSummary(eventType: string, data: Record<string, unknown>): NotificationAggregation["summary"] {
  const numericTotals = Object.fromEntries(Object.entries(data)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  return { eventTypes: { [eventType]: 1 }, numericTotals };
}

function mergeAggregationSummary(
  current: NotificationAggregation["summary"],
  eventType: string,
  data: Record<string, unknown>,
): NotificationAggregation["summary"] {
  const eventTypes = { ...current.eventTypes, [eventType]: (current.eventTypes[eventType] ?? 0) + 1 };
  const numericTotals = { ...current.numericTotals };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "number" && Number.isFinite(value)) numericTotals[key] = (numericTotals[key] ?? 0) + value;
  }
  return { eventTypes, numericTotals };
}

export class NotificationGateway {
  readonly store: NotificationStore;
  readonly config: NotificationGatewayConfig;

  constructor(options: { store?: NotificationStore; config: NotificationGatewayConfig }) {
    this.store = options.store ?? new NotificationStore();
    this.config = options.config;
  }

  emitEvent(input: NotificationEventInput | unknown, options: { eventId?: string; nowMs?: number } = {}): NotificationEmitReceipt {
    const nowMs = options.nowMs ?? Date.now();
    const eventId = options.eventId ?? `nev_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const existing = this.store.getEvent(eventId);
    if (existing) {
      return { eventId, status: "accepted", deliveriesQueued: 0, suppressed: 0, aggregated: 0 };
    }

    const normalized = validateAndNormalizeNotificationInput(input, { maxPayloadBytes: this.config.maxPayloadBytes });
    if (!this.config.enabled) {
      this.store.insertEvent(normalized, { id: eventId, nowMs, status: "SUPPRESSED" });
      return { eventId, status: "disabled", deliveriesQueued: 0, suppressed: 1, aggregated: 0 };
    }

    const dedupeWindowMs = normalized.dedupeWindowMs ?? this.config.dedupeWindowMs;
    if (normalized.dedupeKey && dedupeWindowMs > 0
      && this.store.findRecentEventByDedupeKey(normalized.dedupeKey, nowMs - dedupeWindowMs)) {
      this.store.insertEvent(normalized, { id: eventId, nowMs, status: "SUPPRESSED" });
      this.store.recordAudit({
        eventType: "NOTIFICATION_EVENT_DEDUPED",
        eventId,
        detail: { dedupeKey: normalized.dedupeKey },
        nowMs,
      });
      return { eventId, status: "deduplicated", deliveriesQueued: 0, suppressed: 1, aggregated: 0 };
    }

    this.store.insertEvent(normalized, { id: eventId, nowMs, status: "ACCEPTED" });
    const destinations = (() => {
      if ((normalized.requestedDestinations?.length ?? 0) > 0) {
        return normalized.requestedDestinations!
          .map((id) => this.store.getDestination(id))
          .filter((destination): destination is NonNullable<typeof destination> => destination !== null && destination.enabled);
      }
      const ids = new Set(this.store.listSubscriptions()
        .filter((subscription) => subscriptionMatches(subscription, normalized))
        .map((subscription) => subscription.destinationId));
      return [...ids]
        .map((id) => this.store.getDestination(id))
        .filter((destination): destination is NonNullable<typeof destination> => destination !== null && destination.enabled);
    })();

    let deliveriesQueued = 0;
    let aggregated = 0;
    for (const destination of destinations) {
      const aggregationWindowMs = normalized.aggregationWindowMs ?? this.config.aggregationWindowMs;
      if (normalized.aggregationKey && aggregationWindowMs > 0) {
        const current = this.store.findOpenAggregation(normalized.aggregationKey, destination.id, nowMs);
        if (current) {
          this.store.updateAggregation(
            current.id,
            mergeAggregationSummary(current.summary, normalized.eventType, normalized.data),
            nowMs,
          );
          aggregated++;
          continue;
        }
        const flushAtMs = nowMs + aggregationWindowMs;
        this.store.createAggregation({
          aggregationKey: normalized.aggregationKey,
          destinationId: destination.id,
          rootEventId: eventId,
          summary: initialAggregationSummary(normalized.eventType, normalized.data),
          flushAtMs,
          nowMs,
        });
        const created = this.store.createDelivery({
          eventId,
          destination,
          priority: normalized.priority,
          maxAttempts: this.config.maxAttempts,
          availableAtMs: flushAtMs,
          idempotencyKey: idempotencyKey(eventId, destination.id),
          nowMs,
        });
        if (created.created) deliveriesQueued++;
        continue;
      }

      const created = this.store.createDelivery({
        eventId,
        destination,
        priority: normalized.priority,
        maxAttempts: this.config.maxAttempts,
        availableAtMs: nowMs,
        idempotencyKey: idempotencyKey(eventId, destination.id),
        nowMs,
      });
      if (created.created) deliveriesQueued++;
    }

    this.store.setEventStatus(eventId, deliveriesQueued > 0 || aggregated > 0 ? "QUEUED" : "SUPPRESSED");
    this.store.recordAudit({
      eventType: "NOTIFICATION_EVENT_EMITTED",
      eventId,
      detail: { source: normalized.source, eventType: normalized.eventType, deliveriesQueued, aggregated },
      nowMs,
    });
    return {
      eventId,
      status: destinations.length > 0 ? "accepted" : "suppressed",
      deliveriesQueued,
      suppressed: destinations.length > 0 ? 0 : 1,
      aggregated,
    };
  }
}
