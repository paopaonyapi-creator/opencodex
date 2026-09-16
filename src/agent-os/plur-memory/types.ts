// Phase 20.43 — Pao x PLUR Shared Agent Memory Runtime: canonical contracts
// (spec §3, §4, §6, §10). PLUR is the memory ENGINE; this module is the Pao
// Memory Control Plane (policy, scopes, secret guard, receipts, audit).
// Engine-neutral interface so PLUR (CLI/MCP/core) and a local deterministic
// fallback engine are interchangeable; the active engine is always
// disclosed in results.

export type MemoryEngineId = "plur" | "pao-local-fallback";

export type MemoryOperation =
  | "learn" | "recall" | "inject" | "feedback" | "forget" | "rescope"
  | "sync" | "capture";

export type MemoryType =
  | "preference" | "behavioral_rule" | "constraint" | "architecture_decision"
  | "workflow" | "operational_lesson" | "debugging_lesson" | "tool_usage"
  | "provider_behavior" | "project_convention" | "deployment_rule"
  | "security_rule" | "reviewer_feedback" | "business_rule" | "user_instruction"
  | "temporary_context";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "preference", "behavioral_rule", "constraint", "architecture_decision",
  "workflow", "operational_lesson", "debugging_lesson", "tool_usage",
  "provider_behavior", "project_convention", "deployment_rule",
  "security_rule", "reviewer_feedback", "business_rule", "user_instruction",
  "temporary_context",
];

export type EngramState = "candidate" | "active" | "retired" | "blocked" | "conflicted";

export interface ScopeFamily {
  family: "local" | "global" | "user" | "project" | "workspace" | "agent" | "service" | "environment" | "group";
  id: string | null;
  scope: string;
}

export interface MemoryRequestContext {
  actorType: "operator" | "dashboard" | "agent" | "system";
  actorId: string;
  agentId: string | null;
  agentTrust: "low" | "standard" | "trusted" | "system";
  projectId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  runId: string | null;
  correlationId: string;
}

export interface MemoryPolicyDecision {
  decision: "allow" | "deny" | "require_approval" | "redact";
  matchedRuleIds: string[];
  reason: string;
  forcedScope: string | null;
  forcedVisibility: string | null;
  requiredApprovalType: string | null;
}

export interface SecretScanResult {
  clean: boolean;
  findings: Array<{ category: string; fieldPath: string; fingerprint: string }>;
}

export interface LearnMemoryInput {
  title: string;
  content: string;
  memoryType: MemoryType;
  scope?: string;
  visibility?: "private" | "project" | "shared";
  sensitivity?: "normal" | "sensitive";
  polarity?: "positive" | "negative" | "neutral";
  domain?: string | null;
  sourceKind?: "explicit" | "candidate" | "auto" | "reconciliation" | "import";
  tags?: string[];
}

export interface MemoryWriteResult {
  ok: boolean;
  engramRegistryId: string | null;
  engineEngramId: string | null;
  contentHash: string;
  state: EngramState | "duplicate" | "blocked_secret" | "denied" | "approval_required" | "conflict";
  duplicateOf: string | null;
  conflictId: string | null;
  decision: MemoryPolicyDecision;
  engine: MemoryEngineId;
  reason: string;
}

export interface RecallMemoryInput {
  query: string;
  scope?: string;
  scopes?: string[];
  limit?: number;
  memoryTypes?: MemoryType[];
  projectId?: string | null;
}

export interface RecalledEngram {
  engramRegistryId: string;
  engineEngramId: string | null;
  title: string;
  content: string;
  memoryType: MemoryType;
  scope: string;
  score: number;
  state: EngramState;
}

export interface MemoryRecallResult {
  ok: boolean;
  engine: MemoryEngineId;
  results: RecalledEngram[];
  degraded: boolean;
  fallbackMode: string | null;
  reason: string;
}

export interface MemoryInjectionResult extends MemoryRecallResult {
  receiptId: string;
  usedTokens: number;
  requestedBudgetTokens: number;
  injectedCount: number;
  policyFilteredCount: number;
  secretFilteredCount: number;
  injectedText: string;
}

