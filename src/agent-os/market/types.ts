/**
 * Pao Market Signal Control Plane — Phase 20.52 canonical type surface.
 *
 * Paper-trading-first. Human approval is mandatory before any execution
 * path. Nothing in this file is provider-specific: provider adapters own
 * their schemas and normalize into these types.
 */

// ---------------------------------------------------------------------------
// Providers & ingress
// ---------------------------------------------------------------------------

export type MarketProviderId = string;

export type ProviderAuthType =
  | "hmac_sha256"
  | "static_token"
  | "bearer"
  | "none"
  | "manual";

export interface ProviderHealth {
  readonly providerId: MarketProviderId;
  readonly enabled: boolean;
  readonly state: "healthy" | "degraded" | "down" | "disabled" | "unknown";
  readonly lastEventAt?: string;
  readonly lastFailureAt?: string;
  readonly verificationFailureRate: number;
  readonly duplicateRate: number;
}

/** What an adapter receives: the raw bytes plus redacted-safe metadata. */
export interface IncomingWebhookRequest {
  readonly providerId: MarketProviderId;
  readonly rawBody: Uint8Array;
  readonly headers: Record<string, string>;
  readonly receivedAt: string;
  /** Caller-supplied actor for manual signals; absent for webhooks. */
  readonly actor?: ActorRef;
}

export interface VerificationResult {
  readonly valid: boolean;
  readonly errorCode?:
    | "MARKET_WEBHOOK_SIGNATURE_INVALID"
    | "MARKET_WEBHOOK_TIMESTAMP_STALE"
    | "MARKET_WEBHOOK_PAYLOAD_TOO_LARGE"
    | "MARKET_PROVIDER_DISABLED"
    | "MARKET_PROVIDER_UNKNOWN";
  readonly message?: string;
  readonly deliveryId?: string;
  readonly providerEventId?: string;
}

export interface ProviderEvent {
  readonly providerId: MarketProviderId;
  readonly providerEventId?: string;
  readonly deliveryId?: string;
  readonly eventType: MarketSignalEventType;
  readonly symbol?: string;
  /** Provider-specific extras preserved verbatim, secrets already redacted. */
  readonly metadata: Record<string, unknown>;
  readonly signalTime?: string;
  readonly fields: Record<string, unknown>;
}

export type MarketSignalEventType = "entry" | "exit" | "update" | "alert" | "unknown";

export type MarketDirection = "long" | "short" | "neutral";

export type AssetClass =
  | "equity"
  | "etf"
  | "crypto"
  | "forex"
  | "index"
  | "future"
  | "unknown";

// ---------------------------------------------------------------------------
// Canonical signal
// ---------------------------------------------------------------------------

export interface MarketSignal {
  readonly id: string;
  readonly provider: MarketProviderId;
  readonly providerEventId?: string;
  readonly deliveryId?: string;

  readonly eventType: MarketSignalEventType;
  readonly symbol: string;
  readonly assetClass: AssetClass;
  readonly exchange?: string;
  readonly currency?: string;
  readonly direction?: MarketDirection;

  readonly entryPrice?: number;
  readonly stopPrice?: number;
  readonly targetPrice?: number;

  /** Confidence is ALWAYS attributed: whose confidence this number is. */
  readonly providerConfidence?: number;
  readonly providerScore?: number;

  readonly timeframe?: string;
  readonly strategy?: string;

  readonly signalTime: string;
  readonly receivedAt: string;
  readonly normalizedAt: string;

  readonly sourceUrl?: string;
  readonly tags: readonly string[];

  readonly verified: boolean;
  readonly duplicate: boolean;

  readonly rawEventId: string;
  readonly metadata: Record<string, unknown>;
}

/** Deterministic data-quality grade: completeness/trust, never profitability. */
export interface SignalQuality {
  readonly grade: "A" | "B" | "C" | "D" | "insufficient";
  readonly reasons: string[];
}

// ---------------------------------------------------------------------------
// Signal lifecycle
// ---------------------------------------------------------------------------

