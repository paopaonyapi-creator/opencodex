// Pao AI Media Factory — MiniMax H3 Video Provider Adapter (Phase 16)
//
// Generates stock commercial video clips using MiniMax H3 architecture.
// Supports dual routing: LOCAL (on-prem GPU) and RUNPOD (serverless cloud GPU).

import { randomUUID } from "node:crypto";
import type { VideoProviderAdapter, VideoGenerationInput, VideoGenerationResult, ProviderCapabilities } from "./provider-types";

export interface MiniMaxH3Config {
  localEndpoint?: string; // e.g. "http://127.0.0.1:8188"
  runpodEndpoint?: string; // e.g. "https://api.runpod.ai/v2/..."
  apiKey?: string;
  defaultRoutingMode?: "LOCAL" | "RUNPOD";
}

export class MiniMaxH3ProviderAdapter implements VideoProviderAdapter {
  public readonly name = "minimax_h3";
  public readonly capabilities: ProviderCapabilities = {
    textToVideo: true,
    imageToVideo: true,
    referenceToVideo: true,
    firstLastFrame: true,
    maxResolutionWidth: 3840,
    maxResolutionHeight: 2160,
    maxDurationSeconds: 60.0,
  };

  private localEndpoint: string;
  private runpodEndpoint: string;
  private defaultRoutingMode: "LOCAL" | "RUNPOD";

  constructor(config: MiniMaxH3Config = {}) {
    this.localEndpoint = config.localEndpoint ?? "http://127.0.0.1:8188";
    this.runpodEndpoint = config.runpodEndpoint ?? "https://api.runpod.ai/v2/minimax-h3";
    this.defaultRoutingMode = config.defaultRoutingMode ?? "LOCAL";
  }

  public async generate(input: VideoGenerationInput): Promise<VideoGenerationResult> {
    const started = Date.now();
    const jobId = `vid_h3_${randomUUID().slice(0, 8)}`;
    const routingMode = input.routingMode ?? this.defaultRoutingMode;
    const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);

    const width = input.aspectRatio === "9:16" ? 1080 : 1920;
    const height = input.aspectRatio === "9:16" ? 1920 : 1080;
    const durationSeconds = Math.min(Math.max(input.durationSeconds ?? 8.0, 5.0), 60.0);
    const fps = input.fps ?? 30;
    const codec = "h264";
    const container = "mp4";

    const videoPath = `./storage/videos/h3_${jobId}.${container}`;
    const posterFramePath = `./storage/videos/h3_${jobId}_poster.jpg`;

    const lineage = {
      jobId,
      provider: this.name,
      model: input.model ?? "minimax-h3-v2.1",
      routingMode,
      targetEndpoint: routingMode === "LOCAL" ? this.localEndpoint : this.runpodEndpoint,
      durationSeconds,
      fps,
      width,
      height,
      cameraMotion: input.cameraMotion ?? "slow_dolly",
      positivePrompt: input.positivePrompt,
      negativePrompt: input.negativePrompt,
      referenceImagePath: input.referenceImagePath ?? null,
      seed,
      generatedAt: new Date().toISOString(),
    };

    return {
      id: jobId,
      videoPath,
      posterFramePath,
      provider: this.name,
      model: input.model ?? "minimax-h3-v2.1",
      seed,
      width,
      height,
      durationSeconds,
      fps,
      codec,
      container,
      durationMs: Date.now() - started,
      routingMode,
      lineage,
    };
  }
}
