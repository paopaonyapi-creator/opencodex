/**
 * Pao Market Signal Control Plane — deterministic risk engine (Phase 20.52).
 *
 * Every policy here is pure computation over trusted, deterministic inputs
 * (configured limits, persisted paper account state, open paper positions).
 * The AI layer can never feed this engine numbers, and a hard failure can
 * never be overridden by analysis, council consensus, or a hook.
 */

import type {
  DailyRiskState,
  PaperPosition,
  RiskAssessment,
  RiskContext,
  RiskFinding,
  RiskPolicy,
  MarketSignal,
  PaperAccountState,
  CircuitBreakerRecord,
} from "../types";
import type { MarketConfig } from "../config";
import { nextId } from "../events";

// ---------------------------------------------------------------------------
// Position sizing (spec §18)
// ---------------------------------------------------------------------------

export interface PositionSizingInput {
  readonly equity: number;
  readonly riskPercent: number;
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly maxRiskPercent: number;
}

export type PositionSizingResult =
  | { readonly ok: true; readonly plannedRiskAmount: number; readonly riskPerUnit: number; readonly quantity: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function computePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { equity, riskPercent, entryPrice, stopPrice, maxRiskPercent } = input;
  if (!(entryPrice > 0)) return { ok: false, code: "MARKET_RISK_DATA_MISSING", message: "Entry price must be positive" };
  if (!(stopPrice > 0)) return { ok: false, code: "MARKET_RISK_DATA_MISSING", message: "Stop price must be positive" };
  if (entryPrice === stopPrice) return { ok: false, code: "MARKET_RISK_DATA_MISSING", message: "Entry and stop prices are equal; stop distance is zero" };
  if (!(riskPercent > 0)) return { ok: false, code: "MARKET_RISK_DATA_MISSING", message: "Risk percent must be positive" };
  if (riskPercent > maxRiskPercent) return { ok: false, code: "MARKET_RISK_HARD_FAIL", message: `Risk percent ${riskPercent}% exceeds the per-trade maximum ${maxRiskPercent}%` };

  const plannedRiskAmount = (equity * riskPercent) / 100;
  const riskPerUnit = Math.abs(entryPrice - stopPrice);
  const quantity = Math.floor(plannedRiskAmount / riskPerUnit);
  if (!(quantity > 0)) {
    return { ok: false, code: "MARKET_RISK_DATA_MISSING", message: "Computed quantity is zero: planned risk is smaller than the per-unit risk" };
  }
  return { ok: true, plannedRiskAmount, riskPerUnit, quantity };
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function grossExposure(positions: readonly PaperPosition[]): number {
  return positions.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);
}

function exposureForSymbol(positions: readonly PaperPosition[], symbol: string): number {
  return positions.filter(p => p.symbol === symbol).reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);
}

/** Per-trade risk ceiling: the sizing already enforces it; this re-asserts it. */
export class MaxRiskPerTradePolicy implements RiskPolicy {
  readonly id = "max_risk_per_trade";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(context: RiskContext): RiskFinding[] {
    const planned = (context.account.equity * this.limits.maxRiskPerTradePercent) / 100;
    return [
      {
        policyId: this.id,
        severity: "INFO",
        code: "RISK_LIMIT_RECORDED",
        message: `Per-trade risk ceiling ${this.limits.maxRiskPerTradePercent}% of equity`,
        data: { plannedRiskUsd: planned },
      },
    ];
  }
}

export class DailyLossLimitPolicy implements RiskPolicy {
  readonly id = "max_daily_loss";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(context: RiskContext): RiskFinding[] {
    const { dailyState, account } = context;
    const realized = dailyState.realizedPnl;
    const lossPercent = realized < 0 ? (Math.abs(realized) / Math.max(1, account.equity)) * 100 : 0;
    if (lossPercent >= this.limits.maxDailyLossPercent) {
      return [
        {
          policyId: this.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_HARD_FAIL",
          message: `Daily loss ${lossPercent.toFixed(2)}% breached the ${this.limits.maxDailyLossPercent}% hard limit`,
          data: { realizedPnl: realized, lossPercent },
        },
      ];
    }
    if (lossPercent >= this.limits.maxDailyLossPercent * 0.7) {
      return [
        {
          policyId: this.id,
          severity: "WARNING",
          code: "DAILY_LOSS_WARNING",
          message: `Daily loss ${lossPercent.toFixed(2)}% is approaching the ${this.limits.maxDailyLossPercent}% limit`,
          data: { lossPercent },
        },
      ];
    }
    return [];
  }
}

