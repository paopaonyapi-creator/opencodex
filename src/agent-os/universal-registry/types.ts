// Phase 20.25 — Pao-hubPro × Agentic AI Universal Registry & Toolchain
// Canonical tool schema and domain types.
//
// The registry indexes tools that already exist across the Agent OS (MCP tools,
// agents, skills, Codex runtime, browser tools, models) plus metadata-only
// external catalog entries. It never duplicates a provider fact: each record
// points back at the subsystem that owns execution.

export type RegistryToolType =
  | "agent"
  | "ai_model"
  | "mcp_server"
  | "external_api"
  | "scraper"
  | "browser_tool"
  | "local_tool"
  | "codex_tool"
  | "image_generator"
  | "video_generator"
  | "audio_generator"
  | "research_tool"
  | "reviewer"
  | "database"
  | "storage"
  | "exporter"
  | "notification"
  | "automation"
  | "connector";

export type RegistryToolStatus = "active" | "disabled" | "metadata_only" | "deprecated";
export type RegistryHealth = "healthy" | "degraded" | "offline" | "unknown" | "disabled";
/** Numeric risk ladder from the Phase 20.25 spec (0 read-only … 4 destructive). */
export type RegistryRiskLevel = 0 | 1 | 2 | 3 | 4;

export type PermissionClass =
  | "read_only"
  | "network_read"
  | "file_write"
  | "network_write"
  | "shell_execute"
  | "code_execute"
  | "account_action"
  | "delete"
  | "financial_action"
  | "publish";

export type AuthStatus = "none" | "configured" | "missing" | "invalid";
export type SourceKind = "builtin" | "mcp" | "agent_os" | "codex" | "browser" | "skill" | "model" | "catalog";

export interface ToolAuth {
  /** Secrets are referenced, never stored: `ref` names an env var or config key. */
  type: "none" | "env" | "config";
  ref?: string;
}

export interface ToolRecord {
  id: string;
  name: string;
  slug: string;
  provider: string;
  type: RegistryToolType;
  description: string;
  status: RegistryToolStatus;
  capabilities: string[];
  inputTypes: string[];
  outputTypes: string[];
  auth: ToolAuth;
  /** Only ever one of the AuthStatus values — never a secret value. */
  authStatus: AuthStatus;
  runtime: { execution: "local" | "remote" | "hybrid"; protocol: string; executor?: string };
  risk: { level: RegistryRiskLevel; permissionClass: PermissionClass; requiresApproval: boolean };
  cost: { model: "free" | "fixed" | "usage_based" | "unknown"; unit?: string };
  limits: { rateLimit?: string };
  quality: { reliabilityScore?: number; latencyScore?: number };
  source: { kind: SourceKind; repository?: string; ownerModule?: string };
  tags: string[];
  /** True only when the universal runtime owns a safe executor for this tool. */
  executable: boolean;
  health: RegistryHealth;
  metrics: ToolMetrics;
  createdAt: string;
  updatedAt: string;
}

export interface ToolMetrics {
  runs: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  lastRunAt?: string;
  lastError?: string;
}

export interface ToolHealthSample {
  toolId: string;
  status: RegistryHealth;
  latencyMs?: number;
  checkedAt: string;
  error?: string;
}

export interface IngestedToolInput {
  id?: string;
  name: string;
  slug?: string;
  provider: string;
  type: RegistryToolType;
  description?: string;
  status?: RegistryToolStatus;
  capabilities?: string[];
  inputTypes?: string[];
  outputTypes?: string[];
  auth?: ToolAuth;
  authStatus?: AuthStatus;
  runtime?: { execution: "local" | "remote" | "hybrid"; protocol: string; executor?: string };
  riskLevel?: RegistryRiskLevel;
  permissionClass?: PermissionClass;
  requiresApproval?: boolean;
  cost?: { model: "free" | "fixed" | "usage_based" | "unknown"; unit?: string };
  limits?: { rateLimit?: string };
  quality?: { reliabilityScore?: number; latencyScore?: number };
  source: { kind: SourceKind; repository?: string; ownerModule?: string };
  tags?: string[];
  executable?: boolean;
}

// --- Search / ranking -------------------------------------------------------

export interface SearchFilters {
  type?: RegistryToolType;
  provider?: string;
  health?: RegistryHealth;
  /** Return only tools whose risk level is <= riskMax. */
  riskMax?: RegistryRiskLevel;
  requiresApproval?: boolean;
  execution?: "local" | "remote" | "hybrid";
  costModel?: "free" | "fixed" | "usage_based" | "unknown";
  executableOnly?: boolean;
  sourceKind?: SourceKind;
  capability?: string;
}

