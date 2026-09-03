// Adobe Stock Video Technical Validator
//
// Phase 16: Evaluates stock video clips against Adobe Stock requirements.
// Baseline: 5–60s duration, MOV/MP4/MPG containers, ProRes/H.264/H.265/AV1 codecs,
// standard frame rates (23.98, 24, 25, 29.97, 30, 50, 59.94, 60 fps).

import { ADOBE_STOCK_RULES, type AdobeStockRules } from "../config/adobe-stock-rules";

export interface VideoValidationInput {
  durationSeconds: number;
  container: string; // e.g. "mp4", "mov", "mpg", "video/mp4"
  codec: string; // e.g. "h264", "prores", "hevc", "av1"
  fps: number;
  width: number;
  height: number;
  fileSizeBytes?: number;
  bitrate?: number;
  audioCodec?: string | null;
}

export interface VideoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  details: {
    durationPass: boolean;
    containerPass: boolean;
    codecPass: boolean;
    frameRatePass: boolean;
    resolutionPass: boolean;
  };
}

export function validateStockVideo(
  input: VideoValidationInput,
  rules: AdobeStockRules = ADOBE_STOCK_RULES,
): VideoValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { durationSeconds, container, codec, fps, width, height, fileSizeBytes } = input;

  // 1. Duration check (5s to 60s)
  let durationPass = true;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    durationPass = false;
    errors.push(`Invalid video duration: ${durationSeconds}s`);
  } else if (durationSeconds < rules.video.minDurationSeconds) {
    durationPass = false;
    errors.push(
      `Duration too short: ${durationSeconds.toFixed(2)}s. Adobe Stock requires at least ${rules.video.minDurationSeconds}s.`,
    );
  } else if (durationSeconds > rules.video.maxDurationSeconds) {
    durationPass = false;
    errors.push(
      `Duration exceeds limit: ${durationSeconds.toFixed(2)}s. Adobe Stock maximum clip length is ${rules.video.maxDurationSeconds}s.`,
    );
  }

  // 2. Container check
  const normalizedContainer = container.toLowerCase().replace("video/", "").replace(".", "");
  const containerPass = rules.video.acceptedContainers.some((c) => normalizedContainer.includes(c));
  if (!containerPass) {
    errors.push(
      `Unsupported container format "${container}". Adobe Stock accepts: ${rules.video.acceptedContainers.join(", ")}.`,
    );
  }

  // 3. Codec check
  const normalizedCodec = codec.toLowerCase().trim();
  const codecPass = rules.video.acceptedCodecs.some((c) => normalizedCodec.includes(c));
  if (!codecPass) {
    errors.push(
      `Unsupported video codec "${codec}". Adobe Stock accepts: ${rules.video.acceptedCodecs.join(", ")}.`,
    );
  }

  // 4. Frame rate check (tolerance +/- 0.05 for fractional rates)
  const frameRatePass = rules.video.acceptedFrameRates.some(
    (target) => Math.abs(fps - target) <= 0.06,
  );
  if (!frameRatePass) {
    warnings.push(
      `Non-standard frame rate: ${fps.toFixed(2)} fps. Standard broadcast rates (${rules.video.acceptedFrameRates.join(", ")}) are recommended.`,
    );
  }

  // 5. Resolution check (minimum 720p / 1080p, standard 4K/UHD)
  let resolutionPass = true;
  if (width < 1280 || height < 720) {
    resolutionPass = false;
    errors.push(`Resolution too low: ${width}x${height}. Minimum recommended for stock video is 1280x720 (HD).`);
  }

  // 6. Optional file size check
  if (fileSizeBytes && fileSizeBytes > rules.video.maxFileSizeBytes) {
    const gb = (fileSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
    errors.push(`Video file size exceeds maximum limit (${gb}GB > 4GB).`);
  }

  const valid = durationPass && containerPass && codecPass && resolutionPass;

  return {
    valid,
    errors,
    warnings,
    details: {
      durationPass,
      containerPass,
      codecPass,
      frameRatePass,
      resolutionPass,
    },
  };
}
