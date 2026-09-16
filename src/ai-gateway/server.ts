/**
 * Pao AI Gateway — HTTP Server.
 *
 * Standalone Bun HTTP server on configurable port (default 8787).
 * Provides OpenAI-compatible ingress plus Pao admin endpoints.
 *
 * This is the composition root for the gateway subsystem.
 */

import type {
  GatewayConfig,
  GatewayTraceRecord,
  NormalizedChatRequest,
  NormalizedChatResponse,
  RoutingRequest,
  RouteDecision,
  CandidateOutcome,
  GatewayEventRecord,
  GatewayFailureClass,
  RouteAttemptRecord,
  RouteDecisionRecord,
} from "./types";
import { loadGatewayConfig } from "./config";
import { ProviderRegistry } from "./providers/registry";
import { authenticateRequest, isAliasPermitted } from "./auth/identity";
import { checkBudget, recordSpend, getGlobalSpendSummary, estimateTokens } from "./auth/budget";
import { routeRequest, getFallbackCandidates, type RouterContext } from "./routing/router";
import { resolveAlias } from "./aliases";
import { runInputGuardrails, runOutputGuardrails } from "./guardrails/engine";
import { isPaoAlias } from "./aliases";
import { recordTrace, readTodayTraces, aggregateUsage } from "./traces/ledger";
import { authenticateAdminRequest } from "./auth/identity";
import { classifyRisk, evaluateWithCouncil, type CouncilReviewTarget } from "./council";
import { CircuitBreaker } from "./routing/adaptive";
import { QuotaStore } from "./quota/store";
import { ConnectionStore } from "./resilience/connection-state";
import { LeaseStore } from "./routing/leases";
import {
  planQuotaAwareRoute,
  routeKeyOf,
  type GovernanceCandidate,
  type ScoredRouteCandidate,
} from "./routing/quota-router";
import { executeGoverned } from "./routing/fallback-controller";
import { classifyGatewayFailure, type FailureBehavior } from "./resilience/classifier";
import { startRecoveryWorker, type RecoveryWorkerHandle } from "./resilience/recovery";
import { NineRouterProvider, type NineRouterTelemetry } from "./providers/nine-router";
import { classifyFreshness } from "./quota/model";
import {
  recordDecision,
  recordRouteAttempt,
  recordGatewayEvent,
  readDecisions,
  readGatewayEvents,
  readRouteAttempts,
} from "./traces/decision-ledger";
import type { Server } from "bun";

const ROUTER_VERSION_V3 = "router-v3-quota-aware";

// ---------------------------------------------------------------------------
// Request ID generation
// ---------------------------------------------------------------------------

let requestCounter = 0;
function nextRequestId(): string {
  return `gw-${Date.now()}-${++requestCounter}`;
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Pao-Gateway": "1",
    },
  });
}

function errorResponse(message: string, status: number, code?: string): Response {
  return jsonResponse({
    error: {
      message,
      type: code ?? "gateway_error",
      code,
    },
  }, status);
}

// ---------------------------------------------------------------------------
// Governance runtime (Phase 20.51)
// ---------------------------------------------------------------------------

interface NineRouterRuntime {
  readonly providerId: string;
  readonly adapter: NineRouterProvider;
  telemetry: NineRouterTelemetry | null;
}

interface GovernanceRuntime {
  readonly config: NonNullable<GatewayConfig["governance"]>;
  readonly quotaStore: QuotaStore;
  readonly connections: ConnectionStore;
  readonly breaker: CircuitBreaker;
  readonly leases: LeaseStore;
  /** Set once a nine-router provider registers; mutated only during startup. */
  nineRouter: NineRouterRuntime | null;
  readonly timers: ReturnType<typeof setInterval>[];
  recovery: RecoveryWorkerHandle | null;
}

interface GatewayState {
  config: GatewayConfig;
  providerRegistry: ProviderRegistry;
  rootDir: string;
  startedAt: string;
  governance: GovernanceRuntime | null;
}

function governanceEventSink(rootDir: string): (event: GatewayEventRecord) => void {
  return event => {
    recordGatewayEvent(rootDir, event);
  };
}

/**
 * Map an upstream telemetry hint (e.g. "antigravity/gemini-2.5-pro") onto
 * catalog route keys. Upstream identifiers and catalog ids do not have to
 * agree, so matching runs on the last path segment of each. Hints that match
 * nothing land on the gateway-level key instead of being dropped silently.
 */
function upsertTelemetryWindows(
  state: GatewayState,
  runtime: GovernanceRuntime,
  telemetry: NineRouterTelemetry,
): void {
  if (!runtime.nineRouter) return;
  const { providerId } = runtime.nineRouter;
  const catalogModels = state.config.models.filter(m => m.providerId === providerId);

  for (const { routeKeyHint, window } of telemetry.windows) {
    const hintModel = routeKeyHint.split("/").pop()?.toLowerCase() ?? "";
    const matches = catalogModels.filter(m => {
      const catalogModel = m.model.split("/").pop()?.toLowerCase() ?? "";
      return catalogModel !== "" && (catalogModel === hintModel || routeKeyHint.toLowerCase().includes(catalogModel));
    });
    if (matches.length > 0) {
      for (const match of matches) {
        runtime.quotaStore.upsert(routeKeyOf(providerId, match.id), [window]);
      }
    } else {
      runtime.quotaStore.upsert(`${providerId}/_gateway`, [window]);
    }
  }
}

async function syncNineRouterTelemetry(state: GatewayState): Promise<void> {
  const runtime = state.governance;
  const nr = runtime?.nineRouter;
  if (!runtime || !nr) return;
  try {
    const telemetry = await nr.adapter.getTelemetry();
    nr.telemetry = telemetry;
    upsertTelemetryWindows(state, runtime, telemetry);
    const health = await nr.adapter.healthCheck();
    state.providerRegistry.setCachedHealth(nr.providerId, health);
  } catch (err) {
    recordGatewayEvent(state.rootDir, {
      timestamp: new Date().toISOString(),
      severity: "warning",
      eventType: "NINE_ROUTER_SYNC_FAILED",
      providerId: nr.providerId,
      reasonCode: "TELEMETRY_STALE",
      details: { message: err instanceof Error ? err.message : "unknown error" },
    });
  }
}

