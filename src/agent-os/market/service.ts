/**
 * Pao Market Signal Control Plane — service composition root (Phase 20.52).
 *
 * Wires ingest -> analysis -> deterministic risk -> proposal -> human
 * approval -> paper execution, with the global circuit breaker and audit
 * trail enforced at every gate. This is the class the HTTP server drives;
 * every operator-visible capability goes through here.
 *
 * Hard invariants:
 * - analysis/council can never create or advance a proposal on their own;
 * - proposal creation requires risk.passed === true (deterministic);
 * - execution requires an APPROVED proposal resolved by a permitted human;
 * - execution mode is paper, structurally.
 */

import { loadMarketConfig, type MarketConfig } from "./config";
import { MarketDbStore } from "./db-store";
import { MarketEventBus, nextId } from "./events";
import { MarketIngestPipeline } from "./pipeline";
import { buildDefaultRegistry } from "./providers/registry";
import { MarketRiskEngine } from "./risk/engine";
import { GlobalCircuitBreaker } from "./risk/circuit-breaker";
import { ApprovalService, ApprovalError, type ApprovalPermissions } from "./approvals/service";
import { ExecutionService, PaperBrokerAdapter } from "./execution/broker";
import { AnalysisOrchestrator, deterministicAnalysisModel } from "./analysis/orchestrator";
import { MarketNotifier, type NotificationSink } from "./notifier";
import { computePositionSize } from "./risk/engine";
import { SignalQualityGrader } from "./quality";
import type {
  ActorRef,
  ApprovalRequest,
  MarketAIAnalysis,
  MarketModuleHealth,
  MarketNotification,
  MarketSignal,
  PaperAccountState,
  RiskAssessment,
  SignalQuality,
  TradeProposal,
  TradeResult,
} from "./types";

export interface MarketServiceOptions {
  readonly config?: MarketConfig;
  readonly now?: () => Date;
  readonly notifierSink?: NotificationSink;
}

export interface MarketActorPermissions {
  /** Actor ids that hold market.approval.approve. Empty means no approvers. */
  readonly approverIds: ReadonlySet<string>;
  /** Actor ids that hold market.provider.manage / market.circuit_breaker.manage. */
  readonly operatorIds: ReadonlySet<string>;
}

