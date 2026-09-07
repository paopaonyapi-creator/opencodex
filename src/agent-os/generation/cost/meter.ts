// Phase 20 — FinOps Metering & Cost Attribution.
//
// Records billing data from RunPod, computes financial summary metrics,
// and attributes compute costs to jobs, projects, and assets.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { FinOpsSummary, RunPodBillingRecord } from "../types";
import type { CostGuard } from "./cost-guard";
import type { RunPodBillingPodRecord } from "../cloud/runpod/api-types";

export function recordBillingRecord(record: {
  provider?: string;
  podId: string;
  gpuType: string;
  period?: string | null;
  amount: number;
  timeBilledMs: number;
  observedAt?: string;
}): RunPodBillingRecord {
  const id = `bill_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const observedAt = record.observedAt ?? now;
  const db = openAgentOsDb();

  db.query(`
    INSERT INTO gen_runpod_billing
      (id, provider, pod_id, gpu_type, period, amount, time_billed_ms, observed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.provider ?? "runpod",
    record.podId,
    record.gpuType,
    record.period ?? null,
    record.amount,
    record.timeBilledMs,
    observedAt,
    now,
  );

  return {
    id,
    provider: record.provider ?? "runpod",
    podId: record.podId,
    gpuType: record.gpuType,
    period: record.period ?? null,
    amount: record.amount,
    timeBilledMs: record.timeBilledMs,
    observedAt,
    createdAt: now,
  };
}

export function syncRunPodBilling(records: RunPodBillingPodRecord[]): number {
  let count = 0;
  for (const r of records) {
    recordBillingRecord({
      podId: r.podId,
      gpuType: r.gpuType ?? "unknown",
      period: r.periodStart ? `${r.periodStart}/${r.periodEnd ?? ""}` : null,
      amount: r.amount,
      timeBilledMs: r.timeBilledMs,
    });
    count++;
  }
  return count;
}

export function getFinOpsSummary(guard: CostGuard): FinOpsSummary {
  const db = openAgentOsDb();
  const todaySpend = guard.getSpendToday();
  const monthlySpend = guard.getSpendThisMonth();

  // Active hourly spend rate
  const activeRateRow = db.query(`
    SELECT COALESCE(SUM(cost_per_hour), 0) as rate, COUNT(*) as count
    FROM gen_runpod_pods
    WHERE actual_state NOT IN ('stopped', 'terminated')
  `).get() as { rate: number; count: number } | undefined;

  const activeCostPerHour = activeRateRow?.rate ?? 0;
  const activePodCount = activeRateRow?.count ?? 0;

  // Spend breakdown by GPU
  const gpuRows = db.query(`
    SELECT gpu_type, COALESCE(SUM(amount), 0) as total
    FROM gen_runpod_billing
    GROUP BY gpu_type
  `).all() as Array<{ gpu_type: string; total: number }>;

  const spendByGpu: Record<string, number> = {};
  for (const row of gpuRows) {
    spendByGpu[row.gpu_type] = Math.round(row.total * 100) / 100;
  }

  // Spend breakdown by Project via execution attempts
  const projectRows = db.query(`
    SELECT j.project_id, COALESCE(SUM(a.actual_cost), 0) as total
    FROM gen_execution_attempts a
    JOIN gen_jobs j ON a.job_id = j.id
    WHERE j.project_id IS NOT NULL
    GROUP BY j.project_id
  `).all() as Array<{ project_id: string; total: number }>;

  const spendByProject: Record<string, number> = {};
  for (const row of projectRows) {
    spendByProject[row.project_id] = Math.round(row.total * 100) / 100;
  }

  const budgetRemaining = Math.max(0, Math.round((guard.dailyBudget - todaySpend) * 100) / 100);

  return {
    todaySpend: Math.round(todaySpend * 100) / 100,
    monthlySpend: Math.round(monthlySpend * 100) / 100,
    dailyBudget: guard.dailyBudget,
    monthlyBudget: guard.monthlyBudget,
    budgetRemaining,
    activeCostPerHour: Math.round(activeCostPerHour * 100) / 100,
    activePodCount,
    spendByGpu,
    spendByProject,
  };
}

export function attributeCostToJobAssets(jobId: string, actualCost: number): void {
  const db = openAgentOsDb();
  const assets = db.query("SELECT id, generation_metadata_json FROM gen_assets WHERE job_id = ?").all(jobId) as Array<{
    id: string;
    generation_metadata_json: string;
  }>;

  if (assets.length === 0) return;

  const costPerAsset = actualCost / assets.length;

  for (const asset of assets) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(asset.generation_metadata_json);
    } catch { /* empty */ }

    meta.actual_compute_cost = Math.round(costPerAsset * 10000) / 10000;

    db.query("UPDATE gen_assets SET generation_metadata_json = ? WHERE id = ?").run(
      JSON.stringify(meta),
      asset.id,
    );
  }
}
