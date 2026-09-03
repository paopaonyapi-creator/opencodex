// Adobe Stock Transparent PNG Technical Validator & Alpha Inspector
//
// Phase 16: Evaluates transparent PNG assets against Adobe Stock requirements.
// Baseline: PNG format, 4MP–100MP, max 45MB, sRGB, true alpha transparency,
// minimal excessive empty canvas, clean edges with no halo/fringe contamination.

import { ADOBE_STOCK_RULES, type AdobeStockRules } from "../config/adobe-stock-rules";

export interface AlphaStats {
  hasAlphaChannel: boolean;
  transparentPixelCount: number;
  totalPixelCount: number;
  transparentRatio: number; // 0.0 = fully solid, 1.0 = fully transparent
  subjectBounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
    areaRatio: number; // (subject width * height) / (canvas width * height)
  };
  edgeFringeScore?: number; // 0.0 to 1.0 (higher = more fringe/halo risk)
}

export interface PngValidationInput {
  width: number;
  height: number;
  fileSizeBytes: number;
  format: string; // e.g. "png", "image/png"
  colorProfile?: string;
  alphaStats?: Partial<AlphaStats>;
}

export interface PngValidationResult {
  valid: boolean;
  megapixels: number;
  errors: string[];
  warnings: string[];
  alphaPassed: boolean;
  details: {
    resolutionPass: boolean;
    fileSizePass: boolean;
    formatPass: boolean;
    alphaChannelPass: boolean;
    transparentRatioPass: boolean;
    subjectBoundingBoxPass: boolean;
    haloRiskPass: boolean;
  };
}

export function inspectAlphaChannel(
  stats: Partial<AlphaStats>,
  rules: AdobeStockRules = ADOBE_STOCK_RULES,
): { alphaPassed: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (stats.hasAlphaChannel === false) {
    errors.push("Missing alpha channel. Adobe Stock PNG mode requires true alpha transparency.");
    return { alphaPassed: false, errors, warnings };
  }

  const ratio =
    stats.transparentRatio ??
    (stats.totalPixelCount && stats.totalPixelCount > 0
      ? (stats.transparentPixelCount ?? 0) / stats.totalPixelCount
      : 0);

  if (ratio < rules.png.minTransparentRatio) {
    errors.push(
      `Image appears solid or has insufficient transparency (${(ratio * 100).toFixed(1)}% transparent). True transparent background is required.`,
    );
  } else if (ratio > rules.png.maxTransparentRatio) {
    errors.push(
      `Image is virtually empty (${(ratio * 100).toFixed(1)}% transparent). Meaningful subject content is required.`,
    );
  }

  if (stats.subjectBounds) {
    if (stats.subjectBounds.areaRatio < rules.png.minSubjectBoundingBoxRatio) {
      warnings.push(
        `Excessive empty canvas: Subject fills only ${(stats.subjectBounds.areaRatio * 100).toFixed(1)}% of canvas area. Cropping closer to subject is recommended.`,
      );
    }
  }

  if (stats.edgeFringeScore !== undefined && stats.edgeFringeScore > rules.png.maxHaloTolerance) {
    warnings.push(
      `Potential edge halo / color contamination detected (score: ${stats.edgeFringeScore.toFixed(2)} > tolerance: ${rules.png.maxHaloTolerance}). Review transparent silhouette against multi-color backgrounds.`,
    );
  }

  const alphaPassed = errors.length === 0;
  return { alphaPassed, errors, warnings };
}

export function validateStockPng(
  input: PngValidationInput,
  rules: AdobeStockRules = ADOBE_STOCK_RULES,
): PngValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { width, height, fileSizeBytes, format, colorProfile = "sRGB", alphaStats } = input;

  // 1. Resolution
  const megapixels = Number(((width * height) / 1_000_000).toFixed(2));
  let resolutionPass = true;

  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    resolutionPass = false;
    errors.push(`Invalid image dimensions: ${width}x${height}`);
  } else if (megapixels < rules.png.minMegapixels) {
    resolutionPass = false;
    errors.push(
      `Resolution too low: ${megapixels}MP (${width}x${height}). Adobe Stock PNG requires at least ${rules.png.minMegapixels}MP.`,
    );
  } else if (megapixels > rules.png.maxMegapixels) {
    resolutionPass = false;
    errors.push(
      `Resolution exceeds limit: ${megapixels}MP (${width}x${height}). Adobe Stock PNG maximum is ${rules.png.maxMegapixels}MP.`,
    );
  }

  // 2. File size
  let fileSizePass = true;
  if (fileSizeBytes <= 0 || !Number.isFinite(fileSizeBytes)) {
    fileSizePass = false;
    errors.push("Invalid file size (0 or non-numeric bytes)");
  } else if (fileSizeBytes > rules.png.maxFileSizeBytes) {
    fileSizePass = false;
    const mb = (fileSizeBytes / (1024 * 1024)).toFixed(2);
    const maxMb = (rules.png.maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    errors.push(`File size exceeds limit: ${mb}MB. Adobe Stock PNG maximum is ${maxMb}MB.`);
  }

  // 3. Format
  const normalizedFormat = format.toLowerCase().replace("image/", "").replace(".", "");
  const formatPass = normalizedFormat === rules.png.acceptedFormat;
  if (!formatPass) {
    errors.push(`Unsupported format "${format}". Stock PNG mode requires PNG format.`);
  }

  // 4. Color profile
  if (colorProfile && !colorProfile.toLowerCase().includes("srgb")) {
    warnings.push(`Non-sRGB color profile detected (${colorProfile}). sRGB is strongly recommended for Adobe Stock.`);
  }

  // 5. Alpha inspection
  let alphaChannelPass = true;
  let transparentRatioPass = true;
  let subjectBoundingBoxPass = true;
  let haloRiskPass = true;

  if (alphaStats) {
    const alphaResult = inspectAlphaChannel(alphaStats, rules);
    if (!alphaResult.alphaPassed) {
      errors.push(...alphaResult.errors);
      if (alphaStats.hasAlphaChannel === false) alphaChannelPass = false;
      if (
        alphaStats.transparentRatio !== undefined &&
        (alphaStats.transparentRatio < rules.png.minTransparentRatio ||
          alphaStats.transparentRatio > rules.png.maxTransparentRatio)
      ) {
        transparentRatioPass = false;
      }
    }
    warnings.push(...alphaResult.warnings);

    if (
      alphaStats.subjectBounds &&
      alphaStats.subjectBounds.areaRatio < rules.png.minSubjectBoundingBoxRatio
    ) {
      subjectBoundingBoxPass = false;
    }
    if (alphaStats.edgeFringeScore !== undefined && alphaStats.edgeFringeScore > rules.png.maxHaloTolerance) {
      haloRiskPass = false;
    }
  }

  const valid = resolutionPass && fileSizePass && formatPass && alphaChannelPass && transparentRatioPass;

  return {
    valid,
    megapixels,
    errors,
    warnings,
    alphaPassed: alphaChannelPass && transparentRatioPass,
    details: {
      resolutionPass,
      fileSizePass,
      formatPass,
      alphaChannelPass,
      transparentRatioPass,
      subjectBoundingBoxPass,
      haloRiskPass,
    },
  };
}
