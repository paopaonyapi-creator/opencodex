/**
 * Pao Market Signal Control Plane — public entry point (Phase 20.52).
 *
 * Activation surface for the optional market subsystem: it registers into the
 * Agent OS runtime at activation rather than being imported by any core
 * request path. Live trading does not exist in this phase.
 */

export { startMarketServer, type MarketServerHandle } from "./server";
export { loadMarketConfig, LIVE_EXECUTION_DISABLED, type MarketConfig } from "./config";
export { MarketService, defaultPermissionsFromEnv, type MarketActorPermissions } from "./service";
export { MarketIngestPipeline, type IngestOutcome } from "./pipeline";
export { MarketDbStore } from "./db-store";
export { MarketEventBus, correlationId, nextId, type MarketEventPayloadMap } from "./events";
export { canTransition, requireTransition, lifecycleSuccessors } from "./lifecycle";
export {
  verifyIngress,
  verifySignedWebhook,
  constantTimeEqualHex,
  hmacSha256Hex,
  redactHeaders,
  sha256Hex,
  RateLimiter,
  withinSizeLimit,
  isStaleTimestamp,
} from "./ingress/security";
export {
  KamdenAdapter,
  TradingViewAdapter,
  GenericWebhookAdapter,
  ManualSignalAdapter,
  buildDefaultRegistry,
  MarketProviderRegistry,
} from "./providers/adapters-exports";
export {
  MarketRiskEngine,
  computePositionSize,
  MaxRiskPerTradePolicy,
  DailyLossLimitPolicy,
  MaxOpenPositionsPolicy,
  SymbolExposurePolicy,
  SectorExposurePolicy,
  GrossExposurePolicy,
  DrawdownCircuitBreakerPolicy,
  MarketHoursPolicy,
  VolatilityGuardPolicy,
} from "./risk/engine";
export { GlobalCircuitBreaker } from "./risk/circuit-breaker";
export { ApprovalService, ApprovalError, type ApprovalPermissions } from "./approvals/service";
export {
  ExecutionService,
  PaperBrokerAdapter,
  LiveBrokerDisabledError,
  assertPaperOnly,
  type BrokerAdapter,
} from "./execution/broker";
export {
  AnalysisOrchestrator,
  deterministicAnalysisModel,
  runReviewerCouncil,
  PROMPT_VERSIONS,
  type AnalysisModelFn,
} from "./analysis/orchestrator";
export { validateAnalysisNumbers, detectFabricationPhrases } from "./analysis/hallucination-guard";
export { MarketNotifier, type NotificationSink } from "./notifier";
export { SignalQualityGrader } from "./quality";
export type {
  ApprovalRequest,
  AuditRecord,
  CircuitBreakerRecord,
  MarketSignal,
  MarketModuleHealth,
  PaperPosition,
  RiskAssessment,
  RiskFinding,
  SignalQuality,
  SignalStatus,
  TradeProposal,
  TradeResult,
} from "./types";
