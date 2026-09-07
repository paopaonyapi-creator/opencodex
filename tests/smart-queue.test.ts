import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { ComfyUiQueueObserver } from "../src/agent-os/generation/smart-queue/observer";
import { RuntimePredictor } from "../src/agent-os/generation/smart-queue/runtime-predictor";
import { BatchAffinityPlanner } from "../src/agent-os/generation/smart-queue/batch-affinity";
import { CapacityPlanner } from "../src/agent-os/generation/smart-queue/capacity-planner";
import { BurstDecisionEngine } from "../src/agent-os/generation/smart-queue/burst-controller";
import { DispatchWindowManager } from "../src/agent-os/generation/smart-queue/dispatch-window";
import { ScaleInController } from "../src/agent-os/generation/smart-queue/scale-in-controller";
import { QueueReconciler } from "../src/agent-os/generation/smart-queue/queue-reconciler";
import type { GenerationJob } from "../src/agent-os/generation/types";
import { ComfyUiClient } from "../src/agent-os/generation/comfyui-client";

function makeJob(id: string, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id,
    parentJobId: null,
    projectId: null,
    userId: "test-user",
    idempotencyKey: null,
    jobType: "text_to_image",
    status: "queued",
    stage: null,
    priority: 5,
    providerId: null,
    workflowId: "sdxl-text-to-image",
    workflowVersion: 1,
    modelId: "sdxl-base-1.0",
    prompt: "cinematic product photo",
    negativePrompt: null,
    seed: 12345,
    resolvedSeed: 12345,
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
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe("Phase 20.1 Smart Queue — ComfyUiQueueObserver", () => {
  it("observes native queue and correctly tags Pao vs External ownership", () => {
    const observer = new ComfyUiQueueObserver();
    const rawRunning = [
      [1, "prompt-pao-1", { "3": { class_type: "KSampler" } }, { extra_data: { pao_job_id: "job-101" } }, ["out-1"]],
    ];
    const rawPending = [
      [2, "prompt-ext-1", { "3": { class_type: "KSampler" } }, {}, []],
      [3, "prompt-pao-2", { "3": { class_type: "KSampler" } }, { extra_data: { client_id: "pao-hub-pro" } }, []],
    ];

    const runningItems = observer.normalizeQueueItems("comfyui-local", rawRunning, "running");
    const pendingItems = observer.normalizeQueueItems("comfyui-local", rawPending, "pending");

    expect(runningItems.length).toBe(1);
    expect(runningItems[0]?.ownershipState).toBe("PAO_OWNED");
    expect(runningItems[0]?.paoJobId).toBe("job-101");

    expect(pendingItems.length).toBe(2);
    expect(pendingItems[0]?.ownershipState).toBe("EXTERNAL");
    expect(pendingItems[1]?.ownershipState).toBe("PAO_OWNED");
  });

  it("handles offline provider during captureSnapshot gracefully", async () => {
    const observer = new ComfyUiQueueObserver();
    // Non-existent target on unused port
    const snapshot = await observer.captureSnapshot({
      providerId: "comfyui-test-offline",
      baseUrl: "http://127.0.0.1:59999",
    });

    expect(snapshot.providerId).toBe("comfyui-test-offline");
    expect(snapshot.providerHealth).toBe("offline");
    expect(snapshot.totalActive).toBe(0);
    expect(snapshot.runningItems).toEqual([]);
    expect(snapshot.queuedItems).toEqual([]);
  });
});

describe("Phase 20.1 Smart Queue — RuntimePredictor", () => {
  const predictor = new RuntimePredictor();

  it("predicts runtime based on workflow family and parameters", () => {
    const estImage = predictor.predict({
      workflowId: "sdxl-text-to-image",
      width: 1024,
      height: 1024,
      batchSize: 1,
    });
    expect(estImage.estimatedSeconds).toBeGreaterThanOrEqual(5);
    expect(estImage.estimatedSeconds).toBeLessThan(60);

    const estVideo = predictor.predict({
      workflowId: "wan-video-i2v",
      videoFrames: 81,
      batchSize: 1,
    });
    expect(estVideo.estimatedSeconds).toBeGreaterThanOrEqual(60);
  });
});

describe("Phase 20.1 Smart Queue — BatchAffinityPlanner", () => {
  const planner = new BatchAffinityPlanner({ defaultChunkSize: 2 });

  it("calculates deterministic model affinity hash", () => {
    const jobA1 = makeJob("j1", { modelId: "sdxl-base-1.0", workflowId: "sdxl-text-to-image" });
    const jobA2 = makeJob("j2", { modelId: "sdxl-base-1.0", workflowId: "sdxl-text-to-image" });
    const jobB = makeJob("j3", { modelId: "flux-dev-1.0", workflowId: "flux-dev" });

    const hashA1 = planner.computeAffinityKey(jobA1);
    const hashA2 = planner.computeAffinityKey(jobA2);
    const hashB = planner.computeAffinityKey(jobB);

    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
  });

  it("groups jobs into affinity batches and chunks large batches", () => {
    const jobs: GenerationJob[] = [
      makeJob("j1", { modelId: "sdxl-base-1.0", workflowId: "sdxl-text-to-image" }),
      makeJob("j2", { modelId: "flux-dev-1.0", workflowId: "flux-dev" }),
      makeJob("j3", { modelId: "sdxl-base-1.0", workflowId: "sdxl-text-to-image" }),
      makeJob("j4", { modelId: "sdxl-base-1.0", workflowId: "sdxl-text-to-image" }),
      makeJob("j5", { modelId: "flux-dev-1.0", workflowId: "flux-dev" }),
    ];

    const groups = planner.groupJobsByAffinity(jobs);
    expect(groups.size).toBe(2);

    const sdxlKey = planner.computeAffinityKey(jobs[0]!);
    const sdxlJobs = groups.get(sdxlKey)!;
    expect(sdxlJobs.length).toBe(3);

    const chunks = planner.chunkBatch(sdxlJobs, 2);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBe(2);
    expect(chunks[1]!.length).toBe(1);
  });
});

describe("Phase 20.1 Smart Queue — CapacityPlanner", () => {
  const planner = new CapacityPlanner({ localSlots: 1, maxCloudPods: 3, targetDrainMinutes: 10 });

  it("calculates drain times with local-only and with cloud burst", () => {
    // 20 jobs * 60s = 1200 seconds total backlog
    const result = planner.plan(1200, 0);

    expect(result.currentLocalSlots).toBe(1);
    expect(result.currentCloudSlots).toBe(0);
    // 1200s on 1 slot = 1200s (~20m). Target is 10m (600s), so it needs parallel slots
    expect(result.estimatedDrainBefore).toBe(1200);
    expect(result.desiredTotalSlots).toBeGreaterThan(1);
    expect(result.desiredCloudSlots).toBeGreaterThan(0);
    expect(result.estimatedDrainAfter).toBeLessThan(result.estimatedDrainBefore);
  });
});

describe("Phase 20.1 Smart Queue — BurstDecisionEngine", () => {
  const planner = new CapacityPlanner({ localSlots: 1, maxCloudPods: 3, targetDrainMinutes: 10 });

  it("respects OFF burst mode by never scaling out", () => {
    const engine = new BurstDecisionEngine({ burstMode: "OFF", burstSoftDepth: 5 });
    const capacityPlan = planner.plan(1200, 0);

    const plan = engine.evaluate({
      queueDepth: 25,
      oldestWaitSeconds: 120,
      capacityPlan,
      costGuardApproval: true,
      estimatedHourlyCost: 0.74,
      estimatedBatchCost: 0.25,
    });

    expect(plan.decision).toBe("NO_BURST");
    expect(plan.desiredCloudSlots).toBe(0);
    expect(plan.reason).toContain("OFF");
  });

  it("evaluates scale-out recommendation under AUTO mode", () => {
    const engine = new BurstDecisionEngine({ burstMode: "AUTO", burstSoftDepth: 5, scaleUpStableWindowSeconds: 0 });
    const capacityPlan = planner.plan(1200, 0);

    const plan = engine.evaluate({
      queueDepth: 20,
      oldestWaitSeconds: 120,
      capacityPlan,
      costGuardApproval: true,
      estimatedHourlyCost: 0.74,
      estimatedBatchCost: 0.25,
    });

    expect(plan.decision).toBe("BURST_REQUIRED");
    expect(plan.status).toBe("approved");
    expect(plan.desiredCloudSlots).toBeGreaterThan(0);
  });

  it("prevents bursting when CostGuard budget is not approved", () => {
    const engine = new BurstDecisionEngine({ burstMode: "AUTO", burstSoftDepth: 2, scaleUpStableWindowSeconds: 0 });
    const capacityPlan = planner.plan(1200, 0);

    const plan = engine.evaluate({
      queueDepth: 10,
      oldestWaitSeconds: 60,
      capacityPlan,
      costGuardApproval: false,
      costGuardReason: "Daily budget exceeded ($10.00)",
      estimatedHourlyCost: 0.74,
      estimatedBatchCost: 0.25,
    });

    expect(plan.decision).toBe("BURST_BLOCKED_BY_BUDGET");
    expect(plan.reason).toContain("Daily budget exceeded");
  });
});

describe("Phase 20.1 Smart Queue — DispatchWindowManager", () => {
  const manager = new DispatchWindowManager({ maxPrefetchJobsPerProvider: 2 });

  beforeEach(() => {
    const db = openAgentOsDb();
    db.run("DELETE FROM gen_dispatch_leases");
  });

  afterEach(() => {
    const db = openAgentOsDb();
    db.run("DELETE FROM gen_dispatch_leases");
  });

  it("enforces bounded dispatch: 1 running + 1 prefetch per worker", () => {
    const worker = "worker-gpu-1";

    // Slot 0 (Running)
    const slot0 = manager.acquireSlot(worker, "job-001", "attempt-1", 2);
    expect(slot0).not.toBeNull();
    expect(slot0?.slotIndex).toBe(0);

    // Slot 1 (Prefetch)
    const slot1 = manager.acquireSlot(worker, "job-002", "attempt-2", 2);
    expect(slot1).not.toBeNull();
    expect(slot1?.slotIndex).toBe(1);

    // Slot 2 should be rejected because max is 2 (slot 0 and 1 occupied)
    const slot2 = manager.acquireSlot(worker, "job-003", "attempt-3", 2);
    expect(slot2).toBeNull();
    expect(manager.getAvailableSlots(worker, 2)).toBe(0);
  });

  it("releases slot lease when job completes", () => {
    const worker = "worker-gpu-2";

    manager.acquireSlot(worker, "job-A", "attempt-A", 2);
    manager.acquireSlot(worker, "job-B", "attempt-B", 2);

    expect(manager.getAvailableSlots(worker, 2)).toBe(0);

    // Job A finishes
    manager.releaseJobSlots("job-A");

    expect(manager.getAvailableSlots(worker, 2)).toBe(1);
  });
});

describe("Phase 20.1 Smart Queue — ScaleInController", () => {
  const controller = new ScaleInController({ scaleDownCooldownSeconds: 60, scaleDownStableWindowSeconds: 0 });

  it("tracks draining pods and permits scale-in when conditions met", () => {
    expect(controller.isDraining("pod-123")).toBe(false);
    controller.markDraining("pod-123");
    expect(controller.isDraining("pod-123")).toBe(true);
    controller.clearDraining("pod-123");
    expect(controller.isDraining("pod-123")).toBe(false);

    // When current > desired and cooldown has elapsed
    const canScale = controller.canScaleIn(3, 1);
    expect(canScale).toBe(true);
  });
});

describe("Phase 20.1 Smart Queue — QueueReconciler (Invariants)", () => {
  const reconciler = new QueueReconciler();

  it("detects untracked external prompts and preserves read-only invariant", async () => {
    const snapshot = {
      id: "snap-test",
      providerId: "comfyui-local",
      capturedAt: new Date().toISOString(),
      providerHealth: "healthy" as const,
      runningItems: [
        {
          nativeQueueId: "ext-prompt-1",
          paoJobId: null,
          ownershipState: "EXTERNAL" as const,
          providerId: "comfyui-local",
          detectedAt: new Date().toISOString(),
          position: 0,
        },
      ],
      queuedItems: [],
      totalActive: 1,
      totalExternal: 1,
      totalPaoOwned: 0,
    };

    const mockClient = new ComfyUiClient({ baseUrl: "http://127.0.0.1:8188" });
    const result = await reconciler.reconcile(snapshot, mockClient);

    expect(result.records.length).toBe(1);
    expect(result.records[0]?.mismatchType).toBe("untracked_prompt");
    expect(result.records[0]?.resolutionStatus).toBe("ignored");
  });
});
