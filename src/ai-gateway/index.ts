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
