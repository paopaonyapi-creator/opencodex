// Deterministic Mock MPT Provider for Testing & Offline Execution
import type {
  VideoProductionAdapter,
  VideoProductionRequest,
  CostEstimate,
  ProviderSubmission,
  ProviderJobStatus,
  ProducedArtifact,
  VideoProviderCapabilities,
  ProviderHealthStatus,
} from "../../domain/types";

export type MockBehavior =
  | "success"
  | "slow_success"
  | "fail_before_submit"
  | "fail_after_submit"
  | "rate_limit"
  | "poll_timeout"
  | "artifact_download_failure";

export class MockMptProvider implements VideoProductionAdapter {
  id = "mock-mpt" as const;
  private behavior: MockBehavior;
  private tasks = new Map<string, { attempts: number; request: VideoProductionRequest }>();

  constructor(behavior: MockBehavior = "success") {
    this.behavior = behavior;
  }

  setBehavior(b: MockBehavior): void {
    this.behavior = b;
  }

  async healthCheck(): Promise<{ status: ProviderHealthStatus; latencyMs: number; error?: string }> {
    if (this.behavior === "fail_before_submit") {
      return { status: "offline", latencyMs: 2, error: "Mock provider offline" };
    }
    return { status: "healthy", latencyMs: 1 };
  }

  async getCapabilities(): Promise<VideoProviderCapabilities> {
    return {
      providerId: "mock-mpt",
      available: true,
      displayName: "Mock MoneyPrinterTurbo Provider",
      textToVideo: true,
      imageToVideo: true,
      stockFootage: true,
      localMedia: true,
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      supportedResolutions: ["768P", "1080P", "2K"],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      supportsAudio: true,
      supportsSubtitles: true,
      supportsBatch: true,
      supportsResume: true,
      requiresPaidConfirmation: false,
      estimatedCostPerSecondUsd: 0.05,
      health: "healthy",
    };
  }

  async estimate(request: VideoProductionRequest): Promise<CostEstimate> {
    const duration = request.targetDurationSeconds || 8;
    const cost = duration * 0.05;
    return {
      estimatedCostUsd: Number(cost.toFixed(2)),
      currency: "USD",
      pricingSource: "rate_table",
      confidence: "high",
      observedAt: new Date().toISOString(),
      requiresApproval: cost > 1.0,
    };
  }

  async submit(request: VideoProductionRequest): Promise<ProviderSubmission> {
    if (this.behavior === "fail_before_submit") {
      return {
        success: false,
        externalJobId: "",
        providerId: "mock-mpt",
        submittedAt: new Date().toISOString(),
        error: "Capacity limit or provider unreachable before submission",
      };
    }

    if (this.behavior === "rate_limit") {
      return {
        success: false,
        externalJobId: "",
        providerId: "mock-mpt",
        submittedAt: new Date().toISOString(),
        error: "Rate limit exceeded (HTTP 429)",
      };
    }

    const taskId = "mock-task-" + Math.random().toString(36).slice(2, 10);
    this.tasks.set(taskId, { attempts: 0, request });

    return {
      success: true,
      externalJobId: taskId,
      providerId: "mock-mpt",
      providerModel: "metaso-minimax-h3",
      submittedAt: new Date().toISOString(),
      rawResponse: { mock: true, taskId },
    };
  }

  async getStatus(externalJobId: string): Promise<ProviderJobStatus> {
    if (this.behavior === "fail_after_submit") {
      return {
        externalJobId,
        status: "failed",
        error: "Generation sampler diverged after submission",
      };
    }

    if (this.behavior === "poll_timeout") {
      return {
        externalJobId,
        status: "running",
        progress: 30,
      };
    }

    const task = this.tasks.get(externalJobId);
    if (this.behavior === "slow_success" && task && task.attempts < 2) {
      task.attempts++;
      return {
        externalJobId,
        status: "running",
        progress: task.attempts * 45,
      };
    }

    return {
      externalJobId,
      status: "completed",
      progress: 100,
      videoUrl: "storage/mock-output.mp4",
      usage: { durationSeconds: 8, resolution: "1080P" },
    };
  }

  async recover(externalJobId: string): Promise<ProviderJobStatus> {
    return this.getStatus(externalJobId);
  }

  async collectArtifacts(externalJobId: string): Promise<ProducedArtifact[]> {
    if (this.behavior === "artifact_download_failure") {
      throw new Error("Artifact download checksum mismatch");
    }

    return [
      {
        type: "processed_video",
        localPath: `storage/production-jobs/${externalJobId}/video.mp4`,
        fileSizeBytes: 12582912,
        mimeType: "video/mp4",
      },
      {
        type: "preview_image",
        localPath: `storage/production-jobs/${externalJobId}/preview.jpg`,
        fileSizeBytes: 245760,
        mimeType: "image/jpeg",
      },
    ];
  }
}
