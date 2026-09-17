/**
 * Phase 20.85 — Pao-hubPro Model Gateway Types
 * Unified Multi-Provider AI Gateway, Capability-Aware Routing,
 * Budget Governance & Local-Only Privacy Runtime.
 */

export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export type PricingStatus = "known" | "estimated" | "unknown";

export type FailureClass =
  | "transient"
  | "rate_limit"
  | "timeout"
  | "provider_unavailable"
  | "unsupported_capability"
  | "invalid_request"
  | "authentication"
  | "policy_denied"
  | "budget_denied"
  | "content_refusal";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency?: string;
  status: PricingStatus;
}

export interface ModelDefinition {
  id: string; // e.g. "anthropic/claude-3-7-sonnet"
  providerId: string; // e.g. "anthropic"
  modelName: string; // e.g. "claude-3-7-sonnet"
  modelFamily: string; // e.g. "claude"
  capabilities: string[];
  contextWindow: number;
  isLocal: boolean;
  pricing: ModelPricing;
  status: "approved" | "deprecated" | "quarantined";
}

export interface ProviderDefinition {
  id: string; // e.g. "anthropic"
  name: string;
  endpointUrl: string;
  isLocal: boolean;
  healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  rateLimitRpm?: number;
  circuitState?: "closed" | "open" | "half_open";
}

export interface RouteGroupDefinition {
  routeGroup: string; // e.g. "coding-high", "private-local"
  policyType: "quality_first" | "cost_first" | "local_first";
  candidates: string[]; // List of model IDs in priority order
  requiredCapabilities: string[];
  maxBudgetUsd?: number;
  localOnly?: boolean;
}

export interface PolicyEnvelope {
  requestId: string;
  routeGroup: string;
  dataClass: DataClassification;
  allowedProviders: string[];
  allowedModels?: string[];
  deniedProviders: string[];
  deniedModels: string[];
  localOnly: boolean;
  allowFallback: boolean;
  maxAttempts: number;
  hardBudgetUsd?: number;
  unknownPriceBehavior: "deny" | "allow";
  policyDecisionId: string;
}

export interface RouteAttempt {
  attemptNumber: number;
  provider: string;
  model: string;
  modelFamily: string;
  isLocal: boolean;
  status: "success" | "failed";
  errorClass?: FailureClass;
  errorMessage?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  timestamp: string;
}

export interface GatewayRequest {
  requestId: string;
  actorId: string;
  workspaceId?: string;
  taskId?: string;
  taskType:
    | "chat"
    | "coding"
    | "reasoning"
    | "vision"
    | "image"
    | "embedding"
    | "audio"
    | "review";

  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  input?: unknown;
  systemPrompt?: string;

  capabilityRequirements: string[];

  policy: {
    routeGroup: string;
    allowedProviders?: string[];
    allowedModels?: string[];
    deniedProviders?: string[];
    localOnly?: boolean;
    dataClass?: DataClassification;
    unknownPriceBehavior?: "deny" | "allow";
  };

  budget?: {
    maxCostUsd?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxAttempts?: number;
    hardStop?: boolean;
  };

  runtime?: {
    timeoutMs?: number;
    stream?: boolean;
    allowFallback?: boolean;
    temperature?: number;
  };

  metadata?: Record<string, unknown>;
}

export interface GatewayResponse {
  requestId: string;
  taskId?: string;
  output: string;
  structuredOutput?: unknown;

  routing: {
    requestedRouteGroup: string;
    resolvedProvider: string;
    resolvedModel: string;
    resolvedModelFamily: string;
    isLocal: boolean;
    fallbackCount: number;
    attempts: RouteAttempt[];
  };

  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalTaskCostUsd: number; // Cumulative across all attempts
    finalAttemptCostUsd: number;
    pricingStatus: PricingStatus;
  };

  performance: {
    totalLatencyMs: number;
    firstTokenLatencyMs?: number;
  };

  governance: {
    policyDecisionId: string;
    budgetDecisionId?: string;
    dataClass: DataClassification;
    localOnly: boolean;
    unknownPriceDenied: boolean;
    correlationCheckPassed: boolean;
  };

  gateway: {
    adapter: "omniroute" | "direct";
    version: string;
  };
}

export interface CircuitState {
  provider: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  openedAt?: string;
  cooldownUntil?: string;
  lastReason?: string;
  lastUpdated: string;
}

export interface GatewayHealth {
  status: "healthy" | "degraded" | "unhealthy";
  activeAdapter: "omniroute" | "direct";
  omnirouteConnected: boolean;
  /** Real probe result — degraded (not dead) when the daemon is offline. */
  omniroute?: {
    baseUrl: string;
    status: "connected" | "unreachable" | "disabled";
    checkedAt: string;
    latencyMs: number | null;
    error: string | null;
  };
  totalRequestsToday: number;
  openCircuitsCount: number;
  circuits: CircuitState[];
}
