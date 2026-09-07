// MoneyPrinterTurbo Production Video Adapter
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
import { MptClient } from "./mpt-client";
import { MptRuntimeManager } from "./mpt-runtime";
import type { MptApiTaskRequest } from "./mpt-types";

export class MoneyPrinterTurboAdapter implements VideoProductionAdapter {
  id = "moneyprinterturbo" as const;
  private runtime: MptRuntimeManager;
  private client: MptClient;

  constructor(runtime?: MptRuntimeManager) {
    this.runtime = runtime || new MptRuntimeManager();
    this.client = this.runtime.getClient();
  }

  async healthCheck(): Promise<{ status: ProviderHealthStatus; latencyMs: number; error?: string }> {
    const res = await this.runtime.probeHealth();
    return { status: res.status, latencyMs: res.latencyMs, error: res.error };
  }

  async getCapabilities(): Promise<VideoProviderCapabilities> {
    const health = await this.healthCheck();
    return {
      providerId: "moneyprinterturbo",
      available: health.status === "healthy" || health.status === "degraded",
      displayName: "MoneyPrinterTurbo Native Video Engine",
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
      requiresPaidConfirmation: true,
      estimatedCostPerSecondUsd: 0.08,
      health: health.status,
    };
  }

  async estimate(request: VideoProductionRequest): Promise<CostEstimate> {
    const duration = request.targetDurationSeconds || 8;
    const ratePerSec = 0.08;
    const estimatedCostUsd = Number((duration * ratePerSec).toFixed(2));
    return {
      estimatedCostUsd,
      currency: "USD",
      pricingSource: "rate_table",
      confidence: "medium",
      observedAt: new Date().toISOString(),
      requiresApproval: estimatedCostUsd > 0.5,
    };
  }

  async submit(request: VideoProductionRequest): Promise<ProviderSubmission> {
    let source: MptApiTaskRequest["video_source"] = "metaso_minimax";
    if (request.providerPreference && request.providerPreference.length > 0) {
      const pref = request.providerPreference[0];
      if (pref === "seedance") source = "ark_seedance";
      else if (pref === "ofox-wan") source = "ofox";
      else if (pref === "local-media") source = "local";
      else if (pref === "stock-footage") source = "pexels";
    }

    const taskReq: MptApiTaskRequest = {
      video_subject: request.prompt,
      video_script: request.script,
      video_aspect: request.aspectRatio,
      video_source: source,
      enable_voice: request.voiceoverEnabled ?? false,
      enable_subtitle: request.subtitlesEnabled ?? false,
      bgm_type: request.musicMode === "none" ? "none" : "custom",
      video_duration: request.targetDurationSeconds,
      video_resolution: request.resolution,
    };

    try {
      const res = await this.client.createTask(taskReq);
      if (res.code !== 200 || !res.data?.task_id) {
        return {
          success: false,
          externalJobId: "",
          providerId: "moneyprinterturbo",
          submittedAt: new Date().toISOString(),
          error: res.message || "Failed to enqueue task in MPT",
        };
      }

      return {
        success: true,
        externalJobId: res.data.task_id,
        providerId: "moneyprinterturbo",
        providerModel: source,
        submittedAt: new Date().toISOString(),
        rawResponse: res.data as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      return {
        success: false,
        externalJobId: "",
        providerId: "moneyprinterturbo",
        submittedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getStatus(externalJobId: string): Promise<ProviderJobStatus> {
    try {
      const res = await this.client.getTaskStatus(externalJobId);
      const state = res.data?.state;

      let status: ProviderJobStatus["status"] = "running";
      if (state === "queued") status = "submitting";
      else if (state === "processing") status = "running";
      else if (state === "success") status = "completed";
      else if (state === "failed") status = "failed";

      return {
        externalJobId,
        status,
        progress: res.data?.progress ?? (status === "completed" ? 100 : 50),
        videoUrl: res.data?.video_url,
        error: res.data?.error,
        usage: {
          cost: res.data?.actual_cost ?? res.data?.cost_estimate,
        },
      };
    } catch (err: unknown) {
      return {
        externalJobId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async cancel(externalJobId: string): Promise<void> {
    await this.client.cancelTask(externalJobId);
  }

  async recover(externalJobId: string): Promise<ProviderJobStatus> {
    return this.getStatus(externalJobId);
  }

  async collectArtifacts(externalJobId: string): Promise<ProducedArtifact[]> {
    const status = await this.getStatus(externalJobId);
    if (status.status !== "completed" || !status.videoUrl) {
      throw new Error(`Cannot collect artifacts for non-completed job ${externalJobId}`);
    }

    return [
      {
        type: "processed_video",
        localPath: status.videoUrl,
        mimeType: "video/mp4",
      },
    ];
  }
}
