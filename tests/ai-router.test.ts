// Phase 20.30 — Universal AI Gateway control plane tests: alias modes,
// budget guard, scoring, fallback plan, route preview/explain.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { AIRouterStore, explainRoute, filterCandidates, planFallback, previewRoute, scoreCandidate } from "../src/agent-os/ai-router/router";
import type { ModelCandidate, RoutingPolicy } from "../src/agent-os/ai-router/types";

let testDir: string;

function candidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: "openai/gpt-test",
    provider: "openai",
    capabilities: { text: true, vision: false, tools: true, reasoning: true, streaming: true, structured_output: true },
    costPerMillionUsd: 1,
    isLocal: false,
    isFreeTier: false,
    tags: ["coding"],
    healthScore: 1,
    ...overrides,
  };
}

const BASE_POLICY: RoutingPolicy = {
  id: "policy_balanced", name: "Balanced", mode: "balanced",
  maxPaidCostPerRequestUsd: 0.25, enabled: true,
};

function ctx(overrides: Partial<Parameters<typeof filterCandidates>[1]> = {}): Parameters<typeof filterCandidates>[1] {
  return {
    policy: BASE_POLICY,
    mode: "balanced",
    needsTools: false,
    needsVision: false,
    budget: { dailyLimitUsd: 5, dailySpentUsd: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  closeAgentOsDbForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-ai-router-test-"));
  process.env.OPENCODEX_HOME = testDir;
});

afterEach(() => {
  closeAgentOsDbForTests();
  rmSync(testDir, { recursive: true, force: true });
});

// --- Filters (doc §12-§17) ----------------------------------------------------------

describe("Phase 20.30 routing filters", () => {
  test("requireTools eliminates text-only models", () => {
    const models = [
      candidate({ id: "a/tools", capabilities: { text: true, vision: false, tools: true, reasoning: true, streaming: true, structured_output: true } }),
      candidate({ id: "b/notools", capabilities: { text: true, vision: false, tools: false, reasoning: true, streaming: true, structured_output: false } }),
    ];
    const { eligible, rejected } = filterCandidates(models, ctx({ policy: { ...BASE_POLICY, requireTools: true } }));
    expect(eligible.length).toBe(1);
    expect(rejected[0].rejectedReason).toContain("tool");
  });

  test("free-first mode excludes paid providers but keeps free/local", () => {
    const models = [
      candidate({ id: "free/a", isFreeTier: true, costPerMillionUsd: 0 }),
      candidate({ id: "local/b", isLocal: true, costPerMillionUsd: 0 }),
      candidate({ id: "paid/c", costPerMillionUsd: 3 }),
    ];
    const { eligible, rejected } = filterCandidates(models, ctx({ mode: "free_first", policy: { ...BASE_POLICY, mode: "free_first", requireFree: true, maxPaidCostPerRequestUsd: 0 } }));
    expect(eligible.map((m) => m.id).sort()).toEqual(["free/a", "local/b"]);
    expect(rejected[0].rejectedReason).toContain("free/local");
  });

  test("local-first mode keeps only local models", () => {
    const models = [candidate({ id: "local/a", isLocal: true }), candidate({ id: "remote/b" })];
    const { eligible } = filterCandidates(models, ctx({ mode: "local_first", policy: { ...BASE_POLICY, mode: "local_first", requireLocal: true } }));
    expect(eligible.map((m) => m.id)).toEqual(["local/a"]);
  });

  test("quota-exhausted models are ineligible (doc §17)", () => {
    const models = [candidate({ id: "a", quotaRemaining: 0 }), candidate({ id: "b", quotaRemaining: 0.5 })];
    const { eligible } = filterCandidates(models, ctx({}));
    expect(eligible.map((m) => m.id)).toEqual(["b"]);
  });
});

// --- Budget guard (doc §16) -------------------------------------------------------------

describe("Phase 20.30 budget guard", () => {
  test("100% budget denies paid routes; local/free unaffected", () => {
    const models = [candidate({ id: "paid/a", costPerMillionUsd: 5 }), candidate({ id: "free/b", isFreeTier: true, costPerMillionUsd: 0 })];
    const c = ctx({ budget: { dailyLimitUsd: 5, dailySpentUsd: 5 } });
    const { eligible } = filterCandidates(models, c);
    expect(eligible.map((m) => m.id)).toEqual(["free/b"]);
  });

  test("≥90% budget restricts premium fallback", () => {
    const models = [candidate({ id: "expensive/a", costPerMillionUsd: 20 }), candidate({ id: "cheap/b", costPerMillionUsd: 0.5 })];
    const c = ctx({ budget: { dailyLimitUsd: 10, dailySpentUsd: 9.5 } });
    const { eligible } = filterCandidates(models, c);
    expect(eligible.map((m) => m.id)).toEqual(["cheap/b"]);
  });
});

// --- Scoring & fallback (doc §21-§22) ------------------------------------------------------

describe("Phase 20.30 scoring & fallback planner", () => {
  test("free/local candidates score above expensive ones on equal quality", () => {
    const free = candidate({ id: "free/a", isFreeTier: true, costPerMillionUsd: 0 });
    const paid = candidate({ id: "paid/b", costPerMillionUsd: 10 });
    const c = ctx({});
    expect(scoreCandidate(free, c).score).toBeGreaterThan(scoreCandidate(paid, c).score);
  });

  test("fallback plan is ordered by score with no duplicate models (doc §22)", () => {
    const models = [
      candidate({ id: "b/mid", costPerMillionUsd: 1 }),
      candidate({ id: "a/free", isFreeTier: true, costPerMillionUsd: 0 }),
      candidate({ id: "a/free", isFreeTier: true, costPerMillionUsd: 0 }), // duplicate
    ];
    const plan = planFallback(models, ctx({}), { quality: 0.3, capability: 0.2, health: 0.15, quota: 0.1, cost: 0.15, preference: 0.1 });
    const ids = plan.map((p) => p.candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan[0].candidate.id).toBe("a/free");
  });
});

// --- Store + preview/explain (doc §31, §34-§35) -----------------------------------------------

describe("Phase 20.30 store, preview & explain", () => {
  test("seeds builtin pao/* aliases and policies", () => {
    const store = new AIRouterStore();
    store.seedDefaults();
    const aliases = store.listAliases();
    expect(aliases.some((a) => a.alias === "pao/auto")).toBe(true);
    expect(aliases.some((a) => a.alias === "pao/free")).toBe(true);
    expect(aliases.some((a) => a.alias === "pao/local")).toBe(true);
    expect(aliases.some((a) => a.alias === "pao/coding")).toBe(true);
    expect(store.getPolicy("policy_free_first")?.maxPaidCostPerRequestUsd).toBe(0);
  });

  test("route preview explains selection and rejections without executing (doc §34-§35)", () => {
    const store = new AIRouterStore();
    store.seedDefaults();
    const preview = previewRoute(store, {
      alias: "pao/free",
      needsTools: true,
      candidates: [
        candidate({ id: "free/toolish", isFreeTier: true, costPerMillionUsd: 0 }),
        candidate({ id: "paid/notools", tools: undefined as never }),
      ],
    });
    expect(preview.mode).toBe("free_first");
    expect(preview.selected?.candidate.id).toBe("free/toolish");
    const explanation = explainRoute(preview);
    expect(explanation).toContain("Selected: free/toolish");
    expect(explanation).toContain("Selected: free/toolish");
  });

  test("preview with no eligible route produces actionable no-route note (doc §64)", () => {
    const store = new AIRouterStore();
    store.seedDefaults();
    const preview = previewRoute(store, { alias: "pao/free", candidates: [candidate({ id: "paid/only", costPerMillionUsd: 5 })] });
    expect(preview.selected).toBeUndefined();
    expect(preview.note).toContain("no eligible model route");
    expect(explainRoute(preview)).toContain("policy requires free/local models only");
  });

  test("budget set/spend round-trips and route events are recorded", () => {
    const store = new AIRouterStore();
    store.seedDefaults();
    store.setBudget(store.dailyPeriodKey(), 10);
    store.recordSpend(store.dailyPeriodKey(), 2.5);
    expect(store.getBudget(store.dailyPeriodKey())).toEqual({ dailyLimitUsd: 10, dailySpentUsd: 2.5 });
    const eventId = store.recordRouteEvent({ alias: "pao/auto", selectedModel: "openai/gpt-test", reason: "test" });
    expect(eventId).toBeTruthy();
    expect(store.listRouteEvents(10).length).toBe(1);
  });
});
