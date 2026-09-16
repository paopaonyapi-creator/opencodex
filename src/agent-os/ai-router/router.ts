// Phase 20.30 — Alias/policy/budget routing control plane over the EXISTING
// opencodex proxy router. This module decides which model route is eligible
// and why (policy → capability → cost/budget → scoring → fallback plan);
// request execution remains in the existing proxy core (doc §59: no duplicate
// subsystems). No LLM is consulted in the authorization/routing path.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import {
  newRouteId,
  type AliasDefinition,
  type ModelCandidate,
  type RouteCandidate,
  type RoutePreview,
  type RoutingMode,
  type RoutingPolicy,
  type TaskType,
} from "./types";

// --- Configurable weights (doc §21: never hard-code across files) -------------

export interface ScoringWeights {
  quality: number;
  capability: number;
  health: number;
  quota: number;
  cost: number;
  preference: number;
}

export const ACTIVE_WEIGHTS: ScoringWeights = {
  quality: 0.3,
  capability: 0.2,
  health: 0.15,
  quota: 0.1,
  cost: 0.15,
  preference: 0.1,
};

// --- Built-in Pao aliases (doc §31) -----------------------------------------------

export const BUILTIN_ALIASES: AliasDefinition[] = [
  { alias: "pao/auto", policyId: "policy_balanced", description: "balanced default routing" },
  { alias: "pao/free", policyId: "policy_free_first", description: "free/local only, no paid fallback" },
  { alias: "pao/local", policyId: "policy_local_first", description: "local models only" },
  { alias: "pao/coding", policyId: "policy_coding", description: "coding-capable models with tools" },
  { alias: "pao/reasoning", policyId: "policy_reasoning", description: "reasoning-capable models" },
  { alias: "pao/fast", policyId: "policy_fast", description: "cheap fast models for small tasks" },
  { alias: "pao/reviewer", policyId: "policy_reviewer", description: "review routing with provider diversity" },
  { alias: "pao/premium", policyId: "policy_premium", description: "quality-first with paid allowed" },
];

export const BUILTIN_POLICIES: RoutingPolicy[] = [
  { id: "policy_balanced", name: "Balanced", mode: "balanced", maxPaidCostPerRequestUsd: 0.25, enabled: true },
  { id: "policy_free_first", name: "Free First", mode: "free_first", maxPaidCostPerRequestUsd: 0, requireFree: true, enabled: true },
  { id: "policy_local_first", name: "Local First", mode: "local_first", maxPaidCostPerRequestUsd: 0, requireLocal: true, enabled: true },
  { id: "policy_coding", name: "Coding", mode: "balanced", taskType: "coding", maxPaidCostPerRequestUsd: 0.5, requireTools: true, enabled: true },
  { id: "policy_reasoning", name: "Reasoning", mode: "quality_first", taskType: "reasoning", maxPaidCostPerRequestUsd: 2, requireReasoning: true, enabled: true } as unknown as RoutingPolicy,
  { id: "policy_fast", name: "Fast Simple", mode: "cheapest_first", taskType: "fast_simple", maxPaidCostPerRequestUsd: 0.05, enabled: true },
  { id: "policy_reviewer", name: "Reviewer", mode: "quality_first", taskType: "review", maxPaidCostPerRequestUsd: 1, distinctProviderFamilies: true, enabled: true },
  { id: "policy_premium", name: "Premium", mode: "quality_first", maxPaidCostPerRequestUsd: 2, enabled: true },
];

// --- Budget guard (doc §16) -----------------------------------------------------------

export interface BudgetState {
  dailyLimitUsd: number;
  dailySpentUsd: number;
}

function budgetVerdict(state: BudgetState): { paidAllowed: boolean; warning: boolean; restrictPremium: boolean } {
  if (state.dailyLimitUsd <= 0) return { paidAllowed: true, warning: false, restrictPremium: false };
  const fraction = state.dailySpentUsd / state.dailyLimitUsd;
  return {
    paidAllowed: fraction < 1,
    warning: fraction >= 0.8,
    restrictPremium: fraction >= 0.9,
  };
}

// --- Eligibility + scoring (doc §12-§15, §20-§21) ----------------------------------------

export interface EligibilityContext {
  policy: RoutingPolicy;
  mode: RoutingMode;
  needsTools: boolean;
  needsVision: boolean;
  estimatedInputTokens?: number;
  budget: BudgetState;
}