function buildGovernanceRuntime(state: GatewayState): GovernanceRuntime | null {
  const config = state.config.governance;
  if (!config?.enabled) return null;

  const timers: ReturnType<typeof setInterval>[] = [];

  const connections = new ConnectionStore({
    onEvent: governanceEventSink(state.rootDir),
  });
  const breaker = new CircuitBreaker({
    failureThreshold: config.circuitBreaker.failureThreshold,
    cooldownMs: config.circuitBreaker.cooldownMs,
    rateLimitCooldownMs: config.circuitBreaker.rateLimitCooldownMs,
  });
  const leases = new LeaseStore({ ttlMs: config.sessionLeaseTtlMin * 60 * 1000 });
  const quotaStore = new QuotaStore();

  const runtime: GovernanceRuntime = {
    config,
    quotaStore,
    connections,
    breaker,
    leases,
    nineRouter: null,
    timers,
    recovery: null,
  };

  // Assign before starting timers/workers: the initial telemetry sync reads
  // state.governance through the same state object.
  state.governance = runtime;

  // NineRouter telemetry sync — only when a nine-router provider registered.
  const nrConfig = state.config.nineRouter;
  const nrProviderConfig = state.config.providers.find(p => p.type === "nine-router");
  if (nrConfig?.enabled && nrProviderConfig) {
    const provider = state.providerRegistry.get(nrProviderConfig.id);
    if (provider instanceof NineRouterProvider) {
      runtime.nineRouter = { providerId: nrProviderConfig.id, adapter: provider, telemetry: null };
      const intervalMs = Math.max(5, nrConfig.syncIntervalSec) * 1000;
      const timer = setInterval(() => {
        void syncNineRouterTelemetry(state);
      }, intervalMs);
      timer.unref?.();
      timers.push(timer);
      void syncNineRouterTelemetry(state);
    }
  }

  // Recovery worker probes cooldown routes; quarantined routes stay untouched.
  runtime.recovery = startRecoveryWorker(
    {
      connections,
      probe: async routeKey => {
        const providerId = routeKey.split("/")[0];
        const provider = state.providerRegistry.get(providerId);
        if (!provider) return false;
        const health = await provider.healthCheck();
        return health.healthy;
      },
    },
    {
      intervalMs: 60_000,
      onEvent: governanceEventSink(state.rootDir),
    },
  );

  return runtime;
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

function handleHealth(state: GatewayState): Response {
  return jsonResponse({
    status: "ok",
    version: "20.13",
    routerVersion: state.config.routerVersion,
    startedAt: state.startedAt,
    providers: state.providerRegistry.listIds().length,
    aliases: state.config.aliases.length,
  });
}

function handleReady(state: GatewayState): Response {
  const configuredProviders = state.providerRegistry.listAll().filter(p => p.isConfigured()).length;
  const ready = configuredProviders > 0 || state.config.providers.length === 0;
  return jsonResponse({ ready, configuredProviders }, ready ? 200 : 503);
}

function handleListModels(state: GatewayState): Response {
  // Return aliases as available "models" (the OpenAI-compatible model list)
  const aliasModels = state.config.aliases.map(a => ({
    id: a.id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "pao-gateway",
  }));

  // Also include direct model references
  const directModels = state.config.models
    .filter(m => m.enabled !== false)
    .map(m => ({
      id: m.id,
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: m.providerId,
    }));

  return jsonResponse({
    object: "list",
    data: [...aliasModels, ...directModels],
  });
}

async function handleChatCompletions(
  req: Request,
  state: GatewayState,
): Promise<Response> {
  const requestId = nextRequestId();
  const start = Date.now();

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }

  const requestedModel = String(body.model ?? "");
  if (!requestedModel) {
    return errorResponse("Missing 'model' field", 400, "invalid_request");
  }

  // Authenticate
  const authHeader = req.headers.get("Authorization");
  const identity = authenticateRequest(authHeader, state.config);
  if (!identity) {
    return errorResponse("Unauthorized", 401, "auth_failure");
  }

  // Authorize alias
  if (isPaoAlias(requestedModel) && !isAliasPermitted(identity, requestedModel)) {
    return errorResponse(
      `Identity '${identity.id}' is not permitted to use alias '${requestedModel}'`,
      403,
      "policy_denial",
    );
  }

  // Build normalized request
  const normalizedRequest: NormalizedChatRequest = {
    model: requestedModel,
    messages: (body.messages as NormalizedChatRequest["messages"]) ?? [],
    temperature: body.temperature as number | undefined,
    maxTokens: (body.max_tokens ?? body.maxTokens) as number | undefined,
    topP: (body.top_p ?? body.topP) as number | undefined,
    stream: body.stream === true,
    tools: body.tools as unknown[] | undefined,
    responseFormat: body.response_format ?? body.responseFormat,
  };

  // Input guardrails — must complete BEFORE routing
  const guardrailPolicy = state.config.policies.find(p => p.identityId === identity.id);
  const inputGuardrailResult = runInputGuardrails(normalizedRequest, guardrailPolicy);
  if (inputGuardrailResult.action === "block") {
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: "",
      selectedProviderId: "",
      routerVersion: state.config.routerVersion,
      riskLevel: "R0",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - start,
      status: "blocked",
      fallbackCount: 0,
      guardrailResult: "block",
      traceContentMode: state.config.traceContentMode,
    });
    return errorResponse(
      inputGuardrailResult.safeMessage ?? "Request blocked by input guardrails",
      400,
      inputGuardrailResult.code ?? "guardrail_block",
    );
  }

  // Phase 20.51 — governed path: quota-aware routing, bounded fallback,
  // circuit/connection tracking, decision ledger.
  if (state.governance) {
    return await handleChatCompletionsGoverned(state, req, requestId, start, identity, normalizedRequest, requestedModel, guardrailPolicy);
  }

  // Route
  const routingRequest: RoutingRequest = {
    identityId: identity.id,
    alias: requestedModel,
    privacyClass: identity.localOnly ? "local-only" : "standard",
    toolsRequired: !!normalizedRequest.tools?.length,
  };

  const routerCtx: RouterContext = {
    config: state.config,
    providerRegistry: state.providerRegistry,
  };

  let routeDecision;
  try {
    routeDecision = routeRequest(routingRequest, routerCtx);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const status = code === "policy_denial" ? 403
      : code === "local_only_violation" ? 403
      : 404;
    return errorResponse(
      err instanceof Error ? err.message : "Routing failed",
      status,
      code ?? "routing_error",
    );
  }

  // Budget check
  const selectedModel = state.config.models.find(m => m.id === routeDecision.selectedModelId);
  if (!selectedModel) {
    return errorResponse("Routed model not found in catalog", 500, "internal_error");
  }

  const budgetResult = checkBudget(identity, selectedModel, normalizedRequest, state.config.budgets);
  if (!budgetResult.allowed) {
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: routeDecision.selectedModelId,
      selectedProviderId: routeDecision.selectedProviderId,
      routerVersion: state.config.routerVersion,
      riskLevel: routeDecision.riskLevel,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs: Date.now() - start,
      status: "budget_denied",
      fallbackCount: 0,
      guardrailResult: "allow",
      traceContentMode: state.config.traceContentMode,
    });
    return errorResponse(
      `Budget limit exceeded: ${budgetResult.denialReason}`,
      429,
      "budget_denial",
    );
  }

  // Get provider and execute
  const provider = state.providerRegistry.get(routeDecision.selectedProviderId);
  if (!provider) {
    return errorResponse(`Provider ${routeDecision.selectedProviderId} not available`, 503, "provider_unavailable");
  }

  // Rewrite model to the actual upstream model ID
  const upstreamRequest: NormalizedChatRequest = {
    ...normalizedRequest,
    model: selectedModel.model,
    _gateway: {
      requestId,
      identity,
      routeDecision,
    },
  };

  let response: NormalizedChatResponse;
  try {
    response = await provider.chat(upstreamRequest);
  } catch (err) {
    const latencyMs = Date.now() - start;
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: routeDecision.selectedModelId,
      selectedProviderId: routeDecision.selectedProviderId,
      routerVersion: state.config.routerVersion,
      riskLevel: routeDecision.riskLevel,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs,
      status: "error",
      fallbackCount: 0,
      guardrailResult: "allow",
      traceContentMode: state.config.traceContentMode,
    });
    return errorResponse(
      err instanceof Error ? err.message : "Provider request failed",
      502,
      (err as { code?: string }).code ?? "provider_error",
    );
  }

  // Output guardrails
  const outputGuardrailResult = runOutputGuardrails(response, guardrailPolicy);
  if (outputGuardrailResult.action === "block") {
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: routeDecision.selectedModelId,
      selectedProviderId: routeDecision.selectedProviderId,
      routerVersion: state.config.routerVersion,
      riskLevel: routeDecision.riskLevel,
      inputTokens: response.usage?.promptTokens ?? 0,
      outputTokens: response.usage?.completionTokens ?? 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs: Date.now() - start,
      status: "blocked",
      fallbackCount: 0,
      guardrailResult: "block",
      traceContentMode: state.config.traceContentMode,
    });
    // Do not leak any of the blocked output
    return errorResponse(
      outputGuardrailResult.safeMessage ?? "Response blocked by output guardrails",
      400,
      outputGuardrailResult.code ?? "output_guardrail_block",
    );
  }

  // Record actual usage and spend
  const latencyMs = Date.now() - start;
  const actualInputTokens = response.usage?.promptTokens ?? 0;
  const actualOutputTokens = response.usage?.completionTokens ?? 0;

  let actualCost: number | undefined;
  if (selectedModel.pricing.inputPerMillionUsd !== null && selectedModel.pricing.outputPerMillionUsd !== null) {
    actualCost =
      (actualInputTokens / 1_000_000) * selectedModel.pricing.inputPerMillionUsd +
      (actualOutputTokens / 1_000_000) * selectedModel.pricing.outputPerMillionUsd;
    recordSpend(identity.id, actualCost);
  }

  // Record trace
  recordTrace(state.rootDir, {
    requestId,
    timestamp: new Date().toISOString(),
    identityId: identity.id,
    alias: requestedModel,
    selectedModelId: routeDecision.selectedModelId,
    selectedProviderId: routeDecision.selectedProviderId,
    routerVersion: state.config.routerVersion,
    riskLevel: routeDecision.riskLevel,
    inputTokens: actualInputTokens,
    outputTokens: actualOutputTokens,
    estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
    actualCostUsd: actualCost,
    latencyMs,
    status: "success",
    fallbackCount: 0,
    guardrailResult: "allow",
    traceContentMode: state.config.traceContentMode,
  });

  // Return normalized response with gateway metadata headers
  const respBody = {
    ...response,
    // Rewrite model to show the alias, not the upstream model
    model: requestedModel,
  };

  return new Response(JSON.stringify(respBody), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Pao-Gateway": "1",
      "X-Pao-Request-Id": requestId,
      "X-Pao-Router-Version": state.config.routerVersion,
      "X-Pao-Selected-Model": routeDecision.selectedModelId,
    },
  });
}

