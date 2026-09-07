// Phase 20.5 — Freshness & Invalidation Engine

import { openAgentOsDb } from "../db";
import { getSource } from "./sources";

export type FreshnessLevel = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export interface FreshnessAssessment {
  level: FreshnessLevel;
  ageMs: number;
  isStale: boolean;
  reason: string;
}

// Domain freshness windows in milliseconds
const FRESHNESS_WINDOWS: Record<string, { freshMs: number; staleMs: number }> = {
  API: { freshMs: 7 * 86400 * 1000, staleMs: 30 * 86400 * 1000 },
  PHASE_SPEC: { freshMs: 14 * 86400 * 1000, staleMs: 60 * 86400 * 1000 },
  DECISION: { freshMs: 90 * 86400 * 1000, staleMs: 365 * 86400 * 1000 },
  RUNTIME: { freshMs: 3600 * 1000, staleMs: 86400 * 1000 },
  DEFAULT: { freshMs: 30 * 86400 * 1000, staleMs: 90 * 86400 * 1000 },
};

export function assessFreshness(lastModifiedOrIngestedIso?: string | null, domain = "DEFAULT"): FreshnessAssessment {
  if (!lastModifiedOrIngestedIso) {
    return { level: "UNKNOWN", ageMs: Infinity, isStale: true, reason: "No timestamp available" };
  }

  const then = new Date(lastModifiedOrIngestedIso).getTime();
  if (Number.isNaN(then)) {
    return { level: "UNKNOWN", ageMs: Infinity, isStale: true, reason: "Invalid timestamp" };
  }

  const now = Date.now();
  const ageMs = Math.max(0, now - then);
  const window = FRESHNESS_WINDOWS[domain] ?? FRESHNESS_WINDOWS.DEFAULT!;

  if (ageMs <= window.freshMs) {
    return { level: "FRESH", ageMs, isStale: false, reason: "Recently updated within fresh window" };
  }
  if (ageMs <= window.staleMs) {
    return { level: "AGING", ageMs, isStale: false, reason: "Aging knowledge, approaching verification limit" };
  }
  return { level: "STALE", ageMs, isStale: true, reason: "Exceeded freshness threshold; re-verification recommended" };
}

export function invalidateDownstreamWikiPages(sourceId: string): string[] {
  const db = openAgentOsDb();
  // Find all wiki pages linked to this source
  const linked = db.query(`
    SELECT page_id FROM wiki_source_links WHERE source_id = ?
  `).all(sourceId) as Array<{ page_id: string }>;

  const invalidatedIds: string[] = [];
  const now = new Date().toISOString();

  for (const item of linked) {
    db.query(`
      UPDATE wiki_pages
      SET status = 'STALE', updated_at = ?
      WHERE id = ? AND status = 'CURRENT'
    `).run(now, item.page_id);
    invalidatedIds.push(item.page_id);
  }

  return invalidatedIds;
}
