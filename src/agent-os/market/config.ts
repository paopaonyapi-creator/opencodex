/**
 * Pao Market Signal Control Plane — configuration loader (Phase 20.52).
 *
 * All limits are environment-configurable with spec §61 defaults. Secrets are
 * resolved from environment variables only and never appear in config dumps,
 * logs, or audit metadata.
 *
 * Parsing rule (inherited from the AI Gateway loader): security-relevant
 * switches only accept the literal string "true". A stray non-empty value is
 * not consent.
 */

import type { CircuitBreakerStateName } from "./types";

export interface MarketRiskLimits {
  readonly defaultRiskPercent: number;
  readonly maxRiskPerTradePercent: number;
  readonly maxDailyLossPercent: number;
  readonly maxOpenPositions: number;
  readonly maxSymbolExposurePercent: number;
  readonly maxSectorExposurePercent: number | null;
  readonly maxGrossExposurePercent: number;
  readonly maxDrawdownPercent: number;
}

export interface MarketWebhookSecurity {
  readonly maxAgeSeconds: number;
  readonly maxBodyKb: number;
  readonly rateLimitPerMinute: number;
  /** Per-provider overrides for the rate limit. */
  readonly providerRateLimits: Readonly<Record<string, number>>;
}

export interface MarketProviderConfig {
  readonly enabled: boolean;
  /** Env var name holding the provider HMAC/token secret. Never a value. */
  readonly secretEnv: string;
  readonly authType: "hmac_sha256" | "static_token" | "none" | "manual";
  readonly rateLimitPerMinute?: number;
}

export interface MarketConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly adminKeyEnv: string;
  readonly executionMode: "paper";
  readonly paperSlippageBps: number;
  readonly paperEquity: number;
  readonly paperCurrency: string;
  readonly webhook: MarketWebhookSecurity;
  readonly risk: MarketRiskLimits;
  readonly approvalExpiryMinutes: number;
  readonly aiAnalysisEnabled: boolean;
  readonly reviewerCouncilEnabled: boolean;
  readonly manualSignalEnabled: boolean;
  readonly providers: Readonly<Record<string, MarketProviderConfig>>;
  readonly maxSectorExposureNote: string | null;
}

/**
 * Live execution is hard-disabled in Phase 20.52. This constant exists so a
 * future phase must consciously delete code, not just flip an env var.
 */
export const LIVE_EXECUTION_DISABLED = true;

function envNum(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

export function loadMarketConfig(): MarketConfig {
  const executionModeRaw = (process.env.MARKET_EXECUTION_MODE ?? "paper").trim().toLowerCase();
  // A request for live mode cannot be honored by configuration in this phase.
  const executionMode: "paper" = "paper";
  void executionModeRaw;

  const providerRateLimits: Record<string, number> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MARKET_WEBHOOK_RATE_LIMIT_") && key !== "MARKET_WEBHOOK_RATE_LIMIT_PER_MINUTE") {
      const provider = key.slice("MARKET_WEBHOOK_RATE_LIMIT_".length).toLowerCase();
      const parsed = Number(value);
      if (provider && Number.isFinite(parsed) && parsed > 0) providerRateLimits[provider] = parsed;
    }
  }

  const sectorRaw = process.env.MARKET_MAX_SECTOR_EXPOSURE_PERCENT;
  const sector = sectorRaw !== undefined && sectorRaw.trim() !== "" ? Number(sectorRaw) : null;

  return {
    enabled: envFlag("MARKET_MODULE_ENABLED", false),
    port: envNum("MARKET_MODULE_PORT", 8790, 1, 65535),
    adminKeyEnv: "MARKET_ADMIN_KEY",
    executionMode,
    paperSlippageBps: envNum("PAPER_BROKER_SLIPPAGE_BPS", 0, 0, 10_000),
    paperEquity: envNum("MARKET_PAPER_EQUITY", 100_000, 1, Number.MAX_SAFE_INTEGER),
    paperCurrency: process.env.MARKET_PAPER_CURRENCY?.trim() || "USD",
    webhook: {
      maxAgeSeconds: envNum("MARKET_WEBHOOK_MAX_AGE_SECONDS", 300, 1, 86_400),
      maxBodyKb: envNum("MARKET_WEBHOOK_MAX_BODY_KB", 256, 1, 8192),
      rateLimitPerMinute: envNum("MARKET_WEBHOOK_RATE_LIMIT_PER_MINUTE", 120, 1, 100_000),
      providerRateLimits,
    },
    risk: {
      defaultRiskPercent: envNum("MARKET_DEFAULT_RISK_PERCENT", 0.5, 0, 100),
      maxRiskPerTradePercent: envNum("MARKET_MAX_RISK_PER_TRADE_PERCENT", 1.0, 0, 100),
      maxDailyLossPercent: envNum("MARKET_MAX_DAILY_LOSS_PERCENT", 3.0, 0, 100),
      maxOpenPositions: envNum("MARKET_MAX_OPEN_POSITIONS", 5, 0, 10_000),
      maxSymbolExposurePercent: envNum("MARKET_MAX_SYMBOL_EXPOSURE_PERCENT", 20, 0, 1000),
      maxSectorExposurePercent: sector !== null && Number.isFinite(sector) && sector > 0 ? sector : null,
      maxGrossExposurePercent: envNum("MARKET_MAX_GROSS_EXPOSURE_PERCENT", 100, 0, 1000),
      maxDrawdownPercent: envNum("MARKET_MAX_DRAWDOWN_PERCENT", 10, 0, 100),
    },
    approvalExpiryMinutes: envNum("MARKET_APPROVAL_EXPIRY_MINUTES", 30, 1, 10_080),
    aiAnalysisEnabled: envFlag("MARKET_AI_ANALYSIS_ENABLED", true),
    reviewerCouncilEnabled: envFlag("MARKET_REVIEWER_COUNCIL_ENABLED", true),
    manualSignalEnabled: envFlag("MARKET_MANUAL_SIGNAL_ENABLED", true),
    providers: {
      kamden: {
        enabled: envFlag("MARKET_PROVIDER_KAMDEN_ENABLED", false),
        secretEnv: "MARKET_KAMDEN_WEBHOOK_SECRET",
        authType: "hmac_sha256",
      },
      tradingview: {
        enabled: envFlag("MARKET_PROVIDER_TRADINGVIEW_ENABLED", false),
        secretEnv: "MARKET_TRADINGVIEW_WEBHOOK_SECRET",
        authType: "static_token",
      },
      generic: {
        enabled: envFlag("MARKET_PROVIDER_GENERIC_ENABLED", false),
        secretEnv: "MARKET_GENERIC_WEBHOOK_SECRET",
        authType: process.env.MARKET_GENERIC_AUTH_TYPE === "hmac_sha256" ? "hmac_sha256" : "static_token",
      },
    },
    maxSectorExposureNote:
      sector !== null && Number.isFinite(sector) && sector > 0
        ? null
        : "Sector exposure policy present but sector data is unavailable; findings report NOT_EVALUATED_MISSING_DATA.",
  };
}

export type GlobalBreakerState = CircuitBreakerStateName;
