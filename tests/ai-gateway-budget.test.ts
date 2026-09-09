/**
 * Pao AI Gateway — Budget and Cost Ceiling Tests.
 *
 * Enforces Phase 20.13 budget guardrails:
 * - Hard ceilings: no automation, retry, fallback, or admin convenience bypass
 * - Unknown pricing = fail closed (never assumed free)
 * - Free/local models correctly bypass budget
 * - Identity isolation in spend tracking
 * - Per-request, daily, and monthly ceiling enforcement
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  checkBudget,
  estimateRequestCost,
  estimateTokens,
  recordSpend,
  getSpendSummary,
  getGlobalSpendSummary,
  _resetAllSpend,
} from "../src/ai-gateway/auth/budget";
import type {
  GatewayBudgetConfig,
  GatewayIdentity,
  GatewayModelConfig,
  NormalizedChatRequest,
} from "../src/ai-gateway/types";

const PAID_MODEL: GatewayModelConfig = {
  id: "model-paid",
  providerId: "openai",
  model: "gpt-4o",
  capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
  limits: { contextWindow: 128000, maxOutputTokens: 4096 },
  pricing: { inputPerMillionUsd: 5.0, outputPerMillionUsd: 15.0 },
  tags: ["production"],
};

const EXPENSIVE_MODEL: GatewayModelConfig = {
  id: "model-expensive",
  providerId: "openai",
  model: "o1",
  capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
  limits: { contextWindow: 200000, maxOutputTokens: 32768 },
  pricing: { inputPerMillionUsd: 15.0, outputPerMillionUsd: 60.0 },
  tags: ["reasoning"],
};

const FREE_MODEL: GatewayModelConfig = {
  id: "model-free",
  providerId: "local",
  model: "llama-3-8b",
  capabilities: { chat: true, tools: false, structuredOutput: false, vision: false, reasoning: false },
  limits: { contextWindow: 8192, maxOutputTokens: 2048 },
  pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  tags: ["local", "free"],
};

const UNPRICED_MODEL: GatewayModelConfig = {
  id: "model-unpriced",
  providerId: "custom",
  model: "experimental-model",
  capabilities: { chat: true, tools: false, structuredOutput: false, vision: false, reasoning: false },
  limits: { contextWindow: null, maxOutputTokens: null },
  pricing: { inputPerMillionUsd: null, outputPerMillionUsd: null },
  tags: ["beta"],
};

const IDENTITY_DEVELOPER: GatewayIdentity = {
  id: "dev-alex",
  name: "Alex Dev",
  allowedAliases: ["pao-fast", "pao-code"],
  maxRequestUsd: 0.50,
  maxDailyUsd: 5.00,
  maxMonthlyUsd: 50.00,
};

const IDENTITY_PIPELINE: GatewayIdentity = {
  id: "ci-pipeline",
  name: "CI Automated Pipeline",
  allowedAliases: ["pao-fast"],
  maxRequestUsd: 0.20,
  maxDailyUsd: 2.00,
  maxMonthlyUsd: 20.00,
};

const BUDGET_CONFIG: GatewayBudgetConfig = {
  global: { dailyUsd: 20.00, monthlyUsd: 300.00 },
  identities: [
    { identityId: "dev-alex", dailyUsd: 5.00, monthlyUsd: 50.00, perRequestUsd: 0.50 },
    { identityId: "ci-pipeline", dailyUsd: 2.00, monthlyUsd: 20.00, perRequestUsd: 0.20 },
  ],
};

function makeReq(chars: number, maxTokens?: number): NormalizedChatRequest {
  return {
    model: "pao-fast",
    messages: [{ role: "user", content: "x".repeat(chars) }],
    maxTokens,
  };
}

describe("Pao AI Gateway — Budget Engine Invariants", () => {
  beforeEach(() => {
    _resetAllSpend();
  });

  describe("Token and Cost Estimation", () => {
    test("estimates tokens using ~4 chars per token rule", () => {
      const req = makeReq(400, 1000);
      const est = estimateTokens(req);
      expect(est.input).toBe(100);
      expect(est.output).toBe(1000);
    });

    test("defaults output tokens to 2048 when maxTokens not specified", () => {
      const req = makeReq(400);
      const est = estimateTokens(req);
      expect(est.output).toBe(2048);
    });

    test("estimateRequestCost calculates accurately for paid models", () => {
      // 1M input tokens @ $5.00/M + 1M output tokens @ $15.00/M = $20.00
      const cost = estimateRequestCost(PAID_MODEL, 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(20.00, 4);
    });

    test("estimateRequestCost returns 0 for free/local models", () => {
      const cost = estimateRequestCost(FREE_MODEL, 500_000, 500_000);
      expect(cost).toBe(0);
    });

    test("unknown pricing returns null (never assumed free)", () => {
      const cost = estimateRequestCost(UNPRICED_MODEL, 100, 100);
      expect(cost).toBeNull();
    });
  });

  describe("Fail-Closed Principle", () => {
    test("unpriced models are rejected immediately", () => {
      const res = checkBudget(IDENTITY_DEVELOPER, UNPRICED_MODEL, makeReq(100), BUDGET_CONFIG);
      expect(res.allowed).toBe(false);
      expect(res.denialReason).toBe("unknown_pricing");
      expect(res.estimatedCostUsd).toBeNull();
    });
  });

  describe("Ceiling Hierarchy Enforcement", () => {
    test("allows request well within all limits", () => {
      const res = checkBudget(IDENTITY_DEVELOPER, PAID_MODEL, makeReq(100, 50), BUDGET_CONFIG);
      expect(res.allowed).toBe(true);
      expect(res.estimatedCostUsd).toBeGreaterThan(0);
      expect(res.identityDailyRemaining).toBeDefined();
      expect(res.globalDailyRemaining).toBeDefined();
    });

    test("rejects request exceeding per-request ceiling", () => {
      // dev-alex per-request cap is $0.50
      // 200k chars = ~50k tokens. Output = 32768 tokens.
      // 50k * $15/M = $0.75; 32768 * $60/M = $1.966 -> Total ~$2.71 > $0.50
      const res = checkBudget(IDENTITY_DEVELOPER, EXPENSIVE_MODEL, makeReq(200_000, 32768), BUDGET_CONFIG);
      expect(res.allowed).toBe(false);
      expect(res.denialReason).toBe("per_request_exceeded");
    });

    test("rejects request exceeding identity daily ceiling", () => {
      // Record spend of $4.99 for dev-alex (cap is $5.00)
      recordSpend("dev-alex", 4.99);
      // Even a small request costing $0.05 will push it over
      const res = checkBudget(IDENTITY_DEVELOPER, PAID_MODEL, makeReq(4000, 2048), BUDGET_CONFIG);
      expect(res.allowed).toBe(false);
      expect(res.denialReason).toBe("identity_daily_exceeded");
      expect(res.identityDailyRemaining).toBeCloseTo(0.01, 2);
    });

    test("rejects request exceeding global daily ceiling", () => {
      // Global cap is $20.00. Spend $19.98 across system.
      recordSpend("ci-pipeline", 1.90);
      recordSpend("dev-alex", 4.80);
      // Simulate other usage
      recordSpend("other-service", 13.28);

      const res = checkBudget(IDENTITY_DEVELOPER, PAID_MODEL, makeReq(4000, 2048), BUDGET_CONFIG);
      expect(res.allowed).toBe(false);
      expect(res.denialReason).toBe("global_daily_exceeded");
    });

    test("free model bypasses all budget ceilings even when daily budget is exhausted", () => {
      recordSpend("dev-alex", 5.00); // 100% daily budget spent
      const res = checkBudget(IDENTITY_DEVELOPER, FREE_MODEL, makeReq(10_000), BUDGET_CONFIG);
      expect(res.allowed).toBe(true);
      expect(res.estimatedCostUsd).toBe(0);
    });
  });

  describe("Identity Isolation", () => {
    test("spend by Identity A does not decrement Identity B daily remaining budget", () => {
      recordSpend("ci-pipeline", 1.80); // CI pipeline spent 90% of its $2 cap
      const ciSpend = getSpendSummary("ci-pipeline");
      const devSpend = getSpendSummary("dev-alex");

      expect(ciSpend.dailyUsd).toBe(1.80);
      expect(devSpend.dailyUsd).toBe(0);

      // Dev-alex should still have full daily budget available
      const res = checkBudget(IDENTITY_DEVELOPER, PAID_MODEL, makeReq(400, 100), BUDGET_CONFIG);
      expect(res.allowed).toBe(true);
    });

    test("global spend aggregates across all identities correctly", () => {
      recordSpend("dev-alex", 2.50);
      recordSpend("ci-pipeline", 1.25);

      const global = getGlobalSpendSummary();
      expect(global.dailyUsd).toBeCloseTo(3.75, 2);
      expect(global.monthlyUsd).toBeCloseTo(3.75, 2);
    });
  });
});