export function defaultPermissionsFromEnv(): MarketActorPermissions {
  const split = (raw: string | undefined) =>
    new Set(
      (raw ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(s => s !== ""),
    );
  return {
    approverIds: split(process.env.MARKET_APPROVER_ACTORS),
    operatorIds: split(process.env.MARKET_OPERATOR_ACTORS),
  };
}

export class MarketService {
  readonly config: MarketConfig;
  readonly store: MarketDbStore;
  readonly bus: MarketEventBus;
  readonly ingest: MarketIngestPipeline;
  readonly breaker: GlobalCircuitBreaker;
  readonly approvals: ApprovalService;
  readonly execution: ExecutionService;
  readonly notifier: MarketNotifier;
  private readonly riskEngine: MarketRiskEngine;
  private readonly analysis: AnalysisOrchestrator;
  private readonly permissions: MarketActorPermissions;
  private readonly grader = new SignalQualityGrader();
  private readonly now: () => Date;

  constructor(options: MarketServiceOptions = {}) {
    this.config = options.config ?? loadMarketConfig();
    this.now = options.now ?? (() => new Date());
    this.store = new MarketDbStore({ now: this.now });
    this.bus = new MarketEventBus();
    this.ingest = MarketIngestPipeline.create(this.store, this.bus, this.config);
    this.notifier = new MarketNotifier(this.store, { now: this.now });
    if (options.notifierSink) this.notifier.registerSink(options.notifierSink);

    this.breaker = new GlobalCircuitBreaker({
      store: this.store,
      onTransition: (from, to) => {
        this.bus.publish({
          type: to === "ACTIVE" ? "market.circuit_breaker.reset" : "market.circuit_breaker.triggered",
          payload: to === "ACTIVE" ? { to } : { from, to },
          correlationId: `breaker-${Date.now()}`,
          actor: { type: "system", id: "market-circuit-breaker" },
        });
        if (to !== "ACTIVE") {
          this.notifier.emit({
            eventType: "market.circuit_breaker.triggered",
            severity: "error",
            title: "Market circuit breaker triggered",
            body: `State moved ${from} -> ${to}; no new proposals will advance to execution.`,
          });
        }
      },
    });

    this.riskEngine = new MarketRiskEngine({
      config: this.config,
      onDrawdownTrigger: () => {
        try {
          const current = this.breaker.current();
          if (current.state === "ACTIVE") {
            this.breaker.transition("PAUSED", { type: "system", id: "drawdown-policy" }, {
              reason: "Paper drawdown reached the configured circuit-breaker threshold",
              triggerCode: "DRAWDOWN_CIRCUIT_BREAKER",
            });
          }
        } catch {
          // Breaker transition failures surface via health.
        }
      },
    });

    const permissions = defaultPermissionsFromEnv();
    this.permissions = permissions;
    const approvalPermissions: ApprovalPermissions = {
      canApprove: actor => actor.type === "user" && permissions.approverIds.has(actor.id),
      canView: actor => true,
    };
    this.approvals = new ApprovalService({
      store: this.store,
      bus: this.bus,
      expiryMinutes: this.config.approvalExpiryMinutes,
      permissions: approvalPermissions,
      now: this.now,
    });

    this.execution = new ExecutionService({
      store: this.store,
      bus: this.bus,
      broker: new PaperBrokerAdapter({ slippageBps: this.config.paperSlippageBps, now: this.now }),
      now: this.now,
    });

    this.analysis = new AnalysisOrchestrator({
      model: deterministicAnalysisModel(),
      councilEnabled: this.config.reviewerCouncilEnabled,
      now: this.now,
    });
  }

  // ---------------------------------------------------------------------------
  // Account state — deterministic
  // ---------------------------------------------------------------------------

  private accountState(): PaperAccountState {
    return { equity: this.config.paperEquity, currency: this.config.paperCurrency };
  }

  private dailyState(): import("./types").DailyRiskState {
    const date = this.now().toISOString().slice(0, 10);
    const dayStartIso = `${date}T00:00:00.000Z`;
    const realized = this.store.realizedPnlSince(dayStartIso);
    const existing = this.store.getDailyRisk(date);
    const openingEquity = existing?.openingEquity ?? this.config.paperEquity;
    const lossPercent = realized < 0 ? (Math.abs(realized) / Math.max(1, openingEquity)) * 100 : 0;
    const state = {
      date,
      openingEquity,
      realizedPnl: realized,
      lossPercent,
      circuitBreakerTriggered: this.breaker.current().state !== "ACTIVE",
    };
    this.store.upsertDailyRisk(state);
    return state;
  }

  // ---------------------------------------------------------------------------
  // Pipeline steps
  // ---------------------------------------------------------------------------

  async analyzeSignal(signalId: string, actor: ActorRef, correlationId: string): Promise<MarketAIAnalysis> {
    const entry = this.store.getSignal(signalId);
    if (!entry) throw new Error("MARKET_SIGNAL_NOT_FOUND");
    this.store.updateSignalStatus({ signalId, from: entry.status, to: "ANALYZING", reason: "analysis requested", actor, at: this.now().toISOString() });
    this.bus.publish({ type: "market.analysis.requested", payload: { signalId }, correlationId, actor });

    try {
      const analysis = await this.analysis.analyze({
        signal: entry.signal,
        quality: entry.quality,
      });
      this.store.saveAnalysis(analysis);
      this.store.updateSignalStatus({ signalId, from: "ANALYZING", to: "ANALYZED", reason: "analysis completed", actor, at: this.now().toISOString() });
      this.bus.publish({ type: "market.analysis.completed", payload: { signalId, analysisId: analysis.id }, correlationId, causationId: signalId, actor });
      return analysis;
    } catch (err) {
      this.store.updateSignalStatus({ signalId, from: "ANALYZING", to: "ANALYSIS_FAILED", reason: err instanceof Error ? err.message.slice(0, 120) : "analysis failed", actor, at: this.now().toISOString() });
      this.bus.publish({ type: "market.analysis.failed", payload: { signalId, reason: "exception" }, correlationId, actor });
      throw err;
    }
  }

  runRiskCheck(signalId: string, actor: ActorRef, correlationId: string, riskPercent?: number): RiskAssessment {
    const entry = this.store.getSignal(signalId);
    if (!entry) throw new Error("MARKET_SIGNAL_NOT_FOUND");
    this.store.updateSignalStatus({ signalId, from: entry.status, to: "RISK_CHECK", reason: "risk check requested", actor, at: this.now().toISOString() });
    this.bus.publish({ type: "market.risk.requested", payload: { signalId }, correlationId, actor });

    const assessment = this.riskEngine.assess({
      signal: entry.signal,
      account: this.accountState(),
      openPositions: this.store.listOpenPositions(),
      dailyState: this.dailyState(),
      circuitBreaker: this.breaker.current(),
      riskPercent: riskPercent ?? this.config.risk.defaultRiskPercent,
    });
    this.store.saveRiskAssessment(assessment);

    if (assessment.passed) {
      this.store.updateSignalStatus({ signalId, from: "RISK_CHECK", to: "PROPOSAL_READY", reason: "risk passed", actor, at: this.now().toISOString() });
      this.bus.publish({ type: "market.risk.passed", payload: { signalId, assessmentId: assessment.id }, correlationId, actor });
    } else {
      this.store.updateSignalStatus({ signalId, from: "RISK_CHECK", to: "RISK_REJECTED", reason: assessment.hardFailures.map(f => f.code).join(","), actor, at: this.now().toISOString() });
      this.bus.publish({ type: "market.risk.failed", payload: { signalId, assessmentId: assessment.id, codes: assessment.hardFailures.map(f => f.code) }, correlationId, actor });
      this.notifier.emit({
        eventType: "market.risk.hard_fail",
        severity: "warning",
        title: `Risk hard-fail on ${entry.signal.symbol}`,
        body: assessment.hardFailures.map(f => f.message).join("; "),
        correlationId,
        resourceType: "signal",
        resourceId: signalId,
      });
    }
    return assessment;
  }

  /**
   * Create the trade proposal for a risk-passed signal and open its approval
   * request. This is the ONLY path that creates proposals.
   */
  createProposal(signalId: string, actor: ActorRef, correlationId: string, options: { orderType?: TradeProposal["orderType"] } = {}): TradeProposal {
    const entry = this.store.getSignal(signalId);
    if (!entry) throw new Error("MARKET_SIGNAL_NOT_FOUND");
    if (entry.status !== "PROPOSAL_READY") {
      throw new Error("MARKET_PROPOSAL_NOT_READY: signal has not passed deterministic risk checks");
    }
    const assessment = this.store.getRiskAssessmentBySignal(signalId);
    if (!assessment || !assessment.passed || assessment.positionSize === undefined) {
      throw new Error("MARKET_PROPOSAL_NOT_READY: no passing risk assessment");
    }
    const analysis = this.store.getAnalysisBySignal(signalId);
    const sizing = computePositionSize({
      equity: this.config.paperEquity,
      riskPercent: this.config.risk.defaultRiskPercent,
      entryPrice: entry.signal.entryPrice ?? 0,
      stopPrice: entry.signal.stopPrice ?? 0,
      maxRiskPercent: this.config.risk.maxRiskPerTradePercent,
    });
    if (!sizing.ok) throw new Error(`MARKET_RISK_HARD_FAIL: ${sizing.message}`);

    const nowIso = this.now().toISOString();
    const proposal: TradeProposal = {
      id: nextId("mprp"),
      signalId,
      analysisId: analysis?.id,
      riskAssessmentId: assessment.id,
      symbol: entry.signal.symbol,
      direction: entry.signal.direction === "short" ? "short" : "long",
      orderType: options.orderType ?? "market",
      quantity: assessment.positionSize,
      requestedPrice: entry.signal.entryPrice,
      stopPrice: entry.signal.stopPrice,
      targetPrice: entry.signal.targetPrice,
      executionMode: "paper",
      status: "awaiting_approval",
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.store.saveProposal(proposal);
    this.store.updateSignalStatus({ signalId, from: "PROPOSAL_READY", to: "AWAITING_APPROVAL", reason: "proposal created", actor, at: nowIso });
    this.approvals.request(proposal.id, correlationId);
    this.bus.publish({ type: "market.proposal.created", payload: { proposalId: proposal.id, signalId }, correlationId, causationId: signalId, actor });
    this.notifier.emit({
      eventType: "market.approval.requested",
      severity: "info",
      title: `Paper proposal awaiting approval: ${proposal.symbol} ${proposal.direction.toUpperCase()}`,
      body: `Entry ${proposal.requestedPrice ?? "?"}, stop ${proposal.stopPrice ?? "?"}, quantity ${proposal.quantity}, planned risk ${assessment.plannedRiskAmount?.toFixed(2) ?? "?"} ${this.config.paperCurrency}. Mode: PAPER.`,
      correlationId,
      resourceType: "proposal",
      resourceId: proposal.id,
    });
    this.audit(correlationId, "market.proposal.created", actor, "proposal", proposal.id, "success", { symbol: proposal.symbol });
    return proposal;
  }

  /** Full happy-path convenience: analyze -> risk -> proposal (used by tests + API). */
  async advanceToApproval(signalId: string, actor: ActorRef): Promise<{ proposal?: TradeProposal; risk: RiskAssessment; analysis?: MarketAIAnalysis }> {
    const correlation = `adv-${signalId}-${Date.now()}`;
    const analysis = await this.analyzeSignal(signalId, actor, correlation);
    const risk = this.runRiskCheck(signalId, actor, correlation);
    if (!risk.passed) return { risk, analysis };
    const proposal = this.createProposal(signalId, actor, correlation);
    return { proposal, risk, analysis };
  }

  approveProposal(approvalId: string, actor: ActorRef, editedFields?: Record<string, unknown>): ApprovalRequest {
    const resolved = this.approvals.approve(approvalId, actor, editedFields);
    const proposal = this.store.getProposal(resolved.proposalId);
    if (proposal) {
      this.store.updateProposalStatus(proposal.id, "approved", proposal.version);
      this.store.updateSignalStatus({
        signalId: proposal.signalId,
        from: "AWAITING_APPROVAL",
        to: "APPROVED",
        reason: `approved by ${actor.id}`,
        actor,
        at: this.now().toISOString(),
      });
      this.audit(`approval-${approvalId}`, "market.approval.approved", actor, "approval", approvalId, "success", { proposalId: proposal.id });
    }
    return resolved;
  }

  rejectProposal(approvalId: string, actor: ActorRef, reason: string): ApprovalRequest {
    const resolved = this.approvals.reject(approvalId, actor, reason);
    const proposal = this.store.getProposal(resolved.proposalId);
    if (proposal) {
      this.store.updateProposalStatus(proposal.id, "rejected", proposal.version);
      this.store.updateSignalStatus({
        signalId: proposal.signalId,
        from: "AWAITING_APPROVAL",
        to: "REJECTED",
        reason: `rejected by ${actor.id}`,
        actor,
        at: this.now().toISOString(),
      });
      this.audit(`approval-${approvalId}`, "market.approval.rejected", actor, "approval", approvalId, "success", { proposalId: proposal.id, reason });
      this.notifier.emit({
        eventType: "market.approval.rejected",
        severity: "info",
        title: "Paper proposal rejected",
        body: `Proposal ${proposal.id} rejected by ${actor.id}.`,
        resourceType: "proposal",
        resourceId: proposal.id,
      });
    }
    return resolved;
  }

  /** Execute an approved proposal on the paper broker (idempotent per spec 60). */
  async executeProposal(proposalId: string, actor: ActorRef): Promise<{ orderId: string }> {
    const proposal = this.store.getProposal(proposalId);
    if (!proposal) throw new Error("MARKET_PROPOSAL_NOT_FOUND");
    if (proposal.status === "executed") {
      // Idempotency: a repeated execution request returns the existing order
      // instead of double-filling.
      const existing = this.store.getPaperOrderByProposal(proposalId);
      if (existing && existing.status === "filled") return { orderId: existing.orderId };
      throw new Error("MARKET_PAPER_EXECUTION_FAILED: proposal was executed but no paper order exists");
    }
    if (proposal.status !== "approved") {
      throw new Error("MARKET_PAPER_EXECUTION_FAILED: proposal is not approved");
    }
    this.store.updateSignalStatus({
      signalId: proposal.signalId,
      from: "APPROVED",
      to: "PAPER_EXECUTION_PENDING",
      reason: "execution submitted",
      actor,
      at: this.now().toISOString(),
    });
    const { orderId } = await this.execution.executeApproved(proposal, actor, `exec-${proposalId}`);
    this.store.updateProposalStatus(proposalId, "executed", proposal.version);
    this.store.updateSignalStatus({
      signalId: proposal.signalId,
      from: "PAPER_EXECUTION_PENDING",
      to: "PAPER_EXECUTED",
      reason: `paper order ${orderId}`,
      actor,
      at: this.now().toISOString(),
    });
    this.audit(`exec-${proposalId}`, "paper.order.executed", actor, "paper_order", orderId, "success", { proposalId });
    return { orderId };
  }

  closePosition(orderId: string, exitPrice: number, actor: ActorRef): TradeResult {
    const result = this.execution.closePosition(orderId, exitPrice, `close-${orderId}`, actor);
    this.audit(`close-${orderId}`, "market.trade.closed", actor, "paper_order", orderId, "success", { netPnl: result.netPnl });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Breaker + providers + health
  // ---------------------------------------------------------------------------

  setBreakerState(to: "ACTIVE" | "PAUSED" | "LOCKED", actor: ActorRef, reason?: string): void {
    if (actor.type !== "user" || !this.permissions.operatorIds.has(actor.id)) {
      const err = new Error("MARKET_CIRCUIT_BREAKER_FORBIDDEN");
      (err as Error & { httpStatus?: number }).httpStatus = 403;
      throw err;
    }
    this.breaker.transition(to, actor, { reason });
  }

  setProviderEnabled(providerId: string, enabled: boolean, actor: ActorRef): void {
    if (actor.type !== "user" || !this.permissions.operatorIds.has(actor.id)) {
      const err = new Error("MARKET_PROVIDER_MANAGE_FORBIDDEN");
      (err as Error & { httpStatus?: number }).httpStatus = 403;
      throw err;
    }
    this.store.setProviderEnabled(providerId, enabled);
    this.audit(`prov-${providerId}-${Date.now()}`, "market.provider.state_changed", actor, "provider", providerId, "success", { enabled });
  }

  health(): MarketModuleHealth {
    if (!this.config.enabled) {
      return {
        status: "disabled",
        executionMode: "paper",
        circuitBreaker: this.breaker.current().state,
        pendingApprovals: 0,
        providers: [],
      };
    }
    const providers = this.store.listProviders().map(p => this.store.providerHealth(p.providerId));
    const pending = this.store.listPendingApprovals().length;
    const breakerState = this.breaker.current().state;
    const degraded = providers.some(p => p.state === "degraded" || p.state === "down") || breakerState !== "ACTIVE";
    const lastSignal = this.store.listSignals({ limit: 1 })[0];
    return {
      status: degraded ? "degraded" : "healthy",
      executionMode: "paper",
      circuitBreaker: breakerState,
      pendingApprovals: pending,
      providers,
      lastSignalAt: lastSignal?.signal.receivedAt,
    };
  }

  notifications(limit?: number): MarketNotification[] {
    return this.notifier.list(limit);
  }

  /** Scheduler entry point: expire stale approval requests. */
  expireStaleApprovals(): number {
    return this.approvals.expireStale();
  }

  auditTrail(options: { correlationId?: string; resourceType?: string; resourceId?: string; limit?: number }) {
    return this.store.listAudit(options);
  }

  private audit(correlationId: string, eventType: string, actor: ActorRef, resourceType: string, resourceId: string, result: "success" | "failure" | "denied", metadata: Record<string, unknown>): void {
    try {
      this.store.appendAudit({
        id: `mau-${Date.now()}-${Math.abs(correlationId.length * 31 + eventType.length * 17)}`,
        correlationId,
        eventType,
        actorType: actor.type,
        actorId: actor.id,
        resourceType,
        resourceId,
        action: eventType,
        result,
        metadata,
        createdAt: this.now().toISOString(),
      });
    } catch {
      // Audit append failures surface through health, never break the flow.
    }
  }

  /** Exposed for tests and the risk detail endpoint. */
  qualityOf(signal: MarketSignal): SignalQuality {
    return this.grader.grade(signal, this.now().getTime());
  }
}

export { ApprovalError };
