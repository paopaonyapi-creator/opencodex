// Phase 20.41 — Trustworthy MCP Memory Plane: canonical contracts (spec §3,
// §7, §8, §11, §12, §16, §17). Authoritative memory text is the source of
// truth; chunks, embeddings, observations, digests, traces are derived or
// operational data. Clean-room implementation — no upstream code copied.

export type MemoryAuthority = "authoritative" | "derived" | "observed" | "ephemeral";

export type MemoryKind =
  | "preference" | "constraint" | "decision" | "fact" | "runbook" | "retrospective"
  | "cheatsheet" | "note" | "artifact" | "workflow" | "incident" | "other";

export type MemoryIndexingState = "ready" | "pending" | "degraded";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "preference", "constraint", "decision", "fact", "runbook", "retrospective",
  "cheatsheet", "note", "artifact", "workflow", "incident", "other",
];

export const MEMORY_AUTHORITIES: readonly MemoryAuthority[] = [
  "authoritative", "derived", "observed", "ephemeral",
];

// --- Entities --------------------------------------------------------------------------

export interface MemoryWorkspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProject {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  repositoryUrl: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export type AgentTrustLevel = "low" | "standard" | "trusted" | "system";

export interface MemoryAgent {
  id: string;
  workspaceId: string;
  agentKey: string;
  name: string;
  provider: string | null;
  model: string | null;
  trustLevel: AgentTrustLevel;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  authority: MemoryAuthority;
  kind: MemoryKind;
  currentRevision: number;
  currentHash: string;
  title: string;
  content: string;
  sourcePath: string | null;
  createdByAgentId: string | null;
  supersedesMemoryId: string | null;
  indexingState: MemoryIndexingState;
  status: "active" | "forgotten" | "archived";
  createdAt: string;
  updatedAt: string;
  forgottenAt: string | null;
}

export interface MemoryRevisionSnapshot {
  id: string;
  memoryId: string;
  revision: number;
  contentHash: string;
  title: string;
  content: string;
  kind: MemoryKind;
  authority: MemoryAuthority;
  projectId: string | null;
  sourcePath: string | null;
  createdByAgentId: string | null;
  createdAt: string;
}

export interface MemoryTagLink {
  memoryId: string;
  memoryRevision: number;
  tagName: string;
}

// --- Remember / revise ---------------------------------------------------------------------

export interface RememberRequest {
  workspace?: string;
  project?: string | null;
  title: string;
  content: string;
  kind?: MemoryKind;
  authority?: MemoryAuthority;
  tags?: string[];
  sourcePath?: string | null;
  actor: { agentKey: string; name?: string; provider?: string | null; model?: string | null; trustLevel?: AgentTrustLevel };
  idempotencyKey?: string | null;
}

export interface RememberResult {
  memoryId: string;
  revision: number;
  sourceHash: string;
  indexing: { status: MemoryIndexingState; chunks: number; provider: string | null; degradeReason: string | null };
  duplicate: boolean;
}

export interface ReviseRequest {
  memoryId: string;
  title?: string;
  content?: string;
  kind?: MemoryKind;
  tags?: string[];
  expectedRevision?: number;
  expectedHash?: string;
  actor: { agentKey: string; name?: string };
}

// --- Observations / supersession ----------------------------------------------------------------

export interface ObservationRequest {
  workspace?: string;
  project?: string | null;
  observationText: string;
  confidence?: number | null;
  sources: Array<{ memoryId: string; evidenceJson?: Record<string, unknown> | null }>;
  actor: { agentKey: string; name?: string };
}

export interface MemoryObservation {
  id: string;
  workspaceId: string;
  projectId: string | null;
  observationText: string;
  confidence: number | null;
  createdByAgentId: string | null;
  status: "active" | "dismissed" | "promoted";
  createdAt: string;
  updatedAt: string;
  sources: Array<{ memoryId: string; memoryRevision: number; sourceHash: string; evidenceJson: string | null }>;
}

export interface SupersedeRequest {
  newMemory: RememberRequest;
  supersedesMemoryId: string;
  expectedRevision?: number;
  expectedHash?: string;
}

// --- Recall (spec §11-§13) ---------------------------------------------------------------------------

export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface RecallRequest {
  workspace?: string;
  project?: string | null;
  query: string;
  mode?: SearchMode;
  allowFallback?: boolean;
  limit?: number;
  kinds?: MemoryKind[];
  tags?: string[];
  authority?: MemoryAuthority[];
  createdAfter?: string;
  createdBefore?: string;
  includeContent?: boolean;
  trace?: boolean;
}

export interface RecallResult {
  memoryId: string;
  revision: number;
  sourceHash: string;
  title: string;
  content?: string;
  kind: MemoryKind;
  authority: MemoryAuthority;
  projectId?: string | null;
  tags: string[];
  rank: number;
  scores: { keyword?: number; semantic?: number; fused?: number; rerank?: number };
  rankProvenance: { keywordRank?: number; semanticRank?: number; fusedRank?: number };
}

export interface RecallResponse {
  requestedMode: SearchMode;
  effectiveMode: SearchMode;
  degraded: boolean;
  degradeReason?: string;
  traceId?: string;
  provider?: { embeddingProvider?: string; embeddingModel?: string; reranker?: string };
  results: RecallResult[];
}

// --- Provider health (spec §33) --------------------------------------------------------------------------

export type ProviderHealthState = "healthy" | "degraded" | "unavailable" | "misconfigured" | "unknown";

export interface ProviderHealth {
  state: ProviderHealthState;
  provider: string;
  model: string | null;
  dimensions: number | null;
  lastSuccessfulCheckAt: string | null;
  lastFailureCategory: string | null;
  detail: string;
}

// --- Traces (spec §19) --------------------------------------------------------------------------------------

export interface TraceRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  actorAgentId: string | null;
  requestedMode: SearchMode;
  actualMode: SearchMode;
  queryHash: string;
  queryLength: number | null;
  provider: string | null;
  model: string | null;
  degraded: boolean;
  degradeReason: string | null;
  resultCount: number;
  latencyMs: number | null;
  createdAt: string;
}

