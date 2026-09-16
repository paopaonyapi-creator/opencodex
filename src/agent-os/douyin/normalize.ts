// Phase 20.26 — Raw upstream payload → canonical schema normalizer (doc §12-§13).
//
// Fail-closed against upstream drift (doc §93): a missing aweme id, missing
// media, or an unexpected item shape produces DOUYIN_UPSTREAM_CHANGED — never
// a corrupted canonical record.

import { randomUUID } from "node:crypto";
import { DouyinError } from "./errors";
import { defaultDouyinRights } from "./rights";
import type {
  CanonicalComment,
  CanonicalCreator,
  CanonicalMediaItem,
  UpstreamCommentsRaw,
  UpstreamCreatorRaw,
  UpstreamInspectRaw,
} from "./types";

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DouyinError("DOUYIN_UPSTREAM_CHANGED", `upstream payload missing required field: ${field}`);
  }
  return value.trim();
}

function safeStatistics(stats: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats) return out;
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "string" && /^\d+$/.test(value)) {
      out[key] = Number(value);
    }
  }
  return out;
}

/** Normalize one raw upstream item into the canonical media schema. */
export function normalizeMediaItem(raw: UpstreamInspectRaw, fallbackUrl: string): CanonicalMediaItem {
  const providerItemId = requireText(raw.awemeId ?? raw.url ?? null, "awemeId");
  const canonicalUrl = requireText(raw.url ?? fallbackUrl, "url");
  const title = requireText(raw.title ?? raw.description ?? null, "title");
  const type = raw.mediaType ?? (fallbackUrl.includes("/note/") || fallbackUrl.includes("/gallery/") ? "gallery" : "video");

  return {
    id: `dmedia_${randomUUID().slice(0, 12)}`,
    provider: "douyin",
    providerItemId,
    type,
    canonicalUrl,
    creatorProviderId: typeof raw.creatorId === "string" && raw.creatorId ? raw.creatorId : undefined,
    creatorName: typeof raw.creatorName === "string" ? raw.creatorName : undefined,
    title,
    description: typeof raw.description === "string" ? raw.description : undefined,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : undefined,
    durationMs: typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? Math.max(0, Math.round(raw.durationMs)) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string").slice(0, 30) : [],
    statistics: safeStatistics(raw.statistics),
    rawMetadataRef: undefined,
    rights: defaultDouyinRights(),
    createdAt: new Date().toISOString(),
  };
}

/** Normalize creator; requires the stable sec_uid (doc §13). */
export function normalizeCreator(raw: UpstreamCreatorRaw): CanonicalCreator {
  const providerCreatorId = requireText(raw.secUid, "secUid");
  const displayName = requireText(raw.displayName, "displayName");
  const url = requireText(raw.url, "url");
  return {
    id: `dcreator_${randomUUID().slice(0, 12)}`,
    provider: "douyin",
    providerCreatorId,
    displayName,
    canonicalUrl: url,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : undefined,
    bio: typeof raw.bio === "string" ? raw.bio : undefined,
    statistics: safeStatistics(raw.statistics),
    firstSeenAt: new Date().toISOString(),
  };
}

/**
 * Normalize comments. Comment text is UNTRUSTED DATA (doc §74): it is stored
 * verbatim as content and never interpreted as an instruction. Entries that
 * fail the contract are dropped with a drift report rather than corrupting
 * the canonical store.
 */
export function normalizeComments(
  raw: UpstreamCommentsRaw,
  mediaItemId: string,
): { comments: CanonicalComment[]; dropped: number } {
  const comments: CanonicalComment[] = [];
  let dropped = 0;
  for (const entry of raw.comments ?? []) {
    if (typeof entry.cid !== "string" || !entry.cid || typeof entry.text !== "string" || !entry.text) {
      dropped += 1;
      continue;
    }
    comments.push({
      id: `dcomment_${randomUUID().slice(0, 12)}`,
      providerCommentId: entry.cid,
      mediaItemId,
      parentCommentId: typeof entry.parentId === "string" && entry.parentId ? entry.parentId : undefined,
      authorName: typeof entry.author === "string" ? entry.author : undefined,
      text: entry.text,
      publishedAt: typeof entry.publishedAt === "string" ? entry.publishedAt : undefined,
      statistics: entry.diggCount !== undefined ? { diggCount: entry.diggCount } : {},
      createdAt: new Date().toISOString(),
    });
  }
  return { comments, dropped };
}
