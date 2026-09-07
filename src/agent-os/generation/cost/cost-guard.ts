// Phase 20 — FinOps Cost Guard & Circuit Breaker.
//
// Enforces hard and soft spending limits, concurrent pod limits, and
// maximum hourly GPU rates before any cloud provisioning action occurs.

import { openAgentOsDb } from "../../db";
import type { BudgetDecision, BudgetDecisionVerdict } from "../types";

export interface CostGuardConfig {
  maxGpuPricePerHour?: number;
  maxEstimatedCostPerJob?: number;
  dailyBudget?: number;
  monthlyBudget?: number;
  maxActivePods?: number;
  requireApproval?: boolean;
}

export class CostGuard {
  maxGpuPricePerHour: number;
  maxEstimatedCostPerJob: number;
  dailyBudget: number;
  monthlyBudget: number;
  maxActivePods: number;
  requireApproval: boolean;

  constructor(config: CostGuardConfig = {}) {
    this.maxGpuPricePerHour = config.maxGpuPricePerHour ?? 1.50;
    this.maxEstimatedCostPerJob = config.maxEstimatedCostPerJob ?? 2.00;
    this.dailyBudget = config.dailyBudget ?? 10.00;
    this.monthlyBudget = config.monthlyBudget ?? 100.00;
    this.maxActivePods = config.maxActivePods ?? 2;
    this.requireApproval = config.requireApproval ?? false;
  }

  getSpendToday(): number {
    const db = openAgentOsDb();
    const today = new Date().toISOString().slice(0, 10);
    const row = db.query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM gen_runpod_billing
      WHERE observed_at >= ?
    `).get(`${today}T00:00:00.000Z`) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  getSpendThisMonth(): number {
    const db = openAgentOsDb();
    const month = new Date().toISOString().slice(0, 7);
    const row = db.query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM gen_runpod_billing
      WHERE observed_at >= ?
    `).get(`${month}-01T00:00:00.000Z`) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  getActivePodCount(): number {
    const db = openAgentOsDb();
    const row = db.query(`
      SELECT COUNT(*) as count
      FROM gen_runpod_pods
      WHERE actual_state NOT IN ('stopped', 'terminated')
    `).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  evaluate(params: {
    hourlyPrice: number;
    estimatedCost: number;
    overrideActive?: boolean;
  }): BudgetDecision {
    const { hourlyPrice, estimatedCost, overrideActive } = params;
    const currentDailySpend = this.getSpendToday();
    const currentMonthlySpend = this.getSpendThisMonth();
    const activePods = this.getActivePodCount();

    const reasons: string[] = [];
    let verdict: BudgetDecisionVerdict = "ALLOW";

    if (overrideActive) {
      return {
        verdict: "ALLOW",
        allowed: true,
        estimatedCost,
        hourlyPrice,
        currentDailySpend,
        currentMonthlySpend,
        activePods,
        reasons: ["Admin budget override active"],
      };
    }

    // 1. Max active pods limit
    if (activePods >= this.maxActivePods) {
      verdict = "BLOCK";
      reasons.push(`Active cloud pod limit reached (${activePods}/${this.maxActivePods})`);
    }

    // 2. Max GPU hourly price limit
    if (hourlyPrice > this.maxGpuPricePerHour) {
      verdict = "BLOCK";
      reasons.push(`GPU hourly price ($${hourlyPrice.toFixed(2)}) exceeds max allowed ($${this.maxGpuPricePerHour.toFixed(2)}/hr)`);
    }

    // 3. Max estimated cost per job
    if (estimatedCost > this.maxEstimatedCostPerJob) {
      verdict = this.requireApproval ? "REQUIRE_APPROVAL" : "BLOCK";
      reasons.push(`Estimated job cost ($${estimatedCost.toFixed(2)}) exceeds limit ($${this.maxEstimatedCostPerJob.toFixed(2)})`);
    }

    // 4. Daily budget limit
    if (currentDailySpend + estimatedCost > this.dailyBudget) {
      verdict = "BLOCK";
      reasons.push(`Projected spend ($${(currentDailySpend + estimatedCost).toFixed(2)}) exceeds daily budget ($${this.dailyBudget.toFixed(2)})`);
    }

    // 5. Monthly budget limit
    if (currentMonthlySpend + estimatedCost > this.monthlyBudget) {
      verdict = "BLOCK";
      reasons.push(`Projected spend ($${(currentMonthlySpend + estimatedCost).toFixed(2)}) exceeds monthly budget ($${this.monthlyBudget.toFixed(2)})`);
    }

    // 6. Soft warning threshold (80% of daily or monthly budget)
    if (verdict === "ALLOW") {
      if (currentDailySpend >= this.dailyBudget * 0.8) {
        verdict = "WARN";
        reasons.push(`Approaching daily budget ($${currentDailySpend.toFixed(2)} / $${this.dailyBudget.toFixed(2)})`);
      } else if (currentMonthlySpend >= this.monthlyBudget * 0.8) {
        verdict = "WARN";
        reasons.push(`Approaching monthly budget ($${currentMonthlySpend.toFixed(2)} / $${this.monthlyBudget.toFixed(2)})`);
      }
    }

    const allowed = verdict === "ALLOW" || verdict === "WARN";

    return {
      verdict,
      allowed,
      estimatedCost,
      hourlyPrice,
      currentDailySpend,
      currentMonthlySpend,
      activePods,
      reasons,
    };
  }
}
