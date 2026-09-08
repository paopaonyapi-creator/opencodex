// Phase 20.10 — Signal Normalizer (spec sections 7, 103).
//
// Converts disparate source payloads into a unified NormalizedTrendSignal format.

import type { NormalizedTrendSignal, TrendPlatformSource, TrendSignal } from "./types";

export function normalizeRawItem(
  source: TrendPlatformSource,
  topic: string,
  raw: Record<string, unknown>,
): NormalizedTrendSignal {
  const id = String(raw.id || `sig_${Math.random().toString(36).slice(2, 8)}`);
  const title = String(raw.title || raw.name || topic);
  const views = Number(raw.views || 0);
  const downloads = Number(raw.downloads || 0);
  const engagementRate = Number(raw.engagement_rate || (raw.likes ? Number(raw.likes) / Math.max(views, 100) : 0.02));
  const aiGenerated = Boolean(raw.ai_generated);

  let keywords: string[] = [];
  if (Array.isArray(raw.keywords)) {
    keywords = raw.keywords.map(String);
  } else if (Array.isArray(raw.hashtags)) {
    keywords = raw.hashtags.map(String);
  } else {
    keywords = topic.toLowerCase().split(/\s+/).filter(Boolean);
  }

  // Calculate commercial intent proxy
  const commercialWords = ["business", "corporate", "commercial", "industry", "lifestyle", "technology", "finance", "healthcare", "office", "professional"];
  const matches = keywords.filter((k) => commercialWords.includes(k.toLowerCase())).length;
  const commercialBuyerIntentScore = Math.min(100, matches * 25 + (downloads > 0 ? 30 : 15));

  return {
    id,
    source,
    topic,
    title,
    views,
    downloads,
    engagementRate,
    aiGenerated,
    keywords,
    publishedAt: raw.published_at ? String(raw.published_at) : undefined,
    commercialBuyerIntentScore,
  };
}
