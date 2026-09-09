/**
 * Phase 23 — Pao Autonomous Operations: SLO & Error Budget Governor
 * Tracks service-level objectives, computes burn rates, and enforces backpressure.
 */

import type { SloMetrics } from "./types";

export interface SloGovernorOptions {
  targetAvailabilityPercent?: number; // default 99.9
  totalErrorBudgetMinutes?: number; // default 43.2 (30-day 99.9% budget)
  burnRateThreshold?: number; // default 2.0
}

export class SloGovernor {
  private targetAvailabilityPercent: number;
  private totalErrorBudgetMinutes: number;
  private burnRateThreshold: number;
  private totalRequests = 0;
  private failedRequests = 0;
  private latencies: number[] = [];
  private downtimeMinutes = 0;

  constructor(options: SloGovernorOptions = {}) {
    this.targetAvailabilityPercent = options.targetAvailabilityPercent ?? 99.9;
    this.totalErrorBudgetMinutes = options.totalErrorBudgetMinutes ?? 43.2;
    this.burnRateThreshold = options.burnRateThreshold ?? 2.0;
  }

  /**
   * Record a request result and latency
   */
  public recordRequest(success: boolean, latencyMs = 120): void {
    this.totalRequests += 1;
    if (!success) {
      this.failedRequests += 1;
      this.downtimeMinutes += 0.05; // estimate small slice of error budget consumed
    }

    this.latencies.push(latencyMs);
    if (this.latencies.length > 500) {
      this.latencies.shift();
    }
  }

  /**
   * Calculate live SLO metrics, error budget, and burn rate
   */
  public getMetrics(): SloMetrics {
    const total = Math.max(1, this.totalRequests);
    const successCount = total - this.failedRequests;
    const availabilityPercent = Number(((successCount / total) * 100).toFixed(3));

    const remainingMinutes = Math.max(
      0,
      Number((this.totalErrorBudgetMinutes - this.downtimeMinutes).toFixed(2))
    );

    // Allowed error rate: (100 - target) / 100
    const allowedErrorRate = (100 - this.targetAvailabilityPercent) / 100;
    const actualErrorRate = this.failedRequests / total;
    const rawBurnRate = allowedErrorRate > 0 ? actualErrorRate / allowedErrorRate : 0.0;
    const burnRate = Number(rawBurnRate.toFixed(2));

    const p95LatencyMs = this.calculateP95Latency();
    const backpressureActive = burnRate > this.burnRateThreshold || remainingMinutes <= 0;

    return {
      availabilityPercent,
      targetAvailabilityPercent: this.targetAvailabilityPercent,
      errorBudgetMinutesRemaining: remainingMinutes,
      totalErrorBudgetMinutes: this.totalErrorBudgetMinutes,
      p95LatencyMs,
      burnRate,
      backpressureActive,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Reset stats
   */
  public reset(): void {
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.latencies = [];
    this.downtimeMinutes = 0;
  }

  private calculateP95Latency(): number {
    if (this.latencies.length === 0) return 120;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(index, sorted.length - 1)];
  }
}
