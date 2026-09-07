// Video Production Cost Guard & Budget Governor
import type { CostGuardState, VideoProductionRequest, CostEstimate } from "../domain/types";

export interface VideoCostGuardConfig {
  enabled?: boolean;
  defaultMaxJobCostUsd?: number;
  allowUnknownCost?: boolean;
  requirePaidConfirmation?: boolean;
}

export class VideoCostGuard {
  private enabled: boolean;
  private defaultMaxJobCostUsd: number;
  private allowUnknownCost: boolean;
  private requirePaidConfirmation: boolean;

  constructor(config?: VideoCostGuardConfig) {
    this.enabled = config?.enabled ?? (process.env.VIDEO_COST_GUARD_ENABLED !== "false");
    this.defaultMaxJobCostUsd = config?.defaultMaxJobCostUsd ?? Number(process.env.VIDEO_DEFAULT_MAX_JOB_COST || 2.5);
    this.allowUnknownCost = config?.allowUnknownCost ?? (process.env.VIDEO_ALLOW_UNKNOWN_COST === "true");
    this.requirePaidConfirmation =
      config?.requirePaidConfirmation ?? (process.env.VIDEO_REQUIRE_PAID_CONFIRMATION !== "false");
  }

  evaluate(request: VideoProductionRequest, estimate: CostEstimate): {
    state: CostGuardState;
    allowed: boolean;
    reason: string;
  } {
    if (!this.enabled) {
      return { state: "FREE", allowed: true, reason: "Cost Guard disabled" };
    }

    if (estimate.estimatedCostUsd === 0) {
      return { state: "FREE", allowed: true, reason: "Zero cost / local route" };
    }

    if (estimate.pricingSource === "unknown" && !this.allowUnknownCost) {
      return {
        state: "COST_UNKNOWN",
        allowed: false,
        reason: "Cost is unknown and policy forbids unknown billing",
      };
    }

    const ceiling = request.maxEstimatedCost ?? this.defaultMaxJobCostUsd;
    if (estimate.estimatedCostUsd > ceiling) {
      return {
        state: "BLOCKED_BY_LIMIT",
        allowed: false,
        reason: `Estimated cost $${estimate.estimatedCostUsd} exceeds maximum ceiling $${ceiling}`,
      };
    }

    if (this.requirePaidConfirmation && estimate.requiresApproval) {
      return {
        state: "REQUIRES_APPROVAL",
        allowed: false,
        reason: `Paid generation ($${estimate.estimatedCostUsd}) requires user confirmation`,
      };
    }

    return {
      state: "APPROVED",
      allowed: true,
      reason: "Within budget and approved",
    };
  }
}
