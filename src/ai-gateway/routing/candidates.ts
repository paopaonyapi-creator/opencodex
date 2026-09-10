/**
 * Pao AI Gateway — free-first candidate selection.
 *
 * The rule the phase asks for is "easy work must not burn premium spend". The rule
 * that keeps it SAFE is the second half of the same sentence: never choose a route
 * only because it is free.
 *
 * So this module does not pick a model. It REORDERS eligible candidates by
 * preference, after the capability, privacy, budget, and health filters have already
 * run. A candidate that cannot do the job is not in the list it is given, which is
 * what makes ranking by price safe: the cheap option is only ever considered among
 * options that are otherwise acceptable.
 *
 * Pricing is configuration. Nothing here asserts that any third-party model is or
 * will remain free — a model priced at 0 in the catalog is treated as free because
 * the CATALOG says so, and when the catalog changes the behaviour changes with it.
 */

import type { GatewayModelConfig, GatewayConfig } from "../types";
import type { RouteLevel } from "./adaptive";
import { routeLevelRank } from "./adaptive";

export interface ScoredCandidate {
  readonly model: GatewayModelConfig;
  readonly level: RouteLevel;
  /** Higher score wins. */
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface RankingPreferences {
  /** Prefer the cheapest eligible candidate. */
  readonly freeFirst: boolean;
  readonly costPreference?: "minimize" | "balance" | "quality";
  readonly latencyPreference?: "minimize" | "balance" | "quality";
  /** Minimum context window the request needs, when known. */
  readonly requiredContextTokens?: number;
}

/**
 * Derive a candidate's route level from its OWN declared properties.
 *
 * Level is computed rather than configured because a configured level drifts from
 * the pricing it is supposed to describe, and a stale level is how a premium model
 * ends up on the cheap rung.
 */
export function deriveRouteLevel(model: GatewayModelConfig): RouteLevel {
  const input = model.pricing.inputPerMillionUsd;
  const output = model.pricing.outputPerMillionUsd;
  // Unknown pricing is not cheap. It is unpriceable, and the budget layer fails
  // closed on it; ranking it as free would defeat that.
  if (input === null || output === null) return "L3";
  if (input === 0 && output === 0) return "L0";
  const blended = input + output;
  if (blended <= 1) return "L1";
  if (blended <= 12) return "L2";
  return "L3";
}

/**
 * Score an eligible candidate. Only candidates that already passed every filter
 * reach this function, so scoring never has to ask whether a model is usable.
 */
export function scoreCandidate(
  model: GatewayModelConfig,
  prefs: RankingPreferences,
): ScoredCandidate {
  const reasons: string[] = [];
  const level = deriveRouteLevel(model);
  let score = 0;

  // Level is the primary axis: cheaper wins when nothing else distinguishes them.
  // Inverting the rank means L0 scores highest.
  score += (4 - routeLevelRank(level)) * 40;
  reasons.push(`level ${level}`);

  if (level === "L0") {
    reasons.push("zero marginal cost");
  }

  if (prefs.freeFirst && (level === "L0" || level === "L1")) {
    score += 25;
    reasons.push("free-first preference");
  }

  if (prefs.costPreference === "minimize" && (level === "L0" || level === "L1")) {
    score += 15;
    reasons.push("cost preference: minimize");
  }
  if (prefs.costPreference === "quality" && (level === "L3" || level === "L4")) {
    score += 15;
    reasons.push("cost preference: quality");
  }

  // Capability breadth is a tiebreaker, not a goal: more capable is only better
  // when the other axes are equal, which is what a small weight expresses.
  const caps = model.capabilities;
  let capabilityPoints = 0;
  if (caps.tools) capabilityPoints += 1;
  if (caps.vision) capabilityPoints += 1;
  if (caps.reasoning) capabilityPoints += 1;
  if (caps.structuredOutput) capabilityPoints += 1;
  score += capabilityPoints * 3;
  if (capabilityPoints > 0) reasons.push(`${capabilityPoints} capability point(s)`);

  // A context shortfall is disqualifying, and it is checked here as well as in the
  // caller's filter so a candidate added later cannot silently bypass it.
  if (prefs.requiredContextTokens !== undefined) {
    const window = model.limits.contextWindow ?? 0;
    if (window > 0 && window < prefs.requiredContextTokens) {
      score -= 1000;
      reasons.push(`context window ${window} below required ${prefs.requiredContextTokens}`);
    }
  }

  return { model, level, score, reasons };
}

/**
 * Rank eligible candidates best-first.
 *
 * Ties break on model id so the ordering is stable across runs. A ranking that can
 * reorder equal candidates non-deterministically makes routing unreproducible, and
 * an unreproducible route is very hard to debug from a trace.
 */
export function rankCandidates(
  models: readonly GatewayModelConfig[],
  prefs: RankingPreferences,
): ScoredCandidate[] {
  return models
    .map((model) => scoreCandidate(model, prefs))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.model.id.localeCompare(b.model.id);
    });
}

/**
 * Whether a candidate satisfies the request's declared capabilities.
 *
 * An unmet requirement is never "close enough": a model without tool calling
 * cannot be nudged into tool calling, and selecting it produces a failure the
 * router would then escalate.
 */
export function satisfiesCapabilities(
  model: GatewayModelConfig,
  required: { tools?: boolean; vision?: boolean; structuredOutput?: boolean; reasoning?: boolean } | undefined,
): boolean {
  if (!required) return true;
  const caps = model.capabilities;
  if (required.tools && !caps.tools) return false;
  if (required.vision && !caps.vision) return false;
  if (required.structuredOutput && !caps.structuredOutput) return false;
  if (required.reasoning && !caps.reasoning) return false;
  return true;
}

/**
 * Whether a model is on a public route, for the privacy floor.
 *
 * Local means the endpoint is loopback or a private-range address. This is a
 * hostname check rather than a trust label because a label can be wrong and an
 * address cannot: traffic to 127.0.0.1 does not leave the machine whatever the
 * configuration claims.
 */
export function isLocalModel(model: GatewayModelConfig, config: GatewayConfig): boolean {
  const provider = config.providers.find((entry) => entry.id === model.providerId);
  if (!provider) return false;
  const url = provider.baseUrl ?? "";
  return (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("[::1]") ||
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(url) ||
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/.test(url)
  );
}
