// Rights & Commercial Redistribution Policy Gate
import type { VideoProductionRequest, ProductionMode } from "../domain/types";

export interface RightsGateResult {
  passed: boolean;
  rightsStatus: "VERIFIED" | "UNKNOWN" | "HOLD";
  reason?: string;
}

export function evaluateRightsPolicy(
  mode: ProductionMode,
  request: VideoProductionRequest,
  sourceType: "ai_generated" | "stock_footage" | "local_media",
  footageSource?: string,
): RightsGateResult {
  // AI-generated footage generated locally or via licensed API is commercially redistributable
  if (sourceType === "ai_generated") {
    return { passed: true, rightsStatus: "VERIFIED" };
  }

  // Local media created by operator
  if (sourceType === "local_media") {
    return { passed: true, rightsStatus: "VERIFIED" };
  }

  // Third-party stock footage: Pexels, Pixabay, Coverr
  if (sourceType === "stock_footage" || footageSource) {
    if (mode === "adobe_stock") {
      return {
        passed: false,
        rightsStatus: "HOLD",
        reason: `Third-party stock footage (${footageSource || "stock provider"}) is blocked from Adobe Stock export without explicit commercial resale clearance`,
      };
    }

    // Social or internal mode allows free stock footage
    return {
      passed: true,
      rightsStatus: "VERIFIED",
      reason: "Allowed for social/internal mode under standard creative commons / free terms",
    };
  }

  return { passed: true, rightsStatus: "VERIFIED" };
}

export function evaluateStockFootageRights(
  source: string,
  _license?: string,
  redistributionPermitted?: boolean,
): { permitted: boolean; reason: string } {
  if (redistributionPermitted) {
    return { permitted: true, reason: "Explicit commercial resale clearance granted." };
  }
  const clean = source.toLowerCase();
  if (clean.includes("pexels") || clean.includes("pixabay") || clean.includes("coverr")) {
    return {
      permitted: false,
      reason: `Third-party stock footage (${source}) does not permit direct redistribution or resale as stock media without modified ownership clearance.`,
    };
  }
  return { permitted: true, reason: "Rights verified." };
}
