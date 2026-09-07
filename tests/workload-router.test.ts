// Phase 20 — Workload Analyzer & Intelligent Router unit tests.
import { describe, it, expect, beforeEach } from "bun:test";
import { resolveWorkloadRequirements, classifyWorkload } from "../src/agent-os/generation/routing/workload-analyzer";
import {
  seedGpuCatalog,
  listGpuProfiles,
  findCompatibleGpuCandidates,
  recordPriceObservation,
} from "../src/agent-os/generation/routing/gpu-catalog";
import { IntelligentWorkloadRouter } from "../src/agent-os/generation/routing/router";
import type { GenerationJob } from "../src/agent-os/generation/types";
import { openAgentOsDb } from "../src/agent-os/db";

function makeTestJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: `job_test_${Math.random().toString(36).slice(2, 8)}`,
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
    prompt: "high quality cinematic stock photo",
    negativePrompt: "blurry, low quality",
    seed: -1,
    resolvedSeed: null,
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

describe("phase 20 — workload analyzer & intelligent router", () => {
  beforeEach(() => {
    seedGpuCatalog();
    const db = openAgentOsDb();
    db.query("DELETE FROM gen_runpod_pods").run();
  });

  it("classifies video and heavy batch workloads correctly", () => {
    const imgJob = makeTestJob({ width: 1024, height: 1024, batchSize: 1 });
    expect(classifyWorkload(imgJob)).toBe("LIGHT_IMAGE");

    const batchJob = makeTestJob({ width: 1024, height: 1024, batchSize: 8 });
    expect(classifyWorkload(batchJob)).toBe("HEAVY_IMAGE");

    const videoJob = makeTestJob({ jobType: "text_to_video", width: 1920, height: 1080 });
    expect(classifyWorkload(videoJob)).toBe("LIGHT_VIDEO");

    const heavyVideoJob = makeTestJob({ jobType: "text_to_video", width: 3840, height: 2160 });
    expect(classifyWorkload(heavyVideoJob)).toBe("HEAVY_VIDEO");
  });

  it("resolves minimum VRAM with safety margin", () => {
    const job = makeTestJob({ jobType: "text_to_image" });
    const req = resolveWorkloadRequirements(job, { vramSafetyMarginGb: 4 });
    // SDXL model min VRAM 8 + 4 margin = 12 GB
    expect(req.minVramGb).toBeGreaterThanOrEqual(12);
    expect(req.preferredVramGb).toBeGreaterThanOrEqual(16);
    expect(req.estimatedRuntimeSeconds).toBeGreaterThan(0);
  });

  it("filters compatible GPU candidates by VRAM requirements", () => {
    const all = listGpuProfiles({ enabledOnly: true });
    expect(all.length).toBeGreaterThanOrEqual(5);

    // Candidates with at least 48 GB VRAM (RTX A6000, A40, A100)
    const heavyCandidates = findCompatibleGpuCandidates(48);
    expect(heavyCandidates.length).toBeGreaterThanOrEqual(3);
    for (const c of heavyCandidates) {
      expect(c.vramGb).toBeGreaterThanOrEqual(48);
    }
  });

  it("updates price observations with timestamp", () => {
    recordPriceObservation("NVIDIA GeForce RTX 4090", 0.69, "runpod");
    const profiles = listGpuProfiles();
    const rtx4090 = profiles.find(p => p.gpuTypeId === "NVIDIA GeForce RTX 4090");
    expect(rtx4090?.observedPricePerHour).toBe(0.69);
    expect(rtx4090?.priceObservedAt).toBeDefined();
  });

  it("router selects local GPU when healthy, queue is low, and VRAM is sufficient", async () => {
    const router = new IntelligentWorkloadRouter({
      preferLocal: true,
      localGpuVramGb: 24,
      cloudBurstQueueThreshold: 3,
    });

    const job = makeTestJob({ width: 1024, height: 1024 });
    const decision = await router.routeJob(job, "AUTO", 0);

    expect(decision.selectedProvider).toBe("local");
    expect(decision.estimatedHourlyCost).toBe(0);
    expect(decision.reason).toContain("Local GPU is healthy");
  });

  it("router selects cloud RunPod when local VRAM is insufficient", async () => {
    const router = new IntelligentWorkloadRouter({
      preferLocal: true,
      localGpuVramGb: 8, // small local GPU
      cloudBurstQueueThreshold: 3,
    });

    // Job requires 48GB VRAM (e.g. heavy video)
    const heavyJob = makeTestJob({
      jobType: "text_to_video",
      width: 3840,
      height: 2160,
    });

    const decision = await router.routeJob(heavyJob, "AUTO", 0);

    expect(decision.selectedProvider).toBe("runpod");
    expect(decision.selectedGpu).toBeDefined();
    expect(decision.estimatedHourlyCost).toBeGreaterThan(0);
    expect(decision.reason).toContain("RunPod");
  });

  it("router reuses warm ready RunPod pod before cold provisioning", async () => {
    const db = openAgentOsDb();
    const warmPodId = `pod_warm_${Math.random().toString(36).slice(2, 8)}`;
    db.query(`
      INSERT INTO gen_runpod_pods
        (id, runpod_pod_id, gpu_type, gpu_count, desired_state, actual_state, cost_per_hour, created_by_pao, ownership_marker, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'running', 'ready', 0.74, 1, 'pao-gen-test', datetime('now'), datetime('now'))
    `).run(warmPodId, warmPodId, "NVIDIA GeForce RTX 4090");

    const router = new IntelligentWorkloadRouter({
      preferLocal: false, // force cloud evaluation
    });

    const job = makeTestJob({ width: 1024, height: 1024 });
    const decision = await router.routeJob(job, "CLOUD_ONLY", 0);

    expect(decision.selectedProvider).toBe("runpod");
    expect(decision.selectedInstanceId).toBe(warmPodId);
    expect(decision.reason).toContain("Reusing warm ready RunPod pod");
  });

  it("LOCAL_ONLY mode refuses cloud even when local VRAM is insufficient", async () => {
    const router = new IntelligentWorkloadRouter({
      localGpuVramGb: 8,
    });

    const heavyJob = makeTestJob({ jobType: "text_to_video", width: 3840, height: 2160 });
    const decision = await router.routeJob(heavyJob, "LOCAL_ONLY", 0);

    expect(decision.selectedProvider).toBe("local");
    expect(decision.reason).toContain("LOCAL_ONLY enforced");
  });
});
