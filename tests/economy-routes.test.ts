import { describe, expect, test } from "bun:test";
import { handleEconomyRoutes } from "../src/server/management/economy-routes";
import type { ManagementContext } from "../src/server/management/context";

function makeCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://localhost:10100${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    session: null,
    runtimeConfig: null as never,
    requestEpoch: 1,
  };
}

describe("Phase 24 — Economy Management API Routes", () => {
  let createdBudgetId = "";

  test("GET /api/agent-os/economy/budgets returns active budgets and totals", async () => {
    const ctx = makeCtx("/api/agent-os/economy/budgets", "GET");
    const res = await handleEconomyRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { budgets: Array<{ id: string }>; totalSpendUsd: number };
    expect(Array.isArray(data.budgets)).toBe(true);
    expect(data.budgets.some((b) => b.id === "budget-global-daily")).toBe(true);
  });

  test("POST /api/agent-os/economy/budgets registers new budget", async () => {
    const ctx = makeCtx("/api/agent-os/economy/budgets", "POST", {
      scope: "project",
      targetId: "seo-deep-crawl",
      name: "SEO Deep Crawl Budget",
      limitUsd: 75.0,
      softWarningPercent: 80,
    });

    const res = await handleEconomyRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(201);

    const data = (await res?.json()) as { budget: { id: string; name: string } };
    expect(data.budget.id).toBeDefined();
    expect(data.budget.name).toBe("SEO Deep Crawl Budget");
    createdBudgetId = data.budget.id;
  });

  test("GET /api/agent-os/economy/budgets/:id retrieves budget details", async () => {
    const ctx = makeCtx(`/api/agent-os/economy/budgets/${createdBudgetId}`, "GET");
    const res = await handleEconomyRoutes(ctx);
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { budget: { id: string } };
    expect(data.budget.id).toBe(createdBudgetId);
  });

  test("POST /api/agent-os/economy/transactions/record records spend transaction", async () => {
    const ctx = makeCtx("/api/agent-os/economy/transactions/record", "POST", {
      budgetId: createdBudgetId,
      modelId: "claude-3-5-sonnet-20241022",
      inputTokens: 15000,
      outputTokens: 3000,
      costUsd: 0.0675,
      savingsUsd: 0.021,
      wasDowngraded: true,
    });

    const res = await handleEconomyRoutes(ctx);
    expect(res?.status).toBe(201);

    const data = (await res?.json()) as { transaction: { id: string; costUsd: number } };
    expect(data.transaction.id).toBeDefined();
    expect(data.transaction.costUsd).toBe(0.0675);
  });

  test("GET /api/agent-os/economy/transactions returns transaction history", async () => {
    const ctx = makeCtx("/api/agent-os/economy/transactions", "GET");
    const res = await handleEconomyRoutes(ctx);
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { transactions: Array<{ id: string }> };
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(data.transactions.length).toBeGreaterThan(0);
  });

  test("GET and POST /api/agent-os/economy/burn-guard queries and trips circuit breaker", async () => {
    const getCtx = makeCtx("/api/agent-os/economy/burn-guard", "GET");
    const getRes = await handleEconomyRoutes(getCtx);
    expect(getRes?.status).toBe(200);

    const tripCtx = makeCtx("/api/agent-os/economy/burn-guard/trip", "POST");
    const tripRes = await handleEconomyRoutes(tripCtx);
    expect(tripRes?.status).toBe(200);

    const tripData = (await tripRes?.json()) as { burnGuard: { safeguardAction: string } };
    expect(tripData.burnGuard.safeguardAction).toBe("circuit_broken");

    const resetCtx = makeCtx("/api/agent-os/economy/burn-guard/reset", "POST");
    const resetRes = await handleEconomyRoutes(resetCtx);
    expect(resetRes?.status).toBe(200);
  });

  test("POST /api/agent-os/economy/optimize-route recommends route", async () => {
    const ctx = makeCtx("/api/agent-os/economy/optimize-route", "POST", {
      requestedModelId: "claude-3-5-sonnet-20241022",
      taskType: "summary",
    });

    const res = await handleEconomyRoutes(ctx);
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { recommendation: { recommendedModelId: string; downgraded: boolean } };
    expect(data.recommendation.recommendedModelId).toBe("claude-3-5-haiku-20241022");
    expect(data.recommendation.downgraded).toBe(true);
  });

  test("returns 404 for unknown economy route", async () => {
    const ctx = makeCtx("/api/agent-os/economy/unknown_subroute", "GET");
    const res = await handleEconomyRoutes(ctx);
    expect(res?.status).toBe(404);
  });
});