// ---------------------------------------------------------------------------
// Governed execution path (Phase 20.51)
// ---------------------------------------------------------------------------

function resolveGovernanceCandidates(state: GatewayState, alias: string): GovernanceCandidate[] {
  if (isPaoAlias(alias)) {
    const resolutions = resolveAlias(alias, state.config.aliases, state.config.models);
    if (resolutions.length === 0) {
      throw new Error(`No routes configured for alias: ${alias}`);
    }
    return resolutions.map(r => {
      const model = state.config.models.find(m => m.id === r.modelId)!;
      return { modelId: r.modelId, providerId: model.providerId, model, aliasPriority: r.priority };
    });
  }
  const model = state.config.models.find(m => m.id === alias || m.model === alias);
  if (!model) throw new Error(`Model not found: ${alias}`);
  return [{ modelId: model.id, providerId: model.providerId, model, aliasPriority: 100 }];
}

function decisionFromCandidate(
  alias: string,
  candidate: ScoredRouteCandidate,
  fallbackAttempt: number,
): RouteDecision {
  return {
    alias,
    selectedModelId: candidate.modelId,
    selectedProviderId: candidate.providerId,
    routerVersion: ROUTER_VERSION_V3,
    reason: candidate.reasons,
    fallbackAttempt,
    riskLevel: "R0",
  };
}

