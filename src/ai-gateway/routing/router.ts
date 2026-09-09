/**
 * Pao AI Gateway — Deterministic Rule-Based Router v1.
 *
 * Pipeline: policy filter → capability filter → privacy filter →
 * budget filter → health filter → deterministic scoring → selected route.
 *
 * Same inputs + same health state + same config = same route. Always.
 */

import type {
  GatewayConfig,
  GatewayModelConfig,
  RouteDecision,
  RoutingRequest,
  RiskLevel,
} from "../types";
import { resolveAlias, isPaoAlias } from "../aliases";
import type { ProviderRegistry } from "../providers/registry";

const ROUTER_VERSION = "router-v1-rule-based";

export interface RouterContext {
  readonly config: GatewayConfig;
  readonly providerRegistry: ProviderRegistry;
}

export interface RouteCandidate {
  readonly modelId: string;
  readonly providerId: string;
  readonly model: GatewayModelConfig;
  readonly score: number;
  readonly reasons: string[];
}

/**
 * Route a request to the best eligible model.
 * Returns a RouteDecision with full explainability.
 * Throws if no eligible candidate exists.
 */
export function routeRequest(
  request: RoutingRequest,
  ctx: RouterContext,
): RouteDecision {
  const { config, providerRegistry } = ctx;

  // Step 1: Resolve alias to candidate models
  let candidates: RouteCandidate[];

  if (isPaoAlias(request.alias)) {
    const resolutions = resolveAlias(request.alias, config.aliases, config.models);
    if (resolutions.length === 0) {
      throw new Error(`No routes configured for alias: ${request.alias}`);
    }
    candidates = resolutions.map(r => {
      const model = config.models.find(m => m.id === r.modelId)!;
      return {
        modelId: r.modelId,
        providerId: model.providerId,
        model,
        score: r.priority,
        reasons: [`alias route priority ${r.priority}`],
      };
    });
  } else {
    // Direct model reference
    const model = config.models.find(m => m.id === request.alias || m.model === request.alias);
    if (!model) throw new Error(`Model not found: ${request.alias}`);
    candidates = [{
      modelId: model.id,
      providerId: model.providerId,
      model,
      score: 100,
      reasons: ["direct model reference"],
    }];
  }

  // Step 2: Policy filter — check identity permissions
  const identity = config.identities.find(i => i.id === request.identityId);
  if (identity) {
    if (isPaoAlias(request.alias) && identity.allowedAliases.length > 0) {
      if (!identity.allowedAliases.includes(request.alias)) {
        throw Object.assign(
          new Error(`Identity ${request.identityId} not permitted to use alias ${request.alias}`),
          { code: "policy_denial" },
        );
      }
    }
    candidates = candidates.map(c => ({
      ...c,
      reasons: [...c.reasons, "identity permitted"],
    }));
  }

  // Step 3: Capability filter
  if (request.requiredCapabilities) {
    const rc = request.requiredCapabilities;
    candidates = candidates.filter(c => {
      const caps = c.model.capabilities;
      if (rc.tools && !caps.tools) return false;
      if (rc.vision && !caps.vision) return false;
      if (rc.structuredOutput && !caps.structuredOutput) return false;
      if (rc.reasoning && !caps.reasoning) return false;
      return true;
    });
    if (candidates.length > 0) {
      candidates = candidates.map(c => ({
        ...c,
        reasons: [...c.reasons, "capabilities matched"],
      }));
    }
  }

  // Step 4: Privacy filter — local-only constraint
  if (request.privacyClass === "local-only" || identity?.localOnly) {
    candidates = candidates.filter(c => {
      const provider = providerRegistry.get(c.providerId);
      if (!provider) return false;
      // Local-only: only allow local providers (baseUrl is localhost/127.0.0.1)
      const provConfig = config.providers.find(p => p.id === c.providerId);
      if (!provConfig?.baseUrl) return false;
      const isLocal = provConfig.baseUrl.includes("127.0.0.1") || provConfig.baseUrl.includes("localhost");
      return isLocal;
    });
    if (candidates.length === 0) {
      throw Object.assign(
        new Error("No local providers available for local-only request"),
        { code: "local_only_violation" },
      );
    }
    candidates = candidates.map(c => ({
      ...c,
      reasons: [...c.reasons, "local-only constraint satisfied"],
    }));
  }

  // Step 5: Health filter — prefer healthy providers
  const healthyCandidate = candidates.filter(c => providerRegistry.isHealthy(c.providerId));
  if (healthyCandidate.length > 0) {
    candidates = healthyCandidate.map(c => ({
      ...c,
      score: c.score + 10,
      reasons: [...c.reasons, "provider healthy"],
    }));
  }
  // If no healthy candidates, keep all (fallback will handle retries)

  // Step 6: Deterministic scoring
  // Already sorted by priority from alias resolution, health gives +10 bonus
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new Error(`No eligible candidates for request: alias=${request.alias}, identity=${request.identityId}`);
  }

  const selected = candidates[0]!;

  return {
    alias: request.alias,
    selectedModelId: selected.modelId,
    selectedProviderId: selected.providerId,
    routerVersion: ROUTER_VERSION,
    reason: selected.reasons,
    fallbackAttempt: 0,
    riskLevel: request.riskLevel ?? "R0",
  };
}

/**
 * Get fallback candidates for a failed request.
 * Returns remaining candidates after excluding the failed model.
 * Returns empty array if the failure type is not fallback-eligible.
 */
export function getFallbackCandidates(
  request: RoutingRequest,
  failedModelId: string,
  failureCode: string,
  ctx: RouterContext,
): RouteDecision[] {
  // Non-fallback-eligible failures
  const nonEligible = new Set([
    "auth_failure",
    "policy_denial",
    "budget_denial",
    "secret_leakage_block",
    "prompt_injection_block",
    "local_only_violation",
    "guardrail_failure",
  ]);

  if (nonEligible.has(failureCode)) return [];

  const { config } = ctx;
  const aliasConfig = config.aliases.find(a => a.id === request.alias);
  if (!aliasConfig) return [];

  // Get configured max attempts (default 2)
  const maxAttempts = 2;

  return resolveAlias(request.alias, config.aliases, config.models)
    .filter(r => r.modelId !== failedModelId)
    .slice(0, maxAttempts)
    .map((r, i) => {
      const model = config.models.find(m => m.id === r.modelId)!;
      return {
        alias: request.alias,
        selectedModelId: r.modelId,
        selectedProviderId: model.providerId,
        routerVersion: ROUTER_VERSION,
        reason: [`fallback after ${failureCode}`, `candidate ${i + 1}`],
        fallbackAttempt: i + 1,
        riskLevel: request.riskLevel ?? "R0",
      };
    });
}
