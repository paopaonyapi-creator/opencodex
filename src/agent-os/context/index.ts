/**
 * Pao Context Control Plane — public entry point (Phase 20.53).
 *
 * Activation surface for the optional context subsystem. OpenViking remains
 * an external version-pinned sidecar reached through the compatibility
 * adapter; no AGPLv3 upstream source is vendored.
 */

export { startContextServer, type ContextServerHandle } from "./server";
export { ContextService, contextPermissionsFromEnv, MemoryGovernanceError, AdapterError } from "./service";
export { loadContextConfig, BUDGET_PROFILES, MEMORY_POLICIES, resolveBudgetProfile, resolveMemoryPolicy, type ContextModuleConfig } from "./config";
export {
  buildSharedUri,
  phaseUri,
  derivePeerId,
  userRoot,
  peerRoot,
  parseVikingUri,
  underRoot,
  isForbiddenTarget,
  PAO_SHARED_ROOT,
  SHARED_ROOTS,
} from "./namespace";
export {
  scanContent,
  scanPath,
  scanSource,
  scanMemoryCandidate,
  containsInstructionPattern,
  checksum,
  type SecretFinding,
  type SecretScanResult,
} from "./security/secret-scan";
export { OpenVikingAdapter, AdapterError as OpenVikingAdapterError, classifyHttpError, DEFAULT_PATHS } from "./adapter/openviking";
export { ContextBackendBreaker, type BreakerState } from "./resilience";
export { ContextIngestPipeline, classifySource, type IngestOutcome, type IngestRequest } from "./ingest";
export { RetrievalEngine, packBudget, buildInjectionPlan, estimateTokens, freshnessStatus, matchesSuppression } from "./retrieval";
export { MemoryGovernanceService, computeExperienceConfidence } from "./governance";
export { ContextSessionService, HandoffService } from "./sessions";
export { ContextDbStore } from "./db-store";
export type {
  CompatibilityProbe,
  ContextClass,
  ContextDbCapabilities,
  ContextDbHealth,
  ContextInjectionPlan,
  ContextRetrievalRequest,
  ContextRetrievalResponse,
  ContextReasonCode,
  ContextScope,
  ContextSessionBinding,
  ContextSubsystemHealth,
  AgentHandoffPackage,
  ExperienceGovernanceRecord,
  MemoryGovernanceRecord,
  MemoryReviewState,
  PaoContextRef,
  RetrievalHit,
  Sensitivity,
} from "./types";