/** Map a classified failure onto the connection store's failure kinds. */
function softFailureFor(
  runtime: GovernanceRuntime,
  routeKey: string,
  failureClass: GatewayFailureClass,
): { kind: "transient" | "rate_limit" | "quota_exhausted" | "permanent"; failureClass: string; resetAt?: string } {
  switch (failureClass) {
    case "auth_invalid":
    case "permission_denied":
      return { kind: "permanent", failureClass };
    case "quota_exhausted":
      return {
        kind: "quota_exhausted",
        failureClass,
        resetAt: runtime.quotaStore.primary(routeKey)?.resetAt,
      };
    case "rate_limited":
      return { kind: "rate_limit", failureClass };
    default:
      return { kind: "transient", failureClass };
  }
}

function breakerLegacyCode(failureClass: string): string {
  if (failureClass === "auth_invalid" || failureClass === "permission_denied") return "auth_failure";
  if (failureClass === "rate_limited" || failureClass === "quota_exhausted") return "provider_429";
  return "provider_5xx";
}

function failureStatusFor(behavior: FailureBehavior | undefined): number {
  if (!behavior) return 502;
  if (behavior.failureClass === "content_rejected") return 400;
  if (behavior.failureClass === "budget_blocked") return 429;
  if (behavior.failureClass === "policy_blocked") return 403;
  return 502;
}