export interface TraceResultRecord {
  memoryId: string;
  memoryRevision: number;
  sourceHash: string;
  rank: number;
  keywordRank: number | null;
  semanticRank: number | null;
  keywordScore: number | null;
  semanticScore: number | null;
  fusedScore: number | null;
}

// --- Safe mutations (spec §16-§17) --------------------------------------------------------------------------------

export type MutationAction = "forget_memory" | "rebuild_index";

export interface MutationPreview {
  previewId: string;
  action: MutationAction;
  targetType: "memory" | "index";
  targetId: string;
  expectedRevision: number | null;
  expectedSourceHash: string | null;
  impact: Record<string, unknown>;
  confirmationReceipt: string;
  expiresAt: string;
  createdAt: string;
}

export interface MutationConfirmResult {
  ok: boolean;
  status: "completed" | "stale_preview" | "expired" | "already_consumed" | "not_found";
  detail: string;
  impact?: Record<string, unknown>;
}

// --- Health / preflight / verify (spec §28-§29, §57) ----------------------------------------------------------------------

export interface MemoryPlaneHealth {
  memoryPlane: "healthy" | "degraded" | "unhealthy";
  database: ProviderHealthState;
  keywordSearch: ProviderHealthState;
  embeddingProvider: ProviderHealthState;
  semanticSearch: ProviderHealthState;
  mcp: ProviderHealthState;
  oauth: ProviderHealthState;
  migrationVersion: number;
  warnings: string[];
}

export interface MemoryStats {
  memoriesTotal: number;
  byAuthority: Record<string, number>;
  workspaces: number;
  projects: number;
  indexed: number;
  pendingIndex: number;
  degradedIndex: number;
  chunks: number;
  embeddings: number;
  observations: number;
  traces: number;
  previewsOpen: number;
  provider: ProviderHealth;
}

// --- Import / export (spec §37-§38) ------------------------------------------------------------------------------------------

export interface ExportedMemory {
  workspace: string;
  project: string | null;
  memoryId: string;
  revision: number;
  hash: string;
  title: string;
  content: string;
  kind: MemoryKind;
  authority: MemoryAuthority;
  tags: string[];
  sourcePath: string | null;
  createdBy: string | null;
  createdAt: string;
  supersession: { supersedesMemoryId: string; supersededRevision: number; supersededHash: string } | null;
}

export interface ImportReport {
  dryRun: boolean;
  created: number;
  skipped: number;
  conflicted: number;
  details: Array<{ title: string; outcome: "created" | "skipped" | "conflicted"; reason: string }>;
}
