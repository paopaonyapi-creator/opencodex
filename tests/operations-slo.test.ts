import { describe, expect, test } from "bun:test";
import { SloGovernor } from "../src/agent-os/operations/slo-governor";

describe("Phase 23 — SloGovernor", () => {
  test("initializes with 100% availability and target 99.9%", () => {
    const governor = new SloGovernor();
    const metrics = governor.getMetrics();

    expect(metrics.availabilityPercent).toBe(100);
    expect(metrics.targetAvailabilityPercent).toBe(99.9);
    expect(metrics.errorBudgetMinutesRemaining).toBe(43.2);
    expect(metrics.totalErrorBudgetMinutes).toBe(43.2);
    expect(metrics.burnRate).toBe(0);
    expect(metrics.backpressureActive).toBe(false);
  });

  test("records successful requests without degrading error budget", () => {
    const governor = new SloGovernor();
    for (let i = 0; i < 50; i++) {
      governor.recordRequest(true, 100 + (i % 20));
    }

    const metrics = governor.getMetrics();
    expect(metrics.availabilityPercent).toBe(100);
    expect(metrics.burnRate).toBe(0);
    expect(metrics.errorBudgetMinutesRemaining).toBe(43.2);
    expect(metrics.backpressureActive).toBe(false);
  });

  test("calculates burn rate and consumes budget on failures", () => {
    const governor = new SloGovernor({ targetAvailabilityPercent: 99.9, burnRateThreshold: 2.0 });

    // 98 successes, 2 failures (2% error rate vs allowed 0.1% = 20x burn rate)
    for (let i = 0; i < 98; i++) {
      governor.recordRequest(true, 100);
    }
    governor.recordRequest(false, 500);
    governor.recordRequest(false, 500);

    const metrics = governor.getMetrics();
    expect(metrics.availabilityPercent).toBe(98);
    expect(metrics.burnRate).toBeGreaterThan(2.0);
    expect(metrics.backpressureActive).toBe(true);
    expect(metrics.errorBudgetMinutesRemaining).toBeLessThan(43.2);
  });

  test("calculates p95 latency accurately", () => {
    const governor = new SloGovernor();
    for (let i = 1; i <= 100; i++) {
      governor.recordRequest(true, i * 10);
    }

    const metrics = governor.getMetrics();
    // 95th percentile of 10, 20, ... 1000 is ~950ms
    expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(940);
    expect(metrics.p95LatencyMs).toBeLessThanOrEqual(960);
  });

  test("resets metrics cleanly", () => {
    const governor = new SloGovernor();
    governor.recordRequest(false, 500);
    expect(governor.getMetrics().availabilityPercent).toBe(0);

    governor.reset();
    expect(governor.getMetrics().availabilityPercent).toBe(100);
  });
});
