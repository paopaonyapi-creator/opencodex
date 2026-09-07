// Adobe Stock Video Policy Enforcer
import type { VideoProductionRequest } from "../domain/types";

export interface StockPolicyValidation {
  valid: boolean;
  violations: string[];
  enforcedAdjustments: Record<string, unknown>;
}

export function enforceAdobeStockPolicy(request: VideoProductionRequest): StockPolicyValidation {
  const violations: string[] = [];
  const enforcedAdjustments: Record<string, unknown> = {};

  if (request.mode === "adobe_stock") {
    // 1. Audio policies: Adobe Stock prefers clean video footage without music or voiceover
    if (request.voiceoverEnabled) {
      violations.push("Voiceover should be disabled in Adobe Stock mode (buyers require clean footage)");
      enforcedAdjustments.voiceoverEnabled = false;
    }
    if (request.subtitlesEnabled) {
      violations.push("Subtitles / burnt-in text are prohibited in Adobe Stock mode");
      enforcedAdjustments.subtitlesEnabled = false;
    }
    if (request.musicMode && request.musicMode !== "none") {
      violations.push("Background music must be none for stock video export to prevent copyright issues");
      enforcedAdjustments.musicMode = "none";
    }

    // 2. Technical specs
    if (request.targetDurationSeconds && (request.targetDurationSeconds < 4 || request.targetDurationSeconds > 60)) {
      violations.push("Adobe Stock duration must be between 4 and 60 seconds");
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    enforcedAdjustments,
  };
}
