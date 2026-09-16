/**
 * Pao Market Signal Control Plane — paper broker + execution service
 * (Phase 20.52 §24-25).
 *
 * The paper broker fills orders deterministically against the requested
 * price with configurable slippage, persists everything, and never contacts
 * any external endpoint. Live mode is not a configuration option in this
 * phase: LIVE_EXECUTION_DISABLED is a compile-time constant.
 */

import { LIVE_EXECUTION_DISABLED } from "../config";
import type {
  ActorRef,
  BrokerOrderRequest,
  BrokerOrderResult,
  TradeProposal,
  TradeResult,
} from "../types";
import type { MarketEventBus } from "../events";
import type { MarketDbStore } from "../db-store";
import { nextId } from "../events";

export interface BrokerAdapter {
  readonly id: string;
  readonly mode: "paper" | "live";
  createOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
}

export interface PaperBrokerOptions {
  readonly slippageBps?: number;
  readonly now?: () => Date;
}

/**
 * PaperBrokerAdapter — the only broker implementation in this phase. It
 * performs no network I/O of any kind.
 */
export class PaperBrokerAdapter implements BrokerAdapter {
  readonly id = "paper";
  readonly mode = "paper" as const;
  private readonly slippageBps: number;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: PaperBrokerOptions = {}) {
    this.slippageBps = options.slippageBps ?? 0;
    this.now = options.now ?? (() => new Date());
  }

  async createOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    if (LIVE_EXECUTION_DISABLED && request.proposalId.startsWith("live:")) {
      // Belt-and-braces: even a forged proposal id cannot reach a live path.
      return { orderId: "", status: "rejected", rejectionReason: "MARKET_LIVE_EXECUTION_DISABLED", submittedAt: this.now().toISOString() };
    }
    if (!(request.quantity > 0)) {
      return { orderId: "", status: "rejected", rejectionReason: "MARKET_PAPER_EXECUTION_FAILED: quantity must be positive", submittedAt: this.now().toISOString() };
    }
    const requested = request.requestedPrice ?? 0;
    if (!(requested > 0)) {
      return { orderId: "", status: "rejected", rejectionReason: "MARKET_PAPER_EXECUTION_FAILED: a positive fill price is required", submittedAt: this.now().toISOString() };
    }

    // Deterministic fill: adverse slippage only (worse price for the trader).
    const slippageFactor = this.slippageBps / 10_000;
    const filledPrice =
      request.direction === "long" ? requested * (1 + slippageFactor) : requested * (1 - slippageFactor);

    this.sequence += 1;
    const submittedAt = this.now().toISOString();
    return {
      orderId: `paper-${Date.now()}-${this.sequence}`,
      status: "filled",
      filledPrice: Math.round(filledPrice * 1e6) / 1e6,
      slippageBps: this.slippageBps,
      submittedAt,
      filledAt: submittedAt,
    };
  }
}

/**
 * Live broker adapter intentionally NOT implemented. The type exists so a
 * future phase must write real code against a reviewed interface, and the
 * execution service refuses any non-paper mode at runtime.
 */
export class LiveBrokerDisabledError extends Error {
  readonly code = "MARKET_LIVE_EXECUTION_DISABLED";
  constructor() {
    super("Live execution is hard-disabled in Phase 20.52");
  }
}

export function assertPaperOnly(mode: BrokerAdapter["mode"]): void {
  if (LIVE_EXECUTION_DISABLED && mode !== "paper") {
    throw new LiveBrokerDisabledError();
  }
}

// ---------------------------------------------------------------------------
// Execution service — ties proposals, approvals, broker, ledger, events
// ---------------------------------------------------------------------------

export interface ExecutionServiceDeps {
  readonly store: MarketDbStore;
  readonly bus: MarketEventBus;
  readonly broker: BrokerAdapter;
  readonly now?: () => Date;
}

export class ExecutionService {
  private readonly store: MarketDbStore;
  private readonly bus: MarketEventBus;
  private readonly broker: BrokerAdapter;
  private readonly now: () => Date;

  constructor(deps: ExecutionServiceDeps) {
    this.store = deps.store;
    this.bus = deps.bus;
    this.broker = deps.broker;
    this.now = deps.now ?? (() => new Date());
    assertPaperOnly(deps.broker.mode);
  }

