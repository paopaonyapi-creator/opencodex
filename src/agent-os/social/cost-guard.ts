// Phase 20.20 — Central cost guard (spec section 15).
//
// No provider run may bypass this component. Spend is tracked from the usage ledger;
// "committed" cost per ledger row is the actual provider-reported spend when known,
// otherwise the estimate that authorized the run. Estimated and actual stay separate
// everywhere they are displayed.

import { openAgentOsDb } from "../db";
import { getSocialConfig, type SocialIntelligenceConfig } from "./config";
import type { PricingState, SocialBudgetDecision, UsageSummary } from "./types";

export interface CostDecisionInput {
  estimatedUsd: number | null;
  pricingState: PricingState;
  jobId?: string;
  /** Per-job limit override from the request; falls back to the configured default. */
  jobLimitUsd?: number;
  /**
   * Maximum amount an approved token covers for this job. When set and the estimate
   * fits, the approval requirement is satisfied (fallback candidates run without a
   * fresh token, bounded by the approved ceiling).
   */
  approvedMaxUsd?: number;
}

export class SocialCostGuard {
  /**
   * Config is read per call, not captured at construction: settings come from the
   * environment and must be able to change between decisions (and between tests).
   */
  private get config(): SocialIntelligenceConfig {
    return getSocialConfig();
  }

  /**
   * Decide whether a provider run may start. Order matters: unknown-cost blocks come
   * first (they cannot be reasoned about), then hard budget ceilings, then the
   * approval threshold.
   */
  decide(input: CostDecisionInput): SocialBudgetDecision {
    const estimated = input.estimatedUsd;
    const mayCostMoney = input.pricingState !== "free";

    // 1. Known-paid (or unknown-pricing) tool whose cost cannot be estimated.
    if (mayCostMoney && estimated === null && !this.config.allowUnestimatedPaidRun) {
      return {
        state: "block_unknown_cost",
        reason: input.pricingState === "paid"
          ? "tool is known to be paid but its cost cannot be estimated and SOCIAL_ALLOW_UNESTIMATED_PAID_RUN is false"
          : "tool pricing is unknown and SOCIAL_ALLOW_UNESTIMATED_PAID_RUN is false",
        estimatedCostUsd: null,
      };
    }

    const estimate = estimated ?? 0;

    // 2. Hard budget ceilings: daily, monthly, and the per-job limit.
    const daily = this.getSpend("daily");
    if (daily.committed + estimate > this.config.dailyBudgetUsd) {
      return {
        state: "block_budget_exceeded",
        reason: `daily budget $${this.config.dailyBudgetUsd.toFixed(2)} would be exceeded (committed $${daily.committed.toFixed(4)}, requested $${estimate.toFixed(4)})`,
        estimatedCostUsd: estimated,
      };
    }
    const monthly = this.getSpend("monthly");
    if (monthly.committed + estimate > this.config.monthlyBudgetUsd) {
      return {
        state: "block_budget_exceeded",
        reason: `monthly budget $${this.config.monthlyBudgetUsd.toFixed(2)} would be exceeded (committed $${monthly.committed.toFixed(4)}, requested $${estimate.toFixed(4)})`,
        estimatedCostUsd: estimated,
      };
    }
    const jobLimit = input.jobLimitUsd ?? this.config.defaultMaxJobUsd;
    if (input.jobId) {
      const jobCommitted = this.getJobCommittedUsd(input.jobId);
      if (jobCommitted + estimate > jobLimit) {
        return {
          state: "block_budget_exceeded",
          reason: `job limit $${jobLimit.toFixed(2)} would be exceeded (committed $${jobCommitted.toFixed(4)}, requested $${estimate.toFixed(4)})`,
          estimatedCostUsd: estimated,
        };
      }
    }

    // 3. Approval: anything above the threshold, or any paid run when paid auto-run
    //    is disabled (the default) — unless a valid approval already covers it.
    if (mayCostMoney && (estimate > this.config.requireApprovalOverUsd || !this.config.allowPaidAutoRun)) {
      const coveredByApproval = input.approvedMaxUsd !== undefined && estimate <= input.approvedMaxUsd;
      if (!coveredByApproval) {
        const because = estimate > this.config.requireApprovalOverUsd
          ? `estimated $${estimate.toFixed(4)} exceeds the $${this.config.requireApprovalOverUsd.toFixed(2)} approval threshold`
          : "paid auto-run is disabled (SOCIAL_ALLOW_PAID_AUTO_RUN=false)";
        return { state: "require_approval", reason: because, estimatedCostUsd: estimated };
      }
    }

    // 4. Allow, with a warning when this run would consume most of the daily budget.
    const dailyRemaining = this.config.dailyBudgetUsd - daily.committed - estimate;
    if (mayCostMoney && this.config.dailyBudgetUsd > 0 && dailyRemaining < this.config.dailyBudgetUsd * 0.5) {
      return {
        state: "allow_with_warning",
        reason: `run allowed but only $${Math.max(dailyRemaining, 0).toFixed(4)} of the daily budget would remain`,
        estimatedCostUsd: estimated,
      };
    }

    return { state: "allow", reason: "within budget and approval policy", estimatedCostUsd: estimated };
  }

