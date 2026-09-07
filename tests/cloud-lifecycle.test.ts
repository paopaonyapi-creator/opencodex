// Phase 20 — Cloud Lifecycle Manager unit tests.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { MockRunPodServer } from "../src/agent-os/generation/cloud/runpod/mock";
import { RunPodClient } from "../src/agent-os/generation/cloud/runpod/client";
import { CostGuard } from "../src/agent-os/generation/cost/cost-guard";
import { CloudLifecycleManager } from "../src/agent-os/generation/cloud/lifecycle-manager";
import { openAgentOsDb } from "../src/agent-os/db";

describe("phase 20 — cloud lifecycle manager", () => {
  let mockServer: MockRunPodServer;
  let client: RunPodClient;
  let costGuard: CostGuard;
  let manager: CloudLifecycleManager;

  beforeAll(async () => {
    mockServer = new MockRunPodServer({ validApiKey: "test_key_lifecycle" });
    const baseUrl = await mockServer.start();
    client = new RunPodClient({
      apiKey: "test_key_lifecycle",
      baseUrl,
      allowCustomHost: true,
    });
    costGuard = new CostGuard({ dailyBudget: 50.00 });
    manager = new CloudLifecycleManager({ client, costGuard });
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    const db = openAgentOsDb();
    db.query("DELETE FROM gen_runpod_pods").run();
    db.query("DELETE FROM gen_compute_instances").run();
    db.query("DELETE FROM gen_cloud_leases").run();
  });

  it("provisions a managed pod with traceable name and records in database", async () => {
    const record = await manager.provisionPod({
      jobId: "job_prov_001",
      gpuType: "NVIDIA GeForce RTX 4090",
      hourlyPrice: 0.74,
      estimatedCost: 0.05,
    });

    expect(record.runpodPodId).toBeDefined();
    expect(record.gpuType).toBe("NVIDIA GeForce RTX 4090");
    expect(record.createdByPao).toBe(true);

    const db = openAgentOsDb();
    const podRow = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(record.runpodPodId) as Record<string, unknown>;
    expect(podRow).toBeDefined();
    expect(podRow.actual_state).toBe("provisioned");

    const instanceRow = db.query("SELECT * FROM gen_compute_instances WHERE external_id = ?").get(record.runpodPodId) as Record<string, unknown>;
    expect(instanceRow).toBeDefined();
    expect(instanceRow.name).toContain("pao-gen-prod-");
  });

  it("assigns and unassigns jobs, then auto-stops when idle", async () => {
    const record = await manager.provisionPod({
      jobId: "job_assign_001",
      gpuType: "NVIDIA GeForce RTX 4090",
      hourlyPrice: 0.74,
      estimatedCost: 0.05,
    });

    manager.assignJobToPod(record.runpodPodId, "job_assign_001");
    let db = openAgentOsDb();
    let row = db.query("SELECT actual_state, current_job_id FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(record.runpodPodId) as { actual_state: string; current_job_id: string | null };
    expect(row.actual_state).toBe("busy");
    expect(row.current_job_id).toBe("job_assign_001");

    manager.unassignJobFromPod(record.runpodPodId);
    row = db.query("SELECT actual_state, current_job_id FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(record.runpodPodId) as { actual_state: string; current_job_id: string | null };
    expect(row.actual_state).toBe("ready");
    expect(row.current_job_id).toBeNull();

    // Fast-forward idle timestamp: 15 minutes ago
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.query("UPDATE gen_runpod_pods SET idle_since = ? WHERE runpod_pod_id = ?").run(fifteenMinAgo, record.runpodPodId);

    const stopped = await manager.checkIdleAndStopPods(10);
    expect(stopped).toContain(record.runpodPodId);

    row = db.query("SELECT actual_state FROM gen_runpod_pods WHERE runpod_pod_id = ?").get(record.runpodPodId) as { actual_state: string };
    expect(row.actual_state).toBe("stopped");
  });

  it("refuses to delete imported pod without force flag", async () => {
    const db = openAgentOsDb();
    const importedId = "imported_pod_999";
    db.query(`
      INSERT INTO gen_runpod_pods
        (id, runpod_pod_id, gpu_type, desired_state, actual_state, cost_per_hour, created_by_pao, ownership_marker, created_at, updated_at)
      VALUES (?, ?, 'RTX 4090', 'running', 'ready', 0.74, 0, 'ext', datetime('now'), datetime('now'))
    `).run(importedId, importedId);

    expect(async () => {
      await manager.safeTerminatePod(importedId);
    }).toThrow(/was imported, not created by Pao/);
  });

  it("emergency stops all managed pods", async () => {
    await manager.provisionPod({
      jobId: "job_em_1",
      gpuType: "NVIDIA GeForce RTX 4090",
      hourlyPrice: 0.74,
      estimatedCost: 0.05,
    });
    await manager.provisionPod({
      jobId: "job_em_2",
      gpuType: "NVIDIA GeForce RTX 4090",
      hourlyPrice: 0.74,
      estimatedCost: 0.05,
    });

    const result = await manager.stopAllManagedPods();
    expect(result.stoppedCount).toBe(2);

    const db = openAgentOsDb();
    const active = db.query("SELECT COUNT(*) as count FROM gen_runpod_pods WHERE actual_state NOT IN ('stopped', 'terminated')").get() as { count: number };
    expect(active.count).toBe(0);
  });

  it("detects orphan pods created by Pao not tracked in active database", async () => {
    // Directly create pod on mock server using pao-gen- prefix
    const orphan = await client.createPod({
      name: "pao-gen-test-orphan-pod",
      gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
    });

    const orphans = await manager.detectOrphanPods();
    expect(orphans.some(o => o.podId === orphan.id)).toBe(true);
  });
});