  /**
   * Execute an APPROVED proposal. Idempotent per proposal: an already-
   * executed proposal returns its existing paper order instead of double-
   * filling.
   */
  async executeApproved(proposal: TradeProposal, actor: ActorRef, correlationId: string): Promise<{ orderId: string; result: BrokerOrderResult }> {
    if (proposal.executionMode !== "paper") {
      throw new LiveBrokerDisabledError();
    }
    if (proposal.status !== "approved") {
      throw new Error("MARKET_PAPER_EXECUTION_FAILED: proposal is not in approved state");
    }
    const existing = this.store.getPaperOrderByProposal(proposal.id);
    if (existing && existing.status === "filled") {
      return { orderId: existing.orderId, result: { orderId: existing.orderId, status: "filled", filledPrice: existing.entryPrice, slippageBps: existing.slippageBps, submittedAt: existing.openedAt, filledAt: existing.openedAt } };
    }

    const result = await this.broker.createOrder({
      proposalId: proposal.id,
      symbol: proposal.symbol,
      direction: proposal.direction,
      orderType: proposal.orderType,
      quantity: proposal.quantity,
      requestedPrice: proposal.requestedPrice,
      stopPrice: proposal.stopPrice,
      targetPrice: proposal.targetPrice,
    });

    if (result.status !== "filled") {
      this.bus.publish({
        type: "paper.order.failed",
        payload: { proposalId: proposal.id, reason: result.rejectionReason ?? "unknown" },
        correlationId,
        actor,
      });
      throw new Error(`MARKET_PAPER_EXECUTION_FAILED: ${result.rejectionReason ?? "broker rejected the order"}`);
    }

    this.store.savePaperOrder({
      id: nextId("mpo"),
      proposalId: proposal.id,
      paperOrderId: result.orderId,
      symbol: proposal.symbol,
      direction: proposal.direction,
      orderType: proposal.orderType,
      quantity: proposal.quantity,
      requestedPrice: proposal.requestedPrice,
      filledPrice: result.filledPrice,
      slippageBps: result.slippageBps ?? 0,
      status: "filled",
      submittedAt: result.submittedAt,
      filledAt: result.filledAt,
    });

    this.bus.publish({
      type: "paper.order.created",
      payload: { orderId: result.orderId, proposalId: proposal.id },
      correlationId,
      actor,
    });
    this.bus.publish({
      type: "paper.order.executed",
      payload: { orderId: result.orderId, proposalId: proposal.id, filledPrice: result.filledPrice ?? 0 },
      correlationId,
      actor,
    });
    this.bus.publish({
      type: "market.trade.opened",
      payload: { orderId: result.orderId, symbol: proposal.symbol },
      correlationId,
      actor,
    });

    return { orderId: result.orderId, result };
  }

  /**
   * Close an open paper position at the given exit price. Computes P/L
   * deterministically (direction-aware) and records the trade result.
   */
  closePosition(orderId: string, exitPrice: number, correlationId: string, actor: ActorRef): TradeResult {
    const order = this.store
      .listOpenPositions()
      .find(p => p.orderId === orderId);
    if (!order) throw new Error("MARKET_PAPER_EXECUTION_FAILED: open paper position not found");
    if (!(exitPrice > 0)) throw new Error("MARKET_PAPER_EXECUTION_FAILED: exit price must be positive");

    const directionFactor = order.direction === "long" ? 1 : -1;
    const grossPnl = (exitPrice - order.entryPrice) * order.quantity * directionFactor;
    const fees = 0; // paper trading: zero commission by definition
    const closedAt = this.now().toISOString();
    const result: TradeResult = {
      id: nextId("mtr"),
      orderId,
      entryPrice: order.entryPrice,
      exitPrice,
      quantity: order.quantity,
      grossPnl,
      fees,
      netPnl: grossPnl - fees,
      openedAt: order.openedAt,
      closedAt,
    };
    this.store.saveTradeResult(result);
    this.store.markPaperOrderClosed(orderId, closedAt);
    this.bus.publish({
      type: "market.trade.closed",
      payload: { orderId, netPnl: result.netPnl },
      correlationId,
      actor,
    });
    return result;
  }
}
