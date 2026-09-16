// Phase 20.25 — Ranking engine and preference profiles (doc §15, §16).
//
// Profiles adjust RANKING WEIGHTS only. They can never bypass security policy:
// approval requirements and deny rules are evaluated in risk.ts, downstream of
// any ordering this module produces.

import type { RankingProfile, RankingWeights, RankedTool, ToolRecord } from "./types";
import { clamp01 } from "./util";

export const BASE_WEIGHTS: RankingWeights = {
  capabilityMatch: 0.3,
  reliability: 0.2,
  cost: 0.15,
  latency: 0.1,
  security: 0.15,
  preference: 0.1,
};

export const PROFILE_WEIGHTS: Record<RankingProfile, Partial<RankingWeights>> = {
  balanced: {},
  cheap: { cost: 0.4, reliability: 0.15, latency: 0.05 },
  quality: { reliability: 0.4, cost: 0.05 },
  local_first: { reliability: 0.2, cost: 0.1, latency: 0.15 },
  privacy_first: { security: 0.35, reliability: 0.2, cost: 0.05 },
  adobe_stock_production: { reliability: 0.3, security: 0.2, cost: 0.05 },
};

export function weightsForProfile(profile: RankingProfile, preferenceBoost?: Partial<RankingWeights>): RankingWeights {
  const merged: RankingWeights = { ...BASE_WEIGHTS, ...PROFILE_WEIGHTS[profile], ...preferenceBoost };
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total <= 0) return { ...BASE_WEIGHTS };
  return Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [k, v / total]),
  ) as unknown as RankingWeights;
}

const COST_SCORE: Record<ToolRecord["cost"]["model"], number> = {
  free: 1,
  unknown: 0.5,
  fixed: 0.5,
  usage_based: 0.3,
};

function securityScore(tool: ToolRecord): number {
  // Lower risk ranks higher; approval requirements dampen the score slightly.
  const base = 1 - tool.risk.level / 4;
  return clamp01(base * (tool.risk.requiresApproval ? 0.9 : 1));
}

function reliabilityScore(tool: ToolRecord): number {
  if (tool.quality.reliabilityScore !== undefined) return clamp01(tool.quality.reliabilityScore);
  const { runs, successes } = tool.metrics;
  if (runs < 3) return 0.5;
  return clamp01(successes / runs);
}

function latencyScore(tool: ToolRecord): number {
  if (tool.quality.latencyScore !== undefined) return clamp01(tool.quality.latencyScore);
  const { avgLatencyMs } = tool.metrics;
  if (!avgLatencyMs) return 0.5;
  if (avgLatencyMs <= 250) return 1;
  if (avgLatencyMs >= 5000) return 0.1;
  return clamp01(1 - Math.log10(avgLatencyMs / 250) / Math.log10(20));
}

function healthMultiplier(tool: ToolRecord): number {
  switch (tool.health) {
    case "healthy": return 1;
    case "degraded": return 0.6;
    case "offline": return 0;
    case "disabled": return 0;
    default: return 0.8;
  }
}

export interface RankContext {
  profile: RankingProfile;
  preferenceWeights?: Partial<RankingWeights>;
  /** toolId → preference weight from registry_preferences. */
  preferences?: Map<string, number>;
}

/**
 * Rank a candidate list for one capability. Score components are normalized to
 * [0,1], combined with profile weights, multiplied by health, and every result
 * carries machine-readable reasons (doc §34 explainability).
 */
export function rankTools(
  candidates: ToolRecord[],
  capability: string,
  ctx: RankContext,
): RankedTool[] {
  const weights = weightsForProfile(ctx.profile, ctx.preferenceWeights);
  const preferences = ctx.preferences ?? new Map<string, number>();
  const ranked: RankedTool[] = [];

  for (const tool of candidates) {
    const reasons: string[] = [];

    const exact = tool.capabilities.includes(capability);
    const capabilityMatch = exact ? 1 : clamp01(0.6 * (tool.capabilities.length > 0 ? 1 : 0));
    if (exact) reasons.push(`exact capability match: ${capability}`);
    else if (capabilityMatch > 0) reasons.push(`related capabilities: ${tool.capabilities.slice(0, 3).join(", ")}`);

    const reliability = reliabilityScore(tool);
    const cost = COST_SCORE[tool.cost.model] ?? 0.5;
    const latency = latencyScore(tool);
    const security = securityScore(tool);
    const preference = clamp01((preferences.get(tool.id) ?? 0) / 2 + 0.5);
    const prefWeight = preferences.get(tool.id) ?? 0;
    if (prefWeight !== 0) reasons.push(`user preference weight ${prefWeight > 0 ? "+" : ""}${prefWeight}`);

    if (tool.health === "healthy") reasons.push("health: healthy");
    if (tool.health === "degraded") reasons.push("health: degraded");
    if (tool.health === "offline") reasons.push("health: offline (score zeroed)");
    if (tool.cost.model === "free") reasons.push("cost: free");
    if (tool.cost.model === "usage_based") reasons.push("cost: usage-based");
    if (tool.risk.requiresApproval) reasons.push(`approval required (risk ${tool.risk.level})`);

    const weighted =
      capabilityMatch * weights.capabilityMatch +
      reliability * weights.reliability +
      cost * weights.cost +
      latency * weights.latency +
      security * weights.security +
      preference * weights.preference;

    const score = weighted * healthMultiplier(tool);
    ranked.push({ tool, score, match: capabilityMatch, reasons });
  }

  ranked.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return ranked;
}

/**
 * Candidate ranking for a capability across the whole registry. Catalog
 * metadata-only entries participate in discovery but are only selectable when
 * nothing executable exists (the planner falls back with a note otherwise).
 */
export function rankForCapability(
  store: { listTools(filter?: { status?: string }): ToolRecord[] },
  capability: string,
  ctx: RankContext,
): RankedTool[] {
  const all = store.listTools();
  const candidates = all.filter(
    (tool) => tool.status !== "disabled" && (tool.capabilities.includes(capability) || capabilityMatchLoose(tool, capability)),
  );
  return rankTools(candidates, capability, ctx);
}

function capabilityMatchLoose(tool: ToolRecord, capability: string): boolean {
  const family = capability.split(".")[0];
  return tool.capabilities.some((c) => c.startsWith(`${family}.`) && c !== capability);
}