  /** True when an estimate of this size needs an approval token, shared with the router. */
  approvalRequired(estimatedUsd: number | null, pricingState: PricingState): boolean {
    if (pricingState === "free") return false;
    if (estimatedUsd === null) return !this.config.allowUnestimatedPaidRun;
    return estimatedUsd > this.config.requireApprovalOverUsd || !this.config.allowPaidAutoRun;
  }

  getJobCommittedUsd(jobId: string): number {
    const db = openAgentOsDb();
    const row = db.query(
      "SELECT SUM(COALESCE(actual_cost, estimated_cost)) AS total FROM social_usage_records WHERE research_job_id = ?",
    ).get(jobId) as { total: number | null };
    return row?.total ?? 0;
  }

  /**
   * Ledger-backed spend for a window. `estimated` and `actual` are reported
   * separately; `committed` (what budgets enforce) is actual when known, else the
   * estimate that authorized the run.
   */
  getSpend(window: "daily" | "monthly"): { estimated: number; actual: number | null; committed: number; runs: number } {
    const db = openAgentOsDb();
    const now = new Date();
    const prefix = window === "daily" ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 7);
    const rows = db.query(
      "SELECT estimated_cost, actual_cost FROM social_usage_records WHERE created_at LIKE ?",
    ).all(`${prefix}%`) as { estimated_cost: number; actual_cost: number | null }[];
    let estimated = 0;
    let committed = 0;
    const actuals: number[] = [];
    for (const row of rows) {
      const est = Number(row.estimated_cost ?? 0);
      estimated += est;
      if (row.actual_cost !== null && row.actual_cost !== undefined) {
        actuals.push(Number(row.actual_cost));
        committed += Number(row.actual_cost);
      } else {
        committed += est;
      }
    }
    return {
      estimated,
      actual: actuals.length > 0 ? actuals.reduce((sum, v) => sum + v, 0) : null,
      committed,
      runs: rows.length,
    };
  }

  getUsageSummary(): UsageSummary {
    const daily = this.getSpend("daily");
    const monthly = this.getSpend("monthly");
    return {
      daily: { estimatedUsd: daily.estimated, actualUsd: daily.actual, runs: daily.runs },
      monthly: { estimatedUsd: monthly.estimated, actualUsd: monthly.actual, runs: monthly.runs },
      budgets: {
        dailyBudgetUsd: this.config.dailyBudgetUsd,
        monthlyBudgetUsd: this.config.monthlyBudgetUsd,
        dailyRemainingUsd: Math.max(0, this.config.dailyBudgetUsd - daily.committed),
        monthlyRemainingUsd: Math.max(0, this.config.monthlyBudgetUsd - monthly.committed),
      },
    };
  }

  recordUsage(input: {
    researchJobId: string;
    runId: string;
    providerId: string;
    toolId: string;
    estimatedCost: number | null;
    actualCost: number | null;
    currency: string | null;
    inputItemCount: number;
    outputItemCount: number;
    status: string;
    startedAt: string;
    finishedAt: string | null;
  }): void {
    const db = openAgentOsDb();
    const id = `susage_${crypto.randomUUID().slice(0, 16)}`;
    db.query(`INSERT INTO social_usage_records (
      id, research_job_id, run_id, provider_id, tool_id,
      estimated_cost, actual_cost, currency, input_item_count, output_item_count,
      status, started_at, finished_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.researchJobId,
      input.runId,
      input.providerId,
      input.toolId,
      input.estimatedCost,
      input.actualCost,
      input.currency,
      input.inputItemCount,
      input.outputItemCount,
      input.status,
      input.startedAt,
      input.finishedAt,
      new Date().toISOString(),
    );
  }
}

let instance: SocialCostGuard | null = null;

export function getSocialCostGuard(): SocialCostGuard {
  if (!instance) instance = new SocialCostGuard();
  return instance;
}
