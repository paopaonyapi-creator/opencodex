// Pao Stock Autonomous Campaign Planner — Niche Scoring Engine (Phase 21)
//
// Implements the mathematical Niche Viability Score (NVS) formula:
// NVS = ((C * 0.40) + (V * 0.35) - (S * 0.25)) / (1 + P_risk)
//
// Where:
// - C in [0, 1]: Commercial Intent Score (corporate/editorial buyer demand)
// - V in [0, 1]: Search Velocity Delta (rate of increase over 14 days)
// - S in [0, 1]: Market Saturation Index (existing asset volume)
// - P_risk in [0, 1]: IP & Trademark Liability Penalty

import type {
  NicheScoringInput,
  NicheViabilityResult,
  PriorityTier,
  TrendSignal,
} from "../types";

export const NVS_WEIGHTS = {
  commercialIntent: 0.4,
  searchVelocity: 0.35,
  saturationPenalty: 0.25,
} as const;

export const NVS_THRESHOLDS = {
  highPriority: 0.75,
  secondary: 0.5,
} as const;

/**
 * Clamps a number between min and max.
 */
function clamp(val: number, min = 0, max = 1): number {
  if (Number.isNaN(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Rounds to a specified number of decimal places (default 4).
 */
function roundPrecision(val: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Calculates the Niche Viability Score (NVS) based on input metrics.
 */
export function calculateNVS(input: NicheScoringInput): NicheViabilityResult {
  const C = clamp(input.commercialIntent, 0, 1);
  const V = clamp(input.searchVelocity, 0, 1);
  const S = clamp(input.saturationIndex, 0, 1);
  const P_risk = clamp(input.ipRiskPenalty ?? 0, 0, 1);

  const numerator =
    C * NVS_WEIGHTS.commercialIntent +
    V * NVS_WEIGHTS.searchVelocity -
    S * NVS_WEIGHTS.saturationPenalty;

  const denominator = 1 + P_risk;

  // Raw score can be negative if saturation is high and C/V are low; clamp bottom to 0
  const rawScore = numerator / denominator;
  const nvs = roundPrecision(Math.max(0, rawScore));

  const priorityTier = evaluatePriorityTier(nvs);

  return {
    nvs,
    priorityTier,
    breakdown: {
      commercialIntent: C,
      searchVelocity: V,
      saturationIndex: S,
      ipRiskPenalty: P_risk,
    },
  };
}

/**
 * Evaluates priority tier based on NVS thresholds:
 * - >= 0.75: high_priority
 * - >= 0.50: secondary
 * - < 0.50: rejected
 */
export function evaluatePriorityTier(nvs: number): PriorityTier {
  if (nvs >= NVS_THRESHOLDS.highPriority) {
    return "high_priority";
  }
  if (nvs >= NVS_THRESHOLDS.secondary) {
    return "secondary";
  }
  return "rejected";
}

/**
 * Filters and sorts signals by Niche Viability Score descending.
 */
export function filterAndSortSignals(
  signals: TrendSignal[],
  minScore = 0.5
): TrendSignal[] {
  return signals
    .filter((s) => s.nicheViabilityScore >= minScore)
    .sort((a, b) => b.nicheViabilityScore - a.nicheViabilityScore);
}
