// Phase 20.23 — Pao-hubPro Unified Notification Gateway Service Facade & Operational Controls

import { loadNotificationConfig, type NotificationConfig } from "./config";
import { DiscordWebhookProvider } from "./discord/provider";
import { NotificationGateway } from "./gateway";
import { NotificationStore } from "./store";
import type {
  NotificationDeadLetter,
  NotificationDelivery,
  NotificationDestinationInput,
  NotificationEmitReceipt,
  NotificationEvent,
  NotificationEventInput,
  NotificationProviderGate,
  NotificationRateLimitState,
  PublicNotificationDestination,
} from "./types";
import { NotificationWorker } from "./worker";

export interface NotificationStatusSummary {
  enabled: boolean;
  workerEnabled: boolean;
  workerActive: boolean;
  discordEnabled: boolean;
  totalDestinations: number;
  healthyDestinations: number;
  openCircuits: number;
  queuedDeliveries: number;
  rateLimitedDeliveries: number;
  openDeadLetters: number;
  invalidRequests10m: number;
}

export interface NotificationMetricsSummary {
  eventsToday: number;
  deliveriesToday: number;
  delivered: number;
  retrying: number;
  rateLimited: number;
  failed: number;
  deadLetter: number;
  successRate: number;
  rateLimitCount10m: number;
  invalidRequests10m: number;
  activeDestinations: number;
  openCircuits: number;
}

export class NotificationService {
  readonly store: NotificationStore;
  readonly config: NotificationConfig;
  readonly gateway: NotificationGateway;
  readonly worker: NotificationWorker;
  readonly discordProvider: DiscordWebhookProvider;

  constructor(store?: NotificationStore, config?: NotificationConfig) {
    this.store = store ?? new NotificationStore();
    this.config = config ?? loadNotificationConfig();
    this.gateway = new NotificationGateway({
      store: this.store,
      config: {
        enabled: this.config.enabled,
        maxPayloadBytes: this.config.maxPayloadBytes,
        maxAttempts: this.config.maxAttempts,
        dedupeWindowMs: this.config.dedupeWindowMs,
        aggregationWindowMs: this.config.aggregationWindowMs,
      },
    });
    this.discordProvider = new DiscordWebhookProvider({
      timeoutMs: this.config.discordRequestTimeoutMs,
    });
    this.worker = new NotificationWorker({
      store: this.store,
      config: this.config,
      providers: new Map([["discord_webhook", this.discordProvider]]),
    });

    if (this.config.workerEnabled) {
      this.worker.start();
    }
  }

  async getStatus(): Promise<NotificationStatusSummary> {
    const destinations = this.store.listDestinations();
    const healthyCount = destinations.filter((d) => d.enabled && d.health === "healthy").length;
    const circuits = destinations.map((d) => this.store.getCircuit(d.id)).filter((c) => c && c.state === "OPEN");
    const deliveries = this.store.listDeliveries({ limit: 500 });
    const queuedCount = deliveries.filter((d) => d.status === "QUEUED" || d.status === "RESERVED").length;
    const rateLimitedCount = deliveries.filter((d) => d.status === "RATE_LIMITED").length;
    const deadLetters = this.store.listDeadLetters({ status: "OPEN" });
    const invalidSummary = this.store.invalidRequestSummary();

    return {
      enabled: this.config.enabled,
      workerEnabled: this.config.workerEnabled,
      workerActive: this.config.workerEnabled,
      discordEnabled: this.config.discordEnabled,
      totalDestinations: destinations.length,
      healthyDestinations: healthyCount,
      openCircuits: circuits.length,
      queuedDeliveries: queuedCount,
      rateLimitedDeliveries: rateLimitedCount,
      openDeadLetters: deadLetters.length,
      invalidRequests10m: invalidSummary.invalidRequests10m,
    };
  }

  getMetrics(): NotificationMetricsSummary {
    const deliveries = this.store.listDeliveries({ limit: 500 });
    const events = this.store.listEvents({ limit: 500 });
    const destinations = this.store.listDestinations();
    const circuits = destinations.map((d) => this.store.getCircuit(d.id)).filter((c) => c && c.state === "OPEN");
    const invalid = this.store.invalidRequestSummary();

    const delivered = deliveries.filter((d) => d.status === "DELIVERED").length;
    const retrying = deliveries.filter((d) => d.status === "RETRY_SCHEDULED").length;
    const rateLimited = deliveries.filter((d) => d.status === "RATE_LIMITED").length;
    const failed = deliveries.filter((d) => d.status === "FAILED").length;
    const deadLetter = deliveries.filter((d) => d.status === "DEAD_LETTER").length;

    const totalResolved = delivered + failed + deadLetter;
    const successRate = totalResolved > 0 ? Math.round((delivered / totalResolved) * 100) : 100;

    return {
      eventsToday: events.length,
      deliveriesToday: deliveries.length,
      delivered,
      retrying,
      rateLimited,
      failed,
      deadLetter,
      successRate,
      rateLimitCount10m: invalid.rateLimitedRequests10m,
      invalidRequests10m: invalid.invalidRequests10m,
      activeDestinations: destinations.filter((d) => d.enabled).length,
      openCircuits: circuits.length,
    };
  }

