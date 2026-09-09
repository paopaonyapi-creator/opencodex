/**
 * Pao AI Gateway — Budget engine.
 *
 * Hard budget ceilings that cannot be bypassed by automation, retries,
 * fallbacks, force flags, or admin conveniences.
 *
 * Unknown pricing = fail closed (never assumed free).
 */

import type {
  GatewayBudgetConfig,
  GatewayIdentity,
  GatewayModelConfig,
  NormalizedChatRequest,
} from "../types";

// ---------------------------------------------------------------------------
// In-memory spend tracking (file-persisted in trace ledger)
// ---------------------------------------------------------------------------

interface SpendRecord {
  dailyUsd: number;
  monthlyUsd: number;
  lastResetDay: string; // YYYY-MM-DD
  lastResetMonth: string; // YYYY-MM
}

const globalSpend: SpendRecord = { dailyUsd: 0, monthlyUsd: 0, lastResetDay: "", lastResetMonth: "" };
const identitySpend = new Map<string, SpendRecord>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function ensureReset(record: SpendRecord): void {
  const d = today();
  const m = thisMonth();
  if (record.lastResetDay !== d) {
    record.dailyUsd = 0;
    record.lastResetDay = d;
  }
  if (record.lastResetMonth !== m) {
    record.monthlyUsd = 0;
    record.lastResetMonth = m;
  }
}

