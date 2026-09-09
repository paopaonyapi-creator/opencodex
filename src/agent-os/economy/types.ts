/**
 * Phase 24 — Pao Autonomous Cost & Token Economy Governor (ACEG) Types
 */

export type BudgetScope = "global_daily" | "global_monthly" | "project" | "agent";

export type BudgetStatus = "healthy" | "warning" | "throttled" | "circuit_broken";

export type ModelTier = "tier1_ultra" | "tier2_balanced" | "tier3_economy";

export interface BudgetRecord {
  id: string;
  scope: BudgetScope;
  targetId?: string; // agentId or projectId
  name: string;
  limitUsd: number;
  spentUsd: number;
  softWarningPercent: number; // default 80
  status: BudgetStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CostTransaction {
  id: string;
  budgetId: string;
  agentId?: string;
  projectId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  savingsUsd: number;
  wasDowngraded: boolean;
  timestamp: number;
}

export interface BurnGuardStatus {
  hourlyBurnRateUsd: number;
  projectedDailySpendUsd: number;
  velocitySpikeDetected: boolean;
  safeguardAction: "none" | "throttle" | "downgrade_forced" | "circuit_broken";
  evaluatedAt: string;
}

export interface ModelRoutingRecommendation {
  recommendedTier: ModelTier;
  recommendedModelId: string;
  originalModelId?: string;
  downgraded: boolean;
  estimatedSavingsPercent: number;
  rationale: string;
}

export interface RecordTransactionInput {
  budgetId?: string;
  agentId?: string;
  projectId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  wasDowngraded?: boolean;
  savingsUsd?: number;
}
