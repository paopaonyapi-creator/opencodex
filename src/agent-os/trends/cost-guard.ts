// Phase 20.10 — Cost Guard (spec section 19).
//
// Enforces hard spending ceilings per job and per day, preventing accidental runaway API spend.

import { openAgentOsDb } from "../db";
import { getTrendConfig } from "./config";

export class CostGuard {
  getDailySpendUsd(): number {
    const db = openAgentOsDb();
    const today = new Date().toISOString().slice(0, 10);
    const row = db.query("SELECT SUM(cost_usd) as total FROM trend_usage_costs WHERE created_at LIKE ?").get(`${today}%`) as { total: number | null };
    return row?.total ?? 0.0;
  }

  getJobSpendUsd(jobId: string): number {
    const db = openAgentOsDb();
    const row = db.query("SELECT SUM(cost_usd) as total FROM trend_usage_costs WHERE research_job_id = ?").get(jobId) as { total: number | null };
    return row?.total ?? 0.0;
  }

  canExecute(jobId: string, estimatedCostUsd: number): { allowed: boolean; reason?: string } {
    const config = getTrendConfig();
    const currentDaily = this.getDailySpendUsd();
    if (currentDaily + estimatedCostUsd > config.dailyCostCapUsd) {
      return {
        allowed: false,
        reason: `Daily cost cap of $${config.dailyCostCapUsd.toFixed(2)} exceeded (current: $${currentDaily.toFixed(2)}, requested: $${estimatedCostUsd.toFixed(2)})`,
      };
    }

    const currentJob = this.getJobSpendUsd(jobId);
    if (currentJob + estimatedCostUsd > config.perJobCostCapUsd) {
      return {
        allowed: false,
        reason: `Job cost cap of $${config.perJobCostCapUsd.toFixed(2)} exceeded (current: $${currentJob.toFixed(2)}, requested: $${estimatedCostUsd.toFixed(2)})`,
      };
    }

    return { allowed: true };
  }

  recordUsage(input: {
    jobId: string;
    provider: string;
    actorId: string;
    providerRunId?: string | null;
    costUsd: number;
    units: number;
    metadata?: Record<string, unknown>;
  }): void {
    const db = openAgentOsDb();
    const id = `cost_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.query(`INSERT INTO trend_usage_costs (
      id, research_job_id, provider, actor_id, provider_run_id, cost_usd, units, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.jobId,
      input.provider,
      input.actorId,
      input.providerRunId ?? null,
      input.costUsd,
      input.units,
      JSON.stringify(input.metadata ?? {}),
      now,
    );
  }
}

let costGuardInstance: CostGuard | null = null;
export function getCostGuard(): CostGuard {
  if (!costGuardInstance) {
    costGuardInstance = new CostGuard();
  }
  return costGuardInstance;
}
