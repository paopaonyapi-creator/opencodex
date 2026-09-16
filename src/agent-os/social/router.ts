// Phase 20.20 — Social tool router with explainable scoring (spec sections 11, 12).
//
// Weighted score: capability 35%, reliability 20%, cost 15%, quality 15%,
// speed 10%, freshness 5%. A missing required capability is a hard reject.
// Unknown metrics score a neutral 0.5 and surface as risks — they never quietly
// become perfect scores.

import { clampMaxItems, getSocialConfig } from "./config";
import { getSocialCostGuard } from "./cost-guard";
import { getSocialProvider } from "./provider";
import { SocialToolRegistry } from "./registry";
import type {
  RouteCandidate,
  RouteDecision,
  SocialBudgetDecision,
  SocialResearchRequest,
  SocialTool,
} from "./types";

export interface RouteWithDecision {
  decision: RouteDecision;
  selectedTool: SocialTool | null;
  budget: SocialBudgetDecision | null;
}

const WEIGHTS = {
  capability: 0.35,
  reliability: 0.20,
  cost: 0.15,
  quality: 0.15,
  speed: 0.10,
  freshness: 0.05,
} as const;

const SPEED_BANDS: ReadonlyArray<{ maxMs: number; score: number }> = [
  { maxMs: 5_000, score: 1.0 },
  { maxMs: 15_000, score: 0.8 },
  { maxMs: 45_000, score: 0.6 },
  { maxMs: 120_000, score: 0.4 },
  { maxMs: Number.POSITIVE_INFINITY, score: 0.2 },
];

export class SocialRouter {
  private readonly registry: SocialToolRegistry;

  constructor(registry: SocialToolRegistry = new SocialToolRegistry()) {
    this.registry = registry;
  }

