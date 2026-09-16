/**
 * Pao Market Signal Control Plane — Phase 20.52 provider adapter tests.
 *
 * Covers spec §66: TradingView normalization, generic field mapping, manual
 * signal attribution, and lifecycle transition guards.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { KamdenAdapter, TradingViewAdapter, GenericWebhookAdapter, ManualSignalAdapter } from "../src/agent-os/market/providers/adapters";
import { canTransition, requireTransition, lifecycleSuccessors } from "../src/agent-os/market/lifecycle";
import type { IncomingWebhookRequest, MarketSignal } from "../src/agent-os/market/types";

const FIXTURE_SECRET_ENV = "MARKET_TEST_PROVIDER_SECRET";
const tempHomes: string[] = [];

function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "market-prov-"));
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
  delete process.env[FIXTURE_SECRET_ENV];
});

const ctx = {
  rawEventId: "mraw-1",
  receivedAt: "2026-01-01T00:00:00.000Z",
  verified: true,
  now: () => new Date("2026-01-01T00:00:01.000Z"),
};

function textRequest(body: string, headers: Record<string, string> = {}): IncomingWebhookRequest {
  return {
    providerId: "test",
    rawBody: new TextEncoder().encode(body),
    headers: { "content-type": "application/json", ...headers },
    receivedAt: ctx.receivedAt,
  };
}

function signedKamdenRequest(body: string): IncomingWebhookRequest {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env[FIXTURE_SECRET_ENV] ?? "").update(ts + "." + body).digest("hex");
  return textRequest(body, {
    "x-kamdenai-event": "entry",
    "x-kamdenai-delivery": "dlv-k",
    "x-kamdenai-timestamp": String(ts),
    "x-kamdenai-signature": sig,
  });
}

describe("Phase 20.52 — provider adapters", () => {
  beforeEach(() => {
    freshDb();
    process.env[FIXTURE_SECRET_ENV] = "fixture-provider-secret";
  });

  test("Kamden adapter normalizes provider fields into the canonical signal", async () => {
    const adapter = new KamdenAdapter(
      { providerId: "kamden", displayName: "KamdenAI", secretEnv: FIXTURE_SECRET_ENV, authType: "hmac_sha256", enabled: true },
      { maxAgeSeconds: 300, maxBodyKb: 256 },
    );
    const request = signedKamdenRequest(
      JSON.stringify({ symbol: "msft", event_type: "entry", action: "BUY", price: "410.50", stop: 400, target: 430, confidence: 0.66, score: 8, timeframe: "1h", strategy: "breakout" }),
    );
    const verification = await adapter.verify(request);
    expect(verification.valid).toBe(true);
    const event = await adapter.parse(request, verification);
    expect(event).not.toBeNull();
    const signal = adapter.normalize(event!, ctx);
    expect(signal.symbol).toBe("MSFT");
    expect(signal.entryPrice).toBe(410.5);
    expect(signal.stopPrice).toBe(400);
    expect(signal.targetPrice).toBe(430);
    expect(signal.providerConfidence).toBe(0.66);
    expect(signal.providerScore).toBe(8);
    expect(signal.direction).toBe("long");
    expect(signal.timeframe).toBe("1h");
    expect(signal.strategy).toBe("breakout");
    expect(signal.assetClass).toBe("equity");
    expect(signal.verified).toBe(true);
  });

  test("TradingView adapter verifies the body secret and normalizes action/price", async () => {
    const adapter = new TradingViewAdapter(
      { providerId: "tradingview", displayName: "TradingView", secretEnv: FIXTURE_SECRET_ENV, authType: "static_token", enabled: true },
      { maxAgeSeconds: 300, maxBodyKb: 256 },
    );
    const body = JSON.stringify({ secret: "fixture-provider-secret", symbol: "AAPL", action: "BUY", price: 200.25, stop: 196, target: 208, timeframe: "1h", strategy: "example" });
    const request = textRequest(body);
    const verification = await adapter.verify(request);
    expect(verification.valid).toBe(true);
    const event = await adapter.parse(request, verification);
    expect(event).not.toBeNull();
    const signal = adapter.normalize(event!, ctx);
    expect(signal.direction).toBe("long");
    expect(signal.eventType).toBe("entry");
    expect(signal.entryPrice).toBe(200.25);
  });

  test("TradingView adapter rejects a wrong body secret", async () => {
    const adapter = new TradingViewAdapter(
      { providerId: "tradingview", displayName: "TradingView", secretEnv: FIXTURE_SECRET_ENV, authType: "static_token", enabled: true },
      { maxAgeSeconds: 300, maxBodyKb: 256 },
    );
    const body = JSON.stringify({ secret: "fixture-wrong-secret", symbol: "AAPL", action: "BUY" });
    const request = textRequest(body);
    const verification = await adapter.verify(request);
    expect(verification.valid).toBe(false);
    if (!verification.valid) expect(verification.errorCode).toBe("MARKET_WEBHOOK_SIGNATURE_INVALID");
  });

  test("generic adapter maps configured field names", async () => {
    const adapter = new GenericWebhookAdapter(
      { providerId: "custom-bot", displayName: "Custom Bot", secretEnv: FIXTURE_SECRET_ENV, authType: "static_token", tokenHeader: "x-webhook-token", enabled: true },
      { symbolField: "ticker", actionField: "side", priceField: "px", stopField: "sl", targetField: "tp", confidenceField: "conv" },
      { maxAgeSeconds: 300, maxBodyKb: 256 },
    );
    const body = JSON.stringify({ ticker: "btc-usd", side: "SELL", px: 64000, sl: 65500, tp: 60000, conv: 0.4 });
    const request = textRequest(body, { "x-webhook-token": "fixture-provider-secret" });
    const verification = await adapter.verify(request);
    expect(verification.valid).toBe(true);
    const event = await adapter.parse(request, verification);
    const signal = adapter.normalize(event!, ctx);
    expect(signal.symbol).toBe("BTC-USD");
    expect(signal.direction).toBe("short");
    expect(signal.entryPrice).toBe(64000);
    expect(signal.stopPrice).toBe(65500);
    expect(signal.targetPrice).toBe(60000);
    expect(signal.providerConfidence).toBe(0.4);
  });

  test("manual adapter records attribution in metadata", async () => {
    const adapter = new ManualSignalAdapter();
    const fields = { symbol: "SPY", direction: "long", price: 580, stop: 570, target: 600, reason: "operator judgment" };
    const event = await adapter.parse(
      {
        providerId: "manual",
        rawBody: new TextEncoder().encode(JSON.stringify(fields)),
        headers: { "__market_manual__": JSON.stringify(fields) },
        receivedAt: ctx.receivedAt,
        actor: { type: "user", id: "admin" },
      },
      { valid: true },
    );
    const signal = adapter.normalize(event!, ctx);
    expect(signal.provider).toBe("manual");
    expect(signal.metadata.manual).toBe(true);
    expect(signal.metadata.manualReason).toBe("operator judgment");
  });
});

describe("Phase 20.52 — signal lifecycle state machine", () => {
  test("allowed transitions pass; arbitrary jumps throw", () => {
    expect(canTransition("RECEIVED", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "FAILED_VERIFICATION")).toBe(true);
    expect(canTransition("PAPER_EXECUTED", "CLOSED")).toBe(true);
    expect(canTransition("RECEIVED", "APPROVED")).toBe(false);
    expect(canTransition("DUPLICATE", "VERIFIED")).toBe(false);
    expect(() => requireTransition("CLOSED", "ANALYZING")).toThrow(/MARKET_LIFECYCLE_INVALID_TRANSITION/);
    expect(lifecycleSuccessors("AWAITING_APPROVAL")).toEqual(["APPROVED", "REJECTED", "EXPIRED"]);
  });

  test("terminal states have no successors", () => {
    for (const terminal of ["FAILED_VERIFICATION", "DUPLICATE", "RISK_REJECTED", "REJECTED", "EXPIRED", "CLOSED"] as const) {
      expect(lifecycleSuccessors(terminal)).toEqual([]);
    }
  });
});
