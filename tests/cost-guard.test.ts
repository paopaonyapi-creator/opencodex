// Phase 20 — FinOps Cost Guard & Metering unit tests.
import { describe, it, expect, beforeEach } from "bun:test";
import { CostGuard } from "../src/agent-os/generation/cost/cost-guard";
import {
  recordBillingRecord,
  getFinOpsSummary,
  attributeCostToJobAssets,
} from "../src/agent-os/generation/cost/meter";
import { openAgentOsDb } from "../src/agent-os/db";

describe("phase 20 — cost guard & finops metering", () => {
  beforeEach(() => {
    const db = openAgentOsDb();
    db.query("DELETE FROM gen_runpod_billing").run();
    db.query("DELETE FROM gen_runpod_pods").run();
    db.query("DELETE FROM gen_assets").run();
  });

  it("blocks when hourly GPU price exceeds limit", () => {
    const guard = new CostGuard({ maxGpuPricePerHour: 1.50 });
    const decision = guard.evaluate({ hourlyPrice: 2.20, estimatedCost: 0.50 });
    expect(decision.allowed).toBe(false);
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasons[0]).toContain("exceeds max allowed");
  });

  it("blocks when estimated job cost exceeds job budget", () => {
    const guard = new CostGuard({ maxEstimatedCostPerJob: 2.00 });
    const decision = guard.evaluate({ hourlyPrice: 1.00, estimatedCost: 3.50 });
    expect(decision.allowed).toBe(false);
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasons[0]).toContain("Estimated job cost");
  });

  it("blocks when projected spend exceeds daily budget", () => {
    const guard = new CostGuard({ dailyBudget: 10.00 });

    // Record previous spend today: $8.50
    recordBillingRecord({
      podId: "pod_01",
      gpuType: "RTX 4090",
      amount: 8.50,
      timeBilledMs: 3600000,
    });

    // Attempting a job that costs $2.00 -> total $10.50 > $10.00
    const decision = guard.evaluate({ hourlyPrice: 0.74, estimatedCost: 2.00 });
    expect(decision.allowed).toBe(false);
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasons[0]).toContain("exceeds daily budget");
  });

  it("warns when approaching daily budget (80% threshold)", () => {
    const guard = new CostGuard({ dailyBudget: 10.00 });

    // Record spend: $8.20 (82% of budget)
    recordBillingRecord({
      podId: "pod_01",
      gpuType: "RTX 4090",
      amount: 8.20,
      timeBilledMs: 3600000,
    });

    const decision = guard.evaluate({ hourlyPrice: 0.74, estimatedCost: 0.50 });
    expect(decision.allowed).toBe(true);
    expect(decision.verdict).toBe("WARN");
    expect(decision.reasons[0]).toContain("Approaching daily budget");
  });

  it("blocks when max active cloud pods limit is reached", () => {
    const guard = new CostGuard({ maxActivePods: 2 });
    const db = openAgentOsDb();

    // Insert 2 active pods
    db.query(`
      INSERT INTO gen_runpod_pods (id, runpod_pod_id, gpu_type, desired_state, actual_state, cost_per_hour, created_by_pao, ownership_marker, created_at, updated_at)
      VALUES ('p1', 'p1', 'RTX 4090', 'running', 'ready', 0.74, 1, 'pao', datetime('now'), datetime('now')),
             ('p2', 'p2', 'RTX 4090', 'running', 'busy', 0.74, 1, 'pao', datetime('now'), datetime('now'))
    `).run();

    const decision = guard.evaluate({ hourlyPrice: 0.74, estimatedCost: 0.10 });
    expect(decision.allowed).toBe(false);
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasons[0]).toContain("Active cloud pod limit reached");
  });

  it("allows execution when admin budget override is active", () => {
    const guard = new CostGuard({ dailyBudget: 5.00 });
    const decision = guard.evaluate({
      hourlyPrice: 3.50,
      estimatedCost: 15.00,
      overrideActive: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.verdict).toBe("ALLOW");
    expect(decision.reasons[0]).toContain("override active");
  });

  it("computes FinOps summary correctly", () => {
    const guard = new CostGuard({ dailyBudget: 25.00, monthlyBudget: 200.00 });
    const db = openAgentOsDb();

    db.query(`
      INSERT INTO gen_runpod_pods (id, runpod_pod_id, gpu_type, desired_state, actual_state, cost_per_hour, created_by_pao, ownership_marker, created_at, updated_at)
      VALUES ('p_active', 'p_active', 'NVIDIA GeForce RTX 4090', 'running', 'ready', 0.74, 1, 'pao', datetime('now'), datetime('now'))
    `).run();

    recordBillingRecord({
      podId: "p_active",
      gpuType: "NVIDIA GeForce RTX 4090",
      amount: 4.50,
      timeBilledMs: 1800000,
    });

    const summary = getFinOpsSummary(guard);
    expect(summary.todaySpend).toBe(4.50);
    expect(summary.dailyBudget).toBe(25.00);
    expect(summary.budgetRemaining).toBe(20.50);
    expect(summary.activeCostPerHour).toBe(0.74);
    expect(summary.activePodCount).toBe(1);
    expect(summary.spendByGpu["NVIDIA GeForce RTX 4090"]).toBe(4.50);
  });

  it("attributes compute cost to job assets", () => {
    const db = openAgentOsDb();
    const jobId = "job_cost_attr_01";
    db.query("INSERT INTO gen_jobs (id, job_type, created_at) VALUES (?, 'text_to_image', datetime('now'))").run(jobId);

    db.query(`
      INSERT INTO gen_assets
        (id, job_id, filename, storage_path, mime_type, sha256, generation_metadata_json, created_at, updated_at)
      VALUES
        ('asset_1', ?, 'f1.png', 'p1.png', 'image/png', 'hash1', '{}', datetime('now'), datetime('now')),
        ('asset_2', ?, 'f2.png', 'p2.png', 'image/png', 'hash2', '{}', datetime('now'), datetime('now'))
    `).run(jobId, jobId);

    attributeCostToJobAssets(jobId, 0.40);

    const asset1 = db.query("SELECT generation_metadata_json FROM gen_assets WHERE id = 'asset_1'").get() as { generation_metadata_json: string };
    const meta1 = JSON.parse(asset1.generation_metadata_json) as { actual_compute_cost: number };
    expect(meta1.actual_compute_cost).toBe(0.20);
  });
});