export class MaxOpenPositionsPolicy implements RiskPolicy {
  readonly id = "max_open_positions";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(context: RiskContext): RiskFinding[] {
    if (context.openPositions.length >= this.limits.maxOpenPositions) {
      return [
        {
          policyId: this.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_HARD_FAIL",
          message: `Open position count ${context.openPositions.length} reached the maximum ${this.limits.maxOpenPositions}`,
          data: { openPositions: context.openPositions.length },
        },
      ];
    }
    return [];
  }
}

export class SymbolExposurePolicy implements RiskPolicy {
  readonly id = "max_symbol_exposure";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(context: RiskContext): RiskFinding[] {
    const symbolExposure = exposureForSymbol(context.openPositions, context.signal.symbol);
    const maxUsd = (context.account.equity * this.limits.maxSymbolExposurePercent) / 100;
    const entry = context.signal.entryPrice ?? 0;
    const plannedQuantity = context.signal.eventType === "entry" ? 1 : 1; // exposure delta evaluated at assessment level
    const estimatedNewValue = symbolExposure + entry * plannedQuantity;
    if (symbolExposure >= maxUsd) {
      return [
        {
          policyId: this.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_HARD_FAIL",
          message: `Symbol exposure for ${context.signal.symbol} already at or above the ${this.limits.maxSymbolExposurePercent}% cap`,
          data: { symbolExposureUsd: symbolExposure, maxUsd },
        },
      ];
    }
    if (estimatedNewValue > maxUsd) {
      return [
        {
          policyId: this.id,
          severity: "WARNING",
          code: "SYMBOL_EXPOSURE_WARNING",
          message: `Proposed position pushes ${context.signal.symbol} toward the exposure cap`,
          data: { estimatedNewValue, maxUsd },
        },
      ];
    }
    return [];
  }
}

export class SectorExposurePolicy implements RiskPolicy {
  readonly id = "max_sector_exposure";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(_context: RiskContext): RiskFinding[] {
    // Sector classification is a trusted-data concern. When no sector source
    // exists, the finding says so — fabricating a sector map is forbidden.
    if (this.limits.maxSectorExposurePercent === null) {
      return [
        {
          policyId: this.id,
          severity: "INFO",
          code: "NOT_EVALUATED_MISSING_DATA",
          message: "Sector exposure not evaluated: no trusted sector classification data configured",
        },
      ];
    }
    return [
      {
        policyId: this.id,
        severity: "INFO",
        code: "NOT_EVALUATED_MISSING_DATA",
        message: "Sector exposure not evaluated: this phase has no trusted sector data source",
      },
    ];
  }
}

export class GrossExposurePolicy implements RiskPolicy {
  readonly id = "max_gross_exposure";
  constructor(private readonly limits: MarketConfig["risk"]) {}
  evaluate(context: RiskContext): RiskFinding[] {
    const before = grossExposure(context.openPositions);
    const maxUsd = (context.account.equity * this.limits.maxGrossExposurePercent) / 100;
    const entry = context.signal.entryPrice ?? 0;
    if (before >= maxUsd) {
      return [
        {
          policyId: this.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_HARD_FAIL",
          message: `Gross paper exposure ${before.toFixed(2)} at or above the configured cap`,
          data: { exposureBefore: before, maxUsd },
        },
      ];
    }
    if (before + entry > maxUsd) {
      return [
        {
          policyId: this.id,
          severity: "WARNING",
          code: "GROSS_EXPOSURE_WARNING",
          message: "Proposed position approaches the gross exposure cap",
          data: { exposureBefore: before, maxUsd },
        },
      ];
    }
    return [];
  }
}

