/**
 * Pao AI Gateway — Quota-aware routing engine (Phase 20.51).
 *
 * Orders alias candidates under the governance policy: hard filters run
 * BEFORE scoring (disabled, policy, capability, quarantine, open circuit,
 * exhausted quota, budget), then candidates are scored on
 * quality/quota/health/latency/cost/affinity/freshness with explicit
 * uncertainty and switching penalties.
 *
 * Same inputs + same telemetry state + same config = same order. Ties break
 * deterministically on alias priority, then model id.
 *
 * This EXTENDS routing/router.ts v1 rather than replacing it: v1 stays the
 * ungoverned path; this engine runs when routing governance is enabled.
 */

import type {
  CandidateOutcome,
  GatewayConfig,
  GatewayModelConfig,
  GovernanceWeights,
  ProviderHealth,
  QuotaPolicy,
  RoutingGovernanceConfig,
} from "../types";
import type { ProviderRegistry } from "../providers/registry";
import type { QuotaStore } from "../quota/store";
import type { ConnectionStore } from "../resilience/connection-state";
import type { LeaseStore } from "./leases";
import { routeLevelRank, type RouteLevel } from "./adaptive";
import type { CircuitBreaker } from "./adaptive";
import { quotaHeadroomScore, quotaUncertaintyPenalty } from "../quota/model";
import { deriveRouteLevel } from "./candidates";

