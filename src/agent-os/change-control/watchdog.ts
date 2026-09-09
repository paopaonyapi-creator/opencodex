/**
 * Phase 22 — Pao Autonomous Change Control: Watchdog & Rollback Observer
 * Monitors system health post-merge and triggers self-healing rollback on regression.
 */

import type { WatchdogMetrics } from "./types";

export interface WatchdogOptions {
  stabilizationWindowSeconds?: number;
  errorRateThreshold?: number; // e.g. 0.05 (5%)
  latencyP95ThresholdMs?: number; // e.g. 2500ms
  onRollbackTriggered?: (proposalId: string, reason: string) => Promise<void> | void;
}

export class ChangeWatchdog {
  private stabilizationWindowSeconds: number;
  private errorRateThreshold: number;
  private latencyP95ThresholdMs: number;
  private activeWatches: Map<
    string,
    {
      proposalId: string;
      startedAt: number;
      windowSeconds: number;
      metrics: WatchdogMetrics;
    }
  > = new Map();
  private onRollbackTriggered?: (proposalId: string, reason: string) => Promise<void> | void;

  constructor(options: WatchdogOptions = {}) {
    this.stabilizationWindowSeconds = options.stabilizationWindowSeconds ?? 300;
    this.errorRateThreshold = options.errorRateThreshold ?? 0.05;
    this.latencyP95ThresholdMs = options.latencyP95ThresholdMs ?? 2500;
    this.onRollbackTriggered = options.onRollbackTriggered;
  }

  /**
   * Start stabilization watch for a merged change proposal
   */
  public startWatch(proposalId: string, windowSeconds = this.stabilizationWindowSeconds): void {
    this.activeWatches.set(proposalId, {
      proposalId,
      startedAt: Date.now(),
      windowSeconds,
      metrics: {
        errorRate: 0.0,
        latencyP95Ms: 150,
        healthzOk: true,
        crashesDetected: 0,
        stabilizationRemainingSeconds: windowSeconds,
      },
    });
  }

  /**
   * Record health metrics and evaluate rollback condition
   */
  public reportMetrics(
    proposalId: string,
    metricsUpdate: Partial<WatchdogMetrics>
  ): {
    stable: boolean;
    rollbackTriggered: boolean;
    reason?: string;
    metrics: WatchdogMetrics;
  } {
    const watch = this.activeWatches.get(proposalId);
    if (!watch) {
      throw new Error(`No active watch for proposal '${proposalId}'`);
    }

    const elapsedSeconds = Math.floor((Date.now() - watch.startedAt) / 1000);
    const remainingSeconds = Math.max(0, watch.windowSeconds - elapsedSeconds);

    watch.metrics = {
      ...watch.metrics,
      ...metricsUpdate,
      stabilizationRemainingSeconds: remainingSeconds,
    };

    // Check regression triggers
    let shouldRollback = false;
    let reason: string | undefined;

    if (!watch.metrics.healthzOk) {
      shouldRollback = true;
      reason = "Health check (/healthz) reported unready or failed during stabilization window.";
    } else if (watch.metrics.errorRate > this.errorRateThreshold) {
      shouldRollback = true;
      reason = `Error rate (${(watch.metrics.errorRate * 100).toFixed(1)}%) exceeded threshold (${(
        this.errorRateThreshold * 100
      ).toFixed(1)}%).`;
    } else if (watch.metrics.latencyP95Ms > this.latencyP95ThresholdMs) {
      shouldRollback = true;
      reason = `P95 latency (${watch.metrics.latencyP95Ms}ms) exceeded threshold (${this.latencyP95ThresholdMs}ms).`;
    } else if (watch.metrics.crashesDetected > 0) {
      shouldRollback = true;
      reason = `Detected ${watch.metrics.crashesDetected} runtime crash events.`;
    }

    if (shouldRollback && reason) {
      if (this.onRollbackTriggered) {
        void this.onRollbackTriggered(proposalId, reason);
      }
      return {
        stable: false,
        rollbackTriggered: true,
        reason,
        metrics: watch.metrics,
      };
    }

    const isComplete = remainingSeconds === 0;
    return {
      stable: isComplete,
      rollbackTriggered: false,
      metrics: watch.metrics,
    };
  }

  /**
   * Check watch status
   */
  public getWatchStatus(proposalId: string): WatchdogMetrics | undefined {
    return this.activeWatches.get(proposalId)?.metrics;
  }

  /**
   * Stop watch
   */
  public stopWatch(proposalId: string): void {
    this.activeWatches.delete(proposalId);
  }
}
