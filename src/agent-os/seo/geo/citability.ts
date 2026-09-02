/**
 * Phase 18.1 — Citability agent (passage-level, HEURISTIC).
 * Segments raw HTML into passages and scores how easy each is for an AI
 * system to extract and cite. Every score is a transparent heuristic — it
 * MUST NOT be presented as a platform ranking or citation prediction.
 * Pure functions: no network, fully unit-testable.
 */

export interface GeoPassage {
  type: "definition" | "qa" | "list" | "table" | "paragraph";
  heading: string | null;
  text: string;
  hasEvidenceLink: boolean;
  citability: number;      // 0..100 heuristic
  strengths: string[];
  issues: string[];
}

export interface CitabilityAssessment {
  overallScore: number;    // 0..100 heuristic
  passages: GeoPassage[];
  strongCount: number;     // citability >= 70
  weakCount: number;       // citability < 45
  topIssues: string[];
}

const MARKETING_FLUFF = /(?:world[- ]class|best[- ]in[- ]class|leading|unmatched|premier|ดีที่สุด|ระดับโลก|ที่หนึ่ง)/i;
const QUESTION_START = /^(?:what|why|how|when|where|who|which|can|do|does|is|are|อะไร|ทำไม|อย่างไร|เมื่อไหร่|ที่ไหน|ใคร|ได้หรือไม่)/i;
const DEFINITION_START = /(?:\b(?:is|are|means|refers to)\b|คือ|หมายถึง)/i;
const SPECIFIC = /(?:\d+(?:[.,]\d+)?\s*(?:%|baht|usd|\$|€|kWh|km|kg|mm|cm|ชิ้น|บาท|วัน|เดือน|ปี)|\b(?:19|20)\d{2}\b)/i;

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract heading→body sections + standalone long paragraphs from raw HTML. */
export function segmentPassages(html: string): Array<Pick<GeoPassage, "type" | "heading" | "text" | "hasEvidenceLink">> {
  const segments: Array<Pick<GeoPassage, "type" | "heading" | "text" | "hasEvidenceLink">> = [];
  const sectionPattern = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>([\s\S]*?)(?=<h[1-4]|$)/gi;
  for (const match of html.matchAll(sectionPattern)) {
    const heading = stripHtml(match[1]!);
    const bodyHtml = match[2] ?? "";
    const text = stripHtml(bodyHtml);
    if (!heading && !text) continue;
    const isTable = /<table/i.test(bodyHtml);
    const isList = /<(ul|ol)[^>]*>/i.test(bodyHtml);
    segments.push({
      type: isTable ? "table" : isList ? "list" : QUESTION_START.test(heading) ? "qa" : DEFINITION_START.test(text) ? "definition" : "paragraph",
      heading: heading || null,
      text: text.slice(0, 1200),
      hasEvidenceLink: /<a[^>]+href=/i.test(bodyHtml),
    });
  }
  const orphan = html.replace(sectionPattern, " ");
  for (const p of orphan.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(p[1]!);
    if (text.length >= 80) {
      segments.push({ type: "paragraph", heading: null, text: text.slice(0, 1200), hasEvidenceLink: /<a[^>]+href=/i.test(p[1]!) });
    }
  }
  return segments.filter(segment => segment.text.length >= 40 || segment.heading);
}

/** Heuristic passage scoring — transparent dimension deductions. */
export function scorePassage(passage: Pick<GeoPassage, "type" | "heading" | "text" | "hasEvidenceLink">): GeoPassage {
  const strengths: string[] = [];
  const issues: string[] = [];
  let score = 60;
  const length = passage.text.length;
  if (length >= 60 && length <= 320) { score += 12; strengths.push("self-contained length"); }
  else if (length < 40) { score -= 10; issues.push("too short to be self-contained"); }
  else if (length > 700) { score -= 12; issues.push("very long block; hard to extract a single answer"); }
  if (SPECIFIC.test(passage.text)) { score += 10; strengths.push("specific facts (numbers/units/dates)"); }
  else { score -= 6; issues.push("no specific measurable facts"); }
  if (passage.heading && QUESTION_START.test(passage.heading)) { score += 10; strengths.push("question-style heading (FAQ-like)"); }
  if (passage.type === "definition" && DEFINITION_START.test(passage.text)) { score += 8; strengths.push("direct definition"); }
  if (passage.type === "table" || passage.type === "list") { score += 6; strengths.push("structured format"); }
  if (passage.hasEvidenceLink) { score += 8; strengths.push("inline source link"); }
  else { score -= 5; issues.push("no primary-source citation on the passage"); }
  if (MARKETING_FLUFF.test(passage.text)) { score -= 20; issues.push("marketing superlatives weaken factual clarity"); }
  if (issues.length >= 3) { score -= 8; issues.push("multiple clarity issues compound each other"); }
  score = Math.max(0, Math.min(100, score));
  return { ...passage, citability: score, strengths, issues };
}

/** Score a full document. Empty assessment when nothing segmentable. */
export function analyzeCitability(html: string): CitabilityAssessment {
  const scored = segmentPassages(html).map(scorePassage);
  if (scored.length === 0) {
    return { overallScore: 0, passages: [], strongCount: 0, weakCount: 0, topIssues: ["no segmentable passages found"] };
  }
  const overall = Math.round(scored.reduce((sum, passage) => sum + passage.citability, 0) / scored.length);
  const issueCount = new Map<string, number>();
  for (const passage of scored) for (const issue of passage.issues) issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
  const topIssues = [...issueCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([issue, count]) => `${issue} (${count} passage${count > 1 ? "s" : ""})`);
  return {
    overallScore: overall,
    passages: scored.slice(0, 20),
    strongCount: scored.filter(passage => passage.citability >= 70).length,
    weakCount: scored.filter(passage => passage.citability < 45).length,
    topIssues,
  };
}
