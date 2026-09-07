// Phase 20 — Intelligent Workload Router.
//
// Evaluates Local ComfyUI vs Warm RunPod Pods vs On-Demand Cloud GPU candidates.
// Balances cost, performance, VRAM sufficiency, and queue wait times.
// Produces explainable placement decisions and failover candidate lists.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type {
  GenerationJob,
  RoutingMode,
  PlacementDecision,
  PlacementCandidateScore,
  WorkloadRequirement,
} from "../types";
import { getProvider, listProviders } from "../providers";
import { resolveWorkloadRequirements } from "./workload-analyzer";
import { findCompatibleGpuCandidates, getGpuProfile } from "./gpu-catalog";

export interface RouterConfig {
  preferLocal?: boolean;
  localGpuVramGb?: number;
  cloudBurstQueueThreshold?: number;
  maxGpuPricePerHour?: number;
  routingMode?: RoutingMode;
}

export class IntelligentWorkloadRouter {
  preferLocal: boolean;
  localGpuVramGb: number;
  cloudBurstQueueThreshold: number;
  maxGpuPricePerHour: number;
  defaultMode: RoutingMode;

  constructor(config: RouterConfig = {}) {
    this.preferLocal = config.preferLocal ?? true;
    this.localGpuVramGb = config.localGpuVramGb ?? 16;
    this.cloudBurstQueueThreshold = config.cloudBurstQueueThreshold ?? 3;
    this.maxGpuPricePerHour = config.maxGpuPricePerHour ?? 2.50;
    this.defaultMode = config.routingMode ?? "AUTO";
  }

