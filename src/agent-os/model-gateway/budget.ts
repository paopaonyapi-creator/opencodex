/**
 * Phase 20.85 — Budget Governance Engine
 * Two-layer hard budget control, cumulative retry accounting & zero-zero invariant.
 */

import type { ModelDefinition, PolicyEnvelope, RouteAttempt } from "./types";

export class BudgetPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[BudgetPolicy] ${code}: ${message}`);
    this.name = "BudgetPolicyError";
  }
}

export class BudgetGovernanceEngine {
  /**
   * Pre-flight estimation: checks if the estimated cost of the candidate model
   * would immediately violate the hard budget ceiling.
   */
  public preflightCheck(
    model: ModelDefinition,
    envelope: PolicyEnvelope,
    estimatedInputTokens = 1000,
    estimatedOutputTokens = 1000,
  ): void {
    // 1. Zero-zero invariant: unknown price cannot be treated as free
    if (model.pricing.status === "unknown") {
      if (envelope.unknownPriceBehavior === "deny") {
        throw new BudgetPolicyError(
          "UNKNOWN_PRICE_DENIED",
          `Model '${model.id}' has unknown pricing metadata. Usage is denied by default policy.`,
        );
      }
    }

    if (!envelope.hardBudgetUsd) return;

    const estimatedCost = this.estimateCost(
      model,
      estimatedInputTokens,
      estimatedOutputTokens,
    );

    if (estimatedCost > envelope.hardBudgetUsd) {
      throw new BudgetPolicyError(
        "PREFLIGHT_BUDGET_EXCEEDED",
        `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds hard budget ceiling ($${envelope.hardBudgetUsd.toFixed(4)}) for model '${model.id}'.`,
      );
    }
  }

  /**
   * Evaluates if cumulative spend across attempts exceeds the hard budget limit.
   */
  public assertCumulativeBudget(
    currentCumulativeCostUsd: number,
    additionalCostUsd: number,
    hardBudgetUsd?: number,
  ): void {
    if (!hardBudgetUsd) return;

    const total = currentCumulativeCostUsd + additionalCostUsd;
    if (total > hardBudgetUsd) {
      throw new BudgetPolicyError(
        "HARD_BUDGET_EXCEEDED",
        `Total cumulative task cost ($${total.toFixed(4)}) exceeded hard budget ceiling ($${hardBudgetUsd.toFixed(4)}).`,
      );
    }
  }

  /**
   * Computes accurate cost for given token counts.
   */
  public calculateCost(
    model: ModelDefinition,
    inputTokens: number,
    outputTokens: number,
  ): number {
    if (model.isLocal) return 0.0;
    if (model.pricing.status === "unknown") return 0.0;

    const inputCost = (inputTokens / 1_000_000) * model.pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * model.pricing.outputPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Computes total cumulative cost across all attempts (attempt 1, attempt 2, fallbacks).
   * Invariant: Never report only final-success-attempt cost!
   */
  public computeCumulativeCost(attempts: RouteAttempt[]): number {
    const sum = attempts.reduce((acc, attempt) => acc + (attempt.actualCostUsd || attempt.estimatedCostUsd || 0), 0);
    return Number(sum.toFixed(6));
  }

  private estimateCost(
    model: ModelDefinition,
    inputTokens: number,
    outputTokens: number,
  ): number {
    return this.calculateCost(model, inputTokens, outputTokens);
  }
}
