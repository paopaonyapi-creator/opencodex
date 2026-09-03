// Pao AI Media Factory — Unified Provider Types & Capabilities (Phase 16)
//
// Core abstraction interfaces for multi-model orchestration across Image, Video,
// and Text providers (OpenAI, Gemini, ComfyUI, MiniMax H3, Seedance, Local AI).

export type ProviderKind = "text" | "image" | "video";

export interface ProviderCapabilities {
  textToImage?: boolean;
  imageToImage?: boolean;
  transparentOutput?: boolean;
  referenceImage?: boolean;
  batch?: boolean;
  upscale?: boolean;
  textToVideo?: boolean;
  imageToVideo?: boolean;
  referenceToVideo?: boolean;
  firstLastFrame?: boolean;
  maxResolutionWidth?: number;
  maxResolutionHeight?: number;
  maxDurationSeconds?: number;
}

export type RoutingStrategy =
  | "CHEAP"
  | "BALANCED"
  | "QUALITY"
  | "LOCAL_FIRST"
  | "CLOUD_FIRST"
  | "CUSTOM";

export interface BudgetGuardConfig {
  maxGenerationsPerConcept: number;
  maxAutoRetries: number;
  maxCostPerBatchUsd?: number;
  maxConcurrentJobs: number;
}

export const DEFAULT_BUDGET_GUARD: BudgetGuardConfig = {
  maxGenerationsPerConcept: 8,
  maxAutoRetries: 2,
  maxCostPerBatchUsd: 15.0,
  maxConcurrentJobs: 4,
};

// ---------------------------------------------------------------------------
// Generation Inputs & Results
// ---------------------------------------------------------------------------

export interface TextGenerationInput {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface TextGenerationResult {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  durationMs: number;
}

export interface ImageGenerationInput {
  positivePrompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:5" | "3:2";
  outputType?: "jpeg" | "png";
  transparentBackground?: boolean;
  referenceImagePath?: string;
  batchCount?: number;
  seed?: number;
  model?: string;
  workflowId?: string;
}

export interface ImageGenerationResult {
  id: string;
  imagePaths: string[];
  provider: string;
  model: string;
  seed?: number;
  width: number;
  height: number;
  megapixels: number;
  format: "jpeg" | "png";
  hasAlpha: boolean;
  durationMs: number;
  lineage: Record<string, unknown>;
}

export interface VideoGenerationInput {
  positivePrompt: string;
  negativePrompt?: string;
  referenceImagePath?: string;
  lastFrameImagePath?: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  cameraMotion?: "slow_dolly" | "pan_left" | "pan_right" | "static" | "zoom_in";
  fps?: number;
  seed?: number;
  model?: string;
  routingMode?: "LOCAL" | "RUNPOD";
}

export interface VideoGenerationResult {
  id: string;
  videoPath: string;
  posterFramePath?: string;
  provider: string;
  model: string;
  seed?: number;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  codec: string;
  container: string;
  durationMs: number;
  routingMode: "LOCAL" | "RUNPOD";
  lineage: Record<string, unknown>;
}

export interface ImageProviderAdapter {
  name: string;
  capabilities: ProviderCapabilities;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

export interface VideoProviderAdapter {
  name: string;
  capabilities: ProviderCapabilities;
  generate(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}

export interface TextProviderAdapter {
  name: string;
  generate(input: TextGenerationInput): Promise<TextGenerationResult>;
}