async function handleChatCompletionsGoverned(
  state: GatewayState,
  req: Request,
  requestId: string,
  start: number,
  identity: NonNullable<ReturnType<typeof authenticateRequest>>,
  normalizedRequest: NormalizedChatRequest,
  requestedModel: string,
  guardrailPolicy: Parameters<typeof runInputGuardrails>[1],
): Promise<Response> {
  const runtime = state.governance!;
  const sessionId = req.headers.get("x-pao-session-id")?.trim().slice(0, 128) || undefined;

  // 1. Resolve candidates and plan quota-aware.
  let candidates: GovernanceCandidate[];
  try {
    candidates = resolveGovernanceCandidates(state, requestedModel);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Routing failed",
      404,
      "routing_error",
    );
  }

  const { input: inputTokens } = estimateTokens(normalizedRequest);
  const plan = planQuotaAwareRoute(
    {
      candidates,
      requiredCapabilities: normalizedRequest.tools?.length ? { tools: true } : undefined,
      contextTokens: inputTokens,
      maxCostUsd: identity.maxRequestUsd > 0 ? identity.maxRequestUsd : undefined,
      localOnly: identity.localOnly === true,
      sessionId,
    },
    {
      config: state.config,
      governance: runtime.config,
      providerRegistry: state.providerRegistry,
      quotaStore: runtime.quotaStore,
      connections: runtime.connections,
      breaker: runtime.breaker,
      leases: runtime.leases,
    },
  );

  const rejections: CandidateOutcome[] = [...plan.rejections];

  if (!plan.selected) {
    const decision: RouteDecisionRecord = {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      weightProfile: plan.weightProfile,
      sessionId,
      candidates: rejections,
      fallbackDepth: 0,
      outcome: "no_eligible_route",
      reasonCodes: [...new Set(rejections.flatMap(r => r.reasonCodes))],
      latencyMs: Date.now() - start,
    };
    recordDecision(state.rootDir, decision);
    return errorResponse("No eligible route after policy filters", 404, "no_eligible_route");
  }

  // 2. Budget admission for the planned route (mirrors the legacy trace).
  const selectedModel = plan.selected.model;
  const budgetResult = checkBudget(identity, selectedModel, normalizedRequest, state.config.budgets);
  if (!budgetResult.allowed) {
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: plan.selected.modelId,
      selectedProviderId: plan.selected.providerId,
      routerVersion: ROUTER_VERSION_V3,
      riskLevel: "R0",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs: Date.now() - start,
      status: "budget_denied",
      fallbackCount: 0,
      guardrailResult: "allow",
      traceContentMode: state.config.traceContentMode,
    });
    recordDecision(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      weightProfile: plan.weightProfile,
      sessionId,
      selectedRouteKey: plan.selected.routeKey,
      selectedModelId: plan.selected.modelId,
      selectedProviderId: plan.selected.providerId,
      candidates: [...rejections, {
        routeKey: plan.selected.routeKey,
        providerId: plan.selected.providerId,
        modelId: plan.selected.modelId,
        status: "selected",
        score: plan.selected.score,
        reasonCodes: [...plan.selected.reasons],
      }],
      fallbackDepth: 0,
      outcome: "budget_denied",
      reasonCodes: ["ROUTE_REJECTED_BUDGET", budgetResult.denialReason ?? "budget_denial"],
      latencyMs: Date.now() - start,
    });
    return errorResponse(
      `Budget limit exceeded: ${budgetResult.denialReason}`,
      429,
      "budget_denial",
    );
  }

  // 3. Execute with bounded fallback; gate re-checks live state per attempt.
  let lastErrorMessage = "";
  const attempts: RouteAttemptRecord[] = [];
  const execResult = await executeGoverned({
    requestId,
    candidates: plan.ordered,
    policy: runtime.config.fallback,
    callbacks: {
      executor: async candidate => {
        const provider = state.providerRegistry.get(candidate.providerId);
        if (!provider) {
          throw Object.assign(new Error(`Provider ${candidate.providerId} not available`), {
            code: "provider_unavailable",
          });
        }
        const upstreamRequest: NormalizedChatRequest = {
          ...normalizedRequest,
          model: candidate.model.model,
          _gateway: {
            requestId,
            identity,
            routeDecision: decisionFromCandidate(requestedModel, candidate, attempts.length),
          },
        };
        try {
          return await provider.chat(upstreamRequest);
        } catch (err) {
          lastErrorMessage = err instanceof Error ? err.message : "provider request failed";
          throw err;
        }
      },
      gate: candidate => {
        if (!state.providerRegistry.get(candidate.providerId)) {
          return { allowed: false, reasonCode: "ROUTE_REJECTED_DISABLED" };
        }
        const conn = runtime.connections.get(candidate.routeKey);
        if (conn.state === "disabled") return { allowed: false, reasonCode: "ROUTE_REJECTED_DISABLED" };
        if (conn.state === "quarantined") return { allowed: false, reasonCode: "ROUTE_REJECTED_QUARANTINED" };
        if (conn.state === "cooldown") return { allowed: false, reasonCode: "ROUTE_REJECTED_COOLDOWN" };
        if (!runtime.breaker.canAttempt(candidate.providerId)) {
          return { allowed: false, reasonCode: "ROUTE_REJECTED_CIRCUIT_OPEN" };
        }
        const budget = checkBudget(identity, candidate.model, normalizedRequest, state.config.budgets);
        if (!budget.allowed) return { allowed: false, reasonCode: "ROUTE_REJECTED_BUDGET" };
        return { allowed: true };
      },
      onAttempt: record => {
        attempts.push(record);
        recordRouteAttempt(state.rootDir, record);
        if (record.outcome === "failure" && record.failureClass) {
          const routeKey = routeKeyOf(record.providerId, record.modelId);
          runtime.connections.recordFailure(routeKey, softFailureFor(runtime, routeKey, record.failureClass));
          runtime.breaker.recordFailure(record.providerId, breakerLegacyCode(record.failureClass));
          // A failure on the leased route migrates the session off it.
          if (sessionId) {
            const lease = runtime.leases.get(sessionId);
            if (lease && lease.routeKey === routeKey) {
              runtime.leases.abandon(sessionId);
              recordGatewayEvent(state.rootDir, {
                timestamp: new Date().toISOString(),
                severity: "info",
                eventType: "ROUTE_LEASE_MIGRATED",
                providerId: record.providerId,
                modelId: record.modelId,
                reasonCode: "ROUTE_LEASE_MIGRATED",
                details: { from: routeKey, requestId },
              });
            }
          }
        }
      },
      onSkip: (candidate, reasonCode) => {
        rejections.push({
          routeKey: candidate.routeKey,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          status: "rejected",
          reasonCodes: [reasonCode],
        });
      },
      onEvent: event => recordGatewayEvent(state.rootDir, event),
    },
  });

  const selectedCandidate = execResult.selected ?? plan.selected;
  const decisionReasonCodes = [
    ...new Set([
      ...(selectedCandidate?.reasons ?? []),
      ...rejections.flatMap(r => r.reasonCodes),
      ...execResult.failures.map(f => f.behavior.reasonCode),
    ]),
  ];

  // 4. No attempt succeeded.
  if (execResult.outcome !== "success" || !execResult.result) {
    const lastFailure = execResult.failures[execResult.failures.length - 1];
    const status = failureStatusFor(lastFailure?.behavior);
    const latencyMs = Date.now() - start;
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: selectedCandidate.modelId,
      selectedProviderId: selectedCandidate.providerId,
      routerVersion: ROUTER_VERSION_V3,
      riskLevel: "R0",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs,
      status: "error",
      fallbackCount: execResult.fallbackDepth,
      guardrailResult: "allow",
      traceContentMode: state.config.traceContentMode,
    });
    recordDecision(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      weightProfile: plan.weightProfile,
      sessionId,
      selectedRouteKey: selectedCandidate.routeKey,
      selectedModelId: selectedCandidate.modelId,
      selectedProviderId: selectedCandidate.providerId,
      candidates: [
        ...rejections,
        {
          routeKey: selectedCandidate.routeKey,
          providerId: selectedCandidate.providerId,
          modelId: selectedCandidate.modelId,
          status: "attempted",
          score: selectedCandidate.score,
          reasonCodes: [...selectedCandidate.reasons],
        },
      ],
      fallbackDepth: execResult.fallbackDepth,
      outcome: execResult.outcome,
      reasonCodes: decisionReasonCodes,
      latencyMs,
    });
    const message =
      execResult.outcome === "no_eligible_route"
        ? "All candidate routes were rejected before execution"
        : execResult.outcome === "deadline_exceeded"
          ? "Request deadline exceeded before a route succeeded"
          : lastErrorMessage || "All eligible routes failed";
    return errorResponse(message, status, lastFailure?.behavior.reasonCode ?? "provider_error");
  }

  // 5. Success: health, lease, guardrails, spend, ledgers, response.
  const response = execResult.result;
  runtime.connections.recordSuccess(selectedCandidate.routeKey);
  runtime.breaker.recordSuccess(selectedCandidate.providerId);
  if (sessionId) runtime.leases.bind(sessionId, selectedCandidate.routeKey);

  const outputGuardrailResult = runOutputGuardrails(response, guardrailPolicy);
  if (outputGuardrailResult.action === "block") {
    const latencyMs = Date.now() - start;
    recordTrace(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      selectedModelId: selectedCandidate.modelId,
      selectedProviderId: selectedCandidate.providerId,
      routerVersion: ROUTER_VERSION_V3,
      riskLevel: "R0",
      inputTokens: response.usage?.promptTokens ?? 0,
      outputTokens: response.usage?.completionTokens ?? 0,
      estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
      latencyMs,
      status: "blocked",
      fallbackCount: execResult.fallbackDepth,
      guardrailResult: "block",
      traceContentMode: state.config.traceContentMode,
    });
    recordDecision(state.rootDir, {
      requestId,
      timestamp: new Date().toISOString(),
      identityId: identity.id,
      alias: requestedModel,
      weightProfile: plan.weightProfile,
      sessionId,
      selectedRouteKey: selectedCandidate.routeKey,
      selectedModelId: selectedCandidate.modelId,
      selectedProviderId: selectedCandidate.providerId,
      candidates: rejections,
      fallbackDepth: execResult.fallbackDepth,
      outcome: "failed",
      reasonCodes: [...decisionReasonCodes, outputGuardrailResult.code ?? "output_guardrail_block"],
      latencyMs,
    });
    return errorResponse(
      outputGuardrailResult.safeMessage ?? "Response blocked by output guardrails",
      400,
      outputGuardrailResult.code ?? "output_guardrail_block",
    );
  }

  const latencyMs = Date.now() - start;
  const actualInputTokens = response.usage?.promptTokens ?? 0;
  const actualOutputTokens = response.usage?.completionTokens ?? 0;

  let actualCost: number | undefined;
  if (selectedModel.pricing.inputPerMillionUsd !== null && selectedModel.pricing.outputPerMillionUsd !== null) {
    actualCost =
      (actualInputTokens / 1_000_000) * selectedModel.pricing.inputPerMillionUsd +
      (actualOutputTokens / 1_000_000) * selectedModel.pricing.outputPerMillionUsd;
    recordSpend(identity.id, actualCost);
  }

  recordTrace(state.rootDir, {
    requestId,
    timestamp: new Date().toISOString(),
    identityId: identity.id,
    alias: requestedModel,
    selectedModelId: selectedCandidate.modelId,
    selectedProviderId: selectedCandidate.providerId,
    routerVersion: ROUTER_VERSION_V3,
    riskLevel: "R0",
    inputTokens: actualInputTokens,
    outputTokens: actualOutputTokens,
    estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
    actualCostUsd: actualCost,
    latencyMs,
    status: "success",
    fallbackCount: execResult.fallbackDepth,
    guardrailResult: "allow",
    traceContentMode: state.config.traceContentMode,
  });

  recordDecision(state.rootDir, {
    requestId,
    timestamp: new Date().toISOString(),
    identityId: identity.id,
    alias: requestedModel,
    weightProfile: plan.weightProfile,
    sessionId,
    selectedRouteKey: selectedCandidate.routeKey,
    selectedModelId: selectedCandidate.modelId,
    selectedProviderId: selectedCandidate.providerId,
    candidates: [
      ...rejections,
      {
        routeKey: selectedCandidate.routeKey,
        providerId: selectedCandidate.providerId,
        modelId: selectedCandidate.modelId,
        status: "selected",
        score: selectedCandidate.score,
        reasonCodes: [...selectedCandidate.reasons],
      },
    ],
    fallbackDepth: execResult.fallbackDepth,
    outcome: "success",
    reasonCodes: decisionReasonCodes,
    estimatedCostUsd: budgetResult.estimatedCostUsd ?? 0,
    actualCostUsd: actualCost,
    latencyMs,
  });

  const respBody = {
    ...response,
    model: requestedModel,
  };

  return new Response(JSON.stringify(respBody), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Pao-Gateway": "1",
      "X-Pao-Request-Id": requestId,
      "X-Pao-Router-Version": ROUTER_VERSION_V3,
      "X-Pao-Selected-Model": selectedCandidate.modelId,
      "X-Pao-Fallback-Depth": String(execResult.fallbackDepth),
      "X-Pao-Weight-Profile": plan.weightProfile,
    },
  });
}

