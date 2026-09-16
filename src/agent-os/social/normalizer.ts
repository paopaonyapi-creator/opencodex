// Phase 20.20 — Result normalization (spec section 17).
//
// Provider item shapes vary per tool. This module maps common field variants onto
// NormalizedContentItem, preserves provenance, and drops items whose source URL
// fails the public-HTTP policy. Fields the provider did not supply stay null.

import { randomUUID } from "node:crypto";
import { validatePublicHttpUrl } from "./url-policy";
import type {
  NormalizedContentItem,
  NormalizedContentType,
  NormalizedMetrics,
  SocialTool,
} from "./types";

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function firstNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function nestedField(item: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = item;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function firstNestedString(item: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = nestedField(item, path);
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function firstNestedNumber(item: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    const value = nestedField(item, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toIsoTimestamp(value: string | null): string | null {
  if (!value) return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) && value.length >= 10 && value.length <= 14 ? numeric * (value.length <= 10 ? 1000 : 1) : NaN;
  const parsed = new Date(Number.isFinite(ms) ? ms : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function detectContentType(item: Record<string, unknown>, text: string): NormalizedContentType {
  const type = firstString(item, ["type", "contentType", "mediaType"])?.toLowerCase();
  if (type === "video" || type === "reel" || type === "short" || type === "comment" || type === "reply" || type === "profile") {
    return type;
  }
  if (item.videoUrl !== undefined || item.webVideoUrl !== undefined || item.videoId !== undefined) return "video";
  if (item.caption !== undefined) return "post";
  return text.length > 0 ? "post" : "other";
}

export function normalizeProviderItem(
  tool: SocialTool,
  item: Record<string, unknown>,
  context: { providerId: string; runId: string; platform: SocialTool["platform"]; fetchedAt: string },
): NormalizedContentItem | null {
  const text = firstString(item, ["text", "caption", "selftext", "body"]);
  const title = firstString(item, ["title", "headline"]);
  const description = firstString(item, ["description", "desc", "snippet"]);
  if (text === null && title === null && description === null) return null;

  const rawUrl = firstString(item, ["url", "webVideoUrl", "postUrl", "shareUrl", "link"]);
  const urlCheck = validatePublicHttpUrl(rawUrl);

  const hashtags: string[] = [];
  const mentions: string[] = [];
  const haystack = [text, title, description].filter((v): v is string => v !== null).join(" ");
  for (const match of haystack.matchAll(/#([\p{L}\p{N}_]{1,64})/gu)) hashtags.push(match[1]!.toLowerCase());
  for (const match of haystack.matchAll(/@([A-Za-z0-9_.]{1,64})/g)) mentions.push(match[1]!.toLowerCase());
  const providerHashtags = item.hashtags;
  if (Array.isArray(providerHashtags)) {
    for (const tag of providerHashtags) {
      if (typeof tag === "string" && tag.length > 0) {
        hashtags.push(tag.replace(/^#/, "").toLowerCase());
      }
    }
  }

  const metrics: NormalizedMetrics = {
    views: firstNumber(item, ["views", "viewCount", "playCount", "stats.views"]),
    likes: firstNumber(item, ["likes", "likesCount", "likeCount", "diggCount", "score", "stats.likes"]),
    comments: firstNumber(item, ["comments", "commentsCount", "commentCount", "numComments", "stats.comments"]),
    shares: firstNumber(item, ["shares", "shareCount", "sharesCount", "stats.shares"]),
    saves: firstNumber(item, ["saves", "saveCount", "collectCount", "stats.saves"]),
    followers: firstNestedNumber(item, ["author.followers", "author.followerCount", "stats.followers"]),
  };

  const publishedAt = toIsoTimestamp(
    firstString(item, ["publishedAt", "createTime", "timestamp", "createdUtc", "published_at", "createdAt"]),
  );

  const externalId = firstString(item, ["id", "videoId", "postId", "shortcode"]);
  const sourceUrl = urlCheck.ok ? rawUrl : null;

  return {
    id: `sitem_${randomUUID().slice(0, 16)}`,
    platform: context.platform === "multi" || context.platform === "unknown"
      ? inferPlatformFromItem(item, tool)
      : context.platform,
    sourceToolId: tool.id,
    sourceUrl,
    contentType: detectContentType(item, text ?? ""),
    externalId,
    authorExternalId: firstNestedString(item, ["author.id", "owner.id", "channel.id", "authorExternalId"]),
    authorDisplayName: firstNestedString(item, ["author.name", "author.username", "owner.username", "channel.name", "authorDisplayName"]) ?? firstString(item, ["author"]),
    text,
    title,
    description,
    publishedAt,
    observedAt: new Date().toISOString(),
    metrics,
    hashtags: [...new Set(hashtags)].slice(0, 30),
    mentions: [...new Set(mentions)].slice(0, 30),
    language: firstString(item, ["lang", "language"]),
    duplicateOf: null,
    provenance: {
      provider: context.providerId,
      toolId: tool.id,
      runId: context.runId,
      fetchedAt: context.fetchedAt,
    },
  };
}

function inferPlatformFromItem(item: Record<string, unknown>, tool: SocialTool): SocialTool["platform"] {
  const url = firstString(item, ["url", "webVideoUrl", "postUrl"]);
  if (url) {
    if (url.includes("tiktok.com")) return "tiktok";
    if (url.includes("instagram.com")) return "instagram";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (url.includes("reddit.com")) return "reddit";
    if (url.includes("pinterest.com")) return "pinterest";
    if (url.includes("twitter.com") || url.includes("x.com")) return "x_twitter";
  }
  return tool.platform;
}
