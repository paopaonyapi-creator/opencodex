// Phase 20.26 — Rights policy & the Adobe Stock hard boundary (doc §66, §67).
//
// Downloading a file does NOT imply commercial reuse rights. Every Douyin
// artifact is born research-only, ownership unknown, commercial reuse false.
// The mandatory rule: third-party Douyin media must NEVER flow into the Adobe
// Stock export queue directly — only abstract trend signals derived from
// analysis may feed original concept generation downstream.

import type { DouyinRights } from "./types";
import { DEFAULT_DOUYIN_RIGHTS } from "./types";

export type StockExportDecision =
  | { allowed: true; reason: string }
  | { allowed: false; code: "BLOCKED_BY_RIGHTS_POLICY"; reason: string };

export function defaultDouyinRights(): DouyinRights {
  return { ...DEFAULT_DOUYIN_RIGHTS };
}

/**
 * The hard boundary (spec §67/§100). Douyin-sourced artifacts are blocked
 * from stock export unless rights are explicitly verified as user-owned by
 * the existing rights policy — a state the pipeline does not create by
 * downloading. Analysis/trend signals derived from the same media are NOT
 * blocked: they are abstract insights, not repackaged source media.
 */
export function evaluateDouyinStockExport(input: {
  provider: string;
  rights?: DouyinRights;
  usageClass?: string;
}): StockExportDecision {
  if (input.provider !== "douyin") {
    return { allowed: true, reason: "not a douyin source; standard rights policy applies" };
  }
  const rights = input.rights ?? DEFAULT_DOUYIN_RIGHTS;
  if (input.usageClass === "production_derivative" && rights.ownership === "verified_user_owned" && !rights.researchOnly) {
    return { allowed: true, reason: "rights verified as user-owned by the rights policy" };
  }
  return {
    allowed: false,
    code: "BLOCKED_BY_RIGHTS_POLICY",
    reason: `third-party douyin media is research-only (ownership=${rights.ownership}); derive an original concept instead of exporting source media`,
  };
}

/** Does this artifact source belong to the Douyin family? */
export function isDouyinSource(sourcePlatform: string, sourceUrl?: string): boolean {
  const haystack = `${sourcePlatform} ${sourceUrl ?? ""}`.toLowerCase();
  return haystack.includes("douyin");
}
