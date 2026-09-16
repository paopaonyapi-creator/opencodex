/**
 * Pao AI Gateway — Phase 20.13 type definitions.
 *
 * This file is the canonical type surface for the AI Gateway subsystem.
 * It must not import from src/lab/ or any optional subsystem.
 */

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type GatewayProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "openai-compatible"
  /** Experiential gateway, reached over its OpenAI-compatible HTTP API. */
  | "experiential"
  /**
   * 9Router multi-provider gateway sidecar (Phase 20.51). Reached over its
   * OpenAI-compatible /v1 surface; provider credentials stay inside 9Router.
   */
  | "nine-router";

export interface GatewayProviderConfig {
  readonly id: string;
  readonly type: GatewayProviderType;
  /** Environment variable name holding the API key. Never a raw secret. */
  readonly apiKeyEnv: string;
  /** Override base URL. Supports ${ENV_VAR} interpolation. */
  readonly baseUrl?: string;
  readonly enabled?: boolean;
}

export interface ProviderHealth {
  readonly providerId: string;
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly lastCheckedAt: string;
  readonly lastError?: string;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
  readonly chat: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly vision: boolean;
  readonly reasoning: boolean;
}

export interface ModelPricing {
  /** USD per 1M input tokens. null = unknown (fail-closed for budget). */
  readonly inputPerMillionUsd: number | null;
  /** USD per 1M output tokens. null = unknown (fail-closed for budget). */
  readonly outputPerMillionUsd: number | null;
  /** USD per 1M cached input tokens. */
  readonly cachedInputPerMillionUsd?: number | null;
}

export interface ModelLimits {
  readonly contextWindow: number | null;
  readonly maxOutputTokens: number | null;
}