export interface RankedTool {
  tool: ToolRecord;
  score: number;
  match: number;
  reasons: string[];
}

export interface SearchResult {
  query: string;
  results: RankedTool[];
}

// --- Profiles ---------------------------------------------------------------

export type RankingProfile =
  | "balanced"
  | "cheap"
  | "quality"
  | "local_first"
  | "privacy_first"
  | "adobe_stock_production";

export interface RankingWeights {
  capabilityMatch: number;
  reliability: number;
  cost: number;
  latency: number;
  security: number;
  preference: number;
}

// --- Planner ----------------------------------------------------------------

export interface PlanStep {
  id: string;
  capability: string;
  title: string;
  selectedToolId?: string;
  selectedToolName?: string;
  /** Ordered fallback candidate tool ids for this capability. */
  fallbackToolIds: string[];
  riskLevel: RegistryRiskLevel;
  permissionClass: PermissionClass;
  approvalRequired: boolean;
  dependsOn: string[];
}

export interface ToolchainPlan {
  id: string;
  goal: string;
  profile: RankingProfile;
  steps: PlanStep[];
  riskLevel: RegistryRiskLevel;
  approvalRequired: boolean;
  estimatedCost: string;
  notes: string[];
}

export type RunStatus = "planned" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "awaiting_approval" | "running" | "completed" | "failed" | "skipped" | "fallback_used";

export interface RunRecord {
  id: string;
  goal: string;
  profile: RankingProfile;
  mode: "execute" | "dry_run";
  status: RunStatus;
  plan: ToolchainPlan;
  riskLevel: RegistryRiskLevel;
  approvalRequired: boolean;
  estimatedCost: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RunStepRecord {
  id: string;
  runId: string;
  stepIndex: number;
  capability: string;
  toolId?: string;
  toolName?: string;
  status: StepStatus;
  inputSummary: string;
  outputSummary?: string;
  errorCode?: string;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
}

// --- Permissions / approvals -------------------------------------------------

export type PermissionDecision = "allowed" | "approval_required" | "denied";

export interface PermissionResult {
  decision: PermissionDecision;
  riskLevel: RegistryRiskLevel;
  reason: string;
  approvalId?: string;
}

export interface ApprovalRecord {
  id: string;
  runId?: string;
  stepId?: string;
  toolId: string;
  toolName?: string;
  action: string;
  riskLevel: RegistryRiskLevel;
  reason: string;
  /** Human-readable preview of the command/payload — never includes secrets. */
  preview: string;
  scope: "once" | "session";
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  expiresAt?: string;
}

// --- Execution ----------------------------------------------------------------

export type ToolErrorCode =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_INPUT"
  | "POLICY_BLOCK"
  | "APPROVAL_REQUIRED"
  | "TOOL_UNAVAILABLE"
  | "QUALITY_FAILED"
  | "SSRF_BLOCK"
  | "UNKNOWN";

export interface ExecutionContext {
  runId: string;
  stepId: string;
  workspaceRoot: string;
  approvedActionKeys: Set<string>;
  actor: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  outputSummary: string;
  errorCode?: ToolErrorCode;
  data?: Record<string, unknown>;
  latencyMs: number;
}

export interface ToolAdapter {
  /** Executor key, e.g. "http_get", "local_file_read". */
  readonly key: string;
  supports(tool: ToolRecord): boolean;
  validate(tool: ToolRecord, input: Record<string, unknown>): ToolErrorCode | null;
  /** Named `run` deliberately: the universal runtime never exposes raw `execute` surfaces. */
  run(tool: ToolRecord, input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolExecutionResult>;
}

/** Errors that may trigger an automatic fallback attempt (doc §69). */
export function isRetryableErrorCode(code: ToolErrorCode | undefined): boolean {
  return code === "TIMEOUT" || code === "RATE_LIMIT" || code === "PROVIDER_ERROR" || code === "TOOL_UNAVAILABLE";
}

export interface AuditEventInput {
  runId?: string;
  stepId?: string;
  toolId?: string;
  actor?: string;
  action: string;
  status?: "ok" | "error" | "denied";
  inputSummary?: string;
  outputSummary?: string;
  errorCode?: ToolErrorCode;
  permissionClass?: PermissionClass;
  riskLevel?: RegistryRiskLevel;
  approvalId?: string;
  latencyMs?: number;
}