  async routeJob(
    job: GenerationJob,
    modeOverride?: RoutingMode,
    currentLocalQueueDepth = 0,
  ): Promise<PlacementDecision> {
    const mode = modeOverride ?? this.defaultMode;
    const requirement = resolveWorkloadRequirements(job);
    const candidates: PlacementCandidateScore[] = [];

    const localProvider = getProvider("comfyui-local") ?? listProviders({ enabledOnly: true })[0];
    const isLocalHealthy = localProvider ? localProvider.healthStatus !== "offline" : true;
    const isLocalVramSufficient = this.localGpuVramGb >= requirement.minVramGb;
    const isLocalQueueManageable = currentLocalQueueDepth < this.cloudBurstQueueThreshold;

    // 1. Evaluate Local ComfyUI
    if (mode !== "CLOUD_ONLY" && isLocalHealthy) {
      if (isLocalVramSufficient && isLocalQueueManageable) {
        const localScore: PlacementCandidateScore = {
          provider: "local",
          instanceId: localProvider?.id ?? "comfyui-local",
          gpuType: `Local GPU (${this.localGpuVramGb}GB)`,
          decisionScore: mode === "FASTEST" && currentLocalQueueDepth === 0 ? 98 : 95,
          estimatedHourlyCost: 0,
          estimatedJobCost: 0,
          availabilityScore: 100,
          modelLocalityScore: 90,
          performanceScore: 85,
          costScore: 100, // zero cloud cost
          queuePenalty: currentLocalQueueDepth * 5,
          coldStartPenalty: 0,
          reason: "Local GPU is healthy, has sufficient VRAM, and queue is within threshold",
        };
        candidates.push(localScore);

        if (this.preferLocal && mode !== "CHEAPEST" && mode !== "FASTEST") {
          return this.persistDecision(job.id, localScore, candidates);
        }
      }
    }

    // If LOCAL_ONLY is requested and local cannot handle it
    if (mode === "LOCAL_ONLY") {
      const reason = !isLocalHealthy
        ? "Local provider is currently offline or unreachable"
        : !isLocalVramSufficient
        ? `Local VRAM (${this.localGpuVramGb}GB) is insufficient for this workload (requires ${requirement.minVramGb}GB)`
        : "Local queue threshold exceeded";

      const fallbackScore: PlacementCandidateScore = {
        provider: "local",
        instanceId: localProvider?.id ?? "comfyui-local",
        gpuType: `Local GPU (${this.localGpuVramGb}GB)`,
        decisionScore: 10,
        estimatedHourlyCost: 0,
        estimatedJobCost: 0,
        availabilityScore: isLocalHealthy ? 50 : 0,
        modelLocalityScore: 50,
        performanceScore: 50,
        costScore: 100,
        queuePenalty: currentLocalQueueDepth * 10,
        coldStartPenalty: 0,
        reason: `LOCAL_ONLY enforced: ${reason}`,
      };
      return this.persistDecision(job.id, fallbackScore, [fallbackScore]);
    }

    // 2. Check for warm/ready RunPod pods in the database
    const db = openAgentOsDb();
    const warmPods = db.query(`
      SELECT * FROM gen_runpod_pods
      WHERE actual_state = 'ready' AND current_job_id IS NULL
    `).all() as Array<{
      id: string;
      runpod_pod_id: string;
      gpu_type: string;
      cost_per_hour: number;
    }>;

    for (const pod of warmPods) {
      const gpuProfile = getGpuProfile(pod.gpu_type);
      if (gpuProfile && gpuProfile.vramGb >= requirement.minVramGb) {
        const estHourly = pod.cost_per_hour || gpuProfile.observedPricePerHour || 0.74;
        const estJob = (requirement.estimatedRuntimeSeconds / 3600) * estHourly;

        candidates.push({
          provider: "runpod",
          instanceId: pod.runpod_pod_id,
          gpuType: pod.gpu_type,
          decisionScore: 92,
          estimatedHourlyCost: estHourly,
          estimatedJobCost: estJob,
          availabilityScore: 95,
          modelLocalityScore: 85,
          performanceScore: gpuProfile.benchmarkScore,
          costScore: Math.max(10, 100 - estHourly * 30),
          queuePenalty: 0,
          coldStartPenalty: 5, // warm pod has minimal boot penalty
          reason: `Reusing warm ready RunPod pod (${pod.runpod_pod_id}) with ${pod.gpu_type}`,
        });
      }
    }

    // 3. Evaluate On-Demand GPU Candidates from Catalog
    const gpuCandidates = findCompatibleGpuCandidates(
      requirement.minVramGb,
      this.maxGpuPricePerHour,
      requirement.workloadClass,
    );

    const weights = this.resolveWeights(mode);

    for (const gpu of gpuCandidates) {
      const price = gpu.observedPricePerHour ?? 0.74;
      const estJobCost = (requirement.estimatedRuntimeSeconds / 3600) * price;

      const availScore = 80;
      const localScore = 60;
      const perfScore = Math.min(100, (gpu.benchmarkScore / 160) * 100);
      const costScore = Math.max(10, Math.min(100, (1 - (price / this.maxGpuPricePerHour)) * 100));
      const coldStartPenalty = 20; // new provision cold start

      const totalScore =
        (availScore * weights.avail) +
        (localScore * weights.local) +
        (perfScore * weights.perf) +
        (costScore * weights.cost) -
        coldStartPenalty;

      const reasonDetails = !isLocalVramSufficient
        ? `Local VRAM insufficient (${requirement.minVramGb}GB required vs ${this.localGpuVramGb}GB local)`
        : currentLocalQueueDepth >= this.cloudBurstQueueThreshold
        ? `Local queue depth (${currentLocalQueueDepth}) exceeds threshold (${this.cloudBurstQueueThreshold})`
        : `Selected for ${mode.toLowerCase()} mode`;

      candidates.push({
        provider: "runpod",
        gpuType: gpu.gpuTypeId,
        decisionScore: Math.round(totalScore),
        estimatedHourlyCost: price,
        estimatedJobCost: estJobCost,
        availabilityScore: availScore,
        modelLocalityScore: localScore,
        performanceScore: Math.round(perfScore),
        costScore: Math.round(costScore),
        queuePenalty: 0,
        coldStartPenalty,
        reason: `RunPod on-demand ${gpu.displayName}: ${reasonDetails}`,
      });
    }

    // Sort candidates descending by decisionScore
    candidates.sort((a, b) => b.decisionScore - a.decisionScore);

    const winner = candidates[0] ?? {
      provider: "local",
      gpuType: "comfyui-local",
      decisionScore: 50,
      estimatedHourlyCost: 0,
      estimatedJobCost: 0,
      availabilityScore: 50,
      modelLocalityScore: 50,
      performanceScore: 50,
      costScore: 100,
      queuePenalty: 0,
      coldStartPenalty: 0,
      reason: "Fallback to local provider",
    };

    return this.persistDecision(job.id, winner, candidates);
  }

