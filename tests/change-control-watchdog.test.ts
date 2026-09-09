import { describe, expect, test } from "bun:test";
import { ChangeWatchdog } from "../src/agent-os/change-control/watchdog";

describe("Phase 22 — ChangeWatchdog & Rollback Observer", () => {
  test("monitors healthy stabilization without triggering rollback", () => {
    let rollbackCalled = false;
    const watchdog = new ChangeWatchdog({
      stabilizationWindowSeconds: 10,
      onRollbackTriggered: () => {
        rollbackCalled = true;
      },
    });

    watchdog.startWatch("prop-watch-01");
    const report = watchdog.reportMetrics("prop-watch-01", {
      errorRate: 0.01,
      latencyP95Ms: 120,
      healthzOk: true,
      crashesDetected: 0,
    });

    expect(report.rollbackTriggered).toBe(false);
    expect(rollbackCalled).toBe(false);
    expect(report.metrics.healthzOk).toBe(true);
  });

  test("triggers automated rollback when error rate spikes", () => {
    let rollbackReason = "";
    const watchdog = new ChangeWatchdog({
      errorRateThreshold: 0.05,
      onRollbackTriggered: (_id, reason) => {
        rollbackReason = reason;
      },
    });

    watchdog.startWatch("prop-watch-02");
    const report = watchdog.reportMetrics("prop-watch-02", {
      errorRate: 0.12, // 12% error rate exceeds 5%
    });

    expect(report.rollbackTriggered).toBe(true);
    expect(rollbackReason).toContain("Error rate");
  });

  test("triggers automated rollback when healthz check fails", () => {
    let rollbackReason = "";
    const watchdog = new ChangeWatchdog({
      onRollbackTriggered: (_id, reason) => {
        rollbackReason = reason;
      },
    });

    watchdog.startWatch("prop-watch-03");
    const report = watchdog.reportMetrics("prop-watch-03", {
      healthzOk: false,
    });

    expect(report.rollbackTriggered).toBe(true);
    expect(rollbackReason).toContain("Health check (/healthz)");
  });

  test("triggers automated rollback when latency P95 spikes", () => {
    let rollbackReason = "";
    const watchdog = new ChangeWatchdog({
      latencyP95ThresholdMs: 1000,
      onRollbackTriggered: (_id, reason) => {
        rollbackReason = reason;
      },
    });

    watchdog.startWatch("prop-watch-04");
    const report = watchdog.reportMetrics("prop-watch-04", {
      latencyP95Ms: 1800,
    });

    expect(report.rollbackTriggered).toBe(true);
    expect(rollbackReason).toContain("P95 latency");
  });
});
