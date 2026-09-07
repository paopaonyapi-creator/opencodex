// Local Media / Stock Footage Video Adapter
import type {
  VideoProductionAdapter,
  VideoProductionRequest,
  CostEstimate,
  ProviderSubmission,
  ProviderJobStatus,
  ProducedArtifact,
  VideoProviderCapabilities,
  ProviderHealthStatus,
} from "../domain/types";

export class LocalMediaAdapter implements VideoProductionAdapter {
  id = "local-media" as const;

  async healthCheck(): Promise<{ status: ProviderHealthStatus; latencyMs: number; error?: string }> {
    return { status: "healthy", latencyMs: 0 };
  }

  async getCapabilities(): Promise<VideoProviderCapabilities> {
    return {
      providerId: "local-media",
      available: true,
      displayName: "Local Media & Footage Assembler",
      textToVideo: false,
      imageToVideo: true,
      stockFootage: true,
      localMedia: true,
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      supportedResolutions: ["768P", "1080P", "2K", "4K"],
      minDurationSeconds: 1,
      maxDurationSeconds: 120,
      supportsAudio: true,
      supportsSubtitles: true,
      supportsBatch: true,
      supportsResume: true,
      requiresPaidConfirmation: false,
      estimatedCostPerSecondUsd: 0.0,
      health: "healthy",
    };
  }

  async estimate(_request: VideoProductionRequest): Promise<CostEstimate> {
    return {
      estimatedCostUsd: 0.0,
      currency: "USD",
      pricingSource: "rate_table",
      confidence: "high",
      observedAt: new Date().toISOString(),
      requiresApproval: false,
    };
  }

  async submit(request: VideoProductionRequest): Promise<ProviderSubmission> {
    const externalJobId = "local-media-" + Math.random().toString(36).slice(2, 10);
    return {
      success: true,
      externalJobId,
      providerId: "local-media",
      providerModel: "local-compositor",
      submittedAt: new Date().toISOString(),
      rawResponse: { mode: request.mode },
    };
  }

  async getStatus(externalJobId: string): Promise<ProviderJobStatus> {
    return {
      externalJobId,
      status: "completed",
      progress: 100,
      videoUrl: `storage/local-media/${externalJobId}.mp4`,
    };
  }

  async collectArtifacts(externalJobId: string): Promise<ProducedArtifact[]> {
    return [
      {
        type: "processed_video",
        localPath: `storage/local-media/${externalJobId}.mp4`,
        mimeType: "video/mp4",
      },
    ];
  }
}
