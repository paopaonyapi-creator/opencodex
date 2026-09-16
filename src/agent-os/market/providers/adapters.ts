/**
 * Pao Market Signal Control Plane — provider adapters (Phase 20.52).
 *
 * The core pipeline contains zero provider-specific parsing. Each adapter owns
 * its schema, headers, signature rules, and normalization into the canonical
 * MarketSignal. A future provider registers into the registry; the pipeline
 * never changes.
 */

import { constantTimeEqualHex, verifyIngress, withinSizeLimit, type VerifyOptions } from "../ingress/security";
import type {
  AssetClass,
  IncomingWebhookRequest,
  MarketSignal,
  MarketSignalEventType,
  MarketDirection,
  ProviderEvent,
  VerificationResult,
} from "../types";

export interface ProviderAdapterConfig {
  readonly providerId: string;
  readonly displayName: string;
  readonly secretEnv: string;
  readonly authType: VerifyOptions["authType"];
  readonly signatureHeader?: string;
  readonly timestampHeader?: string;
  readonly tokenHeader?: string;
  readonly enabled: boolean;
}

export interface NormalizeContext {
  readonly rawEventId: string;
  readonly receivedAt: string;
  readonly verified: boolean;
  readonly now: () => Date;
}

export interface MarketSignalProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  verify(request: IncomingWebhookRequest): Promise<VerificationResult>;
  parse(request: IncomingWebhookRequest, verification: VerificationResult): Promise<ProviderEvent | null>;
  normalize(event: ProviderEvent, ctx: NormalizeContext): MarketSignal;
}

// ---------------------------------------------------------------------------
// Shared normalization helpers
// ---------------------------------------------------------------------------

export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function normalizeEventType(value: unknown): MarketSignalEventType {
  const lowered = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["entry", "buy", "long"].includes(lowered)) return "entry";
  if (["exit", "sell", "close", "short_entry"].includes(lowered)) return "exit";
  if (lowered === "update") return "update";
  if (lowered === "alert") return "alert";
  return "unknown";
}

export function normalizeDirection(value: unknown): MarketDirection | undefined {
  const lowered = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["long", "buy"].includes(lowered)) return "long";
  if (["short", "sell"].includes(lowered)) return "short";
  if (lowered === "neutral") return "neutral";
  return undefined;
}

export function detectAssetClass(symbol: string, provided?: unknown): AssetClass {
  if (typeof provided === "string" && provided.trim() !== "") {
    const lowered = provided.trim().toLowerCase();
    const known: AssetClass[] = ["equity", "etf", "crypto", "forex", "index", "future"];
    if (known.includes(lowered as AssetClass)) return lowered as AssetClass;
  }
  // Crypto pairs conventionally quote against BTC/USDT/USD with a dash or
  // slash; equities are bare tickers. This is a default, not a fact — the
  // provider can override through the asset_class field.
  if (/[-/]/.test(symbol) || /(USDT|USD|BTC|ETH)$/i.test(symbol.replace(/[-/].*$/, ""))) {
    return "crypto";
  }
  return "equity";
}

function signalTimeOf(event: ProviderEvent, ctx: NormalizeContext, fallbackFields: Record<string, unknown>): string {
  const candidates = [event.signalTime, fallbackFields.time, fallbackFields.timestamp, fallbackFields.signal_time];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      const ms = candidate < 1e11 ? candidate * 1000 : candidate;
      return new Date(ms).toISOString();
    }
  }
  return ctx.now().toISOString();
}

function buildSignal(
  event: ProviderEvent,
  fields: {
    symbol: string;
    entryPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
    providerConfidence?: number;
    providerScore?: number;
    direction?: MarketDirection;
    timeframe?: string;
    strategy?: string;
    assetClass?: AssetClass;
  },
  ctx: NormalizeContext,
): MarketSignal {
  const signalTime = signalTimeOf(event, ctx, event.fields);
  return {
    id: `msig-${ctx.rawEventId}`,
    provider: event.providerId,
    providerEventId: event.providerEventId,
    deliveryId: event.deliveryId,
    eventType: event.eventType,
    symbol: fields.symbol.toUpperCase(),
    assetClass: fields.assetClass ?? detectAssetClass(fields.symbol),
    direction: fields.direction,
    entryPrice: fields.entryPrice,
    stopPrice: fields.stopPrice,
    targetPrice: fields.targetPrice,
    providerConfidence: fields.providerConfidence,
    providerScore: fields.providerScore,
    timeframe: fields.timeframe,
    strategy: fields.strategy,
    signalTime,
    receivedAt: ctx.receivedAt,
    normalizedAt: ctx.now().toISOString(),
    verified: ctx.verified,
    duplicate: false,
    tags: [],
    rawEventId: ctx.rawEventId,
    metadata: event.metadata,
  };
}

// ---------------------------------------------------------------------------
// Kamden-style signed webhook adapter
// ---------------------------------------------------------------------------