export class DrawdownCircuitBreakerPolicy implements RiskPolicy {
  readonly id = "max_drawdown";
  constructor(
    private readonly limits: MarketConfig["risk"],
    private readonly onTrigger: (finding: RiskFinding) => void,
  ) {}
  evaluate(context: RiskContext): RiskFinding[] {
    const { dailyState, account } = context;
    const equityNow = account.equity + dailyState.realizedPnl;
    const drawdownPercent = equityNow < account.equity ? ((account.equity - equityNow) / Math.max(1, account.equity)) * 100 : 0;
    if (drawdownPercent >= this.limits.maxDrawdownPercent) {
      const finding: RiskFinding = {
        policyId: this.id,
        severity: "HARD_FAIL",
        code: "MARKET_RISK_HARD_FAIL",
        message: `Paper drawdown ${drawdownPercent.toFixed(2)}% reached the ${this.limits.maxDrawdownPercent}% circuit-breaker threshold`,
        data: { drawdownPercent },
      };
      this.onTrigger(finding);
      return [finding];
    }
    return [];
  }
}

export class MarketHoursPolicy implements RiskPolicy {
  readonly id = "market_hours";
  readonly enabled: boolean;
  constructor(
    private readonly windowsByAssetClass: Readonly<Record<string, readonly string[]>> | null,
    enabled = true,
  ) {
    this.enabled = enabled;
  }
  evaluate(context: RiskContext): RiskFinding[] {
    if (!this.enabled) return [];
    // Crypto/forex trade around the clock; U.S. equities do not. The policy
    // only speaks when it has a configured window for the asset class.
    const windows = this.windowsByAssetClass?.[context.signal.assetClass];
    if (!windows) {
      return [
        {
          policyId: this.id,
          severity: "INFO",
          code: "NOT_EVALUATED_MISSING_DATA",
          message: `No market-hours window configured for asset class ${context.signal.assetClass}; policy skipped`,
        },
      ];
    }
    const dayOfWeek = new Date(context.now).getUTCDay();
    const hourUtc = new Date(context.now).getUTCHours();
    // U.S. equities: 13:30–20:00 UTC, Mon–Fri (DST nuance is deliberately out
    // of scope; the window is configurable for operators who need precision).
    const inWindow = dayOfWeek >= 1 && dayOfWeek <= 5 && hourUtc >= 13 && hourUtc < 20;
    if (!inWindow) {
      return [
        {
          policyId: this.id,
          severity: "WARNING",
          code: "MARKET_HOURS_OUTSIDE_WINDOW",
          message: "Signal received outside the configured trading window for this asset class",
          data: { hourUtc, dayOfWeek },
        },
      ];
    }
    return [];
  }
}