// ---------------------------------------------------------------------------
// Admin API handlers
// ---------------------------------------------------------------------------

function handleAdminProviders(state: GatewayState): Response {
  // Never return raw API keys
  return jsonResponse({
    providers: state.config.providers.map(p => ({
      id: p.id,
      type: p.type,
      enabled: p.enabled !== false,
      configured: state.providerRegistry.isConfigured(p.id),
      healthy: state.providerRegistry.isHealthy(p.id),
      baseUrl: p.baseUrl ? p.baseUrl.replace(/\/\/[^@]*@/, "//***@") : undefined,
    })),
  });
}

function handleAdminModels(state: GatewayState): Response {
  return jsonResponse({
    models: state.config.models.map(m => ({
      id: m.id,
      providerId: m.providerId,
      capabilities: m.capabilities,
      limits: m.limits,
      pricing: m.pricing,
      tags: m.tags,
      enabled: m.enabled !== false,
    })),
  });
}

function handleAdminAliases(state: GatewayState): Response {
  return jsonResponse({ aliases: state.config.aliases });
}

function handleAdminUsage(state: GatewayState): Response {
  const traces = readTodayTraces(state.rootDir);
  const summary = aggregateUsage(traces);
  const globalSpend = getGlobalSpendSummary();
  return jsonResponse({
    ...summary,
    budgets: {
      global: state.config.budgets.global,
      globalSpend,
    },
  });
}

function handleAdminBudgets(state: GatewayState): Response {
  const globalSpend = getGlobalSpendSummary();
  return jsonResponse({
    config: state.config.budgets,
    currentSpend: {
      global: globalSpend,
    },
  });
}

function handleAdminHealth(state: GatewayState): Response {
  const providerHealth = state.providerRegistry.listIds().map(id => ({
    id,
    ...state.providerRegistry.getCachedHealth(id),
  }));
  return jsonResponse({
    gateway: {
      status: "ok",
      startedAt: state.startedAt,
      routerVersion: state.config.routerVersion,
    },
    providers: providerHealth,
  });
}

function handleAdminTraces(state: GatewayState, url: URL): Response {
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 1000);
  const traces = readTodayTraces(state.rootDir).slice(-limit);
  return jsonResponse({ traces, count: traces.length });
}

function handleTestRoute(req: Request, state: GatewayState): Response {
  // Dry-run route resolution for debugging/explanation. Never executes a provider call.
  const url = new URL(req.url);
  const alias = url.searchParams.get("alias") ?? "";
  const identityId = url.searchParams.get("identity") ?? "admin-pao";
  if (!alias) return errorResponse("Missing 'alias' query parameter", 400, "invalid_request");
  try {
    const decision = routeRequest(
      { identityId, alias, privacyClass: "standard" },
      { config: state.config, providerRegistry: state.providerRegistry },
    );
    return jsonResponse({ decision });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Route resolution failed",
      404,
      (err as { code?: string }).code ?? "route_test_failed",
    );
  }
}