export class KamdenAdapter implements MarketSignalProviderAdapter {
  readonly providerId: string;
  readonly displayName = "KamdenAI";
  private readonly config: ProviderAdapterConfig;
  private readonly maxAgeSeconds: number;
  private readonly maxBodyKb: number;

  constructor(config: ProviderAdapterConfig, limits: { maxAgeSeconds: number; maxBodyKb: number }) {
    this.providerId = config.providerId;
    this.config = config;
    this.maxAgeSeconds = limits.maxAgeSeconds;
    this.maxBodyKb = limits.maxBodyKb;
  }

  async verify(request: IncomingWebhookRequest): Promise<VerificationResult> {
    return verifyIngress(request, {
      secret: process.env[this.config.secretEnv] ?? "",
      authType: "hmac_sha256",
      signatureHeader: "X-KamdenAI-Signature",
      timestampHeader: "X-KamdenAI-Timestamp",
      maxAgeSeconds: this.maxAgeSeconds,
      maxBodyKb: this.maxBodyKb,
    });
  }

  async parse(request: IncomingWebhookRequest, verification: VerificationResult): Promise<ProviderEvent | null> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(request.rawBody)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const eventTypeHeader = request.headers["x-kamdenai-event"];
    return {
      providerId: this.providerId,
      providerEventId: typeof body.event_id === "string" ? body.event_id : verification.deliveryId,
      deliveryId: verification.deliveryId ?? request.headers["x-kamdenai-delivery"],
      eventType: normalizeEventType(body.event_type ?? eventTypeHeader),
      symbol: typeof body.symbol === "string" ? body.symbol : "",
      metadata: { kamdenEvent: eventTypeHeader ?? null },
      fields: body,
    };
  }

  normalize(event: ProviderEvent, ctx: NormalizeContext): MarketSignal {
    const f = event.fields;
    return buildSignal(
      event,
      {
        symbol: event.symbol || String(f.symbol ?? ""),
        entryPrice: parseNumber(f.price ?? f.entry ?? f.entry_price),
        stopPrice: parseNumber(f.stop ?? f.stop_price),
        targetPrice: parseNumber(f.target ?? f.target_price),
        providerConfidence: parseNumber(f.confidence),
        providerScore: parseNumber(f.score),
        direction: normalizeDirection(f.action ?? f.direction),
        timeframe: typeof f.timeframe === "string" ? f.timeframe : undefined,
        strategy: typeof f.strategy === "string" ? f.strategy : undefined,
      },
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// TradingView webhook adapter
// ---------------------------------------------------------------------------

export class TradingViewAdapter implements MarketSignalProviderAdapter {
  readonly providerId: string;
  readonly displayName = "TradingView";
  private readonly config: ProviderAdapterConfig;
  private readonly maxAgeSeconds: number;
  private readonly maxBodyKb: number;

  constructor(config: ProviderAdapterConfig, limits: { maxAgeSeconds: number; maxBodyKb: number }) {
    this.providerId = config.providerId;
    this.config = config;
    this.maxAgeSeconds = limits.maxAgeSeconds;
    this.maxBodyKb = limits.maxBodyKb;
  }

  async verify(request: IncomingWebhookRequest): Promise<VerificationResult> {
    // TradingView posts the shared secret INSIDE the JSON body. Verification
    // compares it against the env-resolved secret in constant time; the
    // secret is never logged and never echoed back.
    if (!withinSizeLimit(request.rawBody, this.maxBodyKb)) {
      return { valid: false, errorCode: "MARKET_WEBHOOK_PAYLOAD_TOO_LARGE", message: "Webhook body exceeds the size limit" };
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(request.rawBody)) as Record<string, unknown>;
    } catch {
      return { valid: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Payload is not valid JSON" };
    }
    const provided = typeof body.secret === "string" ? body.secret : request.headers["x-tradingview-token"];
    const expected = process.env[this.config.secretEnv] ?? "";
    if (!expected || !provided || !constantTimeEqualHex(expected, provided)) {
      return { valid: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Webhook secret verification failed" };
    }
    return { valid: true, deliveryId: request.headers["x-delivery-id"] ?? undefined };
  }

  async parse(request: IncomingWebhookRequest, verification: VerificationResult): Promise<ProviderEvent | null> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(request.rawBody)) as Record<string, unknown>;
    } catch {
      return null;
    }
    return {
      providerId: this.providerId,
      deliveryId: verification.deliveryId ?? request.headers["x-delivery-id"],
      eventType: normalizeEventType(body.action),
      symbol: typeof body.symbol === "string" ? body.symbol : "",
      metadata: {},
      fields: body,
    };
  }

  normalize(event: ProviderEvent, ctx: NormalizeContext): MarketSignal {
    const f = event.fields;
    return buildSignal(
      event,
      {
        symbol: event.symbol || String(f.symbol ?? ""),
        entryPrice: parseNumber(f.price),
        stopPrice: parseNumber(f.stop),
        targetPrice: parseNumber(f.target),
        providerConfidence: parseNumber(f.confidence),
        providerScore: parseNumber(f.score),
        direction: normalizeDirection(f.action),
        timeframe: typeof f.timeframe === "string" ? f.timeframe : undefined,
        strategy: typeof f.strategy === "string" ? f.strategy : undefined,
      },
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// Generic webhook adapter (config-mapped field names)
// ---------------------------------------------------------------------------

export interface GenericFieldMapping {
  readonly symbolField: string;
  readonly actionField: string;
  readonly priceField?: string;
  readonly stopField?: string;
  readonly targetField?: string;
  readonly confidenceField?: string;
  readonly timeframeField?: string;
  readonly strategyField?: string;
  readonly timestampField?: string;
}

export class GenericWebhookAdapter implements MarketSignalProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  private readonly config: ProviderAdapterConfig;
  private readonly mapping: GenericFieldMapping;
  private readonly limits: { maxAgeSeconds: number; maxBodyKb: number };

  constructor(
    config: ProviderAdapterConfig,
    mapping: GenericFieldMapping,
    limits: { maxAgeSeconds: number; maxBodyKb: number },
  ) {
    this.providerId = config.providerId;
    this.displayName = config.displayName;
    this.config = config;
    this.mapping = mapping;
    this.limits = limits;
  }

  async verify(request: IncomingWebhookRequest): Promise<VerificationResult> {
    return verifyIngress(request, {
      secret: process.env[this.config.secretEnv] ?? "",
      authType: this.config.authType,
      signatureHeader: this.config.signatureHeader,
      timestampHeader: this.config.timestampHeader,
      tokenHeader: this.config.tokenHeader,
      maxAgeSeconds: this.limits.maxAgeSeconds,
      maxBodyKb: this.limits.maxBodyKb,
    });
  }

  async parse(request: IncomingWebhookRequest, verification: VerificationResult): Promise<ProviderEvent | null> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(request.rawBody)) as Record<string, unknown>;
    } catch {
      return null;
    }
    return {
      providerId: this.providerId,
      providerEventId: typeof body.event_id === "string" ? body.event_id : undefined,
      deliveryId: verification.deliveryId ?? request.headers["x-delivery-id"],
      eventType: normalizeEventType(body[this.mapping.actionField]),
      symbol: typeof body[this.mapping.symbolField] === "string" ? (body[this.mapping.symbolField] as string) : "",
      metadata: {},
      fields: body,
    };
  }

  normalize(event: ProviderEvent, ctx: NormalizeContext): MarketSignal {
    const f = event.fields;
    const m = this.mapping;
    return buildSignal(
      event,
      {
        symbol: event.symbol || String(f[m.symbolField] ?? ""),
        entryPrice: m.priceField ? parseNumber(f[m.priceField]) : undefined,
        stopPrice: m.stopField ? parseNumber(f[m.stopField]) : undefined,
        targetPrice: m.targetField ? parseNumber(f[m.targetField]) : undefined,
        providerConfidence: m.confidenceField ? parseNumber(f[m.confidenceField]) : undefined,
        direction: normalizeDirection(f[m.actionField]),
        timeframe: m.timeframeField && typeof f[m.timeframeField] === "string" ? (f[m.timeframeField] as string) : undefined,
        strategy: m.strategyField && typeof f[m.strategyField] === "string" ? (f[m.strategyField] as string) : undefined,
      },
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// Manual signal adapter
// ---------------------------------------------------------------------------

export class ManualSignalAdapter implements MarketSignalProviderAdapter {
  readonly providerId = "manual";
  readonly displayName = "Manual";

  async verify(request: IncomingWebhookRequest): Promise<VerificationResult> {
    // Manual signals are created through authenticated API calls; the caller's
    // actor was resolved before this adapter runs.
    return { valid: !!request.actor, deliveryId: undefined };
  }

  async parse(request: IncomingWebhookRequest): Promise<ProviderEvent | null> {
    const body = request.headers["__market_manual__"];
    if (!body) return null;
    try {
      const fields = JSON.parse(body) as Record<string, unknown>;
      return {
        providerId: this.providerId,
        eventType: normalizeEventType(fields.event_type),
        symbol: typeof fields.symbol === "string" ? fields.symbol : "",
        metadata: { manual: true },
        fields,
      };
    } catch {
      return null;
    }
  }

  normalize(event: ProviderEvent, ctx: NormalizeContext): MarketSignal {
    const f = event.fields;
    const signal = buildSignal(
      event,
      {
        symbol: event.symbol || String(f.symbol ?? ""),
        entryPrice: parseNumber(f.price ?? f.entry_price),
        stopPrice: parseNumber(f.stop ?? f.stop_price),
        targetPrice: parseNumber(f.target ?? f.target_price),
        direction: normalizeDirection(f.direction ?? f.action),
        strategy: typeof f.reason === "string" ? undefined : undefined,
      },
      ctx,
    );
    return {
      ...signal,
      metadata: { ...signal.metadata, manualReason: typeof f.reason === "string" ? f.reason : undefined },
    };
  }
}
