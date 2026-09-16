/**
 * Pao Market Signal Control Plane — ingest pipeline (Phase 20.52).
 *
 * Order of operations (spec §8.1/§9), each step fail-closed:
 *   provider allowlist -> rate limit -> persistent delivery dedup ->
 *   verification -> raw persistence (redacted headers) -> parse ->
 *   provider-event dedup -> normalize -> VERIFIED signal.
 *
 * Unverified payloads never become signals. A failed verification leaves an
 * audited delivery row with the error code, nothing more.
 */

import { loadMarketConfig, type MarketConfig } from "./config";
import { MarketDbStore } from "./db-store";
import { MarketEventBus, correlationId, nextId } from "./events";
import { RateLimiter, hashForLogging, redactHeaders, sha256Hex } from "./ingress/security";
import { buildDefaultRegistry, type MarketProviderRegistry } from "./providers/registry";
import { SignalQualityGrader } from "./quality";
import type {
  ActorRef,
  IncomingWebhookRequest,
  MarketSignal,
  SignalQuality,
} from "./types";

export interface IngestDeps {
  readonly config: MarketConfig;
  readonly registry: MarketProviderRegistry;
  readonly store: MarketDbStore;
  readonly bus: MarketEventBus;
  readonly rateLimiter?: RateLimiter;
  readonly now?: () => Date;
}

export interface IngestOutcome {
  readonly ok: boolean;
  readonly signalId?: string;
  readonly duplicate?: boolean;
  readonly errorCode?: string;
  readonly message?: string;
  readonly correlationId: string;
  readonly httpStatus: number;
}

export class MarketIngestPipeline {
  private readonly config: MarketConfig;
  private readonly registry: MarketProviderRegistry;
  private readonly store: MarketDbStore;
  private readonly bus: MarketEventBus;
  private readonly rateLimiter: RateLimiter;
  private readonly grader: SignalQualityGrader;
  private readonly now: () => Date;

  constructor(deps: IngestDeps) {
    this.config = deps.config;
    this.registry = deps.registry;
    this.store = deps.store;
    this.bus = deps.bus;
    this.rateLimiter = deps.rateLimiter ?? new RateLimiter(() => deps.now?.()?.getTime() ?? Date.now());
    this.grader = new SignalQualityGrader();
    this.now = deps.now ?? (() => new Date());
  }

  static create(store: MarketDbStore, bus: MarketEventBus, config: MarketConfig = loadMarketConfig()): MarketIngestPipeline {
    return new MarketIngestPipeline({
      config,
      registry: buildDefaultRegistry({ limits: config.webhook }),
      store,
      bus,
      now: () => new Date(),
    });
  }