export function routeKeyOf(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export interface GovernanceCandidate {
  readonly modelId: string;
  readonly providerId: string;
  readonly model: GatewayModelConfig;
  readonly aliasPriority: number;
}

export interface ScoredRouteCandidate extends GovernanceCandidate {
  readonly routeKey: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface QuotaRoutingInput {
  readonly candidates: readonly GovernanceCandidate[];
  readonly requiredCapabilities?: Partial<GatewayModelConfig["capabilities"]>;
  readonly contextTokens?: number;
  readonly maxCostUsd?: number;
  readonly localOnly?: boolean;
  readonly sessionId?: string;
}

export interface QuotaRoutingResult {
  readonly ordered: readonly ScoredRouteCandidate[];
  readonly rejections: readonly CandidateOutcome[];
  readonly selected?: ScoredRouteCandidate;
  readonly weightProfile: string;
}

export interface QuotaRoutingContext {
  readonly config: GatewayConfig;
  readonly governance: RoutingGovernanceConfig;
  readonly providerRegistry: ProviderRegistry;
  readonly quotaStore: QuotaStore;
  readonly connections: ConnectionStore;
  readonly breaker: CircuitBreaker;
  readonly leases: LeaseStore;
}

// ---------------------------------------------------------------------------
// Weight profiles
// ---------------------------------------------------------------------------

export const WEIGHT_PROFILES: Readonly<Record<string, GovernanceWeights>> = {
  "coding-premium": {
    quality: 0.3,
    quota: 0.2,
    health: 0.2,
    latency: 0.08,
    cost: 0.08,
    affinity: 0.09,
    freshness: 0.05,
  },
  "background-cheap": {
    quality: 0.12,
    quota: 0.15,
    health: 0.18,
    latency: 0.1,
    cost: 0.35,
    affinity: 0.05,
    freshness: 0.05,
  },
  balanced: {
    quality: 0.2,
    quota: 0.18,
    health: 0.18,
    latency: 0.1,
    cost: 0.14,
    affinity: 0.12,
    freshness: 0.08,
  },
};

export function resolveWeights(profileName: string, configured: GovernanceWeights): GovernanceWeights {
  // A configured weight block always wins; the profile name only selects a
  // preset when no explicit weights were provided (all zeros).
  const sum = Object.values(configured).reduce((a, b) => a + b, 0);
  if (sum > 0) return configured;
  return WEIGHT_PROFILES[profileName] ?? WEIGHT_PROFILES.balanced!;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function qualityScore(model: GatewayModelConfig): number {
  const level: RouteLevel = deriveRouteLevel(model);
  return routeLevelRank(level) / (ROUTE_LEVEL_COUNT - 1);
}

const ROUTE_LEVEL_COUNT = 5;

function latencyScore(health: ProviderHealth | undefined): number {
  if (!health || health.latencyMs === undefined) return 0.5;
  const { latencyMs } = health;
  if (latencyMs <= 500) return 1;
  if (latencyMs >= 3000) return 0;
  return 1 - (latencyMs - 500) / 2500;
}

/** Blended-cost score in [0,1]; 1 = free, 0 = ≥ $20/1M blended. */
export function costScore(model: GatewayModelConfig): number {
  const { inputPerMillionUsd, outputPerMillionUsd } = model.pricing;
  if (inputPerMillionUsd === null || outputPerMillionUsd === null) return 0.5;
  const blended = (inputPerMillionUsd + outputPerMillionUsd) / 2;
  if (blended <= 0) return 1;
  if (blended >= 20) return 0;
  return 1 - blended / 20;
}

function healthScoreFromState(state: string): number {
  switch (state) {
    case "healthy":
      return 1;
    case "recovering":
      return 0.6;
    case "unknown":
      return 0.5;
    case "degraded":
      return 0.4;
    default:
      return 0;
  }
}

function freshnessScoreOf(observedAt: string | undefined, policy: QuotaPolicy, now: number): number {
  if (!observedAt) return 0;
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return 0;
  const ageSec = (now - observed) / 1000;
  if (ageSec < policy.agingAfterSec) return 1;
  if (ageSec < policy.staleAfterSec) return 0.6;
  return 0.2;
}

function estimatedCostUsd(model: GatewayModelConfig, contextTokens: number): number | null {
  const { inputPerMillionUsd, outputPerMillionUsd } = model.pricing;
  if (inputPerMillionUsd === null || outputPerMillionUsd === null) return null;
  // Estimate output as a quarter of the input size; good enough for a
  // routing-tier guard (admission re-checks against the real budget).
  const outputTokens = Math.ceil(contextTokens / 4);
  return (contextTokens / 1_000_000) * inputPerMillionUsd + (outputTokens / 1_000_000) * outputPerMillionUsd;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export function planQuotaAwareRoute(
  input: QuotaRoutingInput,
  ctx: QuotaRoutingContext,
): QuotaRoutingResult {
  const now = Date.now();
  const { governance } = ctx;
  const policy: QuotaPolicy = governance.quota;
  const weights = resolveWeights(governance.weightProfile, governance.weights);

  const rejections: CandidateOutcome[] = [];
  const scored: ScoredRouteCandidate[] = [];
  const lease = input.sessionId ? ctx.leases.get(input.sessionId) : undefined;

  for (const candidate of input.candidates) {
    const routeKey = routeKeyOf(candidate.providerId, candidate.modelId);
    const reject = (reasonCode: string): void => {
      rejections.push({
        routeKey,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        status: "rejected",
        reasonCodes: [reasonCode],
      });
    };

    // 1. Enabled + registered.
    if (candidate.model.enabled === false) {
      reject("ROUTE_REJECTED_DISABLED");
      continue;
    }
    const providerConfig = ctx.config.providers.find(p => p.id === candidate.providerId);
    if (!providerConfig || providerConfig.enabled === false || !ctx.providerRegistry.get(candidate.providerId)) {
      reject("ROUTE_REJECTED_DISABLED");
      continue;
    }

    // 2. Local-only policy.
    if (input.localOnly) {
      const base = providerConfig.baseUrl ?? "";
      const isLocal = base.includes("127.0.0.1") || base.includes("localhost");
      if (!isLocal) {
        reject("ROUTE_REJECTED_POLICY");
        continue;
      }
    }

    // 3. Capabilities and context size.
    const caps = candidate.model.capabilities;
    const rc = input.requiredCapabilities;
    let capabilityOk = true;
    if (rc) {
      if (rc.tools && !caps.tools) capabilityOk = false;
      if (rc.vision && !caps.vision) capabilityOk = false;
      if (rc.structuredOutput && !caps.structuredOutput) capabilityOk = false;
      if (rc.reasoning && !caps.reasoning) capabilityOk = false;
    }
    if (capabilityOk && input.contextTokens && candidate.model.limits.contextWindow !== null) {
      if (input.contextTokens > candidate.model.limits.contextWindow) capabilityOk = false;
    }
    if (!capabilityOk) {
      reject("ROUTE_REJECTED_CAPABILITY");
      continue;
    }

    // 4. Connection state: disabled/quarantined routes never receive traffic.
    const connection = ctx.connections.get(routeKey);
    if (connection.state === "disabled") {
      reject("ROUTE_REJECTED_DISABLED");
      continue;
    }
    if (connection.state === "quarantined") {
      reject("ROUTE_REJECTED_QUARANTINED");
      continue;
    }
    if (connection.state === "cooldown") {
      reject("ROUTE_REJECTED_COOLDOWN");
      continue;
    }

    // 5. Open circuit. canAttempt performs the OPEN -> HALF_OPEN promotion.
    if (!ctx.breaker.canAttempt(candidate.providerId)) {
      reject("ROUTE_REJECTED_CIRCUIT_OPEN");
      continue;
    }

    // 6. Evidence-based quota exhaustion with a known future reset.
    const window = ctx.quotaStore.primary(routeKey);
    if (window && window.remainingRatio !== undefined && window.remainingRatio <= 0) {
      const reset = window.resetAt ? Date.parse(window.resetAt) : NaN;
      if (!Number.isFinite(reset) || reset > now) {
        reject("ROUTE_REJECTED_QUOTA_EXHAUSTED");
        continue;
      }
    }

    // 7. Routing-tier budget guard (admission re-checks precisely).
    if (input.maxCostUsd !== undefined) {
      const cost = estimatedCostUsd(candidate.model, input.contextTokens ?? 8000);
      if (cost !== null && cost > input.maxCostUsd) {
        reject("ROUTE_REJECTED_BUDGET");
        continue;
      }
    }

    // Hard filters passed — score the candidate.
    const reasons: string[] = [];
    const quality = qualityScore(candidate.model);
    const quota = quotaHeadroomScore(window);
    const health = healthScoreFromState(connection.state);
    const providerHealth = ctx.providerRegistry.getCachedHealth(candidate.providerId);
    const latency = latencyScore(providerHealth);
    const cost = costScore(candidate.model);
    const affinity = lease?.routeKey === routeKey ? 1 : 0;
    const freshness = freshnessScoreOf(window?.observedAt, policy, now);

    let score =
      weights.quality * quality +
      weights.quota * quota +
      weights.health * health +
      weights.latency * latency +
      weights.cost * cost +
      weights.affinity * affinity +
      weights.freshness * freshness;

    const uncertainty = quotaUncertaintyPenalty(window, policy);
    if (uncertainty > 0) {
      score -= uncertainty;
      reasons.push(`quota telemetry ${window ? "stale" : "absent"}; penalty applied`);
    }
    const recentFailures = Math.min(connection.consecutiveSoftFailures * 0.05, 0.2);
    if (recentFailures > 0) {
      score -= recentFailures;
      reasons.push("recent failures on route");
    }
    if (lease && affinity === 0 && lease.sticky) {
      score -= 0.05;
      reasons.push("differs from session's leased route");
    }

    if (quota >= 0.8) reasons.push("ROUTE_SELECTED_QUOTA_HEADROOM");
    if (cost >= 0.95) reasons.push("ROUTE_SELECTED_LOW_COST");
    if (affinity === 1) reasons.push("ROUTE_SELECTED_SESSION_AFFINITY");

    scored.push({ ...candidate, routeKey, score, reasons });
  }

  // Deterministic order: score desc, then alias priority desc, then model id asc.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.aliasPriority !== a.aliasPriority) return b.aliasPriority - a.aliasPriority;
    return a.modelId.localeCompare(b.modelId);
  });

  const ordered = scored[0]
    ? [{ ...scored[0], reasons: ["ROUTE_SELECTED_BEST_SCORE", ...scored[0].reasons] }, ...scored.slice(1)]
    : scored;

  return {
    ordered,
    rejections,
    selected: ordered[0],
    weightProfile: governance.weightProfile,
  };
}
