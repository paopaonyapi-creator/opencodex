// Pao Stock Autonomous Campaign Planner — Dynamic Portfolio Allocator (Phase 21)
//
// Calculates optimal asset ratios (video_4k, photo_raw, isolated_element)
// based on market search velocity, category commercial profile, and target count.

import type { AssetType } from "../types";

export interface PortfolioAllocationInput {
  targetAssetCount: number;
  category?: string;
  searchVelocity?: number; // [0, 1]
  commercialIntent?: number; // [0, 1]
}

export interface PortfolioAllocation {
  targetAssetCount: number;
  videoCount: number;
  photoCount: number;
  isolatedCount: number;
  ratios: {
    video: number;
    photo: number;
    isolated: number;
  };
  recommendedAspectRatios: string[];
  distribution: AssetType[];
}

/**
 * Computes optimal asset distribution across media formats.
 */
export function allocatePortfolioRatios(input: PortfolioAllocationInput): PortfolioAllocation {
  const total = Math.max(1, Math.min(100, Math.floor(input.targetAssetCount || 10)));
  const velocity = input.searchVelocity ?? 0.70;
  const category = input.category ?? "general";

  // High velocity or tech/mobility favors video assets
  let videoRatio = 0.30;
  let isolatedRatio = 0.20;

  if (velocity >= 0.85 || category === "sustainable_mobility" || category === "robotics") {
    videoRatio = 0.40;
    isolatedRatio = 0.20;
  } else if (category === "agritech" || category === "clean_tech") {
    videoRatio = 0.30;
    isolatedRatio = 0.20;
  } else if (category === "fintech") {
    videoRatio = 0.20;
    isolatedRatio = 0.30; // High demand for isolated icons and terminal mockups
  }

  const photoRatio = Number((1.0 - videoRatio - isolatedRatio).toFixed(2));

  // Compute absolute counts
  let videoCount = Math.round(total * videoRatio);
  let isolatedCount = Math.round(total * isolatedRatio);
  let photoCount = total - videoCount - isolatedCount;

  // Safeguards to ensure photo count is positive and total matches
  if (photoCount < 1 && total >= 3) {
    photoCount = 1;
    if (videoCount > isolatedCount) videoCount--;
    else isolatedCount--;
  }

  // Construct flat distribution list
  const distribution: AssetType[] = [];
  for (let i = 0; i < videoCount; i++) distribution.push("video_4k");
  for (let i = 0; i < photoCount; i++) distribution.push("photo_raw");
  for (let i = 0; i < isolatedCount; i++) distribution.push("isolated_element");

  return {
    targetAssetCount: total,
    videoCount,
    photoCount,
    isolatedCount,
    ratios: {
      video: Number((videoCount / total).toFixed(2)),
      photo: Number((photoCount / total).toFixed(2)),
      isolated: Number((isolatedCount / total).toFixed(2)),
    },
    recommendedAspectRatios: ["16:9", "3:2", "1:1"],
    distribution,
  };
}
