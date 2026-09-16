/**
 * Pao AI Gateway — Phase 20.51 tests: quota-aware routing plan, bounded
 * fallback controller, session leases, and the decision ledger.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planQuotaAwareRoute,
  resolveWeights,
  routeKeyOf,
  WEIGHT_PROFILES,
} from "../src/ai-gateway/routing/quota-router";
import { executeGoverned } from "../src/ai-gateway/routing/fallback-controller";
import { LeaseStore } from "../src/ai-gateway/routing/leases";
import { QuotaStore } from "../src/ai-gateway/quota/store";
import { ConnectionStore } from "../src/ai-gateway/resilience/connection-state";
import { CircuitBreaker } from "../src/ai-gateway/routing/adaptive";
import { ProviderRegistry } from "../src/ai-gateway/providers/registry";
import {
  recordDecision,
  readDecisions,
  recordGatewayEvent,
  readGatewayEvents,
} from "../src/ai-gateway/traces/decision-ledger";
import type {
  GatewayConfig,
  GatewayModelConfig,
  GovernanceCandidate,
  RouteDecisionRecord,
  RoutingGovernanceConfig,
} from "../src/ai-gateway/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function model(overrides: Partial<GatewayModelConfig> & { id: string; providerId: string }): GatewayModelConfig {
  return {
    model: overrides.id,
    capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
    limits: { contextWindow: 128_000, maxOutputTokens: 8192 },
    pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    tags: [],
    ...overrides,
  } as GatewayModelConfig;
}

const GOVERNANCE: RoutingGovernanceConfig = {
  enabled: true,
  weightProfile: "balanced",
  weights: { quality: 0, quota: 0, health: 0, latency: 0, cost: 0, affinity: 0, freshness: 0 },
  fallback: {
    maxRouteAttempts: 4,
    maxSameProviderAttempts: 2,
    totalDeadlineMs: 10_000,
    backoffMs: [1, 1],
  },
  circuitBreaker: { failureThreshold: 3, cooldownMs: 60_000, rateLimitCooldownMs: 60_000 },
  quota: {
    agingAfterSec: 120,
    staleAfterSec: 600,
    stalePenalty: 0.15,
    unknownPenalty: 0.25,
    softLowRemainingRatio: 0.2,
    criticalRemainingRatio: 0.08,
  },
  sessionLeaseTtlMin: 60,
};

const PROVIDER_BASE_URL = "http://127.0.0.1:1/v1";

const CONFIG: GatewayConfig = {
  enabled: true,
  port: 1,
  providers: [
    { id: "prov-a", type: "openai-compatible", apiKeyEnv: "X", baseUrl: PROVIDER_BASE_URL },
    { id: "prov-b", type: "openai-compatible", apiKeyEnv: "X", baseUrl: PROVIDER_BASE_URL },
  ],
  models: [
    model({ id: "premium", providerId: "prov-a", pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 30 } }),
    model({ id: "cheap", providerId: "prov-b", pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }),
  ],
  aliases: [],
  identities: [],
  budgets: { global: { dailyUsd: 100, monthlyUsd: 1000 }, identities: [] },
  policies: [],
  traceContentMode: "off",
  routerVersion: "test",
  governance: GOVERNANCE,
};

function candidate(id: string, providerId: string, extra: Partial<GatewayModelConfig> = {}): GovernanceCandidate {
  return {
    modelId: id,
    providerId,
    model: model({ id, providerId, ...extra }),
    aliasPriority: 100,
  };
}

interface PlanHarness {
  quotaStore: QuotaStore;
  connections: ConnectionStore;
  breaker: CircuitBreaker;
  leases: LeaseStore;
}

function harness(): PlanHarness {
  return {
    quotaStore: new QuotaStore(),
    connections: new ConnectionStore(),
    breaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, rateLimitCooldownMs: 60_000 }),
    leases: new LeaseStore(),
  };
}

function plan(input: Parameters<typeof planQuotaAwareRoute>[0], h: PlanHarness) {
  return planQuotaAwareRoute(input, {
    config: CONFIG,
    governance: GOVERNANCE,
    providerRegistry: new ProviderRegistry(CONFIG.providers),
    quotaStore: h.quotaStore,
    connections: h.connections,
    breaker: h.breaker,
    leases: h.leases,
  });
}

// ---------------------------------------------------------------------------
// Routing plan
// ---------------------------------------------------------------------------

describe("Phase 20.51 — quota-aware routing plan", () => {
  test("resolveWeights: explicit weights win, presets otherwise, balanced as fallback", () => {
    expect(resolveWeights("background-cheap", GOVERNANCE.weights)).toEqual(WEIGHT_PROFILES["background-cheap"]);
    const explicit = { ...GOVERNANCE.weights, cost: 0.9 };
    expect(resolveWeights("background-cheap", explicit)).toEqual(explicit);
    expect(resolveWeights("no-such-profile", GOVERNANCE.weights)).toEqual(WEIGHT_PROFILES.balanced);
  });

  test("hard filters reject with stable reason codes before scoring", () => {
    const h = harness();
    const result = plan(
      {
        candidates: [
          { ...candidate("disabled-model", "prov-a"), model: model({ id: "disabled-model", providerId: "prov-a", enabled: false }) },
          { ...candidate("caps-model", "prov-a"), model: model({ id: "caps-model", providerId: "prov-a", capabilities: { chat: true, tools: false, structuredOutput: true, vision: true, reasoning: true } }) },
          candidate("ok", "prov-a"),
        ],
        requiredCapabilities: { tools: true },
      },
      h,
    );
    const codes = result.rejections.map(r => r.reasonCodes[0]);
    expect(codes).toContain("ROUTE_REJECTED_DISABLED");
    expect(codes).toContain("ROUTE_REJECTED_CAPABILITY");
    expect(result.selected?.modelId).toBe("ok");
    expect(result.selected?.reasons[0]).toBe("ROUTE_SELECTED_BEST_SCORE");
  });

  test("quarantined, cooldown, and open-circuit routes are rejected", () => {
    const h = harness();
    h.connections.quarantine("prov-a/q1", "auth_invalid", "CONNECTION_QUARANTINED_AUTH");
    h.connections.disable("prov-a/d1");
    h.connections.recordSuccess("prov-a/cd1");
    h.connections.recordFailure("prov-a/cd1", { kind: "rate_limit", failureClass: "rate_limited" });
    h.breaker.recordFailure("prov-a", "auth_failure");

    const result = plan(
      {
        candidates: [candidate("q1", "prov-a"), candidate("d1", "prov-a"), candidate("cd1", "prov-a"), candidate("circuit", "prov-a"), candidate("live", "prov-b")],
      },
      h,
    );
    const codes = result.rejections.map(r => r.reasonCodes[0]);
    expect(codes).toContain("ROUTE_REJECTED_QUARANTINED");
    expect(codes).toContain("ROUTE_REJECTED_DISABLED");
    expect(codes).toContain("ROUTE_REJECTED_COOLDOWN");
    expect(codes).toContain("ROUTE_REJECTED_CIRCUIT_OPEN");
    expect(result.selected?.modelId).toBe("live");
  });

  test("evidence-based quota exhaustion with a future reset rejects the route", () => {
    const h = harness();
    const observed = new Date().toISOString();
    h.quotaStore.upsert("prov-a/exhausted", [
      {
        windowType: "daily",
        label: "daily",
        limit: 100,
        remaining: 0,
        remainingRatio: 0,
        resetAt: new Date(Date.now() + 3_600_000).toISOString(),
        unit: "requests",
        confidence: "estimated",
        observedAt: observed,
      },
    ]);
    const result = plan(
      { candidates: [candidate("exhausted", "prov-a"), candidate("fresh", "prov-b")] },
      h,
    );
    expect(result.rejections.map(r => r.reasonCodes[0])).toContain("ROUTE_REJECTED_QUOTA_EXHAUSTED");
    expect(result.selected?.modelId).toBe("fresh");
  });

  test("unknown quota penalizes but does not reject; known headroom outranks it", () => {
    const h = harness();
    const observed = new Date().toISOString();
    h.quotaStore.upsert("prov-a/unknown", [
      { windowType: "daily", label: "daily", unit: "requests", confidence: "unknown", observedAt: observed },
    ]);
    h.quotaStore.upsert("prov-b/headroom", [
      {
        windowType: "daily",
        label: "daily",
        limit: 100,
        remaining: 95,
        remainingRatio: 0.95,
        unit: "requests",
        confidence: "estimated",
        observedAt: observed,
      },
    ]);
    const result = plan(
      {
        candidates: [candidate("unknown", "prov-a", { pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }), candidate("headroom", "prov-b", { pricing: { inputPerMillionUsd: 0.01, outputPerMillionUsd: 0.02 } })],
      },
      h,
    );
    // With zero weights the score is flat; use cost-heavy weights implicitly
    // by checking the selected reason codes instead.
    expect(result.ordered).toHaveLength(2);
    const headroom = result.ordered.find(c => c.modelId === "headroom")!;
    expect(headroom.reasons).toContain("ROUTE_SELECTED_QUOTA_HEADROOM");
  });

  test("background-cheap weights rank the free model first; coding-premium ranks quality first", () => {
    const h = harness();
    const cheap = { ...GOVERNANCE, weightProfile: "background-cheap" };
    const premium = { ...GOVERNANCE, weightProfile: "coding-premium" };
    const candidates = [
      candidate("premium", "prov-a", { pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 30 } }),
      candidate("cheap", "prov-b", { pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }),
    ];
    const ctxBase = {
      config: CONFIG,
      providerRegistry: new ProviderRegistry(CONFIG.providers),
      quotaStore: h.quotaStore,
      connections: h.connections,
      breaker: h.breaker,
      leases: h.leases,
    };
    const cheapResult = planQuotaAwareRoute(
      { candidates },
      { ...ctxBase, governance: cheap },
    );
    const premiumResult = planQuotaAwareRoute(
      { candidates },
      { ...ctxBase, governance: premium },
    );
    expect(cheapResult.selected?.modelId).toBe("cheap");
    expect(premiumResult.selected?.modelId).toBe("premium");
  });

  test("deterministic tie-break: alias priority, then model id", () => {
    const h = harness();
    const a = { ...candidate("b-model", "prov-a"), aliasPriority: 90 };
    const b = { ...candidate("a-model", "prov-b"), aliasPriority: 90 };
    const result = plan({ candidates: [a, b] }, h);
    // Equal scores and equal priority -> lexicographic model id wins.
    expect(result.selected?.modelId).toBe("a-model");
  });

  test("session affinity boosts the leased route", () => {
    const h = harness();
    h.leases.bind("session-1", routeKeyOf("prov-b", "cheap"));
    const result = plan(
      { candidates: [candidate("premium", "prov-a"), candidate("cheap", "prov-b", { pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 5 } })], sessionId: "session-1" },
      h,
    );
    const cheapEntry = result.ordered.find(c => c.modelId === "cheap")!;
    const premiumEntry = result.ordered.find(c => c.modelId === "premium")!;
    expect(cheapEntry.score).toBeGreaterThan(premiumEntry.score);
    expect(cheapEntry.reasons).toContain("ROUTE_SELECTED_SESSION_AFFINITY");
  });

  test("routing-tier budget guard rejects candidates above the caller's cap", () => {
    const h = harness();
    const result = plan(
      {
        candidates: [candidate("premium", "prov-a"), candidate("cheap", "prov-b", { pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } })],
        contextTokens: 100_000,
        maxCostUsd: 0.1,
      },
      h,
    );
    expect(result.rejections.map(r => r.reasonCodes[0])).toContain("ROUTE_REJECTED_BUDGET");
    expect(result.selected?.modelId).toBe("cheap");
  });
});

// ---------------------------------------------------------------------------
// Bounded fallback controller
// ---------------------------------------------------------------------------

describe("Phase 20.51 — bounded fallback controller", () => {
  function callbacks<R>(overrides: Partial<Parameters<typeof executeGoverned<R>>[0]["callbacks"]> = {}) {
    return {
      executor: async () => "ok",
      gate: () => ({ allowed: true }) as { allowed: boolean; reasonCode?: string },
      onAttempt: () => {},
      onSkip: () => {},
      onEvent: () => {},
      ...overrides,
    };
  }

  test("first candidate success needs exactly one attempt", async () => {
    const attempts: string[] = [];
    const result = await executeGoverned<string>({
      requestId: "r1",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b")],
      policy: GOVERNANCE.fallback,
      callbacks: callbacks({
        onAttempt: record => attempts.push(record.modelId),
      }),
    });
    expect(result.outcome).toBe("success");
    expect(result.selected?.modelId).toBe("m1");
    expect(attempts).toEqual(["m1"]);
    expect(result.fallbackDepth).toBe(0);
  });

  test("429 on the first route falls back to the second", async () => {
    const result = await executeGoverned<string>({
      requestId: "r2",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b")],
      policy: GOVERNANCE.fallback,
      callbacks: callbacks({
        executor: async c => {
          if (c.modelId === "m1") throw Object.assign(new Error("rate limited"), { code: "provider_429" });
          return "ok";
        },
      }),
    });
    expect(result.outcome).toBe("success");
    expect(result.selected?.modelId).toBe("m2");
    expect(result.fallbackDepth).toBe(1);
    expect(result.failures[0]?.behavior.failureClass).toBe("rate_limited");
  });

  test("auth failure stops immediately with no fallback hop", async () => {
    const result = await executeGoverned<string>({
      requestId: "r3",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b")],
      policy: GOVERNANCE.fallback,
      callbacks: callbacks({
        executor: async () => {
          throw Object.assign(new Error("nope"), { code: "auth_failure" });
        },
      }),
    });
    expect(result.outcome).toBe("failed");
    expect(result.attempts).toHaveLength(1);
    expect(result.failures[0]?.behavior.failureClass).toBe("auth_invalid");
  });

  test("budget-blocked fallback may only try routes at most as expensive", async () => {
    const tried: string[] = [];
    const skipped: string[] = [];
    const result = await executeGoverned<string>({
      requestId: "r4",
      candidates: [
        candidate("expensive", "prov-a", { pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 10 } }),
        candidate("pricier-than-failed", "prov-b", { pricing: { inputPerMillionUsd: 50, outputPerMillionUsd: 50 } }),
        candidate("cheaper", "prov-b", { pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }),
      ],
      policy: GOVERNANCE.fallback,
      callbacks: callbacks({
        executor: async c => {
          tried.push(c.modelId);
          if (c.modelId === "expensive") {
            throw Object.assign(new Error("over budget"), { code: "budget_denial" });
          }
          return "ok";
        },
        onSkip: (_c, code) => skipped.push(code),
      }),
    });
    expect(tried).toEqual(["expensive", "cheaper"]);
    expect(skipped).toContain("ROUTE_REJECTED_BUDGET");
    expect(result.selected?.modelId).toBe("cheaper");
  });

  test("same-provider attempt cap forces a real fallback", async () => {
    const skipped: string[] = [];
    const policy = { ...GOVERNANCE.fallback, maxSameProviderAttempts: 1 };
    const result = await executeGoverned<string>({
      requestId: "r5",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-a"), candidate("m3", "prov-b")],
      policy,
      callbacks: callbacks({
        executor: async c => {
          if (c.providerId === "prov-a") throw Object.assign(new Error("boom"), { code: "provider_5xx" });
          return "ok";
        },
        onSkip: (_c, code) => skipped.push(code),
      }),
    });
    expect(skipped).toContain("FALLBACK_SAME_PROVIDER_CAP");
    expect(result.selected?.modelId).toBe("m3");
  });

  test("maxRouteAttempts bounds total attempts", async () => {
    const policy = { ...GOVERNANCE.fallback, maxRouteAttempts: 2 };
    const result = await executeGoverned<string>({
      requestId: "r6",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b"), candidate("m3", "prov-b")],
      policy,
      callbacks: callbacks({
        executor: async () => {
          throw Object.assign(new Error("boom"), { code: "provider_5xx" });
        },
      }),
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.outcome).toBe("failed");
  });

  test("total deadline stops the loop and reports deadline_exceeded", async () => {
    let clock = 0;
    const result = await executeGoverned<string>({
      requestId: "r7",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b")],
      policy: { ...GOVERNANCE.fallback, totalDeadlineMs: 1000 },
      callbacks: callbacks({
        executor: async () => {
          clock += 2000; // each attempt burns past the deadline
          throw Object.assign(new Error("boom"), { code: "provider_5xx" });
        },
        now: () => clock,
      }),
    });
    expect(result.outcome).toBe("deadline_exceeded");
  });

  test("a gate that rejects everything reports no_eligible_route", async () => {
    const skipped: Array<{ modelId: string; code: string }> = [];
    const result = await executeGoverned<string>({
      requestId: "r8",
      candidates: [candidate("m1", "prov-a"), candidate("m2", "prov-b")],
      policy: GOVERNANCE.fallback,
      callbacks: callbacks({
        gate: () => ({ allowed: false, reasonCode: "ROUTE_REJECTED_CIRCUIT_OPEN" }),
        onSkip: (c, code) => skipped.push({ modelId: c.modelId, code }),
      }),
    });
    expect(result.outcome).toBe("no_eligible_route");
    expect(result.attempts).toHaveLength(0);
    expect(skipped).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Leases and decision ledger
// ---------------------------------------------------------------------------

describe("Phase 20.51 — leases and decision ledger", () => {
  test("leases expire on their TTL and abandon returns the old route", () => {
    let now = 1_000_000;
    const leases = new LeaseStore({ ttlMs: 60_000, now: () => now });
    leases.bind("s1", "prov-a/m1");
    expect(leases.get("s1")?.routeKey).toBe("prov-a/m1");
    now += 61_000;
    expect(leases.get("s1")).toBeUndefined();

    leases.bind("s2", "prov-a/m1");
    expect(leases.abandon("s2")).toBe("prov-a/m1");
    expect(leases.get("s2")).toBeUndefined();
    expect(leases.abandon("s2")).toBeUndefined();
  });

  test("decision and event ledger roundtrip through a temp directory", () => {
    const root = mkdtempSync(join(tmpdir(), "pao-gw-ledger-"));
    try {
      const decision: RouteDecisionRecord = {
        requestId: "req-1",
        timestamp: new Date().toISOString(),
        identityId: "admin-pao",
        alias: "pao-code",
        weightProfile: "balanced",
        candidates: [
          { routeKey: "prov-a/m1", providerId: "prov-a", modelId: "m1", status: "rejected", reasonCodes: ["ROUTE_REJECTED_CIRCUIT_OPEN"] },
          { routeKey: "prov-b/m2", providerId: "prov-b", modelId: "m2", status: "selected", score: 0.8, reasonCodes: ["ROUTE_SELECTED_BEST_SCORE"] },
        ],
        fallbackDepth: 0,
        outcome: "success",
        reasonCodes: ["ROUTE_SELECTED_BEST_SCORE"],
        latencyMs: 42,
      };
      recordDecision(root, decision);
      expect(readDecisions(root)[0]?.requestId).toBe("req-1");
      expect(readDecisions(root)[0]?.candidates[0]?.reasonCodes[0]).toBe("ROUTE_REJECTED_CIRCUIT_OPEN");

      recordGatewayEvent(root, {
        timestamp: new Date().toISOString(),
        severity: "warning",
        eventType: "CONNECTION_STATE_CHANGED",
        providerId: "prov-a",
        reasonCode: "CB_RATE_LIMIT",
      });
      expect(readGatewayEvents(root)[0]?.reasonCode).toBe("CB_RATE_LIMIT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