export type SignalStatus =
  | "RECEIVED"
  | "VERIFYING"
  | "FAILED_VERIFICATION"
  | "VERIFIED"
  | "DUPLICATE"
  | "NORMALIZED"
  | "ANALYZING"
  | "ANALYSIS_FAILED"
  | "ANALYZED"
  | "RISK_CHECK"
  | "RISK_REJECTED"
  | "PROPOSAL_READY"
  | "AWAITING_APPROVAL"
  | "REJECTED"
  | "EXPIRED"
  | "APPROVED"
  | "PAPER_EXECUTION_PENDING"
  | "PAPER_EXECUTED"
  | "CLOSED";

export interface StatusTransition {
  readonly signalId: string;
  readonly from: SignalStatus;
  readonly to: SignalStatus;
  readonly reason: string;
  readonly actor: ActorRef;
  readonly at: string;
}

// ---------------------------------------------------------------------------
// Actors, events, audit
// ---------------------------------------------------------------------------

export type ActorType = "user" | "system" | "agent" | "provider" | "scheduler";

export interface ActorRef {
  readonly type: ActorType;
  readonly id: string;
}

export type MarketEventType =
  | "market.signal.received"
  | "market.signal.verification_failed"
  | "market.signal.verified"
  | "market.signal.duplicate"
  | "market.signal.normalized"
  | "market.analysis.requested"
  | "market.analysis.completed"
  | "market.analysis.failed"
  | "market.risk.requested"
  | "market.risk.passed"
  | "market.risk.failed"
  | "market.proposal.created"
  | "market.approval.requested"
  | "market.approval.approved"
  | "market.approval.rejected"
  | "market.approval.expired"
  | "paper.order.created"
  | "paper.order.executed"
  | "paper.order.failed"
  | "market.trade.opened"
  | "market.trade.closed"
  | "market.provider.degraded"
  | "market.provider.recovered"
  | "market.circuit_breaker.triggered"
  | "market.circuit_breaker.reset"
  | "market.notification.emitted";

export interface Actor {
  readonly type: ActorType;
  readonly id: string;
}

export interface MarketEvent<T = Record<string, unknown>> {
  readonly eventId: string;
  readonly type: MarketEventType;
  readonly version: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actor?: Actor;
  readonly payload: T;
}

export interface AuditRecord {
  readonly id: string;
  readonly correlationId: string;
  readonly eventType: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly action: string;
  readonly result: "success" | "failure" | "denied";
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// AI analysis (advisory only — never authoritative for market facts)
// ---------------------------------------------------------------------------

export interface ReviewerVote {
  readonly reviewer: string;
  readonly verdict: "support" | "oppose" | "abstain";
  /** AI/self-assessed conviction, never a probability of profit. */
  readonly confidence: number;
  readonly reasons: string[];
  readonly warnings: string[];
}

export interface CouncilConsensus {
  readonly result: "support" | "mixed" | "oppose" | "insufficient_data";
  readonly votes: ReviewerVote[];
}

export interface ModelRunRef {
  readonly agentId: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly promptVersion: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly errorCode?: string;
}

export interface AnalysisValidation {
  readonly valid: boolean;
  readonly unsupportedClaims: string[];
  readonly warnings: string[];
}

export interface MarketAIAnalysis {
  readonly id: string;
  readonly signalId: string;

  readonly dataSufficient: boolean;
  readonly missingData: string[];

  readonly summary: string;

  readonly bullishFactors: string[];
  readonly bearishFactors: string[];
  readonly invalidationFactors: string[];

  readonly riskNotes: string[];

  /** Attributed self-assessment of the analysis, NOT a probability of profit. */
  readonly confidence: number;
  readonly confidenceBasis: string[];

