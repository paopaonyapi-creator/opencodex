import { describe, expect, test } from "bun:test";
import { BurnGuard } from "../src/agent-os/economy/burn-guard";

describe("Phase 24 — BurnGuard", () => {
  test("initializes with zero burn rate and safe action", () => {
    const guard = new BurnGuard();
    const status = guard.getStatus();

    expect(status.hourlyBurnRateUsd).toBe(0);
    expect(status.projectedDailySpendUsd).toBe(0);
    expect(status.velocitySpikeDetected).toBe(false);
    expect(status.safeguardAction).toBe("none");
  });

  test("calculates hourly burn rate from recent samples", () => {
    const guard = new BurnGuard();
    const now = Date.now();

    guard.recordSpend(1.5, now - 1800_000); // 30 min ago
    guard.recordSpend(2.0, now - 600_000);  // 10 min ago

    const status = guard.getStatus(now);
    expect(status.hourlyBurnRateUsd).toBe(3.5);
    expect(status.projectedDailySpendUsd).toBe(84.0);
  });

  test("detects velocity spike and activates downgrade/throttle", () => {
    // baseline = $5.00/hr, spike = 3.0x -> $15.00/hr
    const guard = new BurnGuard({ baselineHourlyRateUsd: 5.0, spikeMultiplier: 3.0 });
    const now = Date.now();

    // Spend $16.00 in the last 15 minutes
    guard.recordSpend(8.0, now - 900_000);
    guard.recordSpend(8.0, now - 300_000);

    const status = guard.getStatus(now);
    expect(status.velocitySpikeDetected).toBe(true);
    expect(status.safeguardAction).toBe("downgrade_forced");
  });

  test("trips circuit breaker manually and automatically on hard limit", () => {
    const guard = new BurnGuard({ hardHourlyLimitUsd: 20.0 });
    const now = Date.now();

    guard.recordSpend(25.0, now);
    let status = guard.getStatus(now);
    expect(status.safeguardAction).toBe("circuit_broken");

    guard.resetCircuitBreaker();
    guard.tripCircuitBreaker();
    status = guard.getStatus(now);
    expect(status.safeguardAction).toBe("circuit_broken");
  });
});
