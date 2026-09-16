// Phase 20.20 — Adobe Stock opportunity adapter (spec section 20).
//
// Converts observed social evidence into a structured proposal for ORIGINAL concept
// work. Hard boundary enforced here and by callers:
//   - evidence confidence describes the social data only;
//   - opportunity score is a transparent heuristic over observed signals — never a
//     demand, sales, acceptance, or download probability;
//   - suggested directions are original-creation prompts, never "reuse the asset".

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { SocialStockOpportunity } from "./types";
import type { NormalizedEvidenceItem } from "./trends";

export function buildStockOpportunities(jobId: string, items: NormalizedEvidenceItem[]): SocialStockOpportunity[] {
  if (items.length < 3) return []; // too little evidence to propose anything honestly

  const platforms = new Set(items.map((i) => i.platform));
  const hashtagCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  let newestPublishedMs = 0;
  for (const item of items) {
    for (const tag of item.hashtags) hashtagCounts.set(tag, (hashtagCounts.get(tag) ?? 0) + 1);
    const words = (item.text ?? item.title ?? "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']{2,}/gu) ?? [];
    for (const word of words) keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
    if (item.publishedAt) {
      const ms = Date.parse(item.publishedAt);
      if (Number.isFinite(ms)) newestPublishedMs = Math.max(newestPublishedMs, ms);
    }
  }
  const topHashtags = [...hashtagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag]) => tag);
  const themeSource = topHashtags.length > 0 ? topHashtags : [...keywordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const primaryTheme = themeSource[0];
  if (!primaryTheme) return [];

  // Evidence confidence: volume, platform spread, recency. Nothing else feeds it.
  const volumePart = Math.min(1, items.length / 50);
  const spreadPart = Math.min(1, platforms.size / 3);
  const recencyDays = newestPublishedMs > 0 ? (Date.now() - newestPublishedMs) / 86_400_000 : 365;
  const recencyPart = recencyDays <= 7 ? 1 : recencyDays <= 30 ? 0.7 : recencyDays <= 90 ? 0.4 : 0.2;
  const evidenceConfidence = round2(volumePart * 0.5 + spreadPart * 0.3 + recencyPart * 0.2);

  // Opportunity score: a transparent ordering heuristic over the SAME observed
  // signals, weighted differently. It ranks candidates; it does not predict demand.
  const frequencyPart = Math.min(1, (hashtagCounts.get(primaryTheme) ?? 1) / 20);
  const opportunityScore = Math.round(
    (frequencyPart * 0.45 + spreadPart * 0.3 + recencyPart * 0.25) * 100,
  );

  const totalOccurrences = themeSource.reduce((sum, tag) => sum + (hashtagCounts.get(tag) ?? 0), 0);
  const videoShare = items.filter((i) => i.contentType === "video" || i.contentType === "short" || i.contentType === "reel").length / items.length;

  const risks: string[] = [
    "Social trend signals are not Adobe buyer demand; validate separately before producing volume",
    "observed themes may include brand hashtags — original concepts must avoid trademarks and logos",
  ];
  if (items.length < 10) risks.push(`evidence volume is low (${items.length} unique items); confidence is correspondingly limited`);
  if (platforms.size === 1) risks.push("evidence comes from a single platform; cross-platform recurrence was not observed");

  const opportunity: SocialStockOpportunity = {
    id: `sopp_${randomUUID().slice(0, 16)}`,
    researchJobId: jobId,
    title: `Original commercial concepts around "${primaryTheme}"`,
    buyerProblem:
      `Observed ${items.length} unique public social items mentioning "${primaryTheme}" across ` +
      `${platforms.size} platform(s) (${[...platforms].join(", ")}), ${totalOccurrences} thematic tag/keyword occurrences. ` +
      `This is observed social activity, not measured buyer demand; commercial framing below is a hypothesis for human review.`,
    commercialUseCases: videoShare > 0.4
      ? ["short-form-video-inspired still imagery", "thumbnail and cover art around the observed theme", "vertical-format concept studies"]
      : ["editorial-style lifestyle imagery around the observed theme", "background and texture concepts", "seasonal campaign visuals"],
    observedThemes: themeSource,
    evidenceRefs: items.slice(0, 50).map((i) => i.id),
    evidenceConfidence,
    opportunityScore,
    scoreBasis:
      `Heuristic ordering score over observed social signals only: theme frequency ${Math.round(frequencyPart * 100)}%, ` +
      `platform spread ${Math.round(spreadPart * 100)}%, recency ${Math.round(recencyPart * 100)}%. ` +
      `It is NOT search volume, buyer demand, competition count, sales or acceptance probability.`,
    risks,
    suggestedOriginalDirections: [
      `Produce ORIGINAL still-life/lifestyle compositions expressing "${primaryTheme}" with generic, non-branded subjects`,
      `Model-release-safe people-centered scenes reflecting the observed activity, shot or generated from scratch`,
      `Abstract/graphic interpretations of the theme that carry no recognizable third-party content`,
    ],
    createdAt: new Date().toISOString(),
  };

  const db = openAgentOsDb();
  db.query(`INSERT INTO social_opportunities (
    id, research_job_id, title, buyer_problem, commercial_use_cases_json, observed_themes_json,
    evidence_refs_json, evidence_confidence, opportunity_score, score_basis, risks_json,
    suggested_directions_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    opportunity.id,
    opportunity.researchJobId,
    opportunity.title,
    opportunity.buyerProblem,
    JSON.stringify(opportunity.commercialUseCases),
    JSON.stringify(opportunity.observedThemes),
    JSON.stringify(opportunity.evidenceRefs),
    opportunity.evidenceConfidence,
    opportunity.opportunityScore,
    opportunity.scoreBasis,
    JSON.stringify(opportunity.risks),
    JSON.stringify(opportunity.suggestedOriginalDirections),
    opportunity.createdAt,
  );

  return [opportunity];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
