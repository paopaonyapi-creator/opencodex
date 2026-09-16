// Phase 20.62 — Pao-hubPro × Graft: Code Intelligence control plane.
//
// Graft informs; Pao-hubPro decides. This module owns the provider-neutral
// contract, repository registry, scopes, graph lifecycle, risk policy,
// evidence and impact reports. Graft-specific details stop at
// provider/graft/ and never leak into domain types.

export const CODE_INTEL_POLICY_VERSION = "ci-1";

export type CodeIntelErrorCode =
  | "CODEINTEL_DISABLED"
  | "CODEINTEL_NOT_FOUND"
  | "CODEINTEL_INVALID_INPUT"
  | "CODEINTEL_SCOPE_VIOLATION"
  | "CODEINTEL_PROVIDER_UNAVAILABLE"
  | "CODEINTEL_VERSION_MISMATCH"
  | "CODEINTEL_GRAPH_STALE"
  | "CODEINTEL_GRAPH_FAILED"
  | "CODEINTEL_REPOSITORY_UNREGISTERED"
  | "CODEINTEL_MACHINE_CONFIG_DENIED"
  | "CODEINTEL_OUTPUT_TOO_LARGE"
  | "CODEINTEL_POLICY_BLOCKED";

export class CodeIntelError extends Error {
  readonly code: CodeIntelErrorCode;
  readonly httpStatus: number;

