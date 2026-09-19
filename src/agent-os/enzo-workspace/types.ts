// Phase 20.94 — Pao-hubPro × ENZO: composition-layer contracts.
//
// ENZO is a reference architecture, not a runtime dependency. These types are
// the stable internal contracts for the unified Personal AI Operating Plane.
// Persistence uses the existing Agent OS SQLite store (enzo_* prefix).

import { z } from "zod";

export const PHASE_ID = "20.94";

export const RunModeSchema = z.enum(["chat", "research", "coding", "agent", "automation", "auto"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "WAITING_FOR_APPROVAL",
  "RUNNING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RiskClassSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const PolicyEffectSchema = z.enum(["allow", "deny", "require_approval", "allow_with_restrictions"]);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

export const PolicyProfileSchema = z.enum(["safe-personal", "developer-local", "automation-strict"]);
export type PolicyProfile = z.infer<typeof PolicyProfileSchema>;

export const LessonStatusSchema = z.enum(["candidate", "accepted", "quarantined", "retired"]);
export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const BudgetSchema = z.object({
  maxQueries: z.number().int().nonnegative().default(20),
  maxSources: z.number().int().nonnegative().default(40),
  maxFetches: z.number().int().nonnegative().default(50),
  maxToolCalls: z.number().int().nonnegative().default(80),
  maxTokens: z.number().int().nonnegative().default(250000),
  maxCostUsd: z.number().nonnegative().default(2),
  maxRuntimeMinutes: z.number().nonnegative().default(30),
  maxParallelWorkers: z.number().int().positive().default(3),
  maxRetryPerSource: z.number().int().nonnegative().default(1),
  maxSpawnedAgents: z.number().int().nonnegative().default(4),
  maxFilesystemWrites: z.number().int().nonnegative().default(40),
});
export type Budget = z.infer<typeof BudgetSchema>;

export interface BudgetUsage {
  queries: number;
  sources: number;
  fetches: number;
  toolCalls: number;
  tokens: number;
  costUsd: number;
  runtimeMs: number;
  spawnedAgents: number;
  filesystemWrites: number;
}

export function emptyUsage(): BudgetUsage {
  return {
    queries: 0,
    sources: 0,
    fetches: 0,
    toolCalls: 0,
    tokens: 0,
    costUsd: 0,
    runtimeMs: 0,
    spawnedAgents: 0,
    filesystemWrites: 0,
  };
}

export function defaultBudget(overrides: Partial<Budget> = {}): Budget {
  return BudgetSchema.parse(overrides);
}

export interface TaskIntent {
  raw: string;
  mode: RunMode;
  domains: string[];
  capabilities: string[];
  skillIntents: string[];
  risk: RiskClass;
  expectedArtifacts: string[];
  complexity: "low" | "medium" | "high";
  reasons: string[];
}

export interface DomainAnalysis {
  domain: string;
  requiredExpertise: string[];
  tacitKnowledge: string[];
  stages: string[];
  failureModes: string[];
  edgeCases: string[];
  verificationStrategy: string[];
  expectedArtifacts: string[];
  requiredTools: string[];
  requiredMemories: string[];
  permissions: string[];
  budgetProfile: "low" | "medium" | "high";
}

export interface AgentBlueprint {
  id: string;
  slug: string;
  name: string;
  version: number;
  objective: string;
  role: string;
  instructions: string[];
  inputs: string[];
  requiredCapabilities: string[];
  skillIntents: string[];
  tools: string[];
  modelPolicy: {
    routeGroup: string;
    requiredCapabilities: string[];
    localOnly: boolean;
    maxCostUsd: number;
  };
  memoryPolicy: {
    layers: string[];
    autoAcceptMinConfidence: number;
  };
  executionBudget: Budget;
  permissions: string[];
  approvalRules: string[];
  outputContract: string[];
  retryPolicy: { maxAttempts: number };
  observabilityPolicy: { recordProvenance: boolean };
  draftedBy: string;
  immutable: boolean;
}

export interface SkillManifest {
  id: string;
  version: string;
  name: string;
  summary: string;
  intents: string[];
  capabilities: string[];
  requires: string[];
  optional: string[];
  allowedTools: string[];
  risk: RiskClass;
  trust: { provenance: "curated" | "imported" | "unknown"; score: number; status: "trusted" | "quarantined" | "denied" };
  context: { estimatedTokens: number };
  conflicts?: string[];
}

export interface SkillCompositionPlan {
  selected: Array<{ id: string; version: string; reason: string; trustScore: number; estimatedTokens: number }>;
  denied: Array<{ id: string; reason: string }>;
  conflicts: Array<{ a: string; b: string; field: string; resolution: string }>;
  totalTokens: number;
  tokenBudget: number;
}

export interface ModelRecord {
  id: string;
  provider: string;
  displayName: string;
  modalities: Array<"text" | "vision" | "audio" | "image" | "video">;
  capabilities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  health: "healthy" | "degraded" | "offline" | "unknown";
  healthCheckedAt?: string;
  trustScore?: number;
  tags: string[];
  configured: boolean;
  estimatedCostPerMillionUsd?: number;
  latencyClass?: "ultra-low" | "low" | "normal" | "slow";
  costClass?: "free" | "low" | "medium" | "high";
  privacyClass?: "local" | "direct-provider" | "gateway";
}

export interface ModelRouteRequest {
  requirements: string[];
  modalities?: Array<"text" | "vision" | "audio" | "image" | "video">;
  tools?: boolean;
  structuredOutput?: boolean;
  reasoning?: boolean;
  localOnly?: boolean;
  maxCostUsd?: number;
  denyProviders?: string[];
  allowProviders?: string[];
  requestedId?: string;
  maxAttempts?: number;
}

export interface ModelRouteDecision {
  requestedId?: string;
  actualId: string;
  provider: string;
  reason: string;
  fallbacks: string[];
  configured: boolean;
  health: ModelRecord["health"];
}

export interface PolicyDecision {
  decisionId: string;
  runId: string;
  action: string;
  risk: RiskClass;
  decision: PolicyEffect;
  rulesMatched: string[];
  reason: string;
  restrictions?: string[];
  expiresAt?: string;
}

export interface CredentialLease {
  leaseId: string;
  secretRef: string;
  runId: string;
  principal: string;
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  provider?: string;
  revoked: boolean;
}

export interface AgentLesson {
  id: string;
  agentSlug: string;
  domain: string;
  statement: string;
  evidenceRefs: string[];
  runRefs: string[];
  confidence: number;
  status: LessonStatus;
  createdAt: string;
  lastValidatedAt?: string;
  expiresAt?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  type: string;
  actor: string;
  timestamp: string;
  parentEventId?: string;
  payload: Record<string, unknown>;
  redactions?: string[];
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  type: string;
  name: string;
  uri: string;
  sha256: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  actionType: string;
  riskLevel: RiskClass;
  requestPayload: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface WorkspaceRun {
  id: string;
  mode: RunMode;
  status: RunStatus;
  requestText: string;
  agentId: string | null;
  policyProfile: PolicyProfile;
  budget: Budget;
  usage: BudgetUsage;
  plan: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
}

export type EnzoErrorCode =
  | "DISABLED"
  | "RUN_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "LESSON_NOT_FOUND"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_NOT_PENDING"
  | "LEASE_NOT_FOUND"
  | "LEASE_EXPIRED"
  | "LEASE_EXHAUSTED"
  | "SECRET_NOT_FOUND"
  | "POLICY_DENIED"
  | "BUDGET_EXHAUSTED"
  | "INVALID_TRANSITION"
  | "SCHEMA_INVALID"
  | "UNCONFIGURED"
  | "REPLAY_BLOCKED"
  | "SESSION_NOT_FOUND"
  | "SKILL_DENIED"
  | "TOOL_DENIED";

export class EnzoWorkspaceError extends Error {
  readonly code: EnzoErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;
  constructor(code: EnzoErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "EnzoWorkspaceError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}

export function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, payload: unknown, what: string): T {
  try {
    return schema.parse(payload);
  } catch (err) {
    const detail = err instanceof z.ZodError
      ? err.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
      : String(err);
    throw new EnzoWorkspaceError("SCHEMA_INVALID", 422, what + " failed structured validation", { detail });
  }
}

/** Redact secret-looking values from payloads destined for logs/UI/events. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]")
    .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, "sk-proj-[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]{8,}/g, "ghp_[REDACTED]")
    .replace(/xai-[A-Za-z0-9]{8,}/g, "xai-[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/(password|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]");
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|password|token|api[_-]?key|credential/i.test(k) && typeof v === "string") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactJson(v);
      }
    }
    return out;
  }
  return value;
}

export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "TZ",
  "NODE_ENV",
  "PAOHUB_RUN_ID",
  "PAOHUB_PROJECT_ID",
] as const;
