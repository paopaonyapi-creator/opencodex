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
} from "./types";
import { loadGatewayConfig } from "./config";
import { ProviderRegistry } from "./providers/registry";
import { authenticateRequest, isAliasPermitted } from "./auth/identity";
import { checkBudget, recordSpend, getGlobalSpendSummary } from "./auth/budget";
import { routeRequest, type RouterContext } from "./routing/router";
import { runInputGuardrails, runOutputGuardrails } from "./guardrails/engine";
import { isPaoAlias } from "./aliases";
import { recordTrace, readTodayTraces, aggregateUsage } from "./traces/ledger";
import { getFallbackCandidates } from "./routing/router";
import { authenticateAdminRequest } from "./auth/identity";
import { classifyRisk, evaluateWithCouncil, type CouncilReviewTarget } from "./council";
import type { Server } from "bun";

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
// Gateway state
// ---------------------------------------------------------------------------

interface GatewayState {
  config: GatewayConfig;
  providerRegistry: ProviderRegistry;
  rootDir: string;
  startedAt: string;
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
  };

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

  return {
    server,
    config,
    stop() {
      server.stop(true);
      console.log("[ai-gateway] Gateway stopped.");
    },
  };
}