export function filterCandidates(candidates: ModelCandidate[], ctx: EligibilityContext): { eligible: ModelCandidate[]; rejected: RouteCandidate[] } {
  const eligible: ModelCandidate[] = [];
  const rejected: RouteCandidate[] = [];
  const budget = budgetVerdict(ctx.budget);

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const reject = (why: string): void => {
      rejected.push({ candidate, score: 0, reasons: [], rejectedReason: why });
    };

    if (ctx.policy.allowedProviders && !ctx.policy.allowedProviders.includes(candidate.provider)) {
      reject("provider not on the policy allowlist");
      continue;
    }
    if (ctx.policy.deniedProviders?.includes(candidate.provider)) {
      reject("provider denied by policy");
      continue;
    }
    if ((ctx.policy.requireTools || ctx.needsTools) && !candidate.capabilities.tools) {
      reject("no reliable tool calling");
      continue;
    }
    if ((ctx.policy.requireVision || ctx.needsVision) && !candidate.capabilities.vision) {
      reject("no vision support");
      continue;
    }
    if (ctx.policy.requireReasoning && !candidate.capabilities.reasoning) {
      reject("no reasoning support");
      continue;
    }
    if (ctx.policy.requireLocal && !candidate.isLocal) {
      reject("policy requires local models");
      continue;
    }
    if (ctx.policy.requireFree && !candidate.isFreeTier && !candidate.isLocal) {
      reject("policy requires free/local models only");
      continue;
    }
    if (ctx.mode === "local_first" && !candidate.isLocal) {
      reject("local-first mode");
      continue;
    }
    if (ctx.mode === "free_first" && !candidate.isFreeTier && !candidate.isLocal) {
      reject("free-first mode excludes paid providers");
      continue;
    }
    if (candidate.quotaRemaining !== undefined && candidate.quotaRemaining <= 0) {
      reject("quota exhausted");
      continue;
    }
    // Budget guard (doc §16): paid routes denied at 100%; premium restricted at 90%.
    const estCost = estimateRequestCost(candidate, ctx.estimatedInputTokens);
    if (estCost > 0) {
      if (!budget.paidAllowed) {
        reject("daily budget exhausted; paid route denied");
        continue;
      }
      if (budget.restrictPremium && estCost > 0.1) {
        reject("daily budget ≥ 90%: premium fallback restricted");
        continue;
      }
      if (estCost > ctx.policy.maxPaidCostPerRequestUsd) {
        reject("estimated cost exceeds per-request policy ceiling");
        continue;
      }
    }
    reasons.push("passes policy/capability/quota/budget filters");
    if (candidate.isFreeTier || candidate.isLocal) reasons.push("free/local");
    if (candidate.capabilities.tools) reasons.push("supports tools");
    if (candidate.healthScore >= 0.9) reasons.push("healthy");
    eligible.push(candidate);
  }
  return { eligible, rejected };
}

export function estimateRequestCost(candidate: ModelCandidate, estimatedInputTokens = 10_000): number {
  if (candidate.isFreeTier || candidate.isLocal) return 0;
  return (candidate.costPerMillionUsd * estimatedInputTokens) / 1_000_000;
}

export function scoreCandidate(candidate: ModelCandidate, ctx: EligibilityContext, weights: ScoringWeights = ACTIVE_WEIGHTS): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const quality = candidate.tags.includes("coding") || candidate.tags.includes("reasoning") ? 0.9 : 0.6;
  const capability = (candidate.capabilities.tools ? 0.5 : 0) + (candidate.capabilities.reasoning ? 0.3 : 0) + (candidate.capabilities.streaming ? 0.2 : 0);
  const quota = candidate.quotaRemaining ?? 1;
  const cost = estimateRequestCost(candidate, ctx.estimatedInputTokens);
  const costScore = cost === 0 ? 1 : Math.max(0, 1 - cost * 4);

  const score =
    weights.quality * quality +
    weights.capability * capability +
    weights.health * candidate.healthScore +
    weights.quota * quota +
    weights.cost * costScore;

  if (quality >= 0.9) reasons.push("high quality score for task");
  if (costScore >= 0.9) reasons.push("low estimated cost");
  if (candidate.healthScore >= 0.9) reasons.push("provider healthy");
  return { score, reasons };
}

/** Ordered fallback plan from eligible candidates (doc §22): no loops. */
export function planFallback(eligible: ModelCandidate[], ctx: EligibilityContext, weights: ScoringWeights = ACTIVE_WEIGHTS): RouteCandidate[] {
  const scored = eligible
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(candidate, ctx, weights);
      return { candidate, score, reasons } as RouteCandidate;
    })
    .sort((a, b) => b.score - a.score);
  // Deduplicate by model id: no fallback loops.
  const seen = new Set<string>();
  return scored.filter((entry) => {
    if (seen.has(entry.candidate.id)) return false;
    seen.add(entry.candidate.id);
    return true;
  });
}

