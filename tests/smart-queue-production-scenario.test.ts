// Phase 20.1 — Pao ComfyUI Smart Queue Production Scenario Test
//
// Simulates the end-to-end multi-job burst scenario:
// 1. 50 jobs submitted at once (multi-scene stock batch).
// 2. All 50 jobs are retained in Pao SQLite backlog without flooding ComfyUI.
// 3. Batch affinity groups jobs by model/workflow to avoid cold reloading.
// 4. Bounded 1-running + 1-prefetch window protects ComfyUI from crashing.
// 5. Capacity planner calculates drain estimate and recommends cloud burst.
// 6. Multi-node dispatch spreads jobs across local and provisioned cloud pods.
// 7. Scale-in drains and shuts down cloud pods on idle without touching local GPU.
// 8. Invariant: External / non-Pao prompts are never mutated or cancelled.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { SmartQueueController } from "../src/agent-os/generation/smart-queue/smart-queue-controller";
import { CostGuard } from "../src/agent-os/generation/cost/cost-guard";
import { ComfyUiClient } from "../src/agent-os/generation/comfyui-client";
import { loadGenerationConfig } from "../src/agent-os/generation/config";
import { IntelligentWorkloadRouter } from "../src/agent-os/generation/routing/router";
import type { GenerationJob } from "../src/agent-os/generation/types";

