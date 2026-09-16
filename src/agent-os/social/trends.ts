// Phase 20.20 — Trend signal aggregation (spec section 18).
//
// Every signal is computed from the normalized evidence rows of one research job and
// carries the ids of the items that back it. Signals describe observed social data
// only — they are never labeled as buyer demand, search volume, or sales probability.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { SocialPlatform, SocialTrendSignal } from "./types";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have",
  "how", "in", "is", "it", "its", "of", "on", "or", "that", "the", "their", "them",
  "this", "to", "was", "what", "when", "where", "which", "who", "will", "with", "you",
  "your", "not", "can", "all", "out", "more", "new", "get", "one", "two", "use",
]);

const MAX_SIGNALS_PER_KIND = 12;

export function aggregateTrendSignals(jobId: string, items: NormalizedEvidenceItem[]): SocialTrendSignal[] {
  if (items.length === 0) return [];

  const keywordCounts = new Map<string, { count: number; platforms: Set<SocialPlatform>; refs: Set<string> }>();
  const hashtagCounts = new Map<string, { count: number; platforms: Set<SocialPlatform>; refs: Set<string> }>();
  const formatCounts = new Map<string, { count: number; platforms: Set<SocialPlatform>; refs: Set<string> }>();

  for (const item of items) {
    const text = [item.text, item.title, item.description].filter((v): v is string => v !== null).join(" ");
    const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']{2,}/gu) ?? [];
    const seenInItem = new Set<string>();
    for (const word of words) {
      if (STOPWORDS.has(word) || seenInItem.has(word)) continue;
      seenInItem.add(word);
      bump(keywordCounts, word, item);
    }
    for (const tag of item.hashtags) {
      bump(hashtagCounts, tag, item);
    }
    bump(formatCounts, item.contentType, item);
  }

  const signals: SocialTrendSignal[] = [];
  const observedAt = new Date().toISOString();

  signals.push(...topSignals(jobId, "keyword_frequency", keywordCounts, observedAt, MAX_SIGNALS_PER_KIND));
  signals.push(...topSignals(jobId, "hashtag_frequency", hashtagCounts, observedAt, MAX_SIGNALS_PER_KIND));
  signals.push(...topSignals(jobId, "content_format_recurrence", formatCounts, observedAt, 5));

  // Cross-platform recurrence: a hashtag seen on two or more distinct platforms.
  const crossPlatform: SocialTrendSignal[] = [];
  for (const [key, entry] of hashtagCounts) {
    if (entry.platforms.size >= 2) {
      crossPlatform.push(makeSignal(jobId, "cross_platform_recurrence", key, entry, observedAt));
    }
  }
  signals.push(...crossPlatform.sort((a, b) => b.occurrences - a.occurrences).slice(0, MAX_SIGNALS_PER_KIND));

  const db = openAgentOsDb();
  for (const signal of signals) {
    db.query(`INSERT INTO social_trend_signals (
      id, research_job_id, kind, key, platforms_json, occurrences, evidence_refs_json, stats_json, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      signal.id,
      signal.researchJobId,
      signal.kind,
      signal.key,
      JSON.stringify(signal.platforms),
      signal.occurrences,
      JSON.stringify(signal.evidenceRefs),
      JSON.stringify(signal.stats),
      signal.observedAt,
    );
  }
  return signals;
}

export interface NormalizedEvidenceItem {
  id: string;
  platform: SocialPlatform;
  contentType: string;
  text: string | null;
  title: string | null;
  description: string | null;
  hashtags: string[];
  publishedAt: string | null;
}

type CountEntry = { count: number; platforms: Set<SocialPlatform>; refs: Set<string> };

function bump(map: Map<string, CountEntry>, key: string, item: NormalizedEvidenceItem): void {
  const entry = map.get(key) ?? { count: 0, platforms: new Set<SocialPlatform>(), refs: new Set<string>() };
  entry.count++;
  entry.platforms.add(item.platform);
  entry.refs.add(item.id);
  map.set(key, entry);
}

function topSignals(
  jobId: string,
  kind: SocialTrendSignal["kind"],
  map: Map<string, CountEntry>,
  observedAt: string,
  limit: number,
): SocialTrendSignal[] {
  return [...map.entries()]
    .sort(byOccurrences)
    .slice(0, limit)
    .map(([key, entry]) => makeSignal(jobId, kind, key, entry, observedAt));
}

function byOccurrences(a: [string, CountEntry], b: [string, CountEntry]): number {
  return b[1].count - a[1].count || a[0].localeCompare(b[0]);
}

function makeSignal(
  jobId: string,
  kind: SocialTrendSignal["kind"],
  key: string,
  entry: CountEntry,
  observedAt: string,
): SocialTrendSignal {
  return {
    id: `ssig_${randomUUID().slice(0, 16)}`,
    researchJobId: jobId,
    kind,
    key,
    platforms: [...entry.platforms],
    occurrences: entry.count,
    evidenceRefs: [...entry.refs].slice(0, 50),
    stats: {
      platformCount: entry.platforms.size,
      evidenceCount: entry.refs.size,
    },
    observedAt,
  };
}