// --- Store: aliases, policies, budget counters, route events ----------------------------

export class AIRouterStore {
  private initialized = false;

  private ensure(): void {
    if (this.initialized) return;
    const db = openAgentOsDb();
    db.query("CREATE TABLE IF NOT EXISTS ai_aliases (alias TEXT PRIMARY KEY, policy_id TEXT NOT NULL, description TEXT, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS ai_routing_policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, policy_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS ai_budget_counters (period_key TEXT PRIMARY KEY, spent_usd REAL NOT NULL DEFAULT 0, limit_usd REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)").run();
    db.query("CREATE TABLE IF NOT EXISTS ai_route_events (id TEXT PRIMARY KEY, alias TEXT, task_type TEXT, selected_model TEXT, fallback_count INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    db.query("CREATE INDEX IF NOT EXISTS idx_ai_route_events_created ON ai_route_events(created_at DESC)").run();
    this.initialized = true;
  }

  /** Save an operator-defined alias (builtin seeds stay immutable). */
  saveAlias(def: AliasDefinition): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT alias FROM ai_aliases WHERE alias = ?").get(def.alias);
    if (existing) {
      const stmt = db.query("UPDATE ai_aliases SET policy_id = ?, description = ?, updated_at = ? WHERE alias = ?");
      stmt.run(def.policyId, def.description ?? null, new Date().toISOString(), def.alias);
      return;
    }
    const stmt = db.query("INSERT INTO ai_aliases (alias, policy_id, description, updated_at) VALUES (?, ?, ?, ?)");
    stmt.run(def.alias, def.policyId, def.description ?? null, new Date().toISOString());
  }

  listAliases(): AliasDefinition[] {
    this.ensure();
    const rows = openAgentOsDb()
      .query("SELECT alias, policy_id AS policyId, description FROM ai_aliases ORDER BY alias")
      .all() as unknown as AliasDefinition[];
    return rows.length > 0 ? rows : BUILTIN_ALIASES;
  }

  seedDefaults(): void {
    this.ensure();
    const db = openAgentOsDb();
    for (const alias of BUILTIN_ALIASES) {
      const existing = db.query("SELECT alias FROM ai_aliases WHERE alias = ?").get(alias.alias);
      if (existing) continue;
      const stmt = db.query("INSERT INTO ai_aliases (alias, policy_id, description, updated_at) VALUES (?, ?, ?, ?)");
      stmt.run(alias.alias, alias.policyId, alias.description ?? "", new Date().toISOString());
    }
    for (const policy of BUILTIN_POLICIES) {
      const existing = db.query("SELECT id FROM ai_routing_policies WHERE id = ?").get(policy.id);
      if (existing) continue;
      const stmt = db.query("INSERT INTO ai_routing_policies (id, name, policy_json, enabled, updated_at) VALUES (?, ?, ?, 1, ?)");
      stmt.run(policy.id, policy.name, JSON.stringify(policy), new Date().toISOString());
    }
  }

  getPolicy(policyId: string): RoutingPolicy | null {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT policy_json AS json FROM ai_routing_policies WHERE id = ?")
      .get(policyId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as RoutingPolicy) : BUILTIN_POLICIES.find((p) => p.id === policyId) ?? null;
  }

  getBudget(periodKey: string): BudgetState {
    this.ensure();
    const row = openAgentOsDb()
      .query("SELECT spent_usd AS spent, limit_usd AS limitUsd FROM ai_budget_counters WHERE period_key = ?")
      .get(periodKey) as { spent: number; limitUsd: number } | undefined;
    return { dailyLimitUsd: row?.limitUsd ?? 0, dailySpentUsd: row?.spent ?? 0 };
  }

  setBudget(periodKey: string, limitUsd: number): void {
    this.ensure();
    const db = openAgentOsDb();
    const existing = db.query("SELECT period_key FROM ai_budget_counters WHERE period_key = ?").get(periodKey);
    const now = new Date().toISOString();
    if (existing) {
      const stmt = db.query("UPDATE ai_budget_counters SET limit_usd = ?, updated_at = ? WHERE period_key = ?");
      stmt.run(limitUsd, now, periodKey);
      return;
    }
    const stmt = db.query("INSERT INTO ai_budget_counters (period_key, spent_usd, limit_usd, updated_at) VALUES (?, 0, ?, ?)");
    stmt.run(periodKey, limitUsd, now);
  }

