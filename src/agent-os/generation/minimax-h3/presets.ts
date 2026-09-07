// Phase 20.6 — H3 Preset System & Complexity Reduction.

import type { H3Mode, H3Preset, H3PresetConfig, H3ResolutionConfig, H3ResolutionPreset } from "./types";

export const BUILT_IN_PRESETS: Record<H3Preset, H3PresetConfig> = {
  QUALITY: {
    id: "QUALITY",
    name: "High Visual Quality",
    mode: "text_to_image",
    frameProfile: 5,
    samplingProfile: "BASE_QUALITY",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.65,
    stockSafe: true,
    description: "Maximum fidelity 5-frame packet with high-resolution sampling.",
  },
  BALANCED: {
    id: "BALANCED",
    name: "Balanced Production",
    mode: "text_to_image",
    frameProfile: 5,
    samplingProfile: "FL2VA_TURBO_8",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.6,
    turboAdapter: "fl2va_turbo_8",
    stockSafe: true,
    description: "Production balance between 8-step speed and visual clarity.",
  },
  FAST: {
    id: "FAST",
    name: "Quick Preview",
    mode: "text_to_image",
    frameProfile: 5,
    samplingProfile: "BASE_SPEED",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.55,
    stockSafe: true,
    description: "Low-latency preview sampling for rapid concept iteration.",
  },
  TURBO_FAST: {
    id: "TURBO_FAST",
    name: "Turbo Accelerated (4-Step)",
    mode: "image_to_image",
    frameProfile: 5,
    samplingProfile: "FL2VA_TURBO_4_768",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.5,
    turboAdapter: "fl2va_turbo_4",
    stockSafe: true,
    description: "Ultra-fast 4-step transformation for batch screening.",
  },
  REFERENCE_EDIT: {
    id: "REFERENCE_EDIT",
    name: "Multi-Reference Edit",
    mode: "reference_edit",
    frameProfile: 5,
    samplingProfile: "REF2VA_TURBO_4",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.58,
    turboAdapter: "ref2va_turbo_4",
    stockSafe: true,
    description: "Standard reference editing transferring identity, pose, and style.",
  },
  REFERENCE_EDIT_STRONG: {
    id: "REFERENCE_EDIT_STRONG",
    name: "Strong Identity Reference Edit",
    mode: "reference_edit",
    frameProfile: 9,
    samplingProfile: "REF2VA_TURBO_4",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.72,
    turboAdapter: "ref2va_turbo_4",
    stockSafe: true,
    description: "High source fidelity for strict face, pose, and garment preservation.",
  },
  DETAIL_REFINE: {
    id: "DETAIL_REFINE",
    name: "Qwen Detail Refinement & Tone Lock",
    mode: "detail_refiner",
    frameProfile: 1,
    samplingProfile: "CUSTOM",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.8,
    stockSafe: true,
    description: "Post-processing pass for eye, hand, edge, and texture correction.",
  },
  STOCK_SAFE: {
    id: "STOCK_SAFE",
    name: "Adobe Stock Commercial Grade",
    mode: "text_to_image",
    frameProfile: 5,
    samplingProfile: "BASE_QUALITY",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.65,
    stockSafe: true,
    description: "Strictly enforces commercial license validation, logo/watermark guards, and QC.",
  },
  EXPERIMENTAL_SINGLE: {
    id: "EXPERIMENTAL_SINGLE",
    name: "Experimental One-Frame Direct",
    mode: "text_to_image_single",
    frameProfile: 1,
    samplingProfile: "HYBRID_SINGLE",
    resolutionPreset: "NATIVE_DETAIL",
    defaultFidelity: 0.5,
    stockSafe: false,
    description: "Experimental single-frame architecture. Lab mode only; not approved for stock.",
  },
};

export function resolvePreset(preset: H3Preset): H3PresetConfig {
  const p = BUILT_IN_PRESETS[preset];
  if (!p) {
    return BUILT_IN_PRESETS.BALANCED;
  }
  return p;
}

export function listPresets(filters?: { mode?: H3Mode; stockSafeOnly?: boolean }): H3PresetConfig[] {
  let list = Object.values(BUILT_IN_PRESETS);
  if (filters?.mode) {
    list = list.filter((p) => p.mode === filters.mode);
  }
  if (filters?.stockSafeOnly) {
    list = list.filter((p) => p.stockSafe);
  }
  return list;
}

export function calculateDimensions(
  resolutionPreset: H3ResolutionPreset = "NATIVE_DETAIL",
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" = "1:1",
  custom?: { width?: number; height?: number },
): H3ResolutionConfig {
  if (resolutionPreset === "CUSTOM" && custom?.width && custom?.height) {
    const width = Math.round(custom.width / 64) * 64;
    const height = Math.round(custom.height / 64) * 64;
    return {
      preset: "CUSTOM",
      width,
      height,
      megapixels: Number(((width * height) / 1_000_000).toFixed(2)),
    };
  }

  // Base Native Detail ≈ 0.98 MP (~1024x960, 1024x1024, etc.)
  // 2 MP ≈ 1408x1408, 1920x1080
  const isTwoMp = resolutionPreset === "TWO_MP";

  let width = 1024;
  let height = 960;

  switch (aspectRatio) {
    case "1:1":
      width = isTwoMp ? 1440 : 1024;
      height = isTwoMp ? 1440 : 1024;
      break;
    case "16:9":
      width = isTwoMp ? 1920 : 1344;
      height = isTwoMp ? 1088 : 768;
      break;
    case "9:16":
      width = isTwoMp ? 1088 : 768;
      height = isTwoMp ? 1920 : 1344;
      break;
    case "4:3":
      width = isTwoMp ? 1664 : 1152;
      height = isTwoMp ? 1248 : 864;
      break;
    case "3:4":
      width = isTwoMp ? 1248 : 864;
      height = isTwoMp ? 1664 : 1152;
      break;
    case "3:2":
      width = isTwoMp ? 1728 : 1216;
      height = isTwoMp ? 1152 : 832;
      break;
    case "2:3":
      width = isTwoMp ? 1152 : 832;
      height = isTwoMp ? 1728 : 1216;
      break;
  }

  return {
    preset: resolutionPreset,
    width,
    height,
    megapixels: Number(((width * height) / 1_000_000).toFixed(2)),
  };
}