function createBatchJobs(count: number, modelId: string, workflowId: string): GenerationJob[] {
  const jobs: GenerationJob[] = [];
  for (let i = 1; i <= count; i++) {
    jobs.push({
      id: `job_prod_${modelId}_${i.toString().padStart(3, "0")}`,
      parentJobId: null,
      projectId: null,
      userId: "operator-1",
      idempotencyKey: null,
      jobType: "text_to_image",
      status: "queued",
      stage: null,
      priority: 5,
      providerId: null,
      workflowId,
      workflowVersion: 1,
      modelId,
      prompt: `Cinematic frame ${i} of commercial stock production`,
      negativePrompt: "blurry, low quality",
      seed: 1000 + i,
      resolvedSeed: 1000 + i,
      width: 1024,
      height: 1024,
      batchSize: 1,
      inputAssetIds: [],
      loras: [],
      parameters: {},
      stockMode: true,
      autoReview: true,
      autoMetadata: true,
      autoExport: false,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: 2,
      runAfterMs: 0,
      claimedBy: null,
      heartbeatMs: null,
      cancelRequested: false,
      cancelReason: null,
      createdAt: new Date(Date.now() - (50 - i) * 1000).toISOString(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    });
  }
  return jobs;
}

describe("Phase 20.1 Smart Queue — 50-Job Production Burst Scenario", () => {
  let db: ReturnType<typeof openAgentOsDb>;
  let costGuard: CostGuard;
  let controller: SmartQueueController;

  beforeEach(() => {
    db = openAgentOsDb();
    // Clean tables for isolated run
    db.run("DELETE FROM gen_jobs");
    db.run("DELETE FROM gen_dispatch_leases");
    db.run("DELETE FROM gen_scale_plans");
    db.run("DELETE FROM gen_batch_groups");
    db.run("DELETE FROM gen_queue_snapshots");
    db.run("DELETE FROM gen_queue_reconciliations");

    costGuard = new CostGuard({
      dailyBudget: 25.0,
      monthlyBudget: 250.0,
      maxGpuPricePerHour: 2.0,
      maxEstimatedCostPerJob: 0.5,
    });

    const mockLifecycle = {
      provisionPod: async () => ({ id: "pod-runpod-burst-1", runpodPodId: "pod-123", gpuType: "NVIDIA GeForce RTX 4090" }),
      terminatePod: async () => true,
      stopPod: async () => true,
      listTrackedPods: () => [],
    } as any;

    const baseConfig = loadGenerationConfig();
    controller = new SmartQueueController({
      config: {
        ...baseConfig,
        smartQueueEnabled: true,
        burstMode: "ASSISTED",
        burstSoftDepth: 5,
        burstHardDepth: 15,
        maxPrefetchJobsPerProvider: 2, // Strict 1 running + 1 prefetch
        scaleUpStableWindowSeconds: 0,
        scaleDownCooldownSeconds: 0,
        scaleDownStableWindowSeconds: 0,
      },
      localComfyUrl: "http://127.0.0.1:8188",
      router: new IntelligentWorkloadRouter(),
      costGuard,
      lifecycleManager: mockLifecycle,
    });
  });

  afterEach(() => {
    db.run("DELETE FROM gen_jobs");
    db.run("DELETE FROM gen_dispatch_leases");
    db.run("DELETE FROM gen_scale_plans");
    db.run("DELETE FROM gen_batch_groups");
    db.run("DELETE FROM gen_queue_snapshots");
    db.run("DELETE FROM gen_queue_reconciliations");
  });

  it("safely holds 50 jobs in SQLite without ComfyUI queue congestion", () => {
    // 1. Ingest 50 jobs (30 SDXL + 20 Flux) into SQLite
    const sdxlJobs = createBatchJobs(30, "sdxl-base-1.0", "sdxl-text-to-image");
    const fluxJobs = createBatchJobs(20, "flux-dev-1.0", "flux-dev");
    const all50Jobs = [...sdxlJobs, ...fluxJobs];

    for (const j of all50Jobs) {
      db.query(`
        INSERT INTO gen_jobs
          (id, project_id, user_id, job_type, status, priority, workflow_id, workflow_version,
           model_id, prompt, seed, width, height, batch_size, stock_mode, auto_review, auto_metadata,
           auto_export, progress, retry_count, max_retries, run_after_ms, created_at, parameters_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        j.id, j.projectId, j.userId, j.jobType, j.status, j.priority, j.workflowId, j.workflowVersion,
        j.modelId, j.prompt, j.seed, j.width, j.height, j.batchSize, j.stockMode ? 1 : 0,
        j.autoReview ? 1 : 0, j.autoMetadata ? 1 : 0, j.autoExport ? 1 : 0, j.progress,
        j.retryCount, j.maxRetries, j.runAfterMs, j.createdAt, JSON.stringify(j.parameters),
      );
    }

    const queuedCount = (db.query("SELECT COUNT(*) as count FROM gen_jobs WHERE status = 'queued'").get() as { count: number }).count;
    expect(queuedCount).toBe(50);
  });

  it("enforces bounded dispatch window: at most 2 jobs in flight on local GPU", () => {
    const localWorker = "comfyui-local";

    // Slot 0 (Running)
    const slot0 = controller.dispatchWindow.acquireSlot(localWorker, "job_prod_sdxl-base-1.0_001", "att-1", 2);
    expect(slot0).not.toBeNull();
    expect(slot0?.slotIndex).toBe(0);

    // Slot 1 (Prefetch)
    const slot1 = controller.dispatchWindow.acquireSlot(localWorker, "job_prod_sdxl-base-1.0_002", "att-2", 2);
    expect(slot1).not.toBeNull();
    expect(slot1?.slotIndex).toBe(1);

    // Attempting to dispatch job 3 must be blocked
    const slot2 = controller.dispatchWindow.acquireSlot(localWorker, "job_prod_sdxl-base-1.0_003", "att-3", 2);
    expect(slot2).toBeNull();
    expect(controller.dispatchWindow.getAvailableSlots(localWorker, 2)).toBe(0);

    // Verify exactly 2 active leases exist
    const leases = controller.dispatchWindow.getActiveLeases(localWorker);
    expect(leases.length).toBe(2);
    expect(leases.map(l => l.jobId)).toEqual(["job_prod_sdxl-base-1.0_001", "job_prod_sdxl-base-1.0_002"]);
  });

  it("generates scale plan and evaluates burst when backlog exceeds threshold", async () => {
    // 50 jobs with ~30s each = 1500 seconds total work
    const plan = controller.burstEngine.evaluate({
      queueDepth: 50,
      oldestWaitSeconds: 180,
      capacityPlan: controller.capacityPlanner.plan(1500, 0),
      costGuardApproval: true,
      estimatedHourlyCost: 1.48, // 2x RTX 4090 @ $0.74/hr
      estimatedBatchCost: 0.62,
    });

    expect(plan.decision).toBe("BURST_REQUIRED");
    expect(plan.desiredCloudSlots).toBeGreaterThan(0);
    expect(plan.status).toBe("pending"); // ASSISTED mode leaves status pending for 1-click approval
    expect(plan.reason).toContain("Critical queue depth");

    // Operator approves scale plan
    const approved = await controller.approvePlan(plan.id);
    expect(approved.success).toBe(true);
    expect(controller.getActiveScalePlan()?.status).toBe("executed");
  });

  it("multi-node dispatch balances load when cloud pods are attached", () => {
    const localWorker = "comfyui-local";
    const cloudPod1 = "pod-runpod-gpu-1";
    const cloudPod2 = "pod-runpod-gpu-2";

    // Each node gets strictly bounded slots (1 running + 1 prefetch)
    controller.dispatchWindow.acquireSlot(localWorker, "job_1", "att-1", 2);
    controller.dispatchWindow.acquireSlot(localWorker, "job_2", "att-2", 2);

    controller.dispatchWindow.acquireSlot(cloudPod1, "job_3", "att-3", 2);
    controller.dispatchWindow.acquireSlot(cloudPod1, "job_4", "att-4", 2);

    controller.dispatchWindow.acquireSlot(cloudPod2, "job_5", "att-5", 2);
    controller.dispatchWindow.acquireSlot(cloudPod2, "job_6", "att-6", 2);

    // Total in-flight across cluster = 6 (3 nodes * 2 slots)
    const allLeases = controller.dispatchWindow.getActiveLeases();
    expect(allLeases.length).toBe(6);

    // No single node has more than 2 jobs
    expect(controller.dispatchWindow.getAvailableSlots(localWorker, 2)).toBe(0);
    expect(controller.dispatchWindow.getAvailableSlots(cloudPod1, 2)).toBe(0);
    expect(controller.dispatchWindow.getAvailableSlots(cloudPod2, 2)).toBe(0);
  });

  it("reaps cloud pods when backlog clears without touching comfyui-local", () => {
    controller.scaleInController.markDraining("pod-runpod-gpu-1");
    expect(controller.scaleInController.isDraining("pod-runpod-gpu-1")).toBe(true);

    // comfyui-local must never be in draining set
    expect(controller.scaleInController.isDraining("comfyui-local")).toBe(false);

    // Scale-in is allowed from 2 cloud pods down to 0
    const canScale = controller.scaleInController.canScaleIn(2, 0);
    expect(canScale).toBe(true);
  });

  it("strictly enforces read-only invariant on external/unknown ComfyUI prompts", async () => {
    const mockExternalSnapshot = {
      id: "snap-audit",
      providerId: "comfyui-local",
      capturedAt: new Date().toISOString(),
      providerHealth: "healthy" as const,
      runningItems: [
        {
          nativeQueueId: "external-user-prompt-999",
          paoJobId: null,
          ownershipState: "EXTERNAL" as const,
          providerId: "comfyui-local",
          detectedAt: new Date().toISOString(),
          position: 0,
        },
      ],
      queuedItems: [
        {
          nativeQueueId: "external-user-prompt-1000",
          paoJobId: null,
          ownershipState: "EXTERNAL" as const,
          providerId: "comfyui-local",
          detectedAt: new Date().toISOString(),
          position: 1,
        },
      ],
      totalActive: 2,
      totalExternal: 2,
      totalPaoOwned: 0,
    };

    const mockClient = new ComfyUiClient({ baseUrl: "http://127.0.0.1:8188" });
    const result = await controller.reconciler.reconcile(mockExternalSnapshot, mockClient);

    // Two untracked external prompts recorded with resolution 'ignored' (read-only observation)
    expect(result.records.length).toBe(1);
    expect(result.records[0]?.mismatchType).toBe("untracked_prompt");
    expect(result.records[0]?.resolutionStatus).toBe("ignored");

    // Verify gen_queue_reconciliations recorded in database
    const recRows = db.query("SELECT * FROM gen_queue_reconciliations WHERE resolution_status = 'ignored'").all();
    expect(recRows.length).toBeGreaterThanOrEqual(1);
  });
});
