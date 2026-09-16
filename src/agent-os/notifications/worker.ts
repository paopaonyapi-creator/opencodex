// Phase 20.23 — Queue worker with rate limit coordination, backoff, and circuit breaker.

import { randomUUID } from "node:crypto";
import type { NotificationConfig } from "./config";
import { DEFAULT_NOTIFICATION_CONFIG } from "./config";
import type { DiscordWebhookProvider } from "./discord/provider";
import { calculateRetryDelayMs, classifyNotificationFailure, type NotificationFailureClassification } from "./retry";
import type { NotificationStore } from "./store";
import type {
  NotificationAggregation,
  NotificationDelivery,
  NotificationDestination,
  NotificationEvent,
} from "./types";

export type WorkerRunOutcome =
  | { kind: "delivered"; deliveryId: string }
  | { kind: "retry_scheduled"; deliveryId: string; retryAtMs: number; reason: string }
  | { kind: "deferred"; deliveryId?: string; reason: string }
  | { kind: "dead_lettered"; deliveryId: string; reason: string }
  | { kind: "idle" };

export interface NotificationWorkerOptions {
  store: NotificationStore;
  config?: Partial<NotificationConfig>;
  providers?: Map<string, DiscordWebhookProvider>;
  random?: () => number;
}

export class NotificationWorker {
  readonly store: NotificationStore;
  readonly config: NotificationConfig;
  readonly providers: Map<string, DiscordWebhookProvider>;
  private readonly random: () => number;
  private timer: Timer | null = null;
  private active = false;

  constructor(options: NotificationWorkerOptions) {
    this.store = options.store;
    this.config = { ...DEFAULT_NOTIFICATION_CONFIG, ...options.config };
    this.providers = options.providers ?? new Map();
    this.random = options.random ?? Math.random;
  }

