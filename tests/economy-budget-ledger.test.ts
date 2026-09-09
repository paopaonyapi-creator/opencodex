import { describe, expect, test } from "bun:test";
import { BudgetLedger } from "../src/agent-os/economy/budget-ledger";

describe("Phase 24 — BudgetLedger", () => {
  test("registers a budget and initializes with healthy status", () => {
    const ledger = new BudgetLedger();
    const budget = ledger.registerBudget({
      id: "budget-daily-test",
      scope: "global_daily",
      name: "Test Daily Budget",
      limitUsd: 100.0,
      softWarningPercent: 80,
    });

    expect(budget.id).toBe("budget-daily-test");
    expect(budget.limitUsd).toBe(100.0);
    expect(budget.spentUsd).toBe(0);
    expect(budget.status).toBe("healthy");
    expect(ledger.getBudget("budget-daily-test")).toBeDefined();
  });

  test("debits budget and transitions status to warning and circuit_broken", () => {
    const ledger = new BudgetLedger();
    ledger.registerBudget({
      id: "budget-agent-x",
      scope: "agent",
      targetId: "agent-x",
      name: "Agent X Budget",
      limitUsd: 10.0,
      softWarningPercent: 80,
    });

    // Debit $5.00 -> 50% -> healthy
    let updated = ledger.debitBudget("budget-agent-x", 5.0);
    expect(updated.spentUsd).toBe(5.0);
    expect(updated.status).toBe("healthy");

    // Debit $3.50 -> $8.50 -> 85% -> warning
    updated = ledger.debitBudget("budget-agent-x", 3.5);
    expect(updated.spentUsd).toBe(8.5);
    expect(updated.status).toBe("warning");

    // Debit $2.00 -> $10.50 -> 105% -> circuit_broken
    updated = ledger.debitBudget("budget-agent-x", 2.0);
    expect(updated.spentUsd).toBe(10.5);
    expect(updated.status).toBe("circuit_broken");
  });

  test("records transactions and auto-associates with target budget", () => {
    const ledger = new BudgetLedger();
    ledger.registerBudget({
      id: "budget-proj-y",
      scope: "project",
      targetId: "proj-y",
      name: "Project Y",
      limitUsd: 50.0,
    });

    const tx = ledger.recordTransaction({
      projectId: "proj-y",
      modelId: "claude-3-5-sonnet",
      inputTokens: 10000,
      outputTokens: 2000,
      costUsd: 0.045,
      savingsUsd: 0.012,
      wasDowngraded: true,
    });

    expect(tx.budgetId).toBe("budget-proj-y");
    expect(tx.costUsd).toBe(0.045);
    expect(tx.savingsUsd).toBe(0.012);
    expect(tx.wasDowngraded).toBe(true);

    const budget = ledger.getBudget("budget-proj-y");
    expect(budget?.spentUsd).toBe(0.045);
    expect(ledger.getTotalSpend()).toBe(0.045);
    expect(ledger.getTotalSavings()).toBe(0.012);
  });

  test("lists transactions with limit", () => {
    const ledger = new BudgetLedger();
    for (let i = 0; i < 10; i++) {
      ledger.recordTransaction({
        modelId: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
      });
    }

    const txs = ledger.listTransactions(5);
    expect(txs.length).toBe(5);
  });
});
