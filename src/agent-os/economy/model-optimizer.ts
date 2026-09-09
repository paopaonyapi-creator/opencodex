/**
 * Phase 24 — Pao Autonomous Cost & Token Economy: Model Optimizer
 * Evaluates task complexity and budget state to recommend cost-optimal model tiers.
 */

import type {
  BudgetStatus,
  ModelRoutingRecommendation,
  ModelTier,
} from "./types";

export interface OptimizeRouteInput {
  requestedModelId: string;
  taskType?: string;
  budgetStatus?: BudgetStatus;
  safeguardAction?: "none" | "throttle" | "downgrade_forced" | "circuit_broken";
}

const TIER_MAPPINGS: Record<string, ModelTier> = {
  // Tier 1 Ultra / Frontier
  "claude-3-5-sonnet-20241022": "tier1_ultra",
  "claude-3-7-sonnet": "tier1_ultra",
  "gpt-4o": "tier1_ultra",
  "o1": "tier1_ultra",
  "o1-preview": "tier1_ultra",
  "gemini-1.5-pro": "tier1_ultra",

  // Tier 2 Balanced / Efficient
  "claude-3-5-haiku-20241022": "tier2_balanced",
  "gpt-4o-mini": "tier2_balanced",
  "gemini-1.5-flash": "tier2_balanced",
  "deepseek-chat": "tier2_balanced",
  "deepseek-v3": "tier2_balanced",

  // Tier 3 Economy / Local Free
  "ollama/qwen2.5-coder:32b": "tier3_economy",
  "ollama/deepseek-r1:32b": "tier3_economy",
  "local-worker-llm": "tier3_economy",
};

const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  tier1_ultra: "claude-3-5-sonnet-20241022",
  tier2_balanced: "claude-3-5-haiku-20241022",
  tier3_economy: "ollama/qwen2.5-coder:32b",
};

const LOW_COMPLEXITY_TASKS = new Set([
  "summary",
  "json_formatting",
  "simple_query",
  "translation",
  "data_cleanup",
  "metadata_extraction",
]);

export class ModelOptimizer {
  /**
   * Recommend the optimal model tier based on task complexity and budget safeguards
   */
  public recommendRoute(input: OptimizeRouteInput): ModelRoutingRecommendation {
    const originalModel = input.requestedModelId || DEFAULT_TIER_MODELS.tier1_ultra;
    const currentTier = TIER_MAPPINGS[originalModel] || "tier1_ultra";
    const task = (input.taskType || "").toLowerCase();
    const isLowComplexity = LOW_COMPLEXITY_TASKS.has(task);

    // 1. Circuit breaker tripped: Force Tier 3 Local/Free
    if (input.safeguardAction === "circuit_broken" || input.budgetStatus === "circuit_broken") {
      const targetModel = DEFAULT_TIER_MODELS.tier3_economy;
      return {
        recommendedTier: "tier3_economy",
        recommendedModelId: targetModel,
        originalModelId: originalModel,
        downgraded: currentTier !== "tier3_economy",
        estimatedSavingsPercent: 100,
        rationale: "Budget limit reached or circuit breaker active; forced fallback to Tier 3 Local/Free LLM.",
      };
    }

    // 2. Forced downgrade or budget warning: Downgrade from Tier 1 to Tier 2
    if (
      input.safeguardAction === "downgrade_forced" ||
      input.budgetStatus === "warning" ||
      input.budgetStatus === "throttled"
    ) {
      if (currentTier === "tier1_ultra") {
        const targetModel = DEFAULT_TIER_MODELS.tier2_balanced;
        return {
          recommendedTier: "tier2_balanced",
          recommendedModelId: targetModel,
          originalModelId: originalModel,
          downgraded: true,
          estimatedSavingsPercent: 80,
          rationale: "Budget warning / velocity spike active; downgraded from Tier 1 Ultra to Tier 2 Balanced.",
        };
      }
    }

    // 3. Low complexity task: Proactively optimize to Tier 2 for cost efficiency
    if (isLowComplexity && currentTier === "tier1_ultra") {
      const targetModel = DEFAULT_TIER_MODELS.tier2_balanced;
      return {
        recommendedTier: "tier2_balanced",
        recommendedModelId: targetModel,
        originalModelId: originalModel,
        downgraded: true,
        estimatedSavingsPercent: 80,
        rationale: `Task '${task}' has low complexity; routed to cost-efficient Tier 2 model.`,
      };
    }

    // 4. Standard route: Preserve requested model
    return {
      recommendedTier: currentTier,
      recommendedModelId: originalModel,
      originalModelId: originalModel,
      downgraded: false,
      estimatedSavingsPercent: 0,
      rationale: "Budget healthy and task demands high fidelity; executing on requested model.",
    };
  }

  /**
   * Calculate estimated savings when using a lower tier model
   */
  public calculateSavings(
    inputTokens: number,
    outputTokens: number,
    fromTier: ModelTier,
    toTier: ModelTier
  ): number {
    const tierRates: Record<ModelTier, { inputPerM: number; outputPerM: number }> = {
      tier1_ultra: { inputPerM: 3.0, outputPerM: 15.0 },
      tier2_balanced: { inputPerM: 0.25, outputPerM: 1.25 },
      tier3_economy: { inputPerM: 0.0, outputPerM: 0.0 },
    };

    const costFrom =
      (inputTokens * tierRates[fromTier].inputPerM + outputTokens * tierRates[fromTier].outputPerM) / 1_000_000;
    const costTo =
      (inputTokens * tierRates[toTier].inputPerM + outputTokens * tierRates[toTier].outputPerM) / 1_000_000;

    return Number(Math.max(0, costFrom - costTo).toFixed(5));
  }
}
