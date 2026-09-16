/**
 * Pao AI Gateway — Public entry point.
 *
 * This is the activation surface for the optional gateway subsystem.
 * Following the project's optional-subsystem pattern, it registers into
 * a core-owned slot at activation rather than being directly imported
 * by the core request path.
 */

export { startGatewayServer, type GatewayServerHandle } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig } from "./types";

// Phase 20.17 — adaptive routing surface. Exported so the management API and the
// dashboard read one module rather than reaching into routing internals.
export {
  classifyTask,
  CircuitBreaker,
  getCircuitBreaker,
  resetCircuitBreaker,
  projectHealthState,
  isPermitting,
  routeLevelRank,
  ROUTE_LEVELS,
  type Classification,
  type ClassificationInput,
  type CircuitState,
  type HealthState,
  type RouteLevel,
  type Sensitivity,
  type TaskKind,
} from "./routing/adaptive";
export {
  decideEscalation,
  type EscalationDecision,
  type EscalationInput,
} from "./routing/escalation";
export {
  rankCandidates,
  scoreCandidate,
  deriveRouteLevel,
  satisfiesCapabilities,
  isLocalModel,
  type RankingPreferences,
  type ScoredCandidate,
} from "./routing/candidates";
export {
  createRouterArtifact,
  transitionRouter,
  isServing,
  evaluateDirectBypass,
  bypassJustified,
  ROUTER_LIFECYCLE_STATES,
  type BypassDecision,
  type DirectBypassConfig,
  type RouterArtifact,
  type RouterLifecycleState,
} from "./routing/lifecycle";
export {
  verifyUpstreamLock,
  probeUpstreamVersion,
  parseUpstreamLock,
  defaultLockPath,
  type UpstreamLockResult,
  type UpstreamPin,
  type VersionProbeResult,
} from "./upstream-lock";
export { ExperientialProvider } from "./providers/experiential";

// Phase 20.51 — quota-aware governance + 9Router gateway surface. Exported so
// the management API and tooling read one module instead of reaching into
// routing/resilience internals.
export { QuotaStore } from "./quota/store";
export {
  classifyFreshness,
  quotaHeadroomScore,
  quotaUncertaintyPenalty,
  cooldownRemainingMs,
  normalizeQuotaRecord,
  normalizeQuotaPayload,
  selectPrimaryWindow,
} from "./quota/model";
export {
  classifyGatewayFailure,
  FAILURE_BEHAVIORS,
  type FailureBehavior,
  type RetrySameRoute,
} from "./resilience/classifier";
export { ConnectionStore, type ConnectionRecord, type SoftFailureInput } from "./resilience/connection-state";
export { startRecoveryWorker, type RecoveryWorkerHandle, type RecoveryWorkerDeps } from "./resilience/recovery";
export {
  NineRouterProvider,
  NINE_ROUTER_DEFAULT_BASE_URL,
  type NineRouterTelemetry,
} from "./providers/nine-router";
export { LeaseStore } from "./routing/leases";
export {
  planQuotaAwareRoute,
  routeKeyOf,
  WEIGHT_PROFILES,
  resolveWeights,
  costScore,
  type GovernanceCandidate,
  type QuotaRoutingContext,
  type QuotaRoutingInput,
  type QuotaRoutingResult,
  type ScoredRouteCandidate,
} from "./routing/quota-router";
export {
  executeGoverned,
  type GovernedExecutionInput,
  type GovernedExecutionResult,
} from "./routing/fallback-controller";
export {
  recordDecision,
  recordRouteAttempt,
  recordGatewayEvent,
  readDecisions,
  readGatewayEvents,
  readRouteAttempts,
} from "./traces/decision-ledger";
export type {
  ConnectionState,
  GatewayFailureClass,
  QuotaConfidence,
  QuotaFreshness,
  QuotaWindow,
  QuotaWindowType,
  RouteDecisionRecord,
  RouteLease,
  RoutingGovernanceConfig,
} from "./types";
