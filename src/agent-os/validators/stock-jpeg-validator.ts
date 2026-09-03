// Adobe Stock JPEG Technical Validator
//
// Phase 16: Evaluates JPEG photo/illustration assets against current Adobe Stock requirements.
// Baseline: 4MP–100MP resolution, max 45MB file size, sRGB color profile.

import { ADOBE_STOCK_RULES, type AdobeStockRules } from "../config/adobe-stock-rules";

export interface JpegValidationInput {
  width: number;
  height: number;
  fileSizeBytes: number;
  format: string; // e.g. "jpg", "jpeg", "image/jpeg"
  colorProfile?: string; // e.g. "sRGB", "Display P3", "Adobe RGB"
}

export interface JpegValidationResult {
  valid: boolean;
  megapixels: number;
  errors: string[];
  warnings: string[];
  details: {
    resolutionPass: boolean;
    fileSizePass: boolean;
    formatPass: boolean;
    colorProfilePass: boolean;
  };
}

export function validateStockJpeg(
  input: JpegValidationInput,
  rules: AdobeStockRules = ADOBE_STOCK_RULES,
): JpegValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { width, height, fileSizeBytes, format, colorProfile = "sRGB" } = input;

  // 1. Resolution & Megapixel calculation (round to 2 decimals)
  const megapixels = Number(((width * height) / 1_000_000).toFixed(2));
  let resolutionPass = true;

  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    resolutionPass = false;
    errors.push(`Invalid image dimensions: ${width}x${height}`);
  } else if (megapixels < rules.image.minMegapixels) {
    resolutionPass = false;
    errors.push(
      `Resolution too low: ${megapixels}MP (${width}x${height}). Adobe Stock requires at least ${rules.image.minMegapixels}MP.`,
    );
  } else if (megapixels > rules.image.maxMegapixels) {
    resolutionPass = false;
    errors.push(
      `Resolution exceeds limit: ${megapixels}MP (${width}x${height}). Adobe Stock maximum is ${rules.image.maxMegapixels}MP.`,
    );
  }

  // 2. File size validation
  let fileSizePass = true;
  if (fileSizeBytes <= 0 || !Number.isFinite(fileSizeBytes)) {
    fileSizePass = false;
    errors.push("Invalid file size (0 or non-numeric bytes)");
  } else if (fileSizeBytes > rules.image.maxFileSizeBytes) {
    fileSizePass = false;
    const mb = (fileSizeBytes / (1024 * 1024)).toFixed(2);
    const maxMb = (rules.image.maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    errors.push(`File size exceeds limit: ${mb}MB. Adobe Stock maximum is ${maxMb}MB.`);
  }

  // 3. Format validation
  const normalizedFormat = format.toLowerCase().replace("image/", "").replace(".", "");
  const formatPass = rules.image.acceptedFormats.includes(normalizedFormat);
  if (!formatPass) {
    errors.push(
      `Unsupported format "${format}". Adobe Stock photo/illustration requires JPEG (${rules.image.acceptedFormats.join(", ")}).`,
    );
  }

  // 4. Color profile validation
  let colorProfilePass = true;
  if (colorProfile && !colorProfile.toLowerCase().includes("srgb")) {
    colorProfilePass = false;
    warnings.push(`Non-sRGB color profile detected (${colorProfile}). sRGB is strongly recommended for Adobe Stock.`);
  }

  return {
    valid: resolutionPass && fileSizePass && formatPass,
    megapixels,
    errors,
    warnings,
    details: {
      resolutionPass,
      fileSizePass,
      formatPass,
      colorProfilePass,
    },
  };
}