async function handleTestProvider(req: Request, state: GatewayState): Promise<Response> {
  let body: { providerId?: string } = {};
  try {
    body = (await req.json()) as { providerId?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }
  if (!body.providerId) return errorResponse("Missing 'providerId'", 400, "invalid_request");
  const provider = state.providerRegistry.get(body.providerId);
  if (!provider) return errorResponse(`Provider ${body.providerId} not found`, 404);
  try {
    const health = await provider.healthCheck();
    state.providerRegistry.setCachedHealth(body.providerId, health);
    return jsonResponse({ providerId: body.providerId, health });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Health check failed",
      503,
      "provider_health_failed",
    );
  }
}

async function handleCouncilClassify(req: Request): Promise<Response> {
  let body: { text?: string; command?: string; affectedFiles?: string[]; alias?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }
  const result = classifyRisk({
    text: body.text ?? "",
    command: body.command,
    affectedFiles: body.affectedFiles,
    alias: body.alias,
  });
  return jsonResponse({ classification: result });
}

async function handleCouncilEvaluate(req: Request, state: GatewayState): Promise<Response> {
  let body: CouncilReviewTarget = { summary: "" };
  try {
    body = (await req.json()) as CouncilReviewTarget;
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }
  if (!body.summary) {
    return errorResponse("Missing 'summary' in review target", 400, "invalid_request");
  }
  const decision = await evaluateWithCouncil(body, {
    availableModels: state.config.models,
    providers: state.config.providers,
    providerRegistry: state.providerRegistry,
  });
  return jsonResponse({ decision });
}

function handleCouncilPolicies(): Response {
  return jsonResponse({
    levels: [
      { level: "R0", name: "Informational", review: "none", description: "Read-only queries, research, documentation" },
      { level: "R1", name: "Reversible Edit", review: "none", description: "Minor single-file edits, comments, typo fixes" },
      { level: "R2", name: "Multi-file Edit", review: "optional", description: "Multi-file feature development" },
      { level: "R3", name: "Dependency / Migration", review: "mandatory_single", description: "Dependencies, configs, migrations" },
      { level: "R4", name: "Privileged / Command", review: "full_council", description: "Privileged execution, tool calls" },
      { level: "R5", name: "Destructive / Production", review: "human_approval_required", description: "Destructive ops, production, credentials (fail-closed)" },
    ],
    roles: [
      "reviewer-security",
      "reviewer-architecture",
      "reviewer-correctness",
      "reviewer-regression",
      "reviewer-cost",
    ],
  });
}

// ---------------------------------------------------------------------------
// Admin API handlers — governance (Phase 20.51)
// ---------------------------------------------------------------------------

function handleAdminQuotas(state: GatewayState): Response {
  const runtime = state.governance;
  if (!runtime) return jsonResponse({ governance: false, routes: [], nineRouter: null });
  const policy = runtime.config.quota;
  const routes = runtime.quotaStore.keys().map(routeKey => {
    const windows = runtime.quotaStore.get(routeKey);
    const primary = runtime.quotaStore.primary(routeKey);
    return {
      routeKey,
      primary,
      freshness: classifyFreshness(primary?.observedAt, policy),
      windows,
    };
  });
  return jsonResponse({
    governance: true,
    nineRouter: runtime.nineRouter
      ? {
          providerId: runtime.nineRouter.providerId,
          version: runtime.nineRouter.telemetry?.version ?? null,
          observedAt: runtime.nineRouter.telemetry?.observedAt ?? null,
        }
      : null,
    routes,
  });
}

function handleAdminCircuits(state: GatewayState): Response {
  const runtime = state.governance;
  if (!runtime) return jsonResponse({ governance: false, connections: {}, circuits: {} });
  return jsonResponse({
    governance: true,
    connections: runtime.connections.snapshot(),
    circuits: runtime.breaker.snapshot(),
    leases: {
      active: runtime.leases.routeKeys().length,
      leasedRoutes: runtime.leases.routeKeys(),
    },
  });
}

function handleAdminDecisions(state: GatewayState, url: URL): Response {
  const date = url.searchParams.get("date") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 1000);
  const decisions = readDecisions(state.rootDir, date).slice(-limit);
  return jsonResponse({ decisions, count: decisions.length });
}

function handleAdminAttempts(state: GatewayState, url: URL): Response {
  const date = url.searchParams.get("date") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 2000);
  const attempts = readRouteAttempts(state.rootDir, date).slice(-limit);
  return jsonResponse({ attempts, count: attempts.length });
}

function handleAdminEvents(state: GatewayState, url: URL): Response {
  const date = url.searchParams.get("date") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 2000);
  const events = readGatewayEvents(state.rootDir, date).slice(-limit);
  return jsonResponse({ events, count: events.length });
}

async function handleSimulate(req: Request, state: GatewayState): Promise<Response> {
  const runtime = state.governance;
  if (!runtime) {
    return errorResponse("Routing governance is not enabled", 409, "governance_disabled");
  }
  let body: {
    alias?: string;
    requiredCapabilities?: Record<string, boolean>;
    contextTokens?: number;
    sessionId?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }
  const alias = body.alias ?? "";
  if (!alias) return errorResponse("Missing 'alias'", 400, "invalid_request");

  let candidates: GovernanceCandidate[];
  try {
    candidates = resolveGovernanceCandidates(state, alias);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Candidate resolution failed",
      404,
      "routing_error",
    );
  }

  // Simulation never executes inference and never mutates state: it shares
  // the plan path but reads (never writes) stores.
  const plan = planQuotaAwareRoute(
    {
      candidates,
      requiredCapabilities: body.requiredCapabilities,
      contextTokens: body.contextTokens,
      sessionId: body.sessionId,
    },
    {
      config: state.config,
      governance: runtime.config,
      providerRegistry: state.providerRegistry,
      quotaStore: runtime.quotaStore,
      connections: runtime.connections,
      breaker: runtime.breaker,
      leases: runtime.leases,
    },
  );
  return jsonResponse({
    weightProfile: plan.weightProfile,
    selected: plan.selected
      ? { routeKey: plan.selected.routeKey, score: plan.selected.score, reasons: plan.selected.reasons }
      : null,
    ordered: plan.ordered.map(c => ({ routeKey: c.routeKey, score: c.score, reasons: c.reasons })),
    rejected: plan.rejections,
  });
}