  /**
   * Route a research request to a tool. Preview-safe: nothing here executes a
   * provider run or writes usage; it reads the local registry and estimates cost
   * from stored provider metadata.
   */
  async route(request: SocialResearchRequest): Promise<RouteWithDecision> {
    const config = getSocialConfig();
    const required = [...new Set(request.capabilities)];
    const maxItems = clampMaxItems(request.maxItems, config);

    if (required.length === 0) {
      return emptyDecision("request carries no required capability; refusing to guess an intent");
    }

    const excluded = new Set(request.excludedTools ?? []);
    const enabled = this.registry.listTools({
      platform: request.platform ?? "any",
      enabledOnly: true,
    });

    const candidates: RouteCandidate[] = [];
    let hardRejects = 0;

    for (const tool of enabled) {
      if (excluded.has(tool.id) || excluded.has(tool.externalId)) continue;

      // Hard filter: every required capability must be present.
      const covered = required.filter((cap) => tool.capabilities.includes(cap));
      if (covered.length < required.length) {
        hardRejects++;
        continue;
      }

      const reasons: string[] = [];
      const risks: string[] = [];

      // Capability match.
      const capabilityScore = required.length > 0 ? covered.length / required.length : 1;
      reasons.push(`supports all ${required.length} required capabilities (${covered.join(", ")})`);
      if (request.preferredProviders?.includes(tool.providerId)) {
        reasons.push(`provider ${tool.providerId} is preferred for this request`);
      }

      // Reliability from internal runs only.
      const completed = tool.successCount + tool.failureCount + tool.timeoutCount;
      let reliabilityScore: number;
      if (completed === 0) {
        reliabilityScore = 0.5;
        risks.push("no internal run history yet (neutral reliability)");
      } else {
        const rate = tool.successCount / completed;
        reliabilityScore = rate;
        reasons.push(`${Math.round(rate * 100)}% recent internal run success over ${completed} completed runs`);
        if (rate < 0.7) risks.push(`internal success rate ${Math.round(rate * 100)}% is low`);
      }

      // Cost: derive the job estimate from stored provider metadata (no network).
      const limitUsd = request.maxCostUsd ?? config.defaultMaxJobUsd;
      let estimatedJobCost: number | null;
      let costScore: number;
      if (tool.pricingState === "free") {
        estimatedJobCost = 0;
        costScore = 1.0;
        reasons.push("tool is listed as free");
      } else if (tool.pricingState === "paid" && tool.estimatedUnitCost !== null) {
        estimatedJobCost = tool.pricingModel === "per_result"
          ? tool.estimatedUnitCost * maxItems
          : tool.estimatedUnitCost;
        if (estimatedJobCost > limitUsd) {
          // Spec section 12: over-budget tools are excluded unless explicitly approved.
          hardRejects++;
          continue;
        }
        costScore = clamp01(1 - estimatedJobCost / Math.max(limitUsd, 0.0001));
        reasons.push(`estimated job cost $${estimatedJobCost.toFixed(4)} within the $${limitUsd.toFixed(2)} limit`);
      } else {
        estimatedJobCost = null;
        costScore = 0.5;
        risks.push("provider pricing metadata is unknown (neutral cost score)");
      }

      // Data quality: no provider exposes a verifiable quality metric in this phase.
      const qualityScore = 0.5;
      risks.push("data quality is unverified (neutral quality score)");

      // Speed from observed internal latency.
      let speedScore: number;
      if (tool.avgDurationMs !== null) {
        speedScore = SPEED_BANDS.find((band) => tool.avgDurationMs! <= band.maxMs)!.score;
        reasons.push(`observed mean latency ${Math.round(tool.avgDurationMs)}ms`);
      } else {
        speedScore = 0.5;
        risks.push("no observed latency yet (neutral speed)");
      }

      // Freshness of provider metadata.
      let freshnessScore: number;
      if (tool.externalModifiedAt) {
        const ageDays = (Date.now() - Date.parse(tool.externalModifiedAt)) / 86_400_000;
        freshnessScore = ageDays <= 30 ? 1.0 : ageDays <= 90 ? 0.7 : ageDays <= 365 ? 0.4 : 0.2;
        reasons.push(`provider metadata updated ${Math.round(ageDays)} days ago`);
      } else {
        freshnessScore = 0.5;
        risks.push("provider metadata has no modification date (neutral freshness)");
      }

      const preferredBoost = request.preferredProviders?.includes(tool.providerId) ? 0.02 : 0;
      const score = Math.round(
        (capabilityScore * WEIGHTS.capability +
          reliabilityScore * WEIGHTS.reliability +
          costScore * WEIGHTS.cost +
          qualityScore * WEIGHTS.quality +
          speedScore * WEIGHTS.speed +
          freshnessScore * WEIGHTS.freshness) * 100 + preferredBoost * 100,
      );

      candidates.push({
        toolId: tool.id,
        score: Math.min(100, score),
        reasons: reasons.slice(0, 6),
        risks: risks.slice(0, 4),
        estimatedCostUsd: estimatedJobCost,
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      const why = hardRejects > 0
        ? `no enabled tool covers all required capabilities within budget (${hardRejects} candidates rejected on capability or budget)`
        : "no enabled tool matched the requested platform";
      return emptyDecision(why);
    }

    const selectedTool = this.registry.getTool(candidates[0]!.toolId)!;
    const guard = getSocialCostGuard();
    const requiresApproval = guard.approvalRequired(candidates[0]!.estimatedCostUsd, selectedTool.pricingState);
    const budget = await this.estimateBudget(selectedTool, maxItems);

    const decision: RouteDecision = {
      selectedToolId: selectedTool.id,
      candidates: candidates.slice(0, 5),
      estimatedCostUsd: candidates[0]!.estimatedCostUsd,
      requiresApproval,
      blockedReason: null,
    };
    return { decision, selectedTool, budget };
  }

  private async estimateBudget(tool: SocialTool, maxItems: number): Promise<SocialBudgetDecision | null> {
    const provider = getSocialProvider(tool.providerId);
    if (!provider) return null;
    const estimate = await provider.estimateCost({
      tool: { id: tool.id, providerId: tool.providerId, externalId: tool.externalId, name: tool.name },
      query: "",
      maxItems,
    });
    const guard = getSocialCostGuard();
    return guard.decide({ estimatedUsd: estimate.estimatedUsd, pricingState: estimate.pricingState });
  }
}

function emptyDecision(reason: string): RouteWithDecision {
  return {
    decision: {
      selectedToolId: null,
      candidates: [],
      estimatedCostUsd: null,
      requiresApproval: false,
      blockedReason: reason,
    },
    selectedTool: null,
    budget: null,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
