// Phase 20.1 — Runtime Predictor
//
// Calculates expected execution runtime per job based on historical execution attempts,
// workflow categories, model architectures, video durations, and GPU profiles.

import { openAgentOsDb } from "../../db";
import type { GenerationJob } from "../types";
import type { PredictionConfidence, RuntimePrediction } from "./types";

export interface PredictorInput {
  workflowId?: string | null;
  modelId?: string | null;
  gpuType?: string | null;
  width?: number;
  height?: number;
  batchSize?: number;
  videoFrames?: number;
  durationSeconds?: number;
  loraCount?: number;
}

export class RuntimePredictor {
  /**
   * Predicts runtime for a given job and target GPU.
   */
  predict(input: PredictorInput): RuntimePrediction {
    const db = openAgentOsDb();
    const observedAt = new Date().toISOString();

    const workflowId = input.workflowId ?? "";
    const modelId = input.modelId ?? "";
    const gpuType = input.gpuType ?? "";
    const batchSize = Math.max(input.batchSize ?? 1, 1);
    const isVideo = Boolean(input.videoFrames && input.videoFrames > 1) || Boolean(input.durationSeconds && input.durationSeconds > 0) || workflowId.toLowerCase().includes("video");

    // 1. Exact Historical Match: workflow + model + gpuType in gen_execution_attempts
    if (workflowId && modelId && gpuType) {
      const exactRows = db.query(`
        SELECT runtime_seconds FROM gen_execution_attempts
        WHERE status = 'completed' AND instance_id LIKE ? AND gpu_type = ? AND runtime_seconds > 0
        ORDER BY completed_at DESC LIMIT 20
      `).all(`%${workflowId}%`, gpuType) as Array<{ runtime_seconds: number }>;

      if (exactRows.length >= 3) {
        const median = this.calculateMedian(exactRows.map(r => r.runtime_seconds));
        return {
          estimatedSeconds: Math.round(median * batchSize),
          confidence: "HIGH",
          sampleCount: exactRows.length,
          basis: `historical median of ${exactRows.length} runs on ${gpuType}`,
          observedAt,
        };
      }
    }

    // 2. Workflow + GPU Median
    if (workflowId && gpuType) {
      const wfGpuRows = db.query(`
        SELECT runtime_seconds FROM gen_execution_attempts
        WHERE status = 'completed' AND gpu_type = ? AND runtime_seconds > 0
        ORDER BY completed_at DESC LIMIT 20
      `).all(gpuType) as Array<{ runtime_seconds: number }>;

      if (wfGpuRows.length >= 2) {
        const median = this.calculateMedian(wfGpuRows.map(r => r.runtime_seconds));
        return {
          estimatedSeconds: Math.round(median * batchSize),
          confidence: "MEDIUM",
          sampleCount: wfGpuRows.length,
          basis: `historical median of ${wfGpuRows.length} runs on GPU ${gpuType}`,
          observedAt,
        };
      }
    }

    // 3. Workload Category Heuristic Baseline
    if (isVideo) {
      // Heavy video generation workload (e.g. MiniMax H3, CogVideo, AnimateDiff)
      const frameCount = input.videoFrames ?? (input.durationSeconds ? input.durationSeconds * 24 : 81);
      const baseVideoSeconds = Math.max(frameCount * 2.5, 180); // baseline ~180-240s
      return {
        estimatedSeconds: Math.round(baseVideoSeconds * batchSize),
        confidence: "MEDIUM",
        sampleCount: 1,
        basis: `workload class HEAVY_VIDEO heuristic (${frameCount} frames)`,
        observedAt,
      };
    }

    if (modelId.toLowerCase().includes("flux") || modelId.toLowerCase().includes("sd3")) {
      // 24GB+ dense transformer diffusion model
      return {
        estimatedSeconds: Math.round(45 * batchSize),
        confidence: "MEDIUM",
        sampleCount: 1,
        basis: "workload class DENSE_TRANSFORMER heuristic",
        observedAt,
      };
    }

    if (modelId.toLowerCase().includes("xl") || workflowId.toLowerCase().includes("sdxl")) {
      return {
        estimatedSeconds: Math.round(20 * batchSize),
        confidence: "MEDIUM",
        sampleCount: 1,
        basis: "workload class SDXL heuristic",
        observedAt,
      };
    }

    // Standard image fallback
    return {
      estimatedSeconds: Math.round(12 * batchSize),
      confidence: "LOW",
      sampleCount: 0,
      basis: "standard SD1.5/turbo default baseline",
      observedAt,
    };
  }

  /**
   * Predicts runtime directly from a GenerationJob record.
   */
  predictForJob(job: GenerationJob, gpuType?: string): RuntimePrediction {
    const isVideoWorkflow = job.workflowId?.toLowerCase().includes("video") ?? false;
    return this.predict({
      workflowId: job.workflowId,
      modelId: job.modelId,
      gpuType: gpuType ?? job.providerId,
      width: job.width,
      height: job.height,
      batchSize: job.batchSize,
      videoFrames: isVideoWorkflow ? 81 : 1,
      loraCount: job.loras?.length ?? 0,
    });
  }

  private calculateMedian(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