  readonly reviewerConsensus?: CouncilConsensus;
  readonly validation: AnalysisValidation;
  readonly modelRuns: ModelRunRef[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export type RiskSeverity = "INFO" | "WARNING" | "HARD_FAIL";

export interface RiskFinding {
  readonly policyId: string;
  readonly severity: RiskSeverity;
  readonly code: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface RiskContext {
  readonly signal: MarketSignal;
  readonly account: PaperAccountState;
  readonly openPositions: readonly PaperPosition[];
  readonly dailyState: DailyRiskState;
  readonly circuitBreaker: CircuitBreakerRecord;
  /** Trusted volatility context if a real provider supplied it; else absent. */
  readonly volatility?: { readonly source: string; readonly value: number };
  readonly now: string;
}

export interface RiskAssessment {
  readonly id: string;
  readonly signalId: string;
  readonly passed: boolean;
  readonly hardFailures: RiskFinding[];
  readonly warnings: RiskFinding[];
  readonly infos: RiskFinding[];
  readonly accountValue?: number;
  readonly plannedRiskAmount?: number;
  readonly positionSize?: number;
  readonly estimatedPositionValue?: number;
  readonly exposureBefore?: number;
  readonly exposureAfter?: number;
  readonly createdAt: string;
}

export interface RiskPolicy {
  readonly id: string;
  readonly enabled?: boolean;
  evaluate(context: RiskContext): RiskFinding[];
}

export interface MarketRiskPolicy {
  readonly id: string;
  readonly enabled: boolean;
  evaluate(context: RiskContext): RiskFinding[];
}

// ---------------------------------------------------------------------------
// Proposals, approvals, execution
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "executed";

export interface TradeProposal {
  readonly id: string;
  readonly signalId: string;
  readonly analysisId?: string;
  readonly riskAssessmentId: string;

  readonly symbol: string;
  readonly direction: "long" | "short";
  readonly orderType: "market" | "limit" | "stop" | "stop_limit";

  readonly quantity: number;
  readonly requestedPrice?: number;
  readonly stopPrice?: number;
  readonly targetPrice?: number;

  /** Phase 20.52 hard rule: this is always "paper". */
  readonly executionMode: "paper";
  readonly status: ProposalStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  readonly id: string;
  readonly proposalId: string;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly rejectedBy?: string;
  readonly rejectedAt?: string;
  readonly rejectionReason?: string;
  readonly editedFields?: Record<string, unknown>;
  readonly version: number;
}

export type BrokerMode = "paper" | "live";

export interface BrokerOrderRequest {
  readonly proposalId: string;
  readonly symbol: string;
  readonly direction: "long" | "short";
  readonly orderType: "market" | "limit" | "stop" | "stop_limit";
  readonly quantity: number;
  readonly requestedPrice?: number;
  readonly stopPrice?: number;
  readonly targetPrice?: number;
}

export interface BrokerOrderResult {
  readonly orderId: string;
  readonly status: "filled" | "rejected";
  readonly filledPrice?: number;
  readonly slippageBps?: number;
  readonly rejectionReason?: string;
  readonly submittedAt: string;
  readonly filledAt?: string;
}

export interface PaperPosition {
  readonly orderId: string;
  readonly symbol: string;
  readonly direction: "long" | "short";
  readonly quantity: number;
  readonly entryPrice: number;
  readonly stopPrice?: number;
  readonly targetPrice?: number;
  readonly openedAt: string;
  readonly status: "open" | "closed";
}

export interface TradeResult {
  readonly id: string;
  readonly orderId: string;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly netPnl: number;
  readonly openedAt: string;
  readonly closedAt: string;
}

// ---------------------------------------------------------------------------
// Account state — deterministic, never AI-provided
// ---------------------------------------------------------------------------

export interface PaperAccountState {
  /** Configured paper equity. Never inferred from AI or broker state. */
  readonly equity: number;
  readonly currency: string;
}

export interface DailyRiskState {
  readonly date: string;
  readonly openingEquity?: number;
  readonly realizedPnl: number;
  readonly lossPercent?: number;
  readonly circuitBreakerTriggered: boolean;
}

export type CircuitBreakerStateName = "ACTIVE" | "PAUSED" | "LOCKED";

export interface CircuitBreakerRecord {
  readonly state: CircuitBreakerStateName;
  readonly reason?: string;
  readonly triggerCode?: string;
  readonly changedAt: string;
  readonly actor: ActorRef;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface MarketNotification {
  readonly id: string;
  readonly eventType: MarketEventType | "market.risk.hard_fail" | "market.signal.verification_failed";
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly body: string;
  readonly correlationId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Module health (control-plane surface, spec §73)
// ---------------------------------------------------------------------------

export interface MarketModuleHealth {
  readonly status: "healthy" | "degraded" | "down" | "disabled";
  readonly executionMode: "paper";
  readonly circuitBreaker: CircuitBreakerStateName;
  readonly pendingApprovals: number;
  readonly providers: ProviderHealth[];
  readonly lastSignalAt?: string;
  readonly lastErrorAt?: string;
}