  async runOnce(options: { workerId: string; nowMs?: number }): Promise<WorkerRunOutcome> {
    const nowMs = options.nowMs ?? Date.now();

    // 1. Check global provider gate
    const gate = this.store.getProviderGate("discord_webhook");
    if (gate && gate.blockedUntilMs && gate.blockedUntilMs > nowMs) {
      return { kind: "deferred", reason: "global_gate_active" };
    }

    // 2. Reserve next available delivery
    const delivery = this.store.reserveNextDelivery({
      workerId: options.workerId,
      nowMs,
      leaseMs: this.config.leaseMs,
    });
    if (!delivery) return { kind: "idle" };

    const destination = this.store.getDestination(delivery.destinationId);
    if (!destination || !destination.enabled) {
      this.store.updateDelivery(delivery.id, {
        status: "FAILED",
        lastErrorCode: "NOTIFY_DESTINATION_DISABLED",
        reservedBy: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      return { kind: "deferred", deliveryId: delivery.id, reason: "destination_disabled" };
    }

    const event = this.store.getEvent(delivery.eventId);
    if (!event) {
      this.store.updateDelivery(delivery.id, {
        status: "FAILED",
        lastErrorCode: "NOTIFY_INVALID_EVENT",
        reservedBy: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      return { kind: "deferred", deliveryId: delivery.id, reason: "event_not_found" };
    }

    // 3. Check circuit state
    const circuit = this.store.getCircuit(destination.id);
    if (circuit && circuit.state === "OPEN") {
      if (circuit.openedUntilMs !== null && nowMs < circuit.openedUntilMs) {
        this.store.updateDelivery(delivery.id, {
          status: "QUEUED",
          availableAtMs: circuit.openedUntilMs,
          reservedBy: null,
          reservedAtMs: null,
          leaseExpiresAtMs: null,
        }, nowMs);
        return { kind: "deferred", deliveryId: delivery.id, reason: "circuit_open" };
      }
      if (circuit.openedUntilMs === null) {
        this.store.updateDelivery(delivery.id, {
          status: "DEAD_LETTER",
          lastErrorCode: "NOTIFY_CIRCUIT_OPEN",
          reservedBy: null,
          reservedAtMs: null,
          leaseExpiresAtMs: null,
        }, nowMs);
        this.store.createDeadLetter({
          deliveryId: delivery.id,
          eventId: event.id,
          destinationId: destination.id,
          reason: "circuit_open_indefinite",
          lastErrorCode: circuit.reason ?? "NOTIFY_CIRCUIT_OPEN",
          attempts: delivery.attempt,
          nowMs,
        });
        return { kind: "dead_lettered", deliveryId: delivery.id, reason: "circuit_open_indefinite" };
      }
    }

    // 4. Proactive rate limit check
    const rateLimitState = this.store.findRateLimitState(destination.provider, destination.id);
    if (rateLimitState && rateLimitState.blockedUntilMs && rateLimitState.blockedUntilMs > nowMs) {
      this.store.updateDelivery(delivery.id, {
        status: "RATE_LIMITED",
        availableAtMs: rateLimitState.blockedUntilMs,
        reservedBy: null,
        reservedAtMs: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      return { kind: "deferred", deliveryId: delivery.id, reason: "rate_limit_proactive" };
    }

    const provider = this.providers.get(destination.provider);
    if (!provider) {
      this.store.updateDelivery(delivery.id, {
        status: "FAILED",
        lastErrorCode: "NOTIFY_PROVIDER_NOT_FOUND",
        reservedBy: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      return { kind: "deferred", deliveryId: delivery.id, reason: "provider_not_found" };
    }

    const aggregation = this.store.getAggregationForDelivery(delivery);

    this.store.updateDelivery(delivery.id, { status: "SENDING" }, nowMs);
    const startedAt = new Date(nowMs).toISOString();

    try {
      const result = await provider.send({
        delivery,
        event,
        destination,
        aggregation,
        attempt: delivery.attempt + 1,
        nowMs,
      });
      const finishedAt = new Date(nowMs + result.durationMs).toISOString();

      // Record attempt
      this.store.createAttempt({
        id: `natt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        deliveryId: delivery.id,
        attempt: delivery.attempt + 1,
        startedAt,
        finishedAt,
        statusCode: result.status,
        errorCode: null,
        retryAfterMs: result.rateLimit.retryAfterMs,
        bucketId: result.rateLimit.bucketId,
        rateLimitRemaining: result.rateLimit.remaining,
        rateLimitResetAfterMs: result.rateLimit.resetAfterMs,
        globalRateLimited: result.rateLimit.global,
        durationMs: result.durationMs,
      });

      // Update learned rate limit state
      if (result.rateLimit.bucketId || result.rateLimit.remaining !== null || result.rateLimit.resetAfterMs !== null) {
        const stateKey = `discord:${result.rateLimit.scope ?? "shared"}:${result.rateLimit.bucketId ?? destination.id}`;
        const blockedUntilMs = (result.rateLimit.remaining === 0 && result.rateLimit.resetAtMs)
          ? result.rateLimit.resetAtMs
          : (result.rateLimit.remaining === 0 && result.rateLimit.resetAfterMs)
            ? nowMs + result.rateLimit.resetAfterMs
            : null;

        this.store.upsertRateLimitState({
          stateKey,
          provider: destination.provider,
          destinationId: destination.id,
          bucketId: result.rateLimit.bucketId,
          scope: result.rateLimit.scope,
          limit: result.rateLimit.limit,
          remaining: result.rateLimit.remaining,
          resetAfterMs: result.rateLimit.resetAfterMs,
          blockedUntilMs,
          observedAt: finishedAt,
          lastRequestAtMs: nowMs,
          rateLimitedCount: result.status === 429 ? 1 : 0,
        });
      }

      // Success
      if (result.status >= 200 && result.status < 300) {
        this.store.updateDelivery(delivery.id, {
          status: "DELIVERED",
          attempt: delivery.attempt + 1,
          sentAt: startedAt,
          deliveredAt: finishedAt,
          providerMessageId: result.providerMessageId,
          lastStatusCode: result.status,
          lastErrorCode: null,
          reservedBy: null,
          reservedAtMs: null,
          leaseExpiresAtMs: null,
        }, nowMs);
        this.store.updateDestinationHealth(destination.id, "healthy", null, nowMs);
        this.store.upsertCircuit({
          destinationId: destination.id,
          provider: destination.provider,
          state: "CLOSED",
          failureCount: 0,
          lastSuccessAt: finishedAt,
          nowMs,
        });
        if (aggregation) {
          this.store.markAggregationFlushed(aggregation.id, nowMs);
        }
        this.store.recordAudit({
          eventType: "NOTIFICATION_DELIVERY_SENT",
          deliveryId: delivery.id,
          destinationId: destination.id,
          eventId: event.id,
          detail: { statusCode: result.status, durationMs: result.durationMs },
          nowMs,
        });
        return { kind: "delivered", deliveryId: delivery.id };
      }

      // 429 Rate Limited
      if (result.status === 429) {
        this.store.recordInvalidRequest({
          provider: destination.provider,
          destinationId: destination.id,
          statusCode: 429,
          errorCode: "DISCORD_RATE_LIMITED",
          nowMs,
        });

        const cooldownMs = result.rateLimit.retryAfterMs ?? 1_000;
        if (result.rateLimit.global) {
          this.store.setProviderGate(destination.provider, nowMs + cooldownMs, "X-RateLimit-Global", nowMs);
        }

        const jitter = this.random() * this.config.retryJitterMs;
        const availableAtMs = Math.round(nowMs + cooldownMs + jitter);

        this.store.updateDelivery(delivery.id, {
          status: "RATE_LIMITED",
          attempt: delivery.attempt + 1,
          availableAtMs,
          lastStatusCode: 429,
          lastErrorCode: "DISCORD_RATE_LIMITED",
          reservedBy: null,
          reservedAtMs: null,
          leaseExpiresAtMs: null,
        }, nowMs);

        // Explicitly set rate limit state blockedUntilMs
        const stateKey = `discord:${result.rateLimit.scope ?? "shared"}:${result.rateLimit.bucketId ?? destination.id}`;
        this.store.upsertRateLimitState({
          stateKey,
          provider: destination.provider,
          destinationId: destination.id,
          bucketId: result.rateLimit.bucketId,
          scope: result.rateLimit.scope,
          limit: result.rateLimit.limit,
          remaining: 0,
          resetAfterMs: result.rateLimit.resetAfterMs,
          blockedUntilMs: nowMs + cooldownMs,
          observedAt: finishedAt,
          lastRequestAtMs: nowMs,
          rateLimitedCount: 1,
        });

        this.store.recordAudit({
          eventType: "NOTIFICATION_DELIVERY_RATE_LIMITED",
          deliveryId: delivery.id,
          destinationId: destination.id,
          eventId: event.id,
          detail: { retryAfterMs: cooldownMs, global: result.rateLimit.global },
          nowMs,
        });

        return { kind: "retry_scheduled", deliveryId: delivery.id, retryAtMs: availableAtMs, reason: "DISCORD_RATE_LIMITED" };
      }

      // Other 4xx / 5xx
      const classification = classifyNotificationFailure({ status: result.status });
      return this.handleFailure(delivery, destination, event, classification, startedAt, finishedAt, result.status, null, nowMs, true);

    } catch (err) {
      const durationMs = 50;
      const finishedAt = new Date(nowMs + durationMs).toISOString();
      const classification = classifyNotificationFailure({ error: err });
      const errMsg = err instanceof Error ? err.message : String(err);
      return this.handleFailure(delivery, destination, event, classification, startedAt, finishedAt, null, errMsg, nowMs, false);
    }
  }

  private handleFailure(
    delivery: NotificationDelivery,
    destination: NotificationDestination,
    event: NotificationEvent,
    classification: NotificationFailureClassification,
    startedAt: string,
    finishedAt: string,
    statusCode: number | null,
    errorMessage: string | null,
    nowMs: number,
    attemptAlreadyCreated = false,
  ): WorkerRunOutcome {
    const nextAttempt = delivery.attempt + 1;

    if (!attemptAlreadyCreated) {
      this.store.createAttempt({
        id: `natt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        deliveryId: delivery.id,
        attempt: nextAttempt,
        startedAt,
        finishedAt,
        statusCode,
        errorCode: classification.code,
        retryAfterMs: null,
        bucketId: null,
        rateLimitRemaining: null,
        rateLimitResetAfterMs: null,
        globalRateLimited: false,
        durationMs: 50,
      });
    }

    if (classification.invalidRequest) {
      this.store.recordInvalidRequest({
        provider: destination.provider,
        destinationId: destination.id,
        statusCode: statusCode ?? 0,
        errorCode: classification.code,
        nowMs,
      });
    }

    if (classification.opensCircuit || classification.disablesDestination) {
      this.store.upsertCircuit({
        destinationId: destination.id,
        provider: destination.provider,
        state: "OPEN",
        openedUntilMs: null,
        reason: classification.code,
        lastFailureAt: finishedAt,
        nowMs,
      });
      this.store.updateDestinationHealth(destination.id, "invalid", classification.code, nowMs);
      this.store.setDestinationEnabled(destination.id, false, nowMs);
      this.store.updateDelivery(delivery.id, {
        status: "DEAD_LETTER",
        attempt: nextAttempt,
        lastStatusCode: statusCode,
        lastErrorCode: classification.code,
        lastErrorMessage: errorMessage,
        reservedBy: null,
        reservedAtMs: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      this.store.createDeadLetter({
        deliveryId: delivery.id,
        eventId: event.id,
        destinationId: destination.id,
        reason: classification.code,
        lastErrorCode: classification.code,
        attempts: nextAttempt,
        nowMs,
      });
      this.store.recordAudit({
        eventType: "NOTIFICATION_DELIVERY_DEAD_LETTERED",
        deliveryId: delivery.id,
        destinationId: destination.id,
        eventId: event.id,
        detail: { reason: classification.code, statusCode },
        nowMs,
      });
      return { kind: "dead_lettered", deliveryId: delivery.id, reason: classification.code };
    }

    if (classification.retryable && nextAttempt < delivery.maxAttempts) {
      const delayMs = calculateRetryDelayMs(nextAttempt, {
        baseMs: this.config.retryBaseMs,
        maxMs: this.config.retryMaxMs,
        jitterMs: this.config.retryJitterMs,
      }, this.random);
      const availableAtMs = nowMs + delayMs;

      this.store.updateDelivery(delivery.id, {
        status: "RETRY_SCHEDULED",
        attempt: nextAttempt,
        availableAtMs,
        lastStatusCode: statusCode,
        lastErrorCode: classification.code,
        lastErrorMessage: errorMessage,
        reservedBy: null,
        reservedAtMs: null,
        leaseExpiresAtMs: null,
      }, nowMs);
      this.store.recordAudit({
        eventType: "NOTIFICATION_DELIVERY_RETRY_SCHEDULED",
        deliveryId: delivery.id,
        destinationId: destination.id,
        eventId: event.id,
        detail: { attempt: nextAttempt, retryAtMs: availableAtMs, reason: classification.code },
        nowMs,
      });
      return { kind: "retry_scheduled", deliveryId: delivery.id, retryAtMs: availableAtMs, reason: classification.code };
    }

    // Exhausted or non-retryable failure
    this.store.updateDelivery(delivery.id, {
      status: "DEAD_LETTER",
      attempt: nextAttempt,
      lastStatusCode: statusCode,
      lastErrorCode: classification.code,
      lastErrorMessage: errorMessage,
      reservedBy: null,
      reservedAtMs: null,
      leaseExpiresAtMs: null,
    }, nowMs);
    this.store.createDeadLetter({
      deliveryId: delivery.id,
      eventId: event.id,
      destinationId: destination.id,
      reason: classification.code,
      lastErrorCode: classification.code,
      attempts: nextAttempt,
      nowMs,
    });
    this.store.recordAudit({
      eventType: "NOTIFICATION_DELIVERY_DEAD_LETTERED",
      deliveryId: delivery.id,
      destinationId: destination.id,
      eventId: event.id,
      detail: { reason: classification.code, attempts: nextAttempt },
      nowMs,
    });
    return { kind: "dead_lettered", deliveryId: delivery.id, reason: classification.code };
  }

  start(): void {
    if (this.active || !this.config.workerEnabled) return;
    this.active = true;
    const poll = async () => {
      if (!this.active) return;
      try {
        await this.runOnce({ workerId: `worker-${process.pid}` });
      } catch {
        // preserve worker loop
      }
      if (this.active) {
        this.timer = setTimeout(poll, this.config.pollIntervalMs);
      }
    };
    this.timer = setTimeout(poll, 0);
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
