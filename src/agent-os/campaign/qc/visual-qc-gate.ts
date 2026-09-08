// Pao Stock Autonomous Campaign Planner — Visual QC Gate (Phase 21)
//
// Enforces technical stock quality benchmarks: minimum resolution (4MP+),
// aspect ratio compliance, optical sharpness scoring, and artifact penalties.

export interface VisualQcInput {
  assetType: "video_4k" | "photo_raw" | "isolated_element";
  width: number;
  height: number;
  aspectRatio?: string;
  hasAlphaChannel?: boolean;
  rawMetrics?: {
    blurEstimate?: number; // 0 (crisp) to 1 (blurry)
    compressionArtifacts?: number; // 0 (clean) to 1 (heavy compression)
    colorBanding?: number; // 0 to 1
  };
}

export interface VisualQcResult {
  valid: boolean;
  sharpnessScore: number; // [0, 100]
  artifactPenalty: number; // [0, 50]
  megapixels: number;
  errors: string[];
  warnings: string[];
}

const VALID_ASPECT_RATIOS = new Set(["16:9", "3:2", "2:3", "1:1", "4:5", "9:16", "4:3"]);

/**
 * Validates technical visual criteria required by Adobe Stock and high-tier agencies.
 */
export function evaluateVisualQc(input: VisualQcInput): VisualQcResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { width, height, assetType } = input;

  const mp = Number(((width * height) / 1_000_000).toFixed(2));

  // 1. Resolution Check
  if (assetType === "photo_raw" || assetType === "isolated_element") {
    // Adobe Stock rule: minimum 4MP
    if (mp < 4.0) {
      errors.push(`Resolution ${width}x${height} (${mp} MP) is below Adobe Stock minimum of 4.0 MP`);
    } else if (mp < 8.0) {
      warnings.push(`Resolution (${mp} MP) is acceptable but 8.0 MP+ is recommended for hero placement`);
    }
  } else if (assetType === "video_4k") {
    if (width < 1920 || height < 1080) {
      errors.push(`Video resolution ${width}x${height} is below standard 1080p full HD requirement`);
    }
  }

  // 2. Aspect Ratio Check
  if (input.aspectRatio && !VALID_ASPECT_RATIOS.has(input.aspectRatio)) {
    warnings.push(`Aspect ratio ${input.aspectRatio} is non-standard for commercial stock`);
  }

  // 3. Sharpness Score Calculation (0 - 100)
  const blur = input.rawMetrics?.blurEstimate ?? 0.10;
  let sharpness = Math.round(100 - blur * 80);
  if (mp >= 8.0) sharpness = Math.min(100, sharpness + 5);
  sharpness = Math.max(0, Math.min(100, sharpness));

  // 4. Artifact Penalty Calculation (0 - 50)
  const comp = input.rawMetrics?.compressionArtifacts ?? 0.05;
  const banding = input.rawMetrics?.colorBanding ?? 0.05;
  const artifactPenalty = Math.min(50, Math.round((comp * 35) + (banding * 25)));

  if (artifactPenalty > 25) {
    errors.push(`Excessive compression artifacts or color banding detected (penalty: ${artifactPenalty})`);
  } else if (artifactPenalty > 15) {
    warnings.push(`Mild artifacts detected (penalty: ${artifactPenalty})`);
  }

  const valid = errors.length === 0 && sharpness >= 65 && artifactPenalty <= 25;

  return {
    valid,
    sharpnessScore: sharpness,
    artifactPenalty,
    megapixels: mp,
    errors,
    warnings,
  };
}
