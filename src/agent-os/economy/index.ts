/**
 * Phase 24 — Pao Autonomous Cost & Token Economy Governor (ACEG) Module
 */

export * from "./types";
export * from "./budget-ledger";
export * from "./burn-guard";
export * from "./model-optimizer";

import { BudgetLedger } from "./budget-ledger";
import { BurnGuard } from "./burn-guard";
import { ModelOptimizer } from "./model-optimizer";

let globalBudgetLedger: BudgetLedger | null = null;
let globalBurnGuard: BurnGuard | null = null;
let globalModelOptimizer: ModelOptimizer | null = null;

export function getBudgetLedger(): BudgetLedger {
  if (!globalBudgetLedger) {
    globalBudgetLedger = new BudgetLedger();

    // Register baseline default budgets
    globalBudgetLedger.registerBudget({
      id: "budget-global-daily",
      scope: "global_daily",
      name: "Global Daily Budget",
      limitUsd: 50.0,
      softWarningPercent: 80,
    });

    globalBudgetLedger.registerBudget({
      id: "budget-global-monthly",
      scope: "global_monthly",
      name: "Global Monthly Budget",
      limitUsd: 500.0,
      softWarningPercent: 85,
    });

    globalBudgetLedger.registerBudget({
      id: "budget-project-stock",
      scope: "project",
      targetId: "adobe-stock-production",
      name: "Stock Production Pipeline",
      limitUsd: 150.0,
      softWarningPercent: 80,
    });

    globalBudgetLedger.registerBudget({
      id: "budget-agent-coder",
      scope: "agent",
      targetId: "pao-coder",
      name: "Autonomous Coder Specialist",
      limitUsd: 100.0,
      softWarningPercent: 75,
    });
  }
  return globalBudgetLedger;
}

export function getBurnGuard(): BurnGuard {
  if (!globalBurnGuard) {
    globalBurnGuard = new BurnGuard();
  }
  return globalBurnGuard;
}

export function getModelOptimizer(): ModelOptimizer {
  if (!globalModelOptimizer) {
    globalModelOptimizer = new ModelOptimizer();
  }
  return globalModelOptimizer;
}
