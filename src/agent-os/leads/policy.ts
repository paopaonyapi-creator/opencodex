// Phase 20.34 — cost-aware routing (§14), budget engine (§15), scoring (§20-21)
// and suppression matching (§22). Pure logic; persistence lives in store.ts.

import type { CostEstimate, LeadBudget, ProviderDefinition, ProviderHealth, RoutingStrategyName, ScoringProfile, CanonicalLead } from "./types";

export const DEFAULT_WEIGHTS = { quality: 0.35, reliability: 0.25, cost: 0.2, latency: 0.1, freshness: 0.1 };

export interface RouteCandidate {
  definition: ProviderDefinition;
  health: ProviderHealth;
  estimate: CostEstimate;
  score: number;
  reasons: string[];
}

export function routeScore(
  definition: ProviderDefinition,
  health: ProviderHealth,
  estimate: CostEstimate,
  budget: LeadBudget | null,
  weights: Partial<typeof DEFAULT_WEIGHTS> = {},
): { score: number; reasons: string[] } {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const quality = clamp01(definition.qualityScore);
  const reliability = clamp01(health.status === "healthy" ? definition.reliabilityScore : health.status === "degraded" ? definition.reliabilityScore * 0.6 : 0);
  // Cost score: 0 cost → 1; scaled against the per-lead budget cap so the
  // metric is currency-consistent (cost_per_1000 → per unit).
  const perUnit = definition.estimatedCostPer1000 / 1000;
  const cap = budget?.maxCostPerLead && budget.maxCostPerLead > 0 ? budget.maxCostPerLead : Math.max(perUnit, 0.01);
  const costScore = clamp01(1 - perUnit / (cap * 2));
  const latencyScore = clamp01(1 - Math.min((health.latencyMs ?? definition.timeoutMs / 4) / definition.timeoutMs, 1));
  const freshness = 1; // registry-managed providers are assumed current; observed metrics refine this later
  const reasons: string[] = [];
  if (health.status !== "healthy") reasons.push(`health=${health.status}`);
  if (perUnit > 0) reasons.push(`cost_per_unit=${perUnit.toFixed(4)}`);
  return {
    score: Number((quality * w.quality + reliability * w.reliability + costScore * w.cost + latencyScore * w.latency + freshness * w.freshness).toFixed(4)),
    reasons,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export interface RoutingConstraints {
  capability: string;
  strategy: RoutingStrategyName;
  budget: LeadBudget;
  remainingBudget: number;
}

/** Filters + ranks providers; returns them in execution (waterfall) order. */
export function selectProviders(
  candidates: Array<{ definition: ProviderDefinition; health: ProviderHealth; estimate: CostEstimate }>,
  constraints: RoutingConstraints,
): { ordered: RouteCandidate[]; rejected: Array<{ id: string; reason: string }> } {
  const rejected: Array<{ id: string; reason: string }> = [];
  const eligible: RouteCandidate[] = [];
  for (const candidate of candidates) {
    const { definition, health, estimate } = candidate;
    if (!definition.enabled) { rejected.push({ id: definition.id, reason: "disabled" }); continue; }
    if (!definition.capabilities.includes(constraints.capability as ProviderDefinition["capabilities"][number])) {
      rejected.push({ id: definition.id, reason: `missing capability ${constraints.capability}` });
      continue;
    }
    if (health.status === "down" || health.status === "disabled") { rejected.push({ id: definition.id, reason: `health=${health.status}` }); continue; }
    if (estimate.estimatedCost > constraints.remainingBudget) {
      rejected.push({ id: definition.id, reason: "exceeds remaining job budget" });
      continue;
    }
    const { score, reasons } = routeScore(definition, health, estimate, constraints.budget);
    eligible.push({ definition, health, estimate, score, reasons });
  }
  const ordered = [...eligible].sort((a, b) => {
    switch (constraints.strategy) {
      case "CHEAPEST": return a.estimate.estimatedCost - b.estimate.estimatedCost;
      case "BEST_QUALITY": return b.definition.qualityScore - a.definition.qualityScore;
      case "FASTEST": return (a.health.latencyMs ?? a.definition.timeoutMs) - (b.health.latencyMs ?? b.definition.timeoutMs);
      case "MANUAL": return 0; // caller-supplied order is preserved
      default: return b.score - a.score;
    }
  });
  return { ordered, rejected };
}

/** Hard budget gate (§15): paid providers never start past the cap. */
export function checkBudget(budget: LeadBudget, estimatedCost: number, units: number): { allowed: boolean; reasonCode?: "BUDGET_EXCEEDED" | "APPROVAL_REQUIRED"; message?: string } {
  const overrunLimit = budget.maxJobCost * (1 + budget.allowOverrunPercent / 100);
  if (estimatedCost > overrunLimit) {
    return { allowed: false, reasonCode: "BUDGET_EXCEEDED", message: `estimated ${estimatedCost.toFixed(4)} ${budget.currency} exceeds the job cap ${overrunLimit.toFixed(4)}` };
  }
  if (units > 0 && budget.maxCostPerLead > 0 && estimatedCost / units > budget.maxCostPerLead * (1 + budget.allowOverrunPercent / 100)) {
    return { allowed: false, reasonCode: "BUDGET_EXCEEDED", message: `estimated per-lead cost exceeds the cap` };
  }
  if (estimatedCost > budget.requireApprovalAbove) {
    return { allowed: true, reasonCode: "APPROVAL_REQUIRED", message: `estimated ${estimatedCost.toFixed(4)} exceeds the approval threshold ${budget.requireApprovalAbove.toFixed(2)}` };
  }
  return { allowed: true };
}

// --- Deterministic scoring (§20 layer A; versioned profiles §21) ------------------

export const SCORING_PROFILES: ScoringProfile[] = [
  {
    id: "local-business-basic",
    name: "Local Business Basic",
    version: 1,
    weights: {
      has_website: 20,
      has_verified_email: 20,
      industry_match: 15,
      location_match: 15,
      has_phone: 10,
      multi_source: 10,
      social_presence: 10,
    },
  },
  {
    id: "b2b-decision-maker",
    name: "B2B Decision Maker",
    version: 1,
    weights: {
      decision_maker_role: 25,
      has_verified_email: 20,
      has_company_domain: 20,
      industry_match: 15,
      location_match: 10,
      has_phone: 10,
    },
  },
];

const DECISION_ROLES = /\b(ceo|cto|cio|cfo|founder|co-?founder|owner|director|managing director|president|partner|head of)\b/i;

export function scoreLead(
  lead: CanonicalLead,
  profile: ScoringProfile,
  context: { industryKeywords?: string[]; region?: string } = {},
): { total: number; grade: "A" | "B" | "C" | "D"; reasons: string[]; confidence: number } {
  const reasons: string[] = [];
  let total = 0;
  const add = (points: number, reason: string): void => {
    total += points;
    reasons.push(reason);
  };
  const email = lead.contactPoints.find((point) => point.type === "email");
  const verifiedEmail = email && (email.verificationStatus === "valid" || email.verificationStatus === "catch_all");
  const company = lead.company;
  const person = lead.person;

  if (profile.id === "b2b-decision-maker") {
    if (person?.jobTitle && DECISION_ROLES.test(person.jobTitle)) add(profile.weights.decision_maker_role, "decision-maker role");
    if (verifiedEmail) add(profile.weights.has_verified_email, "verified business email");
    if (person?.companyDomain || company?.domain) add(profile.weights.has_company_domain, "company domain present");
  } else {
    if (company?.websiteUrl || company?.domain) add(profile.weights.has_website, "official website present");
    if (verifiedEmail) add(profile.weights.has_verified_email, "verified business email");
    if (lead.contactPoints.some((point) => point.type === "phone")) add(profile.weights.has_phone, "phone present");
    if (lead.socialProfiles.length > 0) add(profile.weights.social_presence, "social presence");
  }
  const haystack = JSON.stringify({ company, person }).toLowerCase();
  if ((context.industryKeywords ?? []).some((keyword) => keyword && haystack.includes(keyword.toLowerCase()))) {
    add(profile.weights.industry_match, "industry match");
  }
  if (context.region && haystack.includes(context.region.toLowerCase())) {
    add(profile.weights.location_match, "location match");
  }
  if (lead.sourceRecords.length > 1) add(profile.weights.multi_source, "multi-provider corroboration");

  total = Math.min(100, Math.round(total));
  const grade: "A" | "B" | "C" | "D" = total >= 80 ? "A" : total >= 60 ? "B" : total >= 40 ? "C" : "D";
  const confidence = Math.min(1, 0.4 + lead.sourceRecords.length * 0.2 + (verifiedEmail ? 0.2 : 0));
  return { total, grade, reasons, confidence: Number(confidence.toFixed(2)) };
}

// --- Suppression matching (§22.1) ---------------------------------------------------

export function suppressionHits(
  lead: CanonicalLead,
  entries: Array<{ matchType: string; matchValue: string }>,
): Array<{ matchType: string; matchValue: string }> {
  const haystacks: Array<{ type: string; value: string }> = [];
  if (lead.company?.domain) haystacks.push({ type: "domain", value: lead.company.domain.toLowerCase() });
  if (lead.company?.canonicalName) haystacks.push({ type: "company", value: lead.company.canonicalName.toLowerCase() });
  if (lead.person?.fullName) haystacks.push({ type: "person", value: lead.person.fullName.toLowerCase() });
  for (const point of lead.contactPoints) {
    haystacks.push({ type: point.type === "website" ? "domain" : point.type, value: point.normalizedValue.toLowerCase() });
  }
  return entries.filter((entry) =>
    haystacks.some((hay) => hay.type === entry.matchType && hay.value === entry.matchValue.toLowerCase()),
  );
}

export function assertValidBudget(input: unknown): LeadBudget {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const maxJobCost = positiveNumber(record.maxJobCost, defaultBudget().maxJobCost);
  const maxCostPerLead = positiveNumber(record.maxCostPerLead, defaultBudget().maxCostPerLead);
  const requireApprovalAbove = positiveNumber(record.requireApprovalAbove, defaultBudget().requireApprovalAbove);
  const allowOverrunPercent = Math.max(0, Number(record.allowOverrunPercent ?? 0) || 0);
  return {
    maxJobCost,
    maxCostPerLead,
    requireApprovalAbove,
    allowOverrunPercent,
    currency: typeof record.currency === "string" && record.currency ? record.currency : "USD",
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultBudget(): LeadBudget {
  return {
    maxJobCost: Number(process.env.LEAD_DEFAULT_MAX_JOB_COST_USD || 2),
    currency: "USD",
    maxCostPerLead: 0.05,
    allowOverrunPercent: 0,
    requireApprovalAbove: 1,
  };
}