export type FeedbackSignal = "positive" | "negative" | "neutral" | "obsolete" | "conflict";

export interface MemoryMutationResult {
  ok: boolean;
  state: EngramState | null;
  reason: string;
}

export interface EpisodeResult {
  ok: boolean;
  episodeRegistryId: string;
}

export interface TimelineQuery {
  agentId?: string;
  sessionId?: string;
  projectId?: string;
  severity?: string;
  eventType?: string;
  limit?: number;
}

export interface MemoryStatus {
  enabled: boolean;
  engine: MemoryEngineId;
  plurAvailable: boolean;
  plurDetail: string;
  engramsActive: number;
  engramsCandidate: number;
  episodes: number;
  receipts: number;
  conflictsOpen: number;
  approvalsPending: number;
  secretBlocked: number;
  syncEnabled: boolean;
  adapters: Array<{ adapterKey: string; displayName: string; enabled: boolean; status: string; capabilities: string[] }>;
}

export interface MemoryDoctorCheck {
  name: string;
  severity: "PASS" | "WARN" | "FAIL" | "MANUAL";
  detail: string;
}

export interface MemoryDoctorReport {
  overall: "healthy" | "degraded" | "unhealthy";
  checks: MemoryDoctorCheck[];
}

export interface SyncPreviewItem {
  scope: string;
  title: string;
  contentHash: string;
  included: boolean;
  blockedReason: string | null;
}

export interface MemorySyncResult {
  ok: boolean;
  status: "completed" | "dry_run" | "blocked" | "disabled" | "engine_unavailable";
  pushedCount: number;
  skippedCount: number;
  blockedCount: number;
  warnings: string[];
  preview: SyncPreviewItem[];
}

export interface PlurCapabilityReport {
  cliAvailable: boolean;
  cliVersion: string | null;
  homeDirAvailable: boolean;
  homeDirPath: string;
  statusHealthy: boolean | null;
  detail: string;
}

export interface MemoryEngine {
  readonly id: MemoryEngineId;
  capabilities(): Promise<PlurCapabilityReport>;
  learn(input: { title: string; content: string; memoryType: string; scope: string; visibility: string; tags: string[] }): Promise<{ engineEngramId: string | null }>;
  recall(input: { query: string; scopes: string[]; limit: number }): Promise<Array<{ engineEngramId: string | null; title: string; content: string; memoryType: string; scope: string; score: number }>>;
  forget(engineEngramId: string | null): Promise<boolean>;
  applyFeedback(engineEngramId: string | null, signal: FeedbackSignal): Promise<boolean>;
  rescope(engineEngramId: string | null, scope: string): Promise<boolean>;
  available(): Promise<boolean>;
}

export interface MemoryAuditEvent {
  correlationId: string;
  operation: MemoryOperation | "reconcile" | "conflict.resolve" | "candidate.approve" | "candidate.reject";
  actorType: string;
  actorId: string;
  agentId: string | null;
  projectId: string | null;
  scope: string | null;
  decision: string;
  engramRegistryId: string | null;
  metadata: Record<string, unknown>;
}

// --- Typed memory errors (spec §10) --------------------------------------------------

export type MemoryErrorCode =
  | "MEMORY_DISABLED" | "MEMORY_ENGINE_UNAVAILABLE" | "MEMORY_POLICY_DENIED"
  | "MEMORY_APPROVAL_REQUIRED" | "MEMORY_SECRET_DETECTED" | "MEMORY_SCOPE_INVALID"
  | "MEMORY_SCOPE_FORBIDDEN" | "MEMORY_NOT_FOUND" | "MEMORY_CONFLICT"
  | "MEMORY_SYNC_DISABLED" | "MEMORY_SYNC_UNSAFE_REMOTE" | "MEMORY_TIMEOUT"
  | "MEMORY_UPSTREAM_ERROR" | "VALIDATION_FAILED" | "NOT_FOUND";

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  constructor(code: MemoryErrorCode, message: string) {
    super("[" + code + "] " + message);
    this.name = "MemoryError";
    this.code = code;
  }
}