  private resolveWeights(mode: RoutingMode): { avail: number; local: number; perf: number; cost: number } {
    switch (mode) {
      case "CHEAPEST":
        return { avail: 0.15, local: 0.10, perf: 0.15, cost: 0.60 };
      case "FASTEST":
        return { avail: 0.20, local: 0.15, perf: 0.55, cost: 0.10 };
      case "LOCAL_ONLY":
        return { avail: 0.25, local: 0.25, perf: 0.25, cost: 0.25 };
      case "CLOUD_ONLY":
        return { avail: 0.25, local: 0.15, perf: 0.30, cost: 0.30 };
      case "BALANCED":
      case "AUTO":
      default:
        return { avail: 0.25, local: 0.20, perf: 0.25, cost: 0.30 };
    }
  }

  private persistDecision(
    jobId: string,
    winner: PlacementCandidateScore,
    alternatives: PlacementCandidateScore[],
  ): PlacementDecision {
    const id = `decision_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const db = openAgentOsDb();

    const decision: PlacementDecision = {
      id,
      jobId,
      selectedProvider: winner.provider,
      selectedInstanceId: winner.instanceId ?? null,
      selectedGpu: winner.gpuType ?? null,
      decisionScore: winner.decisionScore,
      estimatedHourlyCost: winner.estimatedHourlyCost,
      estimatedJobCost: winner.estimatedJobCost,
      coldStartPenalty: winner.coldStartPenalty,
      queuePenalty: winner.queuePenalty,
      modelLocalityScore: winner.modelLocalityScore,
      availabilityScore: winner.availabilityScore,
      costScore: winner.costScore,
      performanceScore: winner.performanceScore,
      reason: winner.reason,
      alternatives,
      createdAt: now,
    };

    try {
      db.query(`
        INSERT INTO gen_placement_decisions
          (id, job_id, selected_provider, selected_instance_id, selected_gpu,
           decision_score, estimated_hourly_cost, estimated_job_cost,
           cold_start_penalty, queue_penalty, model_locality_score,
           availability_score, cost_score, performance_score, reason,
           alternatives_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        decision.id,
        decision.jobId,
        decision.selectedProvider,
        decision.selectedInstanceId,
        decision.selectedGpu,
        decision.decisionScore,
        decision.estimatedHourlyCost,
        decision.estimatedJobCost,
        decision.coldStartPenalty,
        decision.queuePenalty,
        decision.modelLocalityScore,
        decision.availabilityScore,
        decision.costScore,
        decision.performanceScore,
        decision.reason,
        JSON.stringify(decision.alternatives),
        decision.createdAt,
      );
    } catch {
      // Ephemeral / preview / in-memory test jobs may not exist in gen_jobs
    }

    return decision;
  }

  async previewRoute(
    params: {
      jobType?: string;
      prompt?: string;
      width?: number;
      height?: number;
      batchSize?: number;
      workflowId?: string;
      modelId?: string;
      routingMode?: RoutingMode;
    },
    currentLocalQueueDepth = 0,
  ): Promise<{
    requirements: WorkloadRequirement;
    decision: PlacementDecision;
    candidateScores: PlacementCandidateScore[];
  }> {
    const syntheticJob: GenerationJob = {
      id: `preview_${randomUUID().slice(0, 8)}`,
      parentJobId: null,
      projectId: null,
      userId: "preview",
      idempotencyKey: null,
      jobType: (params.jobType as GenerationJob["jobType"]) || "text_to_image",
      status: "queued",
      stage: null,
      priority: 5,
      providerId: null,
      workflowId: params.workflowId || "sdxl-text-to-image",
      workflowVersion: 1,
      modelId: params.modelId || null,
      prompt: params.prompt || "preview",
      negativePrompt: "",
      seed: 12345,
      resolvedSeed: 12345,
      width: params.width || 1024,
      height: params.height || 1024,
      batchSize: params.batchSize || 1,
      inputAssetIds: [],
      loras: [],
      parameters: {},
      stockMode: false,
      autoReview: false,
      autoMetadata: false,
      autoExport: false,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: 1,
      runAfterMs: 0,
      claimedBy: null,
      heartbeatMs: null,
      cancelRequested: false,
      cancelReason: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    };

    const requirement = resolveWorkloadRequirements(syntheticJob);
    const decision = await this.routeJob(syntheticJob, params.routingMode, currentLocalQueueDepth);
    return {
      requirements: requirement,
      decision,
      candidateScores: decision.alternatives,
    };
  }
}
