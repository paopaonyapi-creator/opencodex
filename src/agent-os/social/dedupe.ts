// Phase 20.20 — Layered cross-provider dedupe (spec section 31).
//
// Identity layers, most to least trustworthy:
//   1. platform + externalId
//   2. canonical URL (tracking params stripped, host lowercased)
//   3. normalized URL
//   4. conservative content fingerprint: platform + author + normalized text head +
//      publish date. Text similarity alone NEVER merges two posts.

import { canonicalizeUrl } from "./url-policy";
import type { NormalizedContentItem } from "./types";

function fingerprint(item: NormalizedContentItem): string | null {
  const text = (item.text ?? item.title ?? item.description ?? "").replace(/\s+/g, " ").trim().slice(0, 280).toLowerCase();
  if (!text) return null;
  const day = item.publishedAt ? item.publishedAt.slice(0, 10) : "";
  return [item.platform, item.authorExternalId ?? item.authorDisplayName ?? "", text, day].join("::");
}

/**
 * Marks duplicates by setting `duplicateOf` to the retained item's id. The first
 * occurrence in input order is retained; later duplicates are flagged, not dropped,
 * so per-run counts in the usage ledger stay faithful to what the provider returned.
 */
export function markDuplicates(items: NormalizedContentItem[]): void {
  const seenExternal = new Map<string, string>();
  const seenCanonical = new Map<string, string>();
  const seenFingerprint = new Map<string, string>();

  for (const item of items) {
    if (item.duplicateOf) continue; // already flagged upstream

    // Layer 1: platform + externalId.
    if (item.externalId) {
      const key = `${item.platform}::${item.externalId}`;
      const existing = seenExternal.get(key);
      if (existing) {
        item.duplicateOf = existing;
        continue;
      }
      seenExternal.set(key, item.id);
    }

    // Layer 2: canonical URL.
    const canonical = canonicalizeUrl(item.sourceUrl);
    if (canonical) {
      const existing = seenCanonical.get(canonical);
      if (existing) {
        item.duplicateOf = existing;
        continue;
      }
      seenCanonical.set(canonical, item.id);
    }

    // Layer 4: conservative content fingerprint (layer 3, raw normalized URL, is a
    // subset of the canonical key in practice and adds nothing here).
    const fp = fingerprint(item);
    if (fp) {
      const existing = seenFingerprint.get(fp);
      if (existing) {
        item.duplicateOf = existing;
        continue;
      }
      seenFingerprint.set(fp, item.id);
    }
  }
}