  async ingestWebhook(providerId: string, request: IncomingWebhookRequest): Promise<IngestOutcome> {
    const correlation = correlationId();
    const nowMs = this.now().getTime();

    // 1. Provider allowlist.
    const adapter = this.registry.get(providerId);
    if (!adapter || providerId === "manual") {
      return { ok: false, errorCode: "MARKET_PROVIDER_UNKNOWN", message: "Unknown provider", correlationId: correlation, httpStatus: 404 };
    }
    const providerConfig = this.config.providers[providerId];
    if (!providerConfig || !providerConfig.enabled) {
      this.store.recordDelivery({
        id: nextId("mdl"),
        providerId,
        deliveryId: request.headers["x-delivery-id"] ?? request.headers["x-kamdenai-delivery"] ?? null,
        eventType: null,
        signatureValid: false,
        timestampValid: false,
        httpStatus: 403,
        errorCode: "MARKET_PROVIDER_DISABLED",
        errorMessage: "Provider is disabled",
      });
      this.audit(correlation, "market.webhook.rejected", { type: "provider", id: providerId }, "webhook", providerId, "denied", { reason: "provider_disabled" });
      return { ok: false, errorCode: "MARKET_PROVIDER_DISABLED", message: "Provider is disabled", correlationId: correlation, httpStatus: 403 };
    }

    // 2. Rate limit (provider-scoped, config overrides the default).
    const limit = providerConfig.rateLimitPerMinute ?? this.config.webhook.rateLimitPerMinute;
    if (!this.rateLimiter.allow(providerId, limit)) {
      this.audit(correlation, "market.webhook.rejected", { type: "provider", id: providerId }, "webhook", providerId, "denied", { reason: "rate_limited" });
      return { ok: false, errorCode: "MARKET_WEBHOOK_RATE_LIMITED", message: "Provider rate limit exceeded", correlationId: correlation, httpStatus: 429 };
    }

    const deliveryId =
      request.headers["x-kamdenai-delivery"] ?? request.headers["x-delivery-id"] ?? `untracked-${sha256Hex(request.rawBody).slice(0, 24)}`;

    // 3. Persistent delivery dedup — the replay/duplicate record happens even
    // for requests that later fail verification, so replays of rejected
    // payloads cannot be retried silently either.
    const deliveryRowId = nextId("mdl");
    const inserted = this.store.recordDelivery({
      id: deliveryRowId,
      providerId,
      deliveryId,
      eventType: request.headers["x-kamdenai-event"] ?? null,
      signatureValid: false,
      timestampValid: false,
      httpStatus: 202,
    });
    if (!inserted || this.store.hasDelivery(providerId, deliveryId)) {
      // recordDelivery already tells us truthfully; hasDelivery re-checks the
      // exact unique key for the untracked-hash case.
      if (!inserted) {
        this.store.markDeliveryDuplicate(deliveryRowId);
        this.store.recordProviderEvent(providerId, "duplicate");
        this.bus.publish({
          type: "market.signal.duplicate",
          payload: { providerId, deliveryId },
          correlationId: correlation,
          actor: { type: "provider", id: providerId },
        });
        return { ok: false, duplicate: true, errorCode: "MARKET_WEBHOOK_DUPLICATE", message: "Duplicate delivery", correlationId: correlation, httpStatus: 200 };
      }
    }

    // 4. Verification.
    this.bus.publish({
      type: "market.signal.received",
      payload: { providerId, deliveryId },
      correlationId: correlation,
      actor: { type: "provider", id: providerId },
    });
    const verification = await adapter.verify(request);
    if (!verification.valid) {
      this.store.recordProviderEvent(providerId, "failure");
      this.audit(correlation, "market.webhook.verification_failed", { type: "provider", id: providerId }, "webhook", deliveryId, "failure", {
        errorCode: verification.errorCode,
      });
      this.bus.publish({
        type: "market.signal.verification_failed",
        payload: { providerId, reason: verification.errorCode ?? "unknown" },
        correlationId: correlation,
        actor: { type: "provider", id: providerId },
      });
      return { ok: false, errorCode: verification.errorCode, message: verification.message, correlationId: correlation, httpStatus: 401 };
    }

    // 5. Raw persistence with redacted headers.
    const rawEventId = nextId("mraw");
    this.store.saveRawEvent({
      id: rawEventId,
      providerId,
      deliveryId,
      contentType: request.headers["content-type"] ?? "application/json",
      payloadText: new TextDecoder().decode(request.rawBody),
      payloadHash: sha256Hex(request.rawBody),
      headersRedacted: redactHeaders(request.headers),
    });

    // 6. Parse.
    const event = await adapter.parse(request, verification);
    if (!event || !event.symbol) {
      this.store.recordDelivery({
        id: nextId("mdl"),
        providerId,
        deliveryId: `${deliveryId}:schema`,
        eventType: null,
        signatureValid: true,
        timestampValid: true,
        httpStatus: 422,
        errorCode: "MARKET_WEBHOOK_SCHEMA_INVALID",
        errorMessage: "Payload could not be parsed into a provider event",
      });
      return { ok: false, errorCode: "MARKET_WEBHOOK_SCHEMA_INVALID", message: "Payload schema invalid", correlationId: correlation, httpStatus: 422 };
    }

    // 7. Provider-event dedup (second priority after delivery id).
    if (event.providerEventId) {
      const existing = this.store
        .listSignals({ limit: 500 })
        .find(s => s.signal.provider === providerId && s.signal.providerEventId === event.providerEventId);
      if (existing) {
        this.store.recordProviderEvent(providerId, "duplicate");
        this.bus.publish({
          type: "market.signal.duplicate",
          payload: { providerId, deliveryId },
          correlationId: correlation,
          actor: { type: "provider", id: providerId },
        });
        return { ok: false, duplicate: true, errorCode: "MARKET_WEBHOOK_DUPLICATE", message: "Duplicate provider event", correlationId: correlation, httpStatus: 200 };
      }
    }

    // 8. Normalize + persist as VERIFIED.
    const signal = adapter.normalize(event, {
      rawEventId,
      receivedAt: request.receivedAt,
      verified: true,
      now: this.now,
    });
    const quality = this.grader.grade(signal, nowMs);
    this.store.saveSignal(signal, "VERIFIED", quality);
    this.store.updateSignalStatus({
      signalId: signal.id,
      from: "RECEIVED",
      to: "VERIFIED",
      reason: "webhook verified",
      actor: { type: "provider", id: providerId },
      at: this.now().toISOString(),
    });
    this.store.recordProviderEvent(providerId, "event");
    this.bus.publish({
      type: "market.signal.verified",
      payload: { signalId: signal.id, providerId },
      correlationId: correlation,
      actor: { type: "provider", id: providerId },
    });
    this.bus.publish({
      type: "market.signal.normalized",
      payload: { signalId: signal.id, symbol: signal.symbol, providerId },
      correlationId: correlation,
      causationId: signal.id,
      actor: { type: "provider", id: providerId },
    });

    this.audit(correlation, "market.signal.verified", { type: "provider", id: providerId }, "signal", signal.id, "success", {
      symbol: signal.symbol,
      deliveryId,
    });

    return { ok: true, signalId: signal.id, correlationId: correlation, httpStatus: 202 };
  }