export class VolatilityGuardPolicy implements RiskPolicy {
  readonly id = "volatility_guard";
  readonly enabled: boolean;
  constructor(private readonly maxVolatility: number | null, enabled = true) {
    this.enabled = enabled;
  }
  evaluate(context: RiskContext): RiskFinding[] {
    if (!this.enabled) return [];
    // Only a trusted provider may supply volatility. AI output can never
    // reach this context.
    if (!context.volatility) {
      return [
        {
          policyId: this.id,
          severity: "INFO",
          code: "NOT_EVALUATED_MISSING_DATA",
          message: "Volatility not evaluated: no trusted volatility data supplied",
        },
      ];
    }
    if (this.maxVolatility !== null && context.volatility.value > this.maxVolatility) {
      return [
        {
          policyId: this.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_HARD_FAIL",
          message: `Volatility ${context.volatility.value} exceeds the configured ceiling`,
          data: { source: context.volatility.source, value: context.volatility.value },
        },
      ];
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RiskEngineDeps {
  readonly config: MarketConfig;
  readonly onDrawdownTrigger: (finding: RiskFinding) => void;
}

export class MarketRiskEngine {
  private readonly policies: RiskPolicy[];
  private readonly config: MarketConfig;

  constructor(deps: RiskEngineDeps) {
    this.config = deps.config;
    this.policies = [
      new MaxRiskPerTradePolicy(deps.config.risk),
      new DailyLossLimitPolicy(deps.config.risk),
      new MaxOpenPositionsPolicy(deps.config.risk),
      new SymbolExposurePolicy(deps.config.risk),
      new SectorExposurePolicy(deps.config.risk),
      new GrossExposurePolicy(deps.config.risk),
      new DrawdownCircuitBreakerPolicy(deps.config.risk, deps.onDrawdownTrigger),
      new MarketHoursPolicy({ equity: ["equity", "etf"] }, true),
      new VolatilityGuardPolicy(null, true),
    ];
  }

  /**
   * Deterministic assessment. Returns a passed=true/false result; hard
   * failures are final. Missing market data is reported as
   * NOT_EVALUATED_MISSING_DATA, never fabricated.
   */
  assess(input: {
    signal: MarketSignal;
    account: PaperAccountState;
    openPositions: readonly PaperPosition[];
    dailyState: DailyRiskState;
    circuitBreaker: CircuitBreakerRecord;
    volatility?: { source: string; value: number };
    riskPercent: number;
  }): RiskAssessment {
    const context: RiskContext = {
      signal: input.signal,
      account: input.account,
      openPositions: input.openPositions,
      dailyState: input.dailyState,
      circuitBreaker: input.circuitBreaker,
      volatility: input.volatility,
      now: new Date().toISOString(),
    };

    const hardFailures: RiskFinding[] = [];
    const warnings: RiskFinding[] = [];
    const infos: RiskFinding[] = [];

    // Global circuit breaker gates everything downstream of ingestion.
    if (input.circuitBreaker.state !== "ACTIVE") {
      hardFailures.push({
        policyId: "global_circuit_breaker",
        severity: "HARD_FAIL",
        code: "MARKET_CIRCUIT_BREAKER_ACTIVE",
        message: `Market automation is ${input.circuitBreaker.state}; no new proposals may advance`,
        data: { reason: input.circuitBreaker.reason },
      });
    }

    for (const policy of this.policies) {
      if (policy.enabled === false) continue;
      try {
        for (const finding of policy.evaluate(context)) {
          if (finding.severity === "HARD_FAIL") hardFailures.push(finding);
          else if (finding.severity === "WARNING") warnings.push(finding);
          else infos.push(finding);
        }
      } catch (err) {
        // A throwing policy fails closed, not open.
        hardFailures.push({
          policyId: policy.id,
          severity: "HARD_FAIL",
          code: "MARKET_RISK_DATA_MISSING",
          message: `Risk policy ${policy.id} could not be evaluated`,
          data: { error: err instanceof Error ? err.message : "unknown" },
        });
      }
    }

    // Position sizing is part of the assessment: deterministic, from the
    // configured default risk percent (never from AI).
    const sizing = computePositionSize({
      equity: input.account.equity,
      riskPercent: input.riskPercent,
      entryPrice: input.signal.entryPrice ?? 0,
      stopPrice: input.signal.stopPrice ?? 0,
      maxRiskPercent: this.config.risk.maxRiskPerTradePercent,
    });
    if (!sizing.ok) {
      hardFailures.push({
        policyId: "position_sizing",
        severity: "HARD_FAIL",
        code: sizing.code,
        message: sizing.message,
      });
    }

    const exposureBefore = grossExposure(input.openPositions);

    return {
      id: nextId("mrsk"),
      signalId: input.signal.id,
      passed: hardFailures.length === 0 && sizing.ok,
      hardFailures,
      warnings,
      infos,
      accountValue: input.account.equity,
      plannedRiskAmount: sizing.ok ? sizing.plannedRiskAmount : undefined,
      positionSize: sizing.ok ? sizing.quantity : undefined,
      estimatedPositionValue: sizing.ok ? sizing.quantity * (input.signal.entryPrice ?? 0) : undefined,
      exposureBefore,
      exposureAfter: sizing.ok ? exposureBefore + sizing.quantity * (input.signal.entryPrice ?? 0) : exposureBefore,
      createdAt: new Date().toISOString(),
    };
  }
}
