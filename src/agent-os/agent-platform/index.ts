/**
 * Pao Agent Platform — public entry point (Phase 20.54).
 *
 * Provider-neutral, local-first capable, secure-by-default. Model access
 * flows through the existing Pao routing layers (Phases 20.17/20.51); memory
 * persistence flows through the Phase 20.53 governance plane.
 */

export {
  AgentPlatform,
  Supervisor,
  getAgentPlatform,
  loadReferenceAgentManifests,
  resetAgentPlatformForTests,
  type AgentPlatformOptions,
  type RegisteredAgent,
} from "./service";
export {
  CapabilityRegistry,
  DEFAULT_CAPABILITIES,
  PATTERNS,
  listPatterns,
  validateManifest,
} from "./registry";
export {
  PolicyEngine,
  ScopedApprovalService,
  argumentsHash,
  canonicalJson,
} from "./governance";
export {
  ReceiptService,
  SecureToolExecutor,
  canonicalizePath,
  generateReceiptKeyPair,
  nextId,
  sha256Hex,
} from "./execution";
export {
  ContextCompiler,
  CONTEXT_PRECEDENCE,
  NoopMemoryAdapter,
  OpenVikingMemoryAdapter,
  estimateTokens,
  evaluateMemoryWrite,
  type MemoryGateway,
  type MemoryWriteRequest,
} from "./context-memory";
export {
  McpRegistry,
  ROUTING_WEIGHTS,
  Supervisor as SupervisorRuntime,
  aggregateReviews,
  buildAgentCard,
  minimizeForDelegation,
  routeAgents,
  runSmokeSuite,
  scoreCandidate,
  type McpServerRecord,
  type SmokeTest,
} from "./orchestration";
export { PlatformError } from "./types";
export type {
  AgentManifest,
  AgentCard,
  A2ADelegation,
  ApprovalRecord,
  CapabilityRecord,
  CompiledContextPackage,
  ContextItem,
  ContextType,
  MemoryRecord,
  PatternRecord,
  PolicyInput,
  PolicyOutput,
  ReceiptPayload,
  ReceiptRecord,
  ReviewResult,
  RiskLevel,
  RouteCandidate,
  SupervisorStatus,
  ToolExecutionResult,
} from "./types";