  recordSpend(periodKey: string, amountUsd: number): void {
    this.ensure();
    const state = this.getBudget(periodKey);
    const stmt = openAgentOsDb().query("INSERT INTO ai_budget_counters (period_key, spent_usd, limit_usd, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(period_key) DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd");
    stmt.run(periodKey, amountUsd, state.dailyLimitUsd, new Date().toISOString());
  }

  recordRouteEvent(input: { alias?: string; taskType?: TaskType; selectedModel?: string; fallbackCount?: number; estimatedCostUsd?: number; reason: string }): string {
    this.ensure();
    const id = newRouteId();
    const stmt = openAgentOsDb()
      .query("INSERT INTO ai_route_events (id, alias, task_type, selected_model, fallback_count, estimated_cost_usd, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(id, input.alias ?? null, input.taskType ?? null, input.selectedModel ?? null, input.fallbackCount ?? 0, input.estimatedCostUsd ?? null, input.reason.slice(0, 500), new Date().toISOString());
    return id;
  }

  listRouteEvents(limit = 50): Array<Record<string, unknown>> {
    this.ensure();
    return openAgentOsDb()
      .query("SELECT id, alias, task_type AS taskType, selected_model AS selectedModel, fallback_count AS fallbackCount, estimated_cost_usd AS estimatedCostUsd, reason, created_at AS createdAt FROM ai_route_events ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
  }

  /** Deterministic daily period key; callers can override for tests. */
  dailyPeriodKey(now = new Date()): string {
    return "daily:" + now.toISOString().slice(0, 10);
  }
}

function maxPaid(): void {
  // removed: per-request ceilings live in RoutingPolicy.maxPaidCostPerRequestUsd
}

// --- Route preview / explain (doc §34-§35) ------------------------------------------------

export interface RoutePreviewInput {
  alias?: string;
  taskType?: TaskType;
  needsTools?: boolean;
  needsVision?: boolean;
  estimatedInputTokens?: number;
  candidates: ModelCandidate[];
}

export function previewRoute(
  store: AIRouterStore,
  input: RoutePreviewInput,
): RoutePreview {
  const alias = input.alias ?? "pao/auto";
  const aliases = store.listAliases();
  const aliasDef = aliases.find((a) => a.alias === alias) ?? BUILTIN_ALIASES.find((a) => a.alias === alias);
  const policy = aliasDef
    ? store.getPolicy(aliasDef.policyId) ?? BUILTIN_POLICIES[0]
    : BUILTIN_POLICIES[0];
  const mode: RoutingMode = policy.mode;
  const ctx: EligibilityContext = {
    policy,
    mode,
    needsTools: input.needsTools ?? policy.requireTools === true,
    needsVision: input.needsVision ?? false,
    estimatedInputTokens: input.estimatedInputTokens,
    budget: store.getBudget(store.dailyPeriodKey()),
  };
  const { eligible, rejected } = filterCandidates(input.candidates, ctx);
  const plan = planFallback(eligible, ctx, ACTIVE_WEIGHTS);
  const selected = plan[0];
  const estimated = selected ? estimateRequestCost(selected.candidate, input.estimatedInputTokens) : undefined;
  return {
    alias,
    taskType: input.taskType ?? policy.taskType,
    mode,
    selected,
    candidates: plan,
    rejected,
    estimatedCostPerRequestUsd: estimated,
    note: selected
      ? "selected by score over eligible candidates; execution remains in the existing proxy router"
      : "no eligible model route — see rejected reasons (doc §64)",
  };
}

export function explainRoute(preview: RoutePreview): string {
  const lines: string[] = [];
  if (preview.selected) {
    lines.push("Selected: " + preview.selected.candidate.id);
    lines.push("Reasons:");
    for (const reason of preview.selected.reasons) lines.push("+ " + reason);
  } else {
    lines.push("No eligible model route.");
    lines.push("Rejected candidates:");
    for (const entry of preview.rejected) lines.push("- " + entry.candidate.id + ": " + entry.rejectedReason);
  }
  lines.push("Mode: " + preview.mode);
  return lines.join("\n");
}

export function fingerprintRoute(preview: RoutePreview): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(preview.selected?.candidate.id ?? "")).digest("hex").slice(0, 32);
}

export type { ModelCandidate } from "./types";
