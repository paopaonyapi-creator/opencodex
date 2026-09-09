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
  | "openai-compatible";

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
}