export interface GatewayModelConfig {
  readonly id: string;
  readonly providerId: string;
  /**
   * The actual upstream model id. Supports ${ENV_VAR} interpolation
   * so the real model name can be changed without editing the catalog.
   */
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly tags: readonly string[];
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Alias system
// ---------------------------------------------------------------------------

export interface AliasRouteEntry {
  readonly modelId: string;
  readonly priority: number;
}

export interface AliasConfig {
  readonly id: string;
  readonly routes: readonly AliasRouteEntry[];
  readonly constraints?: AliasConstraints;
}

export interface AliasConstraints {
  readonly localOnly?: boolean;
  readonly reviewRequired?: boolean;
}

// ---------------------------------------------------------------------------
// Identity & permissions
// ---------------------------------------------------------------------------

export interface GatewayIdentity {
  readonly id: string;
  readonly name: string;
  readonly allowedAliases: readonly string[];
  readonly deniedAliases?: readonly string[];
  readonly maxRequestUsd: number;
  readonly maxDailyUsd: number;
  readonly maxMonthlyUsd?: number;
  readonly externalProviderAccess?: boolean;
  readonly localOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface GlobalBudget {
  readonly dailyUsd: number;
  readonly monthlyUsd: number;
}

export interface IdentityBudgetOverride {
  readonly identityId: string;
  readonly dailyUsd: number;
  readonly perRequestUsd: number;
  readonly monthlyUsd?: number;
}

export interface GatewayBudgetConfig {
  readonly global: GlobalBudget;
  readonly identities: readonly IdentityBudgetOverride[];
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export type GuardrailAction = "allow" | "block" | "transform";

export interface GuardrailDecision {
  readonly action: GuardrailAction;
  readonly code?: string;
  /** User-safe message (never contains detected secret text). */
  readonly safeMessage?: string;
  readonly transformedPayload?: unknown;
}

export type InputGuardrailType =
  | "secret_leakage"
  | "prompt_injection"
  | "pii"
  | "request_size"
  | "local_only";

export type OutputGuardrailType =
  | "secret_leakage"
  | "unsafe_tool_arguments"
  | "pii"
  | "schema_validation";

export interface IdentityGuardrailPolicy {
  readonly identityId: string;
  readonly failClosed: boolean;
  readonly input: Partial<Record<InputGuardrailType, GuardrailAction>>;
  readonly output: Partial<Record<OutputGuardrailType, GuardrailAction>>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

export interface RoutingRequest {
  readonly identityId: string;
  readonly alias: string;
  readonly taskType?: string;
  readonly riskLevel?: RiskLevel;
  readonly requiredCapabilities?: Partial<ModelCapabilities>;
  readonly privacyClass?: "local-only" | "standard";
  readonly maxLatencyMs?: number;
  readonly maxCostUsd?: number;
  readonly contextTokens?: number;
  readonly visionRequired?: boolean;
  readonly toolsRequired?: boolean;
  readonly structuredOutputRequired?: boolean;
  readonly reviewRequired?: boolean;
}

export interface RouteDecision {
  readonly alias: string;
  readonly selectedModelId: string;
  readonly selectedProviderId: string;
  readonly routerVersion: string;
  readonly reason: readonly string[];
  readonly fallbackAttempt: number;
  readonly riskLevel: RiskLevel;
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

export type FallbackEligibleFailure =
  | "timeout"
  | "provider_429"
  | "provider_5xx"
  | "network_error"
  | "model_unavailable";

export type FallbackIneligibleFailure =
  | "auth_failure"
  | "policy_denial"
  | "budget_denial"
  | "secret_leakage_block"
  | "prompt_injection_block"
  | "local_only_violation"
  | "guardrail_failure";

export interface FallbackPolicy {
  readonly eligibleOn: readonly FallbackEligibleFailure[];
  readonly maxAttempts: number;
  readonly candidates: readonly string[];
}

// ---------------------------------------------------------------------------
// Normalized request/response contracts
// ---------------------------------------------------------------------------

export interface NormalizedMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly name?: string;
  readonly toolCalls?: readonly NormalizedToolCall[];
  readonly toolCallId?: string;
}

export interface NormalizedToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface NormalizedChatRequest {
  readonly model: string;
  readonly messages: readonly NormalizedMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stream?: boolean;
  readonly tools?: readonly unknown[];
  readonly responseFormat?: unknown;
  /** Pao gateway metadata injected by the admission pipeline. */
  readonly _gateway?: {
    readonly requestId: string;
    readonly identity: GatewayIdentity;
    readonly routeDecision: RouteDecision;
  };
}

export interface NormalizedUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface NormalizedChoice {
  readonly index: number;
  readonly message: NormalizedMessage;
  readonly finishReason: string | null;
}

export interface NormalizedChatResponse {
  readonly id: string;
  readonly object: "chat.completion";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly NormalizedChoice[];
  readonly usage?: NormalizedUsage;
}

// ---------------------------------------------------------------------------
// Trace / Usage Ledger
// ---------------------------------------------------------------------------

export type TraceContentMode = "off" | "metadata_only" | "redacted" | "full_local_encrypted";

export interface GatewayTraceRecord {
  readonly requestId: string;
  readonly timestamp: string;
  readonly identityId: string;
  readonly alias: string;
  readonly selectedModelId: string;
  readonly selectedProviderId: string;
  readonly routerVersion: string;
  readonly riskLevel: RiskLevel;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd?: number;
  readonly latencyMs: number;
  readonly firstTokenLatencyMs?: number;
  readonly status: "success" | "error" | "blocked" | "budget_denied";
  readonly fallbackCount: number;
  readonly guardrailResult: GuardrailAction;
  readonly reviewOutcome?: string;
  readonly traceContentMode: TraceContentMode;
}

export interface GatewayAttemptRecord {
  readonly requestId: string;
  readonly attemptNumber: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "success" | "error" | "timeout" | "rate_limited";
  readonly errorClass?: string;
  readonly latencyMs: number;
  readonly costUsd?: number;
}

// ---------------------------------------------------------------------------
// Quota windows (Phase 20.51)
// ---------------------------------------------------------------------------

export type QuotaWindowType =
  | "rolling"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "credit"
  | "unknown";

export type QuotaUnit = "requests" | "tokens" | "credits" | "seconds" | "unknown";

/**
 * How much the gateway trusts this quota reading. Missing telemetry is
 * "unknown" — never "unlimited", and never rendered as 100% remaining.
 */
export type QuotaConfidence = "authoritative" | "derived" | "estimated" | "unknown";

export type QuotaFreshness = "fresh" | "aging" | "stale" | "unknown";

export interface QuotaWindow {
  readonly windowType: QuotaWindowType;
  readonly label: string;
  readonly consumed?: number;
  readonly limit?: number;
  readonly remaining?: number;
  /** 0..1. Absent when it cannot be derived — absence means unknown, not 1. */
  readonly remainingRatio?: number;
  readonly resetAt?: string;
  readonly unit: QuotaUnit;
  readonly confidence: QuotaConfidence;
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------
// Failure classification & connection state (Phase 20.51)
// ---------------------------------------------------------------------------

export type GatewayFailureClass =
  | "auth_invalid"
  | "permission_denied"
  | "quota_exhausted"
  | "rate_limited"
  | "provider_overloaded"
  | "provider_unavailable"
  | "network_timeout"
  | "protocol_error"
  | "model_unavailable"
  | "capability_mismatch"
  | "budget_blocked"
  | "policy_blocked"
  | "content_rejected"
  | "unknown";

export type ConnectionState =
  | "unknown"
  | "healthy"
  | "degraded"
  | "cooldown"
  | "quarantined"
  | "recovering"
  | "disabled";

// ---------------------------------------------------------------------------
// Session affinity (Phase 20.51)
// ---------------------------------------------------------------------------

export interface RouteLease {
  readonly sessionId: string;
  readonly routeKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly sticky: boolean;
}

// ---------------------------------------------------------------------------
// Route decision & event ledger (Phase 20.51)
// ---------------------------------------------------------------------------

export interface CandidateOutcome {
  readonly routeKey: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly status: "selected" | "rejected" | "attempted";
  readonly score?: number;
  readonly reasonCodes: readonly string[];
}

export type DecisionOutcome =
  | "success"
  | "failed"
  | "no_eligible_route"
  | "deadline_exceeded"
  | "budget_denied";

export interface RouteDecisionRecord {
  readonly requestId: string;
  readonly timestamp: string;
  readonly identityId: string;
  readonly alias: string;
  readonly weightProfile: string;
  readonly sessionId?: string;
  readonly selectedRouteKey?: string;
  readonly selectedModelId?: string;
  readonly selectedProviderId?: string;
  readonly candidates: readonly CandidateOutcome[];
  readonly fallbackDepth: number;
  readonly outcome: DecisionOutcome;
  readonly reasonCodes: readonly string[];
  readonly estimatedCostUsd?: number;
  readonly actualCostUsd?: number;
  readonly latencyMs?: number;
}

export interface RouteAttemptRecord {
  readonly requestId: string;
  readonly attemptNo: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly latencyMs?: number;
  readonly httpStatus?: number;
  readonly failureClass?: GatewayFailureClass;
  readonly reasonCode?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly outcome: "success" | "failure";
}

export interface GatewayEventRecord {
  readonly timestamp: string;
  readonly severity: "info" | "warning" | "error";
  readonly eventType: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly reasonCode: string;
  readonly details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Governance configuration (Phase 20.51)
// ---------------------------------------------------------------------------

export interface GovernanceWeights {
  readonly quality: number;
  readonly quota: number;
  readonly health: number;
  readonly latency: number;
  readonly cost: number;
  readonly affinity: number;
  readonly freshness: number;
}

export interface FallbackLimits {
  readonly maxRouteAttempts: number;
  readonly maxSameProviderAttempts: number;
  readonly totalDeadlineMs: number;
  readonly backoffMs: readonly number[];
}

export interface CircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly rateLimitCooldownMs: number;
}

export interface QuotaPolicy {
  readonly agingAfterSec: number;
  readonly staleAfterSec: number;
  readonly stalePenalty: number;
  readonly unknownPenalty: number;
  readonly softLowRemainingRatio: number;
  readonly criticalRemainingRatio: number;
}

export interface RoutingGovernanceConfig {
  /** Master switch. Off = existing single-attempt routing, byte-for-byte. */
  readonly enabled: boolean;
  readonly weightProfile: string;
  readonly weights: GovernanceWeights;
  readonly fallback: FallbackLimits;
  readonly circuitBreaker: CircuitBreakerPolicy;
  readonly quota: QuotaPolicy;
  readonly sessionLeaseTtlMin: number;
}

export interface NineRouterConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly timeoutMs: number;
  readonly syncIntervalSec: number;
  /** Upstream telemetry endpoints to probe for quota data. 404/unknown is normal. */
  readonly quotaPaths: readonly string[];
  readonly versionPaths: readonly string[];
}

// ---------------------------------------------------------------------------
// Full gateway config (loaded from YAML files)
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly providers: readonly GatewayProviderConfig[];
  readonly models: readonly GatewayModelConfig[];
  readonly aliases: readonly AliasConfig[];
  readonly identities: readonly GatewayIdentity[];
  readonly budgets: GatewayBudgetConfig;
  readonly policies: readonly IdentityGuardrailPolicy[];
  readonly traceContentMode: TraceContentMode;
  readonly routerVersion: string;
  /** Prefer the cheapest eligible candidate. Never at the cost of capability. */
  readonly freeFirst?: boolean;
  /** Upper bound on ladder climbs per request, whatever an agent asks for. */
  readonly maxEscalations?: number;
  /** Emergency direct-provider path. Defaults to off and must be set deliberately. */
  readonly directBypass?: boolean;
  /** Pinned upstream version from the lock file, for the dashboard and boot check. */
  readonly experientialVersion?: string;
  /** Local-only enforcement for tasks classified private or restricted. */
  readonly privateTaskLocalOnly?: boolean;
  /** Phase 20.51 quota-aware routing, bounded fallback, breakers, decision ledger. */
  readonly governance?: RoutingGovernanceConfig;
  /** Phase 20.51 9Router gateway sidecar telemetry settings. */
  readonly nineRouter?: NineRouterConfig;
}