  listDestinationsPublic(): PublicNotificationDestination[] {
    return this.store.listDestinationsPublic();
  }

  getDestination(id: string) {
    return this.store.getDestination(id);
  }

  upsertDestination(input: NotificationDestinationInput): PublicNotificationDestination {
    const dest = this.store.upsertDestination(input);
    const { secretRef: _, ...pub } = dest;
    return pub;
  }

  enableDestination(id: string): PublicNotificationDestination | null {
    return this.store.setDestinationEnabled(id, true);
  }

  disableDestination(id: string): PublicNotificationDestination | null {
    return this.store.setDestinationEnabled(id, false);
  }

  async testDestination(id: string): Promise<NotificationEmitReceipt> {
    const dest = this.store.getDestination(id);
    if (!dest) {
      throw new Error(`destination '${id}' not found`);
    }
    return this.gateway.emitEvent({
      source: "system",
      eventType: "system.test",
      title: `Test Notification to ${dest.name}`,
      message: `Verification ping dispatched by operator at ${new Date().toISOString()}`,
      severity: "info",
      priority: "P2",
      requestedDestinations: [id],
    });
  }

  listDeliveries(options: { limit?: number; status?: any; destinationId?: string } = {}): NotificationDelivery[] {
    return this.store.listDeliveries(options);
  }

  getDelivery(id: string): { delivery: NotificationDelivery; attempts: any[]; event: NotificationEvent | null } | null {
    const delivery = this.store.getDelivery(id);
    if (!delivery) return null;
    const attempts = this.store.listAttempts(delivery.id);
    const event = this.store.getEvent(delivery.eventId);
    return { delivery, attempts, event };
  }

  retryDelivery(id: string): NotificationDelivery | null {
    const delivery = this.store.getDelivery(id);
    if (!delivery) return null;
    return this.store.updateDelivery(id, {
      status: "QUEUED",
      availableAtMs: Date.now(),
      reservedBy: null,
      reservedAtMs: null,
      leaseExpiresAtMs: null,
    });
  }

  listDeadLetters(options: { status?: string; limit?: number } = {}): NotificationDeadLetter[] {
    return this.store.listDeadLetters(options);
  }

  retryDeadLetter(id: string): NotificationDeadLetter | null {
    const dl = this.store.getDeadLetter(id);
    if (!dl) return null;
    this.retryDelivery(dl.deliveryId);
    return this.store.resolveDeadLetter(id, "RETRIED");
  }

  dismissDeadLetter(id: string): NotificationDeadLetter | null {
    return this.store.resolveDeadLetter(id, "DISMISSED");
  }

  listEvents(options: { limit?: number; source?: string; eventType?: string } = {}): NotificationEvent[] {
    return this.store.listEvents(options);
  }

  emitEvent(input: NotificationEventInput, options: { eventId?: string; nowMs?: number } = {}): NotificationEmitReceipt {
    return this.gateway.emitEvent(input, options);
  }

  send(input: {
    destination?: string;
    title: string;
    message?: string;
    severity?: any;
    priority?: any;
    dedupeKey?: string;
    data?: Record<string, unknown>;
  }): NotificationEmitReceipt {
    return this.gateway.emitEvent({
      source: "other",
      eventType: "manual.send",
      title: input.title,
      message: input.message,
      severity: input.severity ?? "info",
      priority: input.priority ?? "P2",
      dedupeKey: input.dedupeKey,
      data: input.data,
      requestedDestinations: input.destination ? [input.destination] : undefined,
    });
  }

  listRateLimits(): {
    states: NotificationRateLimitState[];
    gates: NotificationProviderGate[];
  } {
    const states = this.store.listRateLimitStates();
    const gate = this.store.getProviderGate("discord_webhook");
    return {
      states,
      gates: gate ? [gate] : [],
    };
  }
}

let serviceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!serviceInstance) {
    serviceInstance = new NotificationService();
  }
  return serviceInstance;
}

export function resetNotificationServiceForTests(): void {
  serviceInstance?.worker.stop();
  serviceInstance = null;
}
