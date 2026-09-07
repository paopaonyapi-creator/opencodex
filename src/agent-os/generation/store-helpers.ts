// Phase 19 — Thin accessors the management routes consume, plus the small
// favorite/rating patch the gallery needs. Single import source for routes.

import { openAgentOsDb } from "../db";
import { LocalAssetStorage, listAssets as listAssetsImpl, listProjects as listProjectsImpl, upsertProject as upsertProjectImpl, type ListAssetsOptions } from "./storage";
import type { GeneratedAsset } from "./types";

const assetStore = new LocalAssetStorage({ root: "./data/generation" });

export function listAssets(options: ListAssetsOptions = {}): { assets: GeneratedAsset[]; total: number } {
  return listAssetsImpl(options);
}

export function getAssetRecord(id: string): GeneratedAsset | null {
  return assetStore.getAsset(id);
}

export function softDeleteAsset(id: string): boolean {
  return assetStore.softDeleteAsset(id);
}

export { listProjectsImpl as listProjects, upsertProjectImpl as upsertProject };

export function updateAssetFavoriteRating(id: string, patch: { favorite?: boolean; userRating?: number | null }): GeneratedAsset | null {
  const sets: string[] = ["updated_at = ?"];
  const params: Array<string | number | boolean | null> = [new Date().toISOString()];
  if (patch.favorite !== undefined) { sets.push("favorite = ?"); params.push(patch.favorite ? 1 : 0); }
  if (patch.userRating !== undefined) {
    const rating = patch.userRating === null ? null : Math.min(Math.max(Math.round(patch.userRating), 1), 5);
    sets.push("user_rating = ?");
    params.push(rating);
  }
  const result = openAgentOsDb()
    .query(`UPDATE gen_assets SET ${sets.join(", ")} WHERE id = ? AND deleted = 0`)
    .run(...params, id);
  if (result.changes === 0) return null;
  return assetStore.getAsset(id);
}
