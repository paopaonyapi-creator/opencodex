/**
 * Phase 24 — Pao Autonomous Cost & Token Economy: Burn Guard
 * Monitors spending velocity ($/hr), detects spikes, and enforces circuit breakers.
 */

import type { BurnGuardStatus } from "./types";

interface SpendSample {
  timestamp: number;
  amountUsd: number;
}

export interface BurnGuardOptions {
  baselineHourlyRateUsd?: number; // default $5.00/hr
  spikeMultiplier?: number; // default 3.0x
  hardHourlyLimitUsd?: number; // default $25.00/hr
}

export class BurnGuard {
  private samples: SpendSample[] = [];
  private baselineHourlyRateUsd: number;
  private spikeMultiplier: number;
  private hardHourlyLimitUsd: number;
  private circuitBroken = false;

  constructor(options: BurnGuardOptions = {}) {
    this.baselineHourlyRateUsd = options.baselineHourlyRateUsd ?? 5.0;
    this.spikeMultiplier = options.spikeMultiplier ?? 3.0;
    this.hardHourlyLimitUsd = options.hardHourlyLimitUsd ?? 25.0;
  }

  /**
   * Record a spend sample
   */
  public recordSpend(amountUsd: number, timestamp = Date.now()): void {
    this.samples.push({ timestamp, amountUsd });
    this.pruneOldSamples(timestamp);
  }

  /**
   * Calculate live burn rate and safeguard status
   */
  public getStatus(now = Date.now()): BurnGuardStatus {
    this.pruneOldSamples(now);

    const oneHourAgo = now - 3600_000;
    const recentSpend = this.samples
      .filter((s) => s.timestamp >= oneHourAgo)
      .reduce((sum, s) => sum + s.amountUsd, 0);

    const hourlyBurnRateUsd = Number(recentSpend.toFixed(4));
    const projectedDailySpendUsd = Number((hourlyBurnRateUsd * 24).toFixed(2));

    const spikeThreshold = this.baselineHourlyRateUsd * this.spikeMultiplier;
    const velocitySpikeDetected = hourlyBurnRateUsd >= spikeThreshold;

    let safeguardAction: BurnGuardStatus["safeguardAction"] = "none";

    if (this.circuitBroken || hourlyBurnRateUsd >= this.hardHourlyLimitUsd) {
      safeguardAction = "circuit_broken";
      this.circuitBroken = true;
    } else if (hourlyBurnRateUsd >= spikeThreshold * 0.8) {
      safeguardAction = "downgrade_forced";
    } else if (velocitySpikeDetected) {
      safeguardAction = "throttle";
    }

    return {
      hourlyBurnRateUsd,
      projectedDailySpendUsd,
      velocitySpikeDetected,
      safeguardAction,
      evaluatedAt: new Date(now).toISOString(),
    };
  }

  public tripCircuitBreaker(): void {
    this.circuitBroken = true;
  }

  public resetCircuitBreaker(): void {
    this.circuitBroken = false;
  }

  public reset(): void {
    this.samples = [];
    this.circuitBroken = false;
  }

  private pruneOldSamples(now: number): void {
    const cutoff = now - 3600_000 * 2; // keep 2 hours of history
    this.samples = this.samples.filter((s) => s.timestamp >= cutoff);
  }
}
