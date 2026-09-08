// Phase 20.10 — Trend Intelligence Configuration

import type { TrendConfig, TrendPlatformSource } from "./types";

function boolEnv(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return val.toLowerCase() === "true" || val === "1";
}

function numberEnv(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

export function loadTrendConfig(env: Record<string, string | undefined> = process.env): TrendConfig {
  const sourcesRaw = env.PAO_TREND_DEFAULT_SOURCES;
  const defaultSources: TrendPlatformSource[] = sourcesRaw
    ? (sourcesRaw.split(",").map((s) => s.trim()) as TrendPlatformSource[])
    : ["adobe_stock", "youtube", "tiktok"];

  return {
    enabled: boolEnv(env.PAO_TREND_ENABLED, true),
    dailyCostCapUsd: numberEnv(env.PAO_TREND_DAILY_COST_CAP_USD, 25.0),
    perJobCostCapUsd: numberEnv(env.PAO_TREND_PER_JOB_COST_CAP_USD, 5.0),
    defaultMarket: env.PAO_TREND_DEFAULT_MARKET || "US",
    defaultSources,
    apifyToken: env.APIFY_API_TOKEN,
    mockMode: boolEnv(env.PAO_TREND_MOCK_MODE, true), // Default true for safe offline operations
  };
}

export function getTrendConfig(): TrendConfig {
  return loadTrendConfig();
}
