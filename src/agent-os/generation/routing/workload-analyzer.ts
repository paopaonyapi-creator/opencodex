// Phase 20 — Workload Requirement Analyzer.
//
// Inspects a generation job, its workflow bindings, model requirements,
// and parameters to derive minimum VRAM, runtime estimates, and workload class.

import type { GenerationJob, WorkloadRequirement, WorkloadClass } from "../types";
import { getWorkflow, getModel } from "../registry";

export interface AnalyzerOptions {
  vramSafetyMarginGb?: number;
  localGpuVramGb?: number;
}

export function classifyWorkload(job: GenerationJob): WorkloadClass {
  const isVideo = job.jobType === "text_to_video" || job.jobType === "image_to_video";
  const isAudio = job.jobType === "audio_generation";
  const isUpscale = job.jobType === "image_upscale";
  const totalPixels = (job.width || 1024) * (job.height || 1024) * (job.batchSize || 1);

  if (isVideo) {
    return totalPixels > 1920 * 1080 ? "HEAVY_VIDEO" : "LIGHT_VIDEO";
  }
  if (isAudio) return "AUDIO";
  if (isUpscale) return "UPSCALE_IMAGE";
  if (job.batchSize > 4 || totalPixels > 2048 * 2048) return "HEAVY_IMAGE";
  if (totalPixels > 1024 * 1024) return "STANDARD_IMAGE";
  return "LIGHT_IMAGE";
}

export function estimateJobRuntimeSeconds(requirement: {
  workloadClass: WorkloadClass;
  width: number;
  height: number;
  batchSize: number;
}): number {
  const pixels = requirement.width * requirement.height;
  const mp = pixels / 1_000_000;
  const batch = requirement.batchSize || 1;

  switch (requirement.workloadClass) {
    case "LIGHT_IMAGE":
      return Math.max(3, Math.round(4 * batch));
    case "STANDARD_IMAGE":
      return Math.max(5, Math.round(6 * mp * batch));
    case "HEAVY_IMAGE":
      return Math.max(12, Math.round(10 * mp * batch));
    case "UPSCALE_IMAGE":
      return Math.max(8, Math.round(8 * mp * batch));
    case "LIGHT_VIDEO":
      return 30;
    case "HEAVY_VIDEO":
      return 120;
    case "VIDEO_UPSCALE":
      return 90;
    case "AUDIO":
      return 15;
    default:
      return 10;
  }
}

export function resolveWorkloadRequirements(
  job: GenerationJob,
  options: AnalyzerOptions = {},
): WorkloadRequirement {
  const safetyMargin = options.vramSafetyMarginGb ?? 2;
  const workflow = job.workflowId ? getWorkflow(job.workflowId, job.workflowVersion ?? undefined) : null;
  const model = job.modelId ? getModel(job.modelId) : null;

  const workloadClass = classifyWorkload(job);

  // Workflow minimum VRAM
  const wfMinVram = workflow?.minVramGb ?? (
    workloadClass === "HEAVY_VIDEO" ? 24 :
    workloadClass === "LIGHT_VIDEO" ? 16 :
    workloadClass === "HEAVY_IMAGE" ? 16 :
    workloadClass === "STANDARD_IMAGE" ? 12 : 8
  );

  // Model minimum VRAM
  const modelMinVram = model?.minVramGb ?? 8;
  const modelPrefVram = model?.recommendedVramGb ?? 16;

  // Total required VRAM with safety margin (spec section 21)
  const baseVram = Math.max(wfMinVram, modelMinVram);
  const minVramGb = Math.max(baseVram, baseVram + safetyMargin);
  const preferredVramGb = Math.max(minVramGb, modelPrefVram + safetyMargin);

  const estimatedRuntimeSeconds = estimateJobRuntimeSeconds({
    workloadClass,
    width: job.width,
    height: job.height,
    batchSize: job.batchSize,
  });

  const estimatedInputBytes = 100_000 + (job.inputAssetIds?.length ?? 0) * 5_000_000;
  const estimatedOutputBytes = Math.round((job.width * job.height * 4 * (job.batchSize || 1)) * 0.4);

  return {
    jobId: job.id,
    workflowId: job.workflowId,
    modelId: job.modelId,
    jobType: job.jobType,
    workloadClass,
    minVramGb,
    preferredVramGb,
    gpuCount: 1,
    minCuda: true,
    requiredModels: job.modelId ? [job.modelId] : [],
    requiredLoras: (job.loras ?? []).map(l => l.id),
    requiredCustomNodes: [],
    estimatedRuntimeSeconds,
    estimatedInputBytes,
    estimatedOutputBytes,
    priority: job.priority ?? 5,
    stockMode: job.stockMode ?? false,
    requiresPersistentCache: workloadClass === "HEAVY_VIDEO" || workloadClass === "VIDEO_UPSCALE",
  };
}