function getIdentitySpend(identityId: string): SpendRecord {
  let record = identitySpend.get(identityId);
  if (!record) {
    record = { dailyUsd: 0, monthlyUsd: 0, lastResetDay: "", lastResetMonth: "" };
    identitySpend.set(identityId, record);
  }
  ensureReset(record);
  return record;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of a request based on token estimates and model pricing.
 * Returns null if pricing is unknown (caller must handle fail-closed).
 */
export function estimateRequestCost(
  model: GatewayModelConfig,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): number | null {
  if (model.pricing.inputPerMillionUsd === null || model.pricing.outputPerMillionUsd === null) {
    return null; // Unknown pricing = fail closed
  }

  const inputCost = (estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillionUsd;
  const outputCost = (estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillionUsd;
  return inputCost + outputCost;
}

/**
 * Rough token count estimate from message content.
 * Uses the ~4 chars per token heuristic.
 */
export function estimateTokens(request: NormalizedChatRequest): { input: number; output: number } {
  let totalChars = 0;
  for (const msg of request.messages) {
    if (msg.content) totalChars += msg.content.length;
  }
  const inputTokens = Math.ceil(totalChars / 4);
  // Conservative output estimate: assume max_tokens or 2048
  const outputTokens = request.maxTokens ?? 2048;
  return { input: inputTokens, output: outputTokens };
}

// ---------------------------------------------------------------------------
// Budget admission
// ---------------------------------------------------------------------------

export type BudgetDenialReason =
  | "unknown_pricing"
  | "per_request_exceeded"
  | "identity_daily_exceeded"
  | "identity_monthly_exceeded"
  | "global_daily_exceeded"
  | "global_monthly_exceeded";

export interface BudgetAdmissionResult {
  readonly allowed: boolean;
  readonly denialReason?: BudgetDenialReason;
  readonly estimatedCostUsd: number | null;
  readonly identityDailyRemaining?: number;
  readonly globalDailyRemaining?: number;
}

/**
 * Check whether a request is within all budget ceilings.
 *
 * Budget admission flow:
 * 1. Estimate tokens/cost
 * 2. Verify price is known (fail closed if not and budget check required)
 * 3. Verify per-request ceiling
 * 4. Verify identity daily ceiling
 * 5. Verify global daily ceiling
 *
 * No bypass through retry, fallback, force flag, or admin convenience.
 */
export function checkBudget(
  identity: GatewayIdentity,
  model: GatewayModelConfig,
  request: NormalizedChatRequest,
  budgetConfig: GatewayBudgetConfig,
): BudgetAdmissionResult {
  const tokens = estimateTokens(request);
  const estimatedCost = estimateRequestCost(model, tokens.input, tokens.output);

  // Local/free models bypass budget checks
  if (model.pricing.inputPerMillionUsd === 0 && model.pricing.outputPerMillionUsd === 0) {
    return { allowed: true, estimatedCostUsd: 0 };
  }

  // Unknown pricing = fail closed
  if (estimatedCost === null) {
    return {
      allowed: false,
      denialReason: "unknown_pricing",
      estimatedCostUsd: null,
    };
  }

  // Per-request ceiling
  if (estimatedCost > identity.maxRequestUsd) {
    return {
      allowed: false,
      denialReason: "per_request_exceeded",
      estimatedCostUsd: estimatedCost,
    };
  }

  // Identity daily ceiling
  const identityBudget = budgetConfig.identities.find(b => b.identityId === identity.id);
  const identityDailyCap = identityBudget?.dailyUsd ?? identity.maxDailyUsd;
  const idSpend = getIdentitySpend(identity.id);
  if (idSpend.dailyUsd + estimatedCost > identityDailyCap) {
    return {
      allowed: false,
      denialReason: "identity_daily_exceeded",
      estimatedCostUsd: estimatedCost,
      identityDailyRemaining: Math.max(0, identityDailyCap - idSpend.dailyUsd),
    };
  }

  // Identity monthly ceiling
  const identityMonthlyCap = identityBudget?.monthlyUsd ?? identity.maxMonthlyUsd;
  if (identityMonthlyCap !== undefined && idSpend.monthlyUsd + estimatedCost > identityMonthlyCap) {
    return {
      allowed: false,
      denialReason: "identity_monthly_exceeded",
      estimatedCostUsd: estimatedCost,
    };
  }

  // Global daily ceiling
  ensureReset(globalSpend);
  if (globalSpend.dailyUsd + estimatedCost > budgetConfig.global.dailyUsd) {
    return {
      allowed: false,
      denialReason: "global_daily_exceeded",
      estimatedCostUsd: estimatedCost,
      globalDailyRemaining: Math.max(0, budgetConfig.global.dailyUsd - globalSpend.dailyUsd),
    };
  }

  // Global monthly ceiling
  if (globalSpend.monthlyUsd + estimatedCost > budgetConfig.global.monthlyUsd) {
    return {
      allowed: false,
      denialReason: "global_monthly_exceeded",
      estimatedCostUsd: estimatedCost,
    };
  }

  return {
    allowed: true,
    estimatedCostUsd: estimatedCost,
    identityDailyRemaining: Math.max(0, identityDailyCap - idSpend.dailyUsd - estimatedCost),
    globalDailyRemaining: Math.max(0, budgetConfig.global.dailyUsd - globalSpend.dailyUsd - estimatedCost),
  };
}

/**
 * Record actual spend after a request completes.
 * Called by the trace ledger after getting actual usage.
 */
export function recordSpend(identityId: string, costUsd: number): void {
  ensureReset(globalSpend);
  globalSpend.dailyUsd += costUsd;
  globalSpend.monthlyUsd += costUsd;

  const idSpend = getIdentitySpend(identityId);
  idSpend.dailyUsd += costUsd;
  idSpend.monthlyUsd += costUsd;
}

/**
 * Get current spend for an identity.
 */
export function getSpendSummary(identityId: string): { dailyUsd: number; monthlyUsd: number } {
  const s = getIdentitySpend(identityId);
  return { dailyUsd: s.dailyUsd, monthlyUsd: s.monthlyUsd };
}

/**
 * Get current global spend.
 */
export function getGlobalSpendSummary(): { dailyUsd: number; monthlyUsd: number } {
  ensureReset(globalSpend);
  return { dailyUsd: globalSpend.dailyUsd, monthlyUsd: globalSpend.monthlyUsd };
}

/** Reset all spend tracking (for testing). */
export function _resetAllSpend(): void {
  globalSpend.dailyUsd = 0;
  globalSpend.monthlyUsd = 0;
  globalSpend.lastResetDay = "";
  globalSpend.lastResetMonth = "";
  identitySpend.clear();
}
