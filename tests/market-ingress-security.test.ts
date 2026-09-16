/**
 * Pao Market Signal Control Plane — Phase 20.52 security tests.
 *
 * Covers spec §66 ingress requirements: HMAC accept/reject, stale timestamps,
 * payload size, constant-time comparison, header redaction, rate limiting,
 * and replay/duplicate handling through the real pipeline against a temp DB.
 *
 * No credential-shaped literal appears in this file: HMAC secrets are
 * obviously-fake fixtures, and sensitive header VALUES for redaction tests
 * come from environment fallbacks.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  constantTimeEqualHex,
  hmacSha256Hex,
  redactHeaders,
  verifyIngress,
  verifySignedWebhook,
  RateLimiter,
  withinSizeLimit,
  sha256Hex,
} from "../src/agent-os/market/ingress/security";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { MarketIngestPipeline } from "../src/agent-os/market/pipeline";
import { MarketDbStore } from "../src/agent-os/market/db-store";
import { MarketEventBus } from "../src/agent-os/market/events";
import { loadMarketConfig } from "../src/agent-os/market/config";
import { buildDefaultRegistry } from "../src/agent-os/market/providers/registry";

// Fixture secret for HMAC tests only — explicitly not a real credential.
const SECRET = "fixture-webhook-secret-for-tests-only";
const FIXTURE_AUTH = process.env.MARKET_TEST_FIXTURE_AUTH ?? "fixture-auth-placeholder";
const FIXTURE_KEY = process.env.MARKET_TEST_FIXTURE_KEY ?? "fixture-key-placeholder";
const tempHomes: string[] = [];

function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "market-sec-"));
  tempHomes.push(dir);
  process.env.OPENCODEX_HOME = dir;
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
}

afterEach(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) {
    try {
      rmSync(tempHomes.pop()!, { recursive: true, force: true });
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("Phase 20.52 — webhook security primitives", () => {
  const now = () => 1_000_000_000_000; // fixed epoch ms

  test("valid HMAC over timestamp-prefixed raw body is accepted", () => {
    const body = new TextEncoder().encode('{"symbol":"AAPL"}');
    const timestamp = Math.floor(now() / 1000);
    const sig = hmacSha256Hex(SECRET, `${timestamp}.${new TextDecoder().decode(body)}`);
    const result = verifySignedWebhook({
      rawBody: body,
      headers: {
        "x-kamdenai-signature": sig,
        "x-kamdenai-timestamp": String(timestamp),
        "x-kamdenai-delivery": "dlv-1",
      },
      policy: { secret: SECRET, signatureHeader: "X-KamdenAI-Signature", timestampHeader: "X-KamdenAI-Timestamp", maxAgeSeconds: 300 },
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryId).toBe("dlv-1");
  });

  test("invalid HMAC is rejected", () => {
    const body = new TextEncoder().encode('{"symbol":"AAPL"}');
    const timestamp = Math.floor(now() / 1000);
    const result = verifySignedWebhook({
      rawBody: body,
      headers: {
        "x-kamdenai-signature": hmacSha256Hex("fixture-wrong-secret", `${timestamp}.body`),
        "x-kamdenai-timestamp": String(timestamp),
      },
      policy: { secret: SECRET, signatureHeader: "X-KamdenAI-Signature", timestampHeader: "X-KamdenAI-Timestamp", maxAgeSeconds: 300 },
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("MARKET_WEBHOOK_SIGNATURE_INVALID");
  });

  test("a signature computed over re-serialized JSON fails raw-body verification", () => {
    // The provider signed the original bytes; re-serialization changes them.
    const original = '{"symbol":"AAPL","price":200.25}';
    const timestamp = Math.floor(now() / 1000);
    const sig = hmacSha256Hex(SECRET, `${timestamp}.${original}`);
    const reserialized = new TextEncoder().encode(JSON.stringify({ price: 200.25, symbol: "AAPL" }));
    const result = verifySignedWebhook({
      rawBody: reserialized,
      headers: { "x-kamdenai-signature": sig, "x-kamdenai-timestamp": String(timestamp) },
      policy: { secret: SECRET, signatureHeader: "X-KamdenAI-Signature", timestampHeader: "X-KamdenAI-Timestamp", maxAgeSeconds: 300 },
      now,
    });
    expect(result.ok).toBe(false);
  });

  test("stale timestamps are rejected with the dedicated error code", () => {
    const body = new TextEncoder().encode("{}");
    const staleTimestamp = Math.floor(now() / 1000) - 3600;
    const sig = hmacSha256Hex(SECRET, `${staleTimestamp}.{}`);
    const result = verifySignedWebhook({
      rawBody: body,
      headers: { "x-kamdenai-signature": sig, "x-kamdenai-timestamp": String(staleTimestamp) },
      policy: { secret: SECRET, signatureHeader: "X-KamdenAI-Signature", timestampHeader: "X-KamdenAI-Timestamp", maxAgeSeconds: 300 },
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("MARKET_WEBHOOK_TIMESTAMP_STALE");
  });

  test("constant-time comparison rejects length mismatches without throwing", () => {
    expect(constantTimeEqualHex("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(constantTimeEqualHex("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(constantTimeEqualHex("short", "longer-value")).toBe(false);
  });

  test("sensitive headers are redacted before persistence", () => {
    const redacted = redactHeaders({
      "content-type": "application/json",
      "authorization": FIXTURE_AUTH,
      "x-api-key": FIXTURE_KEY,
      "x-kamdenai-signature": "a".repeat(64),
      "x-kamdenai-delivery": "dlv-9",
    });
    expect(redacted["authorization"]).toBe("[REDACTED]");
    expect(redacted["x-api-key"]).toBe("[REDACTED]");
    expect(redacted["x-kamdenai-signature"]).toBe("[REDACTED]");
    expect(redacted["content-type"]).toBe("application/json");
    expect(redacted["x-kamdenai-delivery"]).toBe("dlv-9");
    expect(JSON.stringify(redacted)).not.toContain(FIXTURE_AUTH);
    expect(JSON.stringify(redacted)).not.toContain(FIXTURE_KEY);
  });

  test("payload size limit is enforced", () => {
    const big = new Uint8Array(300 * 1024);
    expect(withinSizeLimit(big, 256)).toBe(false);
    expect(withinSizeLimit(new Uint8Array(10), 256)).toBe(true);
  });

  test("rate limiter allows up to the configured count then blocks", () => {
    let clock = 0;
    const limiter = new RateLimiter(() => clock);
    for (let i = 0; i < 5; i++) expect(limiter.allow("p", 5)).toBe(true);
    expect(limiter.allow("p", 5)).toBe(false);
    clock += 60_001; // new window
    expect(limiter.allow("p", 5)).toBe(true);
    // A second provider has an independent window.
    expect(limiter.allow("other", 5)).toBe(true);
  });

  test("unauthenticated ingress mode is refused", () => {
    const result = verifyIngress(
      { providerId: "p", rawBody: new TextEncoder().encode("{}"), headers: {}, receivedAt: "" },
      { secret: "fixture-secret", authType: "none", maxAgeSeconds: 300, maxBodyKb: 256 },
    );
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MARKET_PROVIDER_DISABLED");
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level security (persistent dedup, replay, disabled provider)
// ---------------------------------------------------------------------------

describe("Phase 20.52 — pipeline ingress security", () => {
  let pipeline: MarketIngestPipeline;
  let store: MarketDbStore;
  let clockMs: number;

  beforeEach(() => {
    freshDb();
    process.env.MARKET_PROVIDER_KAMDEN_ENABLED = "true";
    process.env.MARKET_KAMDEN_WEBHOOK_SECRET = SECRET;
    process.env.MARKET_WEBHOOK_MAX_AGE_SECONDS = "300";
    clockMs = Date.now();
    const config = loadMarketConfig();
    store = new MarketDbStore({ now: () => new Date(clockMs) });
    store.init();
    store.upsertProvider({ providerId: "kamden", displayName: "KamdenAI", enabled: true, authType: "hmac_sha256" });
    pipeline = new MarketIngestPipeline({
      config,
      registry: buildDefaultRegistry({ limits: config.webhook }),
      store,
      bus: new MarketEventBus(),
      now: () => new Date(clockMs),
    });
  });

  afterEach(() => {
    delete process.env.MARKET_PROVIDER_KAMDEN_ENABLED;
    delete process.env.MARKET_KAMDEN_WEBHOOK_SECRET;
  });

  function kamdenRequest(bodyText: string, deliveryId: string, timestampSec?: number) {
    const ts = timestampSec ?? Math.floor(clockMs / 1000);
    const sig = createHmac("sha256", SECRET).update(`${ts}.${bodyText}`).digest("hex");
    return {
      providerId: "kamden",
      rawBody: new TextEncoder().encode(bodyText),
      headers: {
        "content-type": "application/json",
        "x-kamdenai-event": "entry",
        "x-kamdenai-delivery": deliveryId,
        "x-kamdenai-timestamp": String(ts),
        "x-kamdenai-signature": sig,
      },
      receivedAt: new Date(clockMs).toISOString(),
    };
  }

  test("valid signed webhook is accepted and normalized into a signal", async () => {
    const body = JSON.stringify({ symbol: "aapl", event_type: "entry", price: 200.25, stop: 196, target: 208, confidence: 0.7 });
    const outcome = await pipeline.ingestWebhook("kamden", kamdenRequest(body, "dlv-1"));
    expect(outcome.ok).toBe(true);
    const entry = store.getSignal(outcome.signalId!)!;
    expect(entry.signal.symbol).toBe("AAPL");
    expect(entry.signal.entryPrice).toBe(200.25);
    expect(entry.status).toBe("VERIFIED");
    expect(entry.quality?.grade === "A" || entry.quality?.grade === "B").toBe(true);
  });

  test("invalid signature leaves no signal and records the failure", async () => {
    const body = JSON.stringify({ symbol: "AAPL" });
    const request = kamdenRequest(body, "dlv-bad");
    request.headers["x-kamdenai-signature"] = "0".repeat(64);
    const outcome = await pipeline.ingestWebhook("kamden", request);
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("MARKET_WEBHOOK_SIGNATURE_INVALID");
    expect(store.listSignals()).toHaveLength(0);
  });

  test("replay of the same delivery id is detected as duplicate (idempotent)", async () => {
    const body = JSON.stringify({ symbol: "MSFT", event_type: "entry", price: 410, stop: 400, target: 430 });
    const first = await pipeline.ingestWebhook("kamden", kamdenRequest(body, "dlv-replay"));
    expect(first.ok).toBe(true);
    const replay = await pipeline.ingestWebhook("kamden", kamdenRequest(body, "dlv-replay"));
    expect(replay.ok).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.errorCode).toBe("MARKET_WEBHOOK_DUPLICATE");
    expect(store.listSignals()).toHaveLength(1);
  });

  test("a different delivery id is accepted", async () => {
    const body = JSON.stringify({ symbol: "NVDA", event_type: "entry", price: 120, stop: 115, target: 130 });
    expect((await pipeline.ingestWebhook("kamden", kamdenRequest(body, "dlv-a"))).ok).toBe(true);
    expect((await pipeline.ingestWebhook("kamden", kamdenRequest(body, "dlv-b"))).ok).toBe(true);
    expect(store.listSignals()).toHaveLength(2);
  });

  test("disabled provider rejects events without verification", async () => {
    const body = JSON.stringify({ symbol: "AAPL" });
    const request = kamdenRequest(body, "dlv-x");
    const outcome = await pipeline.ingestWebhook("disabled-provider", request);
    expect(outcome.errorCode).toBe("MARKET_PROVIDER_UNKNOWN");
    // Now a registered-but-disabled provider: generic is off by default.
    const genericOutcome = await pipeline.ingestWebhook("generic", request);
    expect(genericOutcome.errorCode).toBe("MARKET_PROVIDER_DISABLED");
    expect(genericOutcome.httpStatus).toBe(403);
  });

  test("raw event persists with redacted headers only", async () => {
    const body = JSON.stringify({ symbol: "TSLA", event_type: "entry", price: 250, stop: 240, target: 270 });
    const request = kamdenRequest(body, "dlv-raw");
    request.headers["authorization"] = FIXTURE_AUTH;
    const outcome = await pipeline.ingestWebhook("kamden", request);
    expect(outcome.ok).toBe(true);
    const signals = store.listSignals({ limit: 1 });
    const raw = store.getRawEvent(signals[0]!.signal.rawEventId)!;
    expect(raw.headersRedacted["authorization"]).toBe("[REDACTED]");
    expect(raw.payloadText).not.toContain("fixture-auth-placeholder");
    expect(raw.payloadHash).toBe(sha256Hex(new TextEncoder().encode(body)));
  });
});
