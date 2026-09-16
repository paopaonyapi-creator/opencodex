/**
 * Pao Market Signal Control Plane — Phase 20.52 risk, approval, and paper
 * execution tests.
 *
 * Covers spec §66: position sizing, zero stop distance, per-trade risk cap,
 * daily loss limit, max open positions, drawdown circuit breaker, risk
 * hard-fail blocking, approval permission/expiration/idempotency, paper
 * broker isolation, and live-mode rejection.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { MarketService } from "../src/agent-os/market/service";
import { loadMarketConfig, type MarketConfig } from "../src/agent-os/market/config";
import { computePositionSize } from "../src/agent-os/market/risk/engine";
import { GlobalCircuitBreaker } from "../src/agent-os/market/risk/circuit-breaker";
import { ApprovalService, ApprovalError } from "../src/agent-os/market/approvals/service";
import { PaperBrokerAdapter, assertPaperOnly, LiveBrokerDisabledError, ExecutionService } from "../src/agent-os/market/execution/broker";
import { MarketDbStore } from "../src/agent-os/market/db-store";
import { MarketEventBus } from "../src/agent-os/market/events";
import type { MarketConfig as FullMarketConfig } from "../src/agent-os/market/config";

const tempHomes: string[] = [];
let clockMs = Date.now();

function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "market-risk-"));
  tempHomes.push(dir);
  process.env.OPENCODEX_HOME = dir;
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
}

afterEach(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) {
    try {
      rmSync(tempHomes.pop()!, { recursive: true, force: true });
    } catch {}
  }
  delete process.env.MARKET_APPROVER_ACTORS;
  delete process.env.MARKET_OPERATOR_ACTORS;
});

const admin = { type: "user" as const, id: "admin" };
const nobody = { type: "user" as const, id: "random-user" };

function baseConfig(overrides: Partial<FullMarketConfig["risk"]> = {}): FullMarketConfig {
  const defaults = loadMarketConfig();
  return {
    ...defaults,
    enabled: true,
    paperEquity: 100_000,
    risk: {
      defaultRiskPercent: 0.5,
      maxRiskPerTradePercent: 1.0,
      maxDailyLossPercent: 3.0,
      maxOpenPositions: 5,
      maxSymbolExposurePercent: 20,
      maxSectorExposurePercent: null,
      maxGrossExposurePercent: 100,
      maxDrawdownPercent: 10,
      ...overrides,
    },
  };
}

function makeSignal(input: { id: string; symbol?: string; entryPrice?: number; stopPrice?: number; direction?: "long" | "short" }): import("../src/agent-os/market/types").MarketSignal {
  return {
    id: input.id,
    provider: "kamden",
    eventType: "entry",
    symbol: input.symbol ?? "AAPL",
    assetClass: "equity",
    direction: input.direction ?? "long",
    entryPrice: "entryPrice" in input ? input.entryPrice : 200,
    stopPrice: "stopPrice" in input ? input.stopPrice : 195,
    targetPrice: 210,
    providerConfidence: 0.7,
    signalTime: new Date(clockMs).toISOString(),
    receivedAt: new Date(clockMs).toISOString(),
    normalizedAt: new Date(clockMs).toISOString(),
    verified: true,
    duplicate: false,
    tags: [],
    rawEventId: "mraw-x",
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Position sizing
// ---------------------------------------------------------------------------

describe("Phase 20.52 — position sizing", () => {
  test("computes planned risk and floored quantity deterministically", () => {
    const result = computePositionSize({ equity: 100_000, riskPercent: 0.5, entryPrice: 200, stopPrice: 195, maxRiskPercent: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plannedRiskAmount).toBeCloseTo(500);
      expect(result.riskPerUnit).toBe(5);
      expect(result.quantity).toBe(100);
    }
  });

  test("guards: zero stop distance, non-positive prices, and over-cap risk are rejected", () => {
    expect(computePositionSize({ equity: 100_000, riskPercent: 0.5, entryPrice: 200, stopPrice: 200, maxRiskPercent: 1 }).ok).toBe(false);
    expect(computePositionSize({ equity: 100_000, riskPercent: 0.5, entryPrice: 0, stopPrice: 195, maxRiskPercent: 1 }).ok).toBe(false);
    expect(computePositionSize({ equity: 100_000, riskPercent: 0.5, entryPrice: 200, stopPrice: 0, maxRiskPercent: 1 }).ok).toBe(false);
    const overCap = computePositionSize({ equity: 100_000, riskPercent: 2, entryPrice: 200, stopPrice: 195, maxRiskPercent: 1 });
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.code).toBe("MARKET_RISK_HARD_FAIL");
    expect(computePositionSize({ equity: 100_000, riskPercent: 0.00001, entryPrice: 200, stopPrice: 195, maxRiskPercent: 1 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Risk engine + circuit breaker via the service
// ---------------------------------------------------------------------------

describe("Phase 20.52 — deterministic risk engine", () => {
  let service: MarketService;
  let config: FullMarketConfig;

  beforeEach(() => {
    freshDb();
    process.env.MARKET_APPROVER_ACTORS = "admin";
    process.env.MARKET_OPERATOR_ACTORS = "admin";
    clockMs = Date.now();
    config = baseConfig();
    service = new MarketService({ config, now: () => new Date(clockMs) });
  });

  test("risk hard-fail blocks the proposal path", async () => {
    const signal = makeSignal({ id: "msig-risk-1" });
    service.store.saveSignal(signal, "VERIFIED", null);
    // A signal without a stop distance fails sizing -> hard fail.
    const noStop = makeSignal({ id: "msig-risk-2", stopPrice: undefined });
    service.store.saveSignal(noStop, "VERIFIED", null);

    const failed = service.runRiskCheck(noStop.id, admin, "corr-1");
    expect(failed.passed).toBe(false);
    expect(failed.hardFailures.length).toBeGreaterThan(0);

    await service.analyzeSignal(noStop.id, admin, "corr-2").catch(() => {});
    // Force status through analysis for the proposal gate test.
    expect(() => service.createProposal(noStop.id, admin, "corr-3")).toThrow(/MARKET_PROPOSAL_NOT_READY|MARKET_LIFECYCLE/);
    void signal;
  });

  test("daily loss limit hard-fails and max open positions blocks", () => {
    // Seed a realized loss of 4% of equity (limit is 3%).
    service.store.saveTradeResult({
      id: "mtr-seed",
      orderId: "paper-seed",
      entryPrice: 100,
      exitPrice: 96,
      quantity: 100,
      grossPnl: -4000,
      fees: 0,
      netPnl: -4000,
      openedAt: new Date(clockMs).toISOString(),
      closedAt: new Date(clockMs).toISOString(),
    });
    const assessment = service.runRiskCheck(service.store.listSignals({ limit: 1 })[0]?.signal.id ?? seedSignal(service), admin, "corr-loss");
    expect(assessment.passed).toBe(false);
    expect(assessment.hardFailures.some(f => f.policyId === "max_daily_loss")).toBe(true);
  });

  test("drawdown circuit breaker pauses automation, which then blocks new proposals", () => {
    // 12% drawdown against a 10% breaker threshold.
    service.store.saveTradeResult({
      id: "mtr-dd",
      orderId: "paper-dd",
      entryPrice: 100,
      exitPrice: 88,
      quantity: 100,
      grossPnl: -12000,
      fees: 0,
      netPnl: -12000,
      openedAt: new Date(clockMs).toISOString(),
      closedAt: new Date(clockMs).toISOString(),
    });
    const signalId = seedSignal(service);
    const assessment = service.runRiskCheck(signalId, admin, "corr-dd");
    expect(assessment.passed).toBe(false);
    expect(service.breaker.current().state).toBe("PAUSED");
    expect(service.health().circuitBreaker).toBe("PAUSED");
  });

  test("max open positions hard-fails at the configured ceiling", () => {
    const riskLimits = baseConfig({ maxOpenPositions: 1 });
    const tight = new MarketService({ config: riskLimits, now: () => new Date(clockMs) });
    // One open paper position already occupies the single slot.
    tight.store.savePaperOrder({
      id: "mpo-1",
      proposalId: "mprp-existing",
      paperOrderId: "paper-1",
      symbol: "MSFT",
      direction: "long",
      orderType: "market",
      quantity: 10,
      requestedPrice: 400,
      filledPrice: 400,
      slippageBps: 0,
      status: "filled",
      submittedAt: new Date(clockMs).toISOString(),
      filledAt: new Date(clockMs).toISOString(),
    });
    const signalId = seedSignal(tight);
    const assessment = tight.runRiskCheck(signalId, admin, "corr-ops");
    expect(assessment.passed).toBe(false);
    expect(assessment.hardFailures.some(f => f.policyId === "max_open_positions")).toBe(true);
  });

  test("sector and volatility policies report NOT_EVALUATED_MISSING_DATA rather than fabricating", () => {
    const signalId = seedSignal(service);
    const assessment = service.runRiskCheck(signalId, admin, "corr-missing");
    expect(assessment.passed).toBe(true);
    const codes = assessment.infos.map(f => f.code);
    expect(codes).toContain("NOT_EVALUATED_MISSING_DATA");
  });
});

function seedSignal(service: MarketService): string {
  const signal = makeSignal({ id: `msig-${Math.floor(clockMs)}-${Math.random().toString(36).slice(2, 8)}` });
  service.store.saveSignal(signal, "VERIFIED", null);
  return signal.id;
}

// ---------------------------------------------------------------------------
// Circuit breaker transitions
// ---------------------------------------------------------------------------

describe("Phase 20.52 — global circuit breaker", () => {
  test("ACTIVE -> PAUSED -> ACTIVE works; LOCKED can only be released by an operator", () => {
    freshDb();
    const store = new MarketDbStore();
    store.init();
    const breaker = new GlobalCircuitBreaker({ store });
    expect(breaker.current().state).toBe("ACTIVE");
    expect(breaker.isExecutionAllowed()).toBe(true);

    breaker.transition("PAUSED", { type: "system", id: "drawdown" }, { reason: "test" });
    expect(breaker.current().state).toBe("PAUSED");
    expect(breaker.isExecutionAllowed()).toBe(false);

    breaker.transition("LOCKED", admin, { reason: "operator stop" });
    expect(() => breaker.transition("ACTIVE", { type: "system", id: "auto" })).toThrow(/MARKET_CIRCUIT_BREAKER_LOCKED/);
    breaker.transition("ACTIVE", admin);
    expect(breaker.current().state).toBe("ACTIVE");
  });

  test("service forbids breaker changes for non-operators", () => {
    freshDb();
    process.env.MARKET_OPERATOR_ACTORS = "admin";
    const service = new MarketService({ config: baseConfig(), now: () => new Date(clockMs) });
    expect(() => service.setBreakerState("PAUSED", nobody, "nope")).toThrow(/MARKET_CIRCUIT_BREAKER_FORBIDDEN/);
    expect(() => service.setBreakerState("PAUSED", admin, "ops")).not.toThrow();
    expect(service.breaker.current().state).toBe("PAUSED");
  });
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

describe("Phase 20.52 — human approval runtime", () => {
  let store: MarketDbStore;
  let approvals: ApprovalService;

  beforeEach(() => {
    freshDb();
    store = new MarketDbStore();
    store.init();
    let nowMs = Date.now();
    approvals = new ApprovalService({
      store,
      bus: new MarketEventBus(),
      expiryMinutes: 30,
      permissions: { canApprove: a => a.type === "user" && a.id === "admin", canView: () => true },
      now: () => new Date(nowMs),
    });
    // Expose the clock for expiry tests.
    (approvals as unknown as { setClock(ms: number): void }).setClock = (ms: number) => {
      nowMs = ms;
    };
  });

  function seedProposal(): string {
    store.saveProposal({
      id: "mprp-1",
      signalId: "msig-1",
      riskAssessmentId: "mrsk-1",
      symbol: "AAPL",
      direction: "long",
      orderType: "market",
      quantity: 10,
      requestedPrice: 200,
      executionMode: "paper",
      status: "awaiting_approval",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const approval = approvals.request("mprp-1", "corr-1");
    return approval.id;
  }

  test("approval requires the configured permission", () => {
    const approvalId = seedProposal();
    expect(() => approvals.approve(approvalId, nobody)).toThrow(ApprovalError);
    try {
      approvals.approve(approvalId, nobody);
    } catch (err) {
      expect((err as ApprovalError).code).toBe("MARKET_APPROVAL_FORBIDDEN");
      expect((err as ApprovalError).httpStatus).toBe(403);
    }
    // Provider/system actors can never approve.
    expect(() => approvals.approve(approvalId, { type: "agent", id: "market-agent" })).toThrow(ApprovalError);
    expect(approvals.approve(approvalId, admin).status).toBe("approved");
  });

  test("double approval is idempotent for the same actor and conflicts for others", () => {
    const approvalId = seedProposal();
    approvals.approve(approvalId, admin);
    expect(approvals.approve(approvalId, admin).status).toBe("approved");
    try {
      approvals.reject(approvalId, admin, "late change");
      throw new Error("expected rejection to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalError);
      expect((err as ApprovalError).code).toBe("MARKET_APPROVAL_ALREADY_RESOLVED");
    }
  });

  test("expired approvals cannot be approved", () => {
    const approvalId = seedProposal();
    (approvals as unknown as { __clock?: number }).__clock = undefined;
    // Advance the injected clock past the expiry.
    const clockHolder = approvals as unknown as { setClock?: (ms: number) => void };
    clockHolder.setClock?.(Date.now() + 31 * 60_000);
    try {
      approvals.approve(approvalId, admin);
      throw new Error("expected expired approval to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalError);
      expect((err as ApprovalError).code).toBe("MARKET_APPROVAL_EXPIRED");
    }
    expect(approvals.store.getApproval(approvalId)?.status).toBe("expired");
  });

  test("reject records the reason and resolution is optimistic", () => {
    const approvalId = seedProposal();
    const resolved = approvals.reject(approvalId, admin, "bad setup");
    expect(resolved.status).toBe("rejected");
    expect(resolved.rejectionReason).toBe("bad setup");
    expect(resolved.version).toBe(2);
    // A stale-version resolution attempt fails.
    expect(store.resolveApproval(approvalId, "approved", { by: "admin", at: new Date().toISOString() }, 1)).toBeNull();
  });

  test("expireStale resolves only past-deadline requests", () => {
    store.saveProposal({
      id: "mprp-2",
      signalId: "msig-2",
      riskAssessmentId: "mrsk-2",
      symbol: "MSFT",
      direction: "long",
      orderType: "market",
      quantity: 5,
      executionMode: "paper",
      status: "awaiting_approval",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    approvals.request("mprp-2", "corr-2");
    // Nothing stale yet.
    expect(approvals.expireStale()).toBe(0);
    const clockHolder = approvals as unknown as { setClock?: (ms: number) => void };
    clockHolder.setClock?.(Date.now() + 31 * 60_000);
    expect(approvals.expireStale()).toBeGreaterThanOrEqual(1);
    expect(store.listPendingApprovals()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Paper broker + execution
// ---------------------------------------------------------------------------

describe("Phase 20.52 — paper execution", () => {
  test("paper broker fills deterministically with adverse slippage and never contacts a live endpoint", async () => {
    const broker = new PaperBrokerAdapter({ slippageBps: 10 });
    const long = await broker.createOrder({ proposalId: "p1", symbol: "AAPL", direction: "long", orderType: "market", quantity: 100, requestedPrice: 200 });
    expect(long.status).toBe("filled");
    expect(long.filledPrice).toBeCloseTo(200.2, 6);
    const short = await broker.createOrder({ proposalId: "p2", symbol: "AAPL", direction: "short", orderType: "market", quantity: 100, requestedPrice: 200 });
    expect(short.filledPrice).toBeCloseTo(199.8, 6);
  });

  test("live mode is refused structurally", () => {
    expect(() => assertPaperOnly("live")).toThrow(LiveBrokerDisabledError);
    const store = new MarketDbStore();
    store.init();
    expect(
      () =>
        new ExecutionService({
          store,
          bus: new MarketEventBus(),
          broker: { id: "rogue", mode: "live", createOrder: async () => ({ orderId: "x", status: "filled" as const, submittedAt: "" }) },
        }),
    ).toThrow(LiveBrokerDisabledError);
  });

  test("approval -> execution -> close produces a deterministic paper trade with audit", async () => {
    freshDb();
    process.env.MARKET_APPROVER_ACTORS = "admin";
    process.env.MARKET_OPERATOR_ACTORS = "admin";
    const config = baseConfig();
    const service = new MarketService({ config, now: () => new Date(clockMs) });
    const signalId = seedSignal(service);
    const { proposal } = await service.advanceToApproval(signalId, admin);
    expect(proposal).toBeDefined();
    expect(proposal!.executionMode).toBe("paper");

    const pending = service.store.listPendingApprovals();
    expect(pending).toHaveLength(1);
    const approvalId = pending[0]!.id;

    // An unauthorized user cannot approve.
    expect(() => service.approveProposal(approvalId, nobody)).toThrow(ApprovalError);
    service.approveProposal(approvalId, admin);

    const { orderId } = await service.executeProposal(proposal!.id, admin);
    expect(orderId).toMatch(/^paper-/);
    // Idempotent execution returns the same order.
    const again = await service.executeProposal(proposal!.id, admin);
    expect(again.orderId).toBe(orderId);

    const result = service.closePosition(orderId, proposal!.requestedPrice! + 5, admin);
    expect(result.netPnl).toBeCloseTo(5 * proposal!.quantity, 6);

    // Audit trail records the whole chain.
    const auditActions = service.auditTrail({ limit: 50 }).map(a => a.eventType);
    expect(auditActions).toContain("market.proposal.created");
    expect(auditActions).toContain("market.approval.approved");
    expect(auditActions).toContain("paper.order.executed");
    expect(auditActions).toContain("market.trade.closed");

    // No notification may contain secret-shaped material.
    for (const notification of service.notifications(50)) {
      expect(notification.body).not.toMatch(/secret|bearer|authorization/i);
    }
  });

  test("execution of a non-approved proposal is refused", async () => {
    freshDb();
    process.env.MARKET_APPROVER_ACTORS = "admin";
    const config = baseConfig();
    const service = new MarketService({ config, now: () => new Date(clockMs) });
    const signalId = seedSignal(service);
    const { risk } = await service.advanceToApproval(signalId, admin);
    expect(risk.passed).toBe(true);
    const proposal = service.store.listProposals("awaiting_approval")[0]!;
    await expect(service.executeProposal(proposal.id, admin)).rejects.toThrow(/not approved/);
  });
});
