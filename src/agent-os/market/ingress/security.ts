/**
 * Pao Market Signal Control Plane — webhook ingress security (Phase 20.52).
 *
 * Defense in depth, in the order the spec mandates:
 *   size limit -> timestamp/replay window -> constant-time HMAC ->
 *   delivery-id dedup (persistent) -> raw persistence -> normalize.
 *
 * Secrets are read from environment variables by name and never logged.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { IncomingWebhookRequest, VerificationResult } from "../types";

const SENSITIVE_HEADER_HINTS = [
  "authorization",
  "cookie",
  "x-api-key",
  "api-key",
  "signature",
  "token",
  "secret",
];

/** Redact sensitive header values before anything is persisted or displayed. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();
    out[name] = SENSITIVE_HEADER_HINTS.some(hint => lowered.includes(hint)) ? "[REDACTED]" : value;
  }
  return out;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Stable pseudo-identifier for rate-limit and delivery logs; never reversible. */
export function hashForLogging(value: string): string {
  return sha256Hex(value).slice(0, 16);
}

export function hmacSha256Hex(secret: string, payload: Uint8Array | string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time comparison. Returns false for length mismatches without
 * throwing (a length difference is itself a failed verification).
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export interface SignaturePolicy {
  readonly secret: string;
  /** Header carrying the hex signature. */
  readonly signatureHeader: string;
  /** Header carrying the unix-epoch-seconds timestamp, when the provider signs one. */
  readonly timestampHeader?: string;
  /** Extra headers folded into the signed payload, in order. */
  readonly signedExtraHeaders?: readonly string[];
  readonly maxAgeSeconds: number;
}

export interface SignatureCheckInput {
  readonly rawBody: Uint8Array;
  readonly headers: Record<string, string>;
  readonly policy: SignaturePolicy;
  readonly now: () => number;
}

export type SignatureCheckResult =
  | { readonly ok: true; readonly deliveryId?: string }
  | { readonly ok: false; readonly errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID" | "MARKET_WEBHOOK_TIMESTAMP_STALE"; readonly message: string };

/**
 * Verify a signed webhook. The signature is computed over the ORIGINAL raw
 * request bytes (never a re-serialized object). Comparison is constant-time.
 */
export function verifySignedWebhook(input: SignatureCheckInput): SignatureCheckResult {
  const { policy, headers, rawBody } = input;

  const provided = headers[policy.signatureHeader.toLowerCase()] ?? headers[policy.signatureHeader];
  if (!provided || provided.trim() === "") {
    return { ok: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Missing signature header" };
  }

  // Timestamp window first: a stale delivery is rejected before any secret
  // material comparison matters.
  let signedPayload: Uint8Array = rawBody;
  if (policy.timestampHeader) {
    const timestampRaw = headers[policy.timestampHeader.toLowerCase()] ?? headers[policy.timestampHeader];
    if (!timestampRaw) {
      return { ok: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Missing timestamp header" };
    }
    const timestampSec = Number(timestampRaw);
    if (!Number.isFinite(timestampSec)) {
      return { ok: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Malformed timestamp header" };
    }
    const ageSec = Math.abs(input.now() / 1000 - timestampSec);
    if (ageSec > policy.maxAgeSeconds) {
      return { ok: false, errorCode: "MARKET_WEBHOOK_TIMESTAMP_STALE", message: `Webhook timestamp outside the ${policy.maxAgeSeconds}s window` };
    }
    // Providers that sign the timestamp sign it as part of the payload prefix
    // (v1-style scheme: HMAC over `${timestamp}.${body}`).
    const prefix = new TextEncoder().encode(`${timestampRaw}.`);
    const combined = new Uint8Array(prefix.length + rawBody.length);
    combined.set(prefix, 0);
    combined.set(rawBody, prefix.length);
    signedPayload = combined;
  }

  const expected = hmacSha256Hex(policy.secret, signedPayload);
  const providedHex = normalizeHex(provided);
  if (!providedHex || !constantTimeEqualHex(expected, providedHex)) {
    return { ok: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Webhook signature verification failed" };
  }

  const deliveryId = headers["x-kamdenai-delivery"] ?? headers["x-delivery-id"] ?? undefined;
  return { ok: true, deliveryId: deliveryId || undefined };
}

/** Accepts plain hex, `sha256=<hex>`, or `v1=<hex>` signature prefixes. */
function normalizeHex(raw: string): string | null {
  const trimmed = raw.trim();
  const eq = trimmed.indexOf("=");
  const candidate = trimmed.startsWith("sha256=") || /^[a-zA-Z0-9]+=\S+$/.test(trimmed)
    ? trimmed.slice(eq + 1).trim()
    : trimmed;
  return /^[0-9a-f]{64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Replay window (timestamp-only providers) & size limit
// ---------------------------------------------------------------------------

export function isStaleTimestamp(timestampHeader: string | undefined, headers: Record<string, string>, maxAgeSeconds: number, now: () => number): boolean {
  if (!timestampHeader) return false;
  const raw = headers[timestampHeader.toLowerCase()] ?? headers[timestampHeader];
  if (!raw) return true;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return true;
  return Math.abs(now() / 1000 - seconds) > maxAgeSeconds;
}

export function withinSizeLimit(bodyBytes: Uint8Array, maxBodyKb: number): boolean {
  return bodyBytes.byteLength <= maxBodyKb * 1024;
}

// ---------------------------------------------------------------------------
// Rate limiting (provider-scoped, fixed-window per process)
// ---------------------------------------------------------------------------

interface RateWindow {
  readonly windowStartMs: number;
  count: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Returns true when the request is allowed. */
  allow(key: string, limitPerMinute: number): boolean {
    const t = this.now();
    const windowMs = 60_000;
    const existing = this.windows.get(key);
    if (!existing || t - existing.windowStartMs >= windowMs) {
      this.windows.set(key, { windowStartMs: t, count: 1 });
      return true;
    }
    existing.count += 1;
    if (existing.count > limitPerMinute) return false;
    return true;
  }

  /** Test seam. */
  reset(): void {
    this.windows.clear();
  }
}

// ---------------------------------------------------------------------------
// Shared verification entry point
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  readonly secret: string;
  readonly authType: "hmac_sha256" | "static_token" | "none" | "manual";
  readonly signatureHeader?: string;
  readonly timestampHeader?: string;
  readonly tokenHeader?: string;
  readonly maxAgeSeconds: number;
  readonly maxBodyKb: number;
  readonly now?: () => number;
}

export function verifyIngress(request: IncomingWebhookRequest, options: VerifyOptions): VerificationResult {
  const now = options.now ?? Date.now;

  if (!withinSizeLimit(request.rawBody, options.maxBodyKb)) {
    return { valid: false, errorCode: "MARKET_WEBHOOK_PAYLOAD_TOO_LARGE", message: `Webhook body exceeds ${options.maxBodyKb} KB` };
  }

  if (options.authType === "hmac_sha256") {
    const result = verifySignedWebhook({
      rawBody: request.rawBody,
      headers: request.headers,
      policy: {
        secret: options.secret,
        signatureHeader: options.signatureHeader ?? "X-KamdenAI-Signature",
        timestampHeader: options.timestampHeader,
        maxAgeSeconds: options.maxAgeSeconds,
      },
      now,
    });
    if (!result.ok) {
      return { valid: false, errorCode: result.errorCode, message: result.message };
    }
    return { valid: true, deliveryId: result.deliveryId };
  }

  if (options.authType === "static_token") {
    const token = request.headers[(options.tokenHeader ?? "x-webhook-token").toLowerCase()];
    if (!token || !constantTimeEqualHex(options.secret, token)) {
      return { valid: false, errorCode: "MARKET_WEBHOOK_SIGNATURE_INVALID", message: "Webhook token verification failed" };
    }
    if (isStaleTimestamp(options.timestampHeader, request.headers, options.maxAgeSeconds, now)) {
      return { valid: false, errorCode: "MARKET_WEBHOOK_TIMESTAMP_STALE", message: "Webhook timestamp outside the allowed window" };
    }
    return { valid: true, deliveryId: request.headers["x-delivery-id"] ?? undefined };
  }

  // authType "none" must never reach production ingress; the pipeline rejects
  // it before verification unless a policy explicitly permits it.
  return { valid: false, errorCode: "MARKET_PROVIDER_DISABLED", message: "Unauthenticated ingress is not permitted" };
}