  constructor(code: CodeIntelErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "CodeIntelError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// --- graph lifecycle (spec §10) ---

export type GraphState =
  | "uninitialized" | "building" | "ready" | "stale"
  | "refreshing" | "degraded" | "failed" | "disabled";

export const GRAPH_TRANSITIONS: Record<GraphState, readonly GraphState[]> = {
  uninitialized: ["building", "disabled"],
  building: ["ready", "failed", "disabled"],
  ready: ["stale", "refreshing", "building", "disabled"],
  stale: ["refreshing", "building", "disabled"],
  refreshing: ["ready", "degraded", "failed", "disabled"],
  degraded: ["refreshing", "building", "disabled"],
  failed: ["building", "refreshing", "disabled"],
  disabled: [],
};

export function assertGraphTransition(from: GraphState, to: GraphState): void {
  if (from === to) return;
  if (!GRAPH_TRANSITIONS[from].includes(to)) {
    throw new CodeIntelError("CODEINTEL_INVALID_INPUT", 409, `invalid graph transition ${from} -> ${to}`);
  }
}

// --- provider contract (spec §6) ---

export interface RepositoryMapInput { cwd: string; scope?: string; maxDirs?: number }
export interface FindCodeInput { cwd: string; question: string; pathScope?: string[] }
export interface FileApiInput { cwd: string; file: string }
export interface FindAllInput { cwd: string; pattern: string; pathScope?: string[]; ignoreCase?: boolean }
export interface TraceCallsInput { cwd: string; symbol: string; direction: "in" | "out"; depth: number }
export interface FreshnessInput { cwd: string }
export interface BuildGraphInput { cwd: string; deep?: boolean; extensions?: string[] }

export interface RepositoryMap {
  clusters: Array<{ path: string; files: number; note?: string }>;
  hotspots: Array<{ path: string; coupling: number }>;
  rawText: string | null;
  truncated: boolean;
}

export interface CodeSearchResult {
  title: string;
  path: string;
  symbol: string | null;
  snippet: string | null;
  score: number | null;
}

export interface FileApiSurface {
  file: string;
  signatures: string[];
  rawText: string | null;
  truncated: boolean;
}

export interface CodeOccurrence {
  path: string;
  line: number | null;
  text: string | null;
  symbol: string | null;
}

export interface DependencyTrace {
  symbol: string;
  direction: "in" | "out";
  depth: number;
  dependents: string[];
  dependencies: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface FreshnessReport {
  state: "fresh" | "stale" | "missing";
  drift: string | null;
}

export interface GraphBuildResult {
  ok: boolean;
  indexedFiles: number | null;
  indexedSymbols: number | null;
  durationMs: number | null;
  deep: boolean;
  rawSummary: string | null;
}

export interface CodeIntelligenceCapabilities {
  provider: string;
  version: string | null;
  structural: boolean;
  deepEnrichment: boolean;
  mcpTools: string[];
  compatible: boolean;
  incompatibilityReason: string | null;
}

export interface ProviderHealth {
  available: boolean;
  provider: string;
  version: string | null;
  nodeVersion: string | null;
  compatible: boolean;
  incompatibilityReason: string | null;
  telemetryDisabled: boolean;
}

export interface CodeIntelligenceProvider {
  readonly provider: string;
  getRepositoryMap(input: RepositoryMapInput): Promise<RepositoryMap>;
  findCode(input: FindCodeInput): Promise<CodeSearchResult[]>;
  getFileApi(input: FileApiInput): Promise<FileApiSurface>;
  findAll(input: FindAllInput): Promise<CodeOccurrence[]>;
  traceCalls(input: TraceCallsInput): Promise<DependencyTrace>;
  blastRadius(input: { cwd: string; baseRef?: string }): Promise<BlastRadiusReport>;
  checkFreshness(input: FreshnessInput): Promise<FreshnessReport>;
  buildGraph(input: BuildGraphInput): Promise<GraphBuildResult>;
  getCapabilities(): Promise<CodeIntelligenceCapabilities>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface BlastRadiusReport {
  baseRef: string | null;
  changedFiles: string[];
  impactedSymbols: string[];
  impactedTests: string[];
  rawText: string | null;
  truncated: boolean;
}

// --- repository registry + scope (spec §8, §9, §36, §37) ---

export type TrustLevel = "trusted" | "sandbox" | "untrusted";

export interface RegisteredRepository {
  id: string;
  name: string;
  canonicalPath: string;
  repoType: "single" | "monorepo" | "workspace-folder";
  vcsType: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  trustLevel: TrustLevel;
  sensitivity: "normal" | "sensitive";
  indexingEnabled: boolean;
  deepEnrichmentEnabled: boolean;
  providerKey: string;
  graphState: GraphState;
  lastBuildAt: string | null;
  lastFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  repositoryId: string;
  alias: string | null;
  crossRepoTraceEnabled: boolean;
  trustBoundary: string;
  createdAt: string;
}

export interface RepositoryScope {
  repositoryId: string;
  allowedPathPrefixes: string[];
  deniedPathPrefixes: string[];
  allowedOperations: CodeIntelOperation[];
  maxTraversalDepth: number;
  allowCrossRepo: boolean;
}

export type CodeIntelOperation =
  | "repo_map" | "find_code" | "file_api" | "find_all"
  | "trace" | "impact" | "build" | "deep_enrich";

// --- risk + impact (spec §15-§19, §29) ---

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskThresholds {
  medium: number;
  high: number;
  critical: number;
}

export interface RiskFactor {
  factor: string;
  points: number;
}

export interface ImpactReport {
  id: string;
  repositoryId: string;
  taskId: string | null;
  worktreePath: string | null;
  requestedBy: string;
  targetType: "symbol" | "file" | "path";
  targetRef: string;
  direction: "in" | "out";
  depth: number;
  graphBuildId: string | null;
  freshnessState: FreshnessReport["state"];
  fingerprint: string | null;
  directDependencyCount: number;
  transitiveDependencyCount: number;
  crossRepoDependencyCount: number;
  affectedTests: string[];
  protectedMatches: string[];
  riskScore: number;
  riskLevel: RiskLevel;
  policyDecision: "allow" | "reviewer_required" | "independent_review_and_approval" | "blocked_operator_approval";
  factors: RiskFactor[];
  provider: string;
  reducedConfidence: boolean;
  createdAt: string;
}

export interface ImpactDelta {
  beforeEvidenceId: string;
  afterEvidenceId: string;
  addedDependencies: string[];
  removedDependencies: string[];
  newCrossRepoEdges: string[];
  riskBefore: RiskLevel;
  riskAfter: RiskLevel;
  escalationRequired: boolean;
}

// --- evidence + context pack (spec §20, §31) ---

export interface CodeIntelEvidence {
  id: string;
  repositoryId: string;
  graphBuildId: string | null;
  operation: CodeIntelOperation;
  requestFingerprint: string;
  normalizedRequest: Record<string, unknown>;
  resultDigest: string;
  resultMetadata: Record<string, unknown>;
  freshnessState: FreshnessReport["state"] | "unavailable";
  provider: string;
  providerVersion: string | null;
  actorId: string;
  taskId: string | null;
  createdAt: string;
}

export interface CodeContextPack {
  repositoryId: string;
  graphState: GraphState;
  freshness: FreshnessReport;
  taskIntent: string;
  relevantNodes: CodeSearchResult[];
  targetSymbols: string[];
  dependencySummary: { directDependents: number; transitiveDependents: number; crossRepo: number };
  hotspots: Array<{ path: string; coupling: number }>;
  constraints: string[];
  protectedAreas: string[];
  evidenceIds: string[];
  reducedConfidence: boolean;
  generatedAt: string;
}

// --- audit event names (spec §42) ---

export type CodeIntelAuditEvent =
  | "codeintel.query.completed"
  | "codeintel.query.denied"
  | "codeintel.graph.build.started"
  | "codeintel.graph.build.completed"
  | "codeintel.graph.build.failed"
  | "codeintel.graph.stale"
  | "codeintel.impact.created"
  | "codeintel.risk.escalated"
  | "codeintel.policy.blocked"
  | "codeintel.provider.unavailable"
  | "codeintel.version.mismatch"
  | "codeintel.scope.violation"
  | "codeintel.machine_config.denied";
