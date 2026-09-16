// Phase 20.20 — Social Intelligence configuration (spec section 15).
//
// Budget defaults are deliberately conservative: paid provider runs never start
// without passing the central Cost Guard, and an unknown cost on a known-paid
// tool blocks auto-run entirely.

import type { SocialCapability, SocialPlatform } from "./types";

function boolEnv(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return val.toLowerCase() === "true" || val === "1";
}

function numberEnv(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultVal;
}

export interface SocialIntelligenceConfig {
  enabled: boolean;
  apifyToken: string | null;
  defaultMaxJobUsd: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  requireApprovalOverUsd: number;
  allowUnestimatedPaidRun: boolean;
  allowPaidAutoRun: boolean;
  maxProviderAttempts: number;
  maxRetriesPerTool: number;
  maxItemsDefault: number;
  maxItemsHardLimit: number;
  mockMode: boolean;
}

export function loadSocialConfig(env: Record<string, string | undefined> = process.env): SocialIntelligenceConfig {
  return {
    enabled: boolEnv(env.SOCIAL_INTELLIGENCE_ENABLED, true),
    apifyToken: env.APIFY_API_TOKEN || null,
    defaultMaxJobUsd: numberEnv(env.SOCIAL_DEFAULT_MAX_JOB_USD, 0.10),
    dailyBudgetUsd: numberEnv(env.SOCIAL_DAILY_BUDGET_USD, 1.0),
    monthlyBudgetUsd: numberEnv(env.SOCIAL_MONTHLY_BUDGET_USD, 10.0),
    requireApprovalOverUsd: numberEnv(env.SOCIAL_REQUIRE_APPROVAL_OVER_USD, 0.05),
    allowUnestimatedPaidRun: boolEnv(env.SOCIAL_ALLOW_UNESTIMATED_PAID_RUN, false),
    allowPaidAutoRun: boolEnv(env.SOCIAL_ALLOW_PAID_AUTO_RUN, false),
    maxProviderAttempts: Math.max(1, Math.floor(numberEnv(env.SOCIAL_MAX_PROVIDER_ATTEMPTS, 3))),
    maxRetriesPerTool: Math.max(0, Math.floor(numberEnv(env.SOCIAL_MAX_RETRIES_PER_TOOL, 1))),
    maxItemsDefault: Math.floor(numberEnv(env.SOCIAL_MAX_ITEMS_DEFAULT, 100)),
    maxItemsHardLimit: Math.floor(numberEnv(env.SOCIAL_MAX_ITEMS_HARD_LIMIT, 1000)),
    // Default true for safe offline operation, matching the trends subsystem.
    mockMode: boolEnv(env.PAO_SOCIAL_MOCK_MODE, true),
  };
}

export function getSocialConfig(): SocialIntelligenceConfig {
  return loadSocialConfig();
}

export function clampMaxItems(requested: number | undefined, config: SocialIntelligenceConfig): number {
  const base = requested ?? config.maxItemsDefault;
  return Math.min(Math.max(1, Math.floor(base)), config.maxItemsHardLimit);
}

export type { SocialCapability, SocialPlatform };