async function handleConnectionAction(req: Request, state: GatewayState): Promise<Response> {
  const runtime = state.governance;
  if (!runtime) {
    return errorResponse("Routing governance is not enabled", 409, "governance_disabled");
  }
  let body: { routeKey?: string; action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400, "invalid_request");
  }
  const routeKey = body.routeKey ?? "";
  const action = body.action ?? "";
  if (!routeKey || routeKey.split("/").length !== 2) {
    return errorResponse("Missing or malformed 'routeKey' (expected providerId/modelId)", 400, "invalid_request");
  }

  switch (action) {
    case "disable":
      runtime.connections.disable(routeKey);
      break;
    case "quarantine":
      runtime.connections.quarantine(routeKey, "operator_action", "CB_OPERATOR_ACTION");
      break;
    case "recover":
    case "enable":
      runtime.connections.beginRecovery(routeKey);
      break;
    default:
      return errorResponse("Unknown action; expected disable, quarantine, recover, or enable", 400, "invalid_request");
  }

  return jsonResponse({ routeKey, action, connection: runtime.connections.get(routeKey) });
}

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

export interface GatewayServerHandle {
  server: Server<unknown>;
  config: GatewayConfig;
  stop(): void;
}

/**
 * Start the Pao AI Gateway server.
 * Returns a handle to the running server.
 */
export async function startGatewayServer(rootDir: string): Promise<GatewayServerHandle> {
  const config = loadGatewayConfig(rootDir);

  if (!config.enabled) {
    throw new Error("Pao AI Gateway is not enabled. Set PAO_AI_GATEWAY_ENABLED=true to activate.");
  }

  const providerRegistry = new ProviderRegistry(config.providers);
  const startedAt = new Date().toISOString();

  const state: GatewayState = {
    config,
    providerRegistry,
    rootDir,
    startedAt,
    governance: null,
  };
  buildGovernanceRuntime(state);

  // Initial health check (non-blocking)
  providerRegistry.checkAllHealth().catch(() => {});

  const server = Bun.serve({
    port: config.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      try {
        // Health / Ready
        if (path === "/health" || path === "/healthz") return handleHealth(state);
        if (path === "/ready") return handleReady(state);

        // OpenAI-compatible endpoints
        if (path === "/v1/models" && method === "GET") return handleListModels(state);
        if (path === "/v1/chat/completions" && method === "POST") return await handleChatCompletions(req, state);

      // Admin API — requires admin authentication
      if (path.startsWith("/api/gateway/")) {
        const adminIdentity = authenticateAdminRequest(req.headers.get("Authorization"), state.config);
        if (!adminIdentity) {
          return errorResponse("Admin authorization required", 401, "admin_auth_failure");
        }
        if (path === "/api/gateway/providers" && method === "GET") return handleAdminProviders(state);
        if (path === "/api/gateway/models" && method === "GET") return handleAdminModels(state);
        if (path === "/api/gateway/aliases" && method === "GET") return handleAdminAliases(state);
        if (path === "/api/gateway/usage" && method === "GET") return handleAdminUsage(state);
        if (path === "/api/gateway/budgets" && method === "GET") return handleAdminBudgets(state);
        if (path === "/api/gateway/health" && method === "GET") return handleAdminHealth(state);
        if (path === "/api/gateway/traces" && method === "GET") return handleAdminTraces(state, url);
        if (path === "/api/gateway/test-route" && method === "POST") return handleTestRoute(req, state);
        if (path === "/api/gateway/test-provider" && method === "POST") return await handleTestProvider(req, state);
        if (path === "/api/gateway/council/classify" && method === "POST") return await handleCouncilClassify(req);
        if (path === "/api/gateway/council/evaluate" && method === "POST") return await handleCouncilEvaluate(req, state);
        if (path === "/api/gateway/council/policies" && method === "GET") return handleCouncilPolicies();
        if (path === "/api/gateway/quotas" && method === "GET") return handleAdminQuotas(state);
        if (path === "/api/gateway/circuits" && method === "GET") return handleAdminCircuits(state);
        if (path === "/api/gateway/decisions" && method === "GET") return handleAdminDecisions(state, url);
        if (path === "/api/gateway/attempts" && method === "GET") return handleAdminAttempts(state, url);
        if (path === "/api/gateway/events" && method === "GET") return handleAdminEvents(state, url);
        if (path === "/api/gateway/simulate" && method === "POST") return await handleSimulate(req, state);
        if (path === "/api/gateway/connections" && method === "POST") return await handleConnectionAction(req, state);
        return errorResponse("Not found", 404);
      }

        return errorResponse("Not found", 404);
      } catch (err) {
        // Never leak internal errors or secrets
        console.error(`[ai-gateway] Unhandled error: ${err instanceof Error ? err.message : "unknown"}`);
        return errorResponse("Internal gateway error", 500, "internal_error");
      }
    },
  });

  console.log(`[ai-gateway] Pao AI Gateway started on http://127.0.0.1:${config.port}`);
  console.log(`[ai-gateway] Router: ${config.routerVersion}`);
  console.log(`[ai-gateway] Providers: ${providerRegistry.listIds().join(", ") || "(none)"}`);
  console.log(`[ai-gateway] Aliases: ${config.aliases.map(a => a.id).join(", ") || "(none)"}`);
  if (state.governance) {
    console.log(
      `[ai-gateway] Governance: enabled (profile=${state.governance.config.weightProfile}, ` +
        `maxFallbackAttempts=${state.governance.config.fallback.maxRouteAttempts})`,
    );
  }
  if (state.governance?.nineRouter) {
    console.log(`[ai-gateway] 9Router telemetry: ${state.governance.nineRouter.providerId} @ ${state.config.nineRouter?.baseUrl}`);
  }

  return {
    server,
    config,
    stop() {
      for (const timer of state.governance?.timers ?? []) clearInterval(timer);
      state.governance?.recovery?.stop();
      server.stop(true);
      console.log("[ai-gateway] Gateway stopped.");
    },
  };
}