  async ingestManual(
    actor: ActorRef,
    fields: Record<string, unknown>,
  ): Promise<IngestOutcome> {
    const correlation = correlationId();
    if (!this.config.manualSignalEnabled) {
      return { ok: false, errorCode: "MARKET_MANUAL_SIGNAL_DISABLED", message: "Manual signals disabled", correlationId: correlation, httpStatus: 403 };
    }
    if (!actor || actor.type === "provider") {
      return { ok: false, errorCode: "MARKET_FORBIDDEN", message: "Manual signals require an authenticated actor", correlationId: correlation, httpStatus: 403 };
    }
    const symbol = typeof fields.symbol === "string" ? fields.symbol.trim().toUpperCase() : "";
    if (!symbol) {
      return { ok: false, errorCode: "MARKET_WEBHOOK_SCHEMA_INVALID", message: "symbol is required", correlationId: correlation, httpStatus: 422 };
    }

    const rawEventId = nextId("mraw");
    const receivedAt = this.now().toISOString();
    this.store.saveRawEvent({
      id: rawEventId,
      providerId: "manual",
      deliveryId: null,
      contentType: "application/json",
      payloadText: JSON.stringify(fields),
      payloadHash: sha256Hex(JSON.stringify(fields)),
      headersRedacted: {},
    });

    const adapter = this.registry.get("manual")!;
    const event = await adapter.parse(
      {
        providerId: "manual",
        rawBody: new TextEncoder().encode(JSON.stringify(fields)),
        headers: { "__market_manual__": JSON.stringify(fields) },
        receivedAt,
        actor,
      },
      { valid: true },
    );
    if (!event) {
      return { ok: false, errorCode: "MARKET_WEBHOOK_SCHEMA_INVALID", message: "Manual signal payload invalid", correlationId: correlation, httpStatus: 422 };
    }

    const signal = adapter.normalize(event, { rawEventId, receivedAt, verified: true, now: this.now });
    const quality = this.grader.grade(signal, this.now().getTime());
    this.store.saveSignal(signal, "VERIFIED", quality);
    this.store.updateSignalStatus({
      signalId: signal.id,
      from: "RECEIVED",
      to: "VERIFIED",
      reason: "manual signal created",
      actor,
      at: receivedAt,
    });
    this.bus.publish({
      type: "market.signal.verified",
      payload: { signalId: signal.id, providerId: "manual" },
      correlationId: correlation,
      actor,
    });
    this.audit(correlation, "market.signal.manual_created", actor, "signal", signal.id, "success", { symbol: signal.symbol });
    return { ok: true, signalId: signal.id, correlationId: correlation, httpStatus: 201 };
  }

  /** Deterministic data-quality metadata for UI/routing (never profitability). */
  qualityOf(signal: MarketSignal, nowMs: number): SignalQuality {
    return this.grader.grade(signal, nowMs);
  }

  private audit(
    correlationId: string,
    eventType: string,
    actor: ActorRef,
    resourceType: string,
    resourceId: string,
    result: "success" | "failure" | "denied",
    metadata: Record<string, unknown>,
  ): void {
    try {
      this.store.appendAudit({
        id: nextId("mau"),
        correlationId,
        eventType,
        actorType: actor.type,
        actorId: actor.id,
        resourceType,
        resourceId,
        action: eventType,
        result,
        metadata: { ...metadata, remoteHash: typeof metadata.deliveryId === "string" ? hashForLogging(metadata.deliveryId) : undefined },
        createdAt: this.now().toISOString(),
      });
    } catch {
      // Audit failures are surfaced by the health endpoint, never thrown into
      // the ingest path.
    }
  }
}

export { hashForLogging };
