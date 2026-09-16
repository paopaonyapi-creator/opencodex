/**
 * Pao AI Gateway — Phase 20.51 tests: 9Router adapter, quota model, quota store.
 *
 * Uses a local mock 9Router surface. No real upstream calls, no spend.
 */

import { describe, test, expect, afterAll } from "bun:test";
import {
  classifyFreshness,
  normalizeQuotaRecord,
  normalizeQuotaPayload,
  selectPrimaryWindow,
  quotaHeadroomScore,
  quotaUncertaintyPenalty,
} from "../src/ai-gateway/quota/model";
import { QuotaStore } from "../src/ai-gateway/quota/store";
import { NineRouterProvider, NINE_ROUTER_DEFAULT_BASE_URL } from "../src/ai-gateway/providers/nine-router";

// ---------------------------------------------------------------------------
// Mock 9Router gateway
// ---------------------------------------------------------------------------

const MOCK_PORT = 19931;
let quotaPayload: unknown = { records: [] };
let versionPayload: unknown = { version: "9router-test-1" };
let quotaStatus = 200;

const mockServer = Bun.serve({
  port: MOCK_PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "gemini/gemini-test", owned_by: "gateway" }] });
    }
    if (url.pathname === "/v1/chat/completions") {
      return Response.json({
        id: "mock-1",
        object: "chat.completion",
        created: 1,
        model: "gemini/gemini-test",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    if (url.pathname.startsWith("/api/quotas")) {
      if (quotaStatus !== 200) return new Response("no", { status: quotaStatus });
      return Response.json(quotaPayload);
    }
    if (url.pathname.startsWith("/api/version")) {
      return Response.json(versionPayload);
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => {
  mockServer.stop(true);
});

// ---------------------------------------------------------------------------
// Quota model
// ---------------------------------------------------------------------------

describe("Phase 20.51 — quota normalization", () => {
  const OBSERVED = "2026-01-01T00:00:00.000Z";

  test("derives remainingRatio from remaining and limit", () => {
    const window = normalizeQuotaRecord({ limit: 100, remaining: 25, window: "daily" }, OBSERVED);
    expect(window.remainingRatio).toBe(0.25);
    expect(window.windowType).toBe("daily");
    expect(window.confidence).toBe("estimated");
  });

  test("interprets a bare percent field as percent used", () => {
    const window = normalizeQuotaRecord({ percent: 70, window: "weekly" }, OBSERVED);
    expect(window.remainingRatio).toBeCloseTo(0.3);
  });

  test("accepts a percent-remaining field above 1 as a 0-100 scale", () => {
    const window = normalizeQuotaRecord({ remaining_ratio: 40 }, OBSERVED);
    expect(window.remainingRatio).toBeCloseTo(0.4);
  });

  test("no numbers means unknown confidence and no ratio", () => {
    const window = normalizeQuotaRecord({ window: "daily" }, OBSERVED);
    expect(window.confidence).toBe("unknown");
    expect(window.remainingRatio).toBeUndefined();
  });

  test("parses epoch-seconds and epoch-milliseconds reset times", () => {
    const sec = normalizeQuotaRecord({ limit: 10, remaining: 5, reset: 1767225600 }, OBSERVED);
    const ms = normalizeQuotaRecord({ limit: 10, remaining: 5, reset: 1767225600000 }, OBSERVED);
    expect(sec.resetAt).toBe(ms.resetAt);
  });

  test("unknown quota is never scored as headroom", () => {
    const unknownWindow = normalizeQuotaRecord({ window: "daily" }, OBSERVED);
    expect(quotaHeadroomScore(unknownWindow)).toBe(0);
    expect(quotaHeadroomScore(undefined)).toBe(0);
  });

  test("absent or unknown window applies the unknown penalty; fresh windows do not", () => {
    const policy = { staleAfterSec: 600, stalePenalty: 0.15, unknownPenalty: 0.25 };
    expect(quotaUncertaintyPenalty(undefined, policy)).toBe(0.25);
    expect(quotaUncertaintyPenalty(normalizeQuotaRecord({}, OBSERVED), policy)).toBe(0.25);
    const fresh = normalizeQuotaRecord({ limit: 10, remaining: 5 }, new Date().toISOString());
    expect(quotaUncertaintyPenalty(fresh, policy)).toBe(0);
  });

  test("normalizeQuotaPayload reads arrays, wrappers, and keyed objects", () => {
    const observed = OBSERVED;
    const fromArray = normalizeQuotaPayload(
      [{ provider: "antigravity", model: "gemini-test", limit: 10, remaining: 4, window: "daily" }],
      observed,
    );
    expect(fromArray).toHaveLength(1);
    expect(fromArray[0]!.routeKeyHint).toBe("antigravity/gemini-test");

    const fromWrapper = normalizeQuotaPayload({ records: [{ model: "m1", limit: 5, remaining: 5 }] }, observed);
    expect(fromWrapper).toHaveLength(1);

    const fromKeyed = normalizeQuotaPayload(
      { "prov/m1": { limit: 5, remaining: 1, resetAt: "2026-01-02T00:00:00Z" } },
      observed,
    );
    expect(fromKeyed).toHaveLength(1);
    expect(fromKeyed[0]!.routeKeyHint).toBe("prov/m1");

    expect(normalizeQuotaPayload("garbage", observed)).toHaveLength(0);
    expect(normalizeQuotaPayload([{ no: "hints" }], observed)).toHaveLength(0);
  });

  test("selectPrimaryWindow prefers ratio-bearing, typed, confident windows", () => {
    const unknown = normalizeQuotaRecord({}, OBSERVED);
    const typed = normalizeQuotaRecord({ limit: 10, remaining: 5, window: "daily" }, OBSERVED);
    expect(selectPrimaryWindow([unknown, typed])?.remainingRatio).toBeDefined();
    expect(selectPrimaryWindow([])).toBeUndefined();
  });
});

describe("Phase 20.51 — quota freshness", () => {
  const policy = { agingAfterSec: 120, staleAfterSec: 600 };
  const NOW = Date.parse("2026-01-01T00:10:00.000Z");

  test("fresh under the aging threshold", () => {
    expect(classifyFreshness("2026-01-01T00:09:30.000Z", policy, () => NOW)).toBe("fresh");
  });

  test("aging between thresholds", () => {
    expect(classifyFreshness("2026-01-01T00:06:00.000Z", policy, () => NOW)).toBe("aging");
  });

  test("stale beyond the stale threshold", () => {
    expect(classifyFreshness("2026-01-01T00:00:00.000Z", policy, () => NOW)).toBe("stale");
  });

  test("missing or unparseable timestamps are unknown", () => {
    expect(classifyFreshness(undefined, policy, () => NOW)).toBe("unknown");
    expect(classifyFreshness("not-a-date", policy, () => NOW)).toBe("unknown");
  });
});

describe("Phase 20.51 — quota store", () => {
  test("falls back to the gateway-level key when the route has no data", () => {
    const store = new QuotaStore();
    const observed = new Date().toISOString();
    store.upsert("nine-router-gateway/_gateway", [
      normalizeQuotaRecord({ limit: 10, remaining: 5 }, observed),
    ]);
    expect(store.primary("nine-router-gateway/some-model")?.remainingRatio).toBeCloseTo(0.5);
    expect(store.primary("other-provider/some-model")).toBeUndefined();
  });

  test("upsert replaces the previous observation for a route", () => {
    const store = new QuotaStore();
    const observed = new Date().toISOString();
    store.upsert("p/m", [normalizeQuotaRecord({ limit: 10, remaining: 9 }, observed)]);
    store.upsert("p/m", [normalizeQuotaRecord({ limit: 10, remaining: 2 }, observed)]);
    expect(store.primary("p/m")?.remainingRatio).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// NineRouterProvider adapter
// ---------------------------------------------------------------------------

describe("Phase 20.51 — NineRouterProvider", () => {
  test("empty interpolated base URL falls back to the loopback default", () => {
    const provider = new NineRouterProvider({
      id: "nine-router-gateway",
      type: "nine-router",
      apiKeyEnv: "NINE_ROUTER_TEST_KEY",
      baseUrl: "",
    });
    // Exercised through telemetry probing: the default URL points at a port
    // with no listener, so the probe must resolve (not throw) with no data.
    return provider.getTelemetry().then(telemetry => {
      expect(telemetry.windows).toHaveLength(0);
      expect(telemetry.version).toBeNull();
      expect(NINE_ROUTER_DEFAULT_BASE_URL).toContain("20128");
    });
  });

  test("is configured on loopback without a key", () => {
    const provider = new NineRouterProvider({
      id: "nine-router-gateway",
      type: "nine-router",
      apiKeyEnv: "NINE_ROUTER_TEST_KEY",
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    });
    expect(provider.isConfigured()).toBe(true);
  });

  test("normalizes a readable quota surface and version", async () => {
    quotaPayload = {
      records: [
        { provider: "antigravity", model: "gemini-test", window: "daily", limit: 100, remaining: 80, reset: Date.now() + 3_600_000 },
      ],
    };
    versionPayload = { version: "v0.5.75-test" };
    quotaStatus = 200;
    const provider = new NineRouterProvider({
      id: "nine-router-gateway",
      type: "nine-router",
      apiKeyEnv: "NINE_ROUTER_TEST_KEY",
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    });
    const telemetry = await provider.getTelemetry();
    expect(telemetry.version).toBe("v0.5.75-test");
    expect(telemetry.windows).toHaveLength(1);
    expect(telemetry.windows[0]!.routeKeyHint).toBe("antigravity/gemini-test");
    expect(telemetry.windows[0]!.window.remainingRatio).toBeCloseTo(0.8);
  });

  test("a telemetry 404 is a normal outcome: empty windows, not an error", async () => {
    quotaStatus = 404;
    const provider = new NineRouterProvider({
      id: "nine-router-gateway",
      type: "nine-router",
      apiKeyEnv: "NINE_ROUTER_TEST_KEY",
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    });
    const telemetry = await provider.getTelemetry();
    expect(telemetry.windows).toHaveLength(0);
    expect(telemetry.version).toBe("v0.5.75-test");
    quotaStatus = 200;
  });

  test("inherits the OpenAI-compatible chat path", async () => {
    const provider = new NineRouterProvider({
      id: "nine-router-gateway",
      type: "nine-router",
      apiKeyEnv: "NINE_ROUTER_TEST_KEY",
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    });
    const response = await provider.chat({
      model: "gemini/gemini-test",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.object).toBe("chat.completion");
  });

  test("maps upstream 429 onto the legacy provider_429 code", async () => {
    const failing = Bun.serve({
      port: MOCK_PORT + 1,
      fetch() {
        return new Response("rate limited", { status: 429 });
      },
    });
    try {
      const provider = new NineRouterProvider({
        id: "nine-router-gateway",
        type: "nine-router",
        apiKeyEnv: "NINE_ROUTER_TEST_KEY",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
      });
      expect(
        provider.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }).catch(err => err.code),
      ).resolves.toBe("provider_429");
    } finally {
      failing.stop(true);
    }
  });
});
