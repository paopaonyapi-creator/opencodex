// Phase 20.31 — Prompt/IP Guard (doc §39): policy lint layer for
// Adobe-Stock-bound prompts before they reach a generation provider.
//
// This is the one piece of the Phase 20.31 spec NOT already covered by the
// Phase 20.7 video factory (which ships the MPT adapter, job queue, Adobe
// Stock policy/QC/similarity/compliance gates). The guard flags or blocks
// prohibited references per current Adobe guidance; blocks record a reason
// and hold for human compliance review rather than silently rewriting the
// user's concept.

export type PromptGuardVerdict = "clear" | "flagged" | "blocked";

export interface PromptGuardFinding {
  category:
    | "artist_name"
    | "celebrity_person"
    | "fictional_character"
    | "copyrighted_franchise"
    | "trademark_brand"
    | "government_agency"
    | "artist_style_imitation"
    | "fake_news_framing"
    | "embedded_text_request";
  matched: string;
  severity: "flag" | "block";
  note: string;
}

export interface PromptGuardResult {
  verdict: PromptGuardVerdict;
  findings: PromptGuardFinding[];
  /** Sanitized summary safe for audit rows (no prompt content echoed). */
  summary: string;
}

interface GuardRule {
  category: PromptGuardFinding["category"];
  pattern: RegExp;
  severity: "flag" | "block";
  note: string;
}

/**
 * Versioned rule data (doc §16 principle): curated representative lists —
 * Adobe guidance evolves, so rules are data here, extendable without touching
 * the guard logic. Common artist names are blocked by surname pattern for
 * well-known prompt-injection targets; the flag list catches style requests.
 */
const GUARD_RULES: GuardRule[] = [
  // Fictional characters / franchises (block: clear third-party IP)
  { category: "fictional_character", pattern: /\b(mickey mouse|pikachu|batman|superman|spider[-\s]?man|mario|sonic|goku|darth vader|harry potter|elsa frozen)\b/i, severity: "block", note: "fictional character IP" },
  { category: "copyrighted_franchise", pattern: /\b(disney|pixar|marvel|dc comics|star wars|harry potter|pokemon|nintendo|playstation|hogwarts)\b/i, severity: "block", note: "copyrighted franchise" },
  // Well-known artists (block direct name use; flag style imitation)
  { category: "artist_name", pattern: /\b(van gogh|picasso|monet|rembrandt|dali|warhol|banksy|basquiat|vermeer|klimt|hokusai)\b/i, severity: "block", note: "named artist reference" },
  { category: "artist_style_imitation", pattern: /\bin the style of\b|\bstyle of (van gogh|picasso|monet|ghibli)\b/i, severity: "flag", note: "artist style imitation request" },
  // Celebrities / known people (block: real-person references need releases)
  { category: "celebrity_person", pattern: /\b(elon musk|taylor swift|tom cruise|angelina jolie|ronaldo|messi|obama|trump|putin|beyonce)\b/i, severity: "block", note: "real person reference" },
  // Trademarks / brands (flag: context-dependent, may be incidental)
  { category: "trademark_brand", pattern: /\b(coca[-\s]?cola|nike|adidas|apple logo|iphone|ferrari|rolex|mcdonald)\b/i, severity: "flag", note: "brand/trademark reference" },
  // Government agencies (flag per Adobe guidance in this context)
  { category: "government_agency", pattern: /\b(white house|pentagon|fbi|cia|nasa logo|united nations logo)\b/i, severity: "flag", note: "government agency reference" },
  // Fake news framing (flag)
  { category: "fake_news_framing", pattern: /\b(breaking news|live footage of|actual footage|real event recording)\b/i, severity: "flag", note: "implies real news event" },
  // Embedded text/logo requests in Stock Mode (flag: normally unwanted)
  { category: "embedded_text_request", pattern: /\b(embed(ded)?\s+text|add\s+text\s+saying|watermark|logo\s+overlay)\b/i, severity: "flag", note: "embedded text/logo/watermark request" },
];

/**
 * Lint a Stock-bound generation prompt. Verdicts:
 * - clear: no prohibited references;
 * - flagged: style/brand/agency/text references — human compliance review;
 * - blocked: clear third-party IP/person/artist references — hold, do not
 *   silently rewrite the user's concept (doc §39).
 */
export function lintStockPrompt(prompt: string, opts: { stockMode?: boolean } = {}): PromptGuardResult {
  const findings: PromptGuardFinding[] = [];
  for (const rule of GUARD_RULES) {
    const match = prompt.match(rule.pattern);
    if (match) {
      findings.push({
        category: rule.category,
        matched: match[0],
        severity: rule.severity,
        note: rule.note,
      });
    }
  }
  const hasBlock = findings.some((f) => f.severity === "block");
  const verdict: PromptGuardVerdict = hasBlock ? "blocked" : findings.length > 0 ? "flagged" : "clear";
  const categories = findings.map((f) => f.category).join(", ") || "none";
  return {
    verdict,
    findings,
    // Summary deliberately excludes the prompt content itself (doc §26: no
    // prompt payloads in audit).
    summary: `prompt lint: ${verdict}; categories: ${categories}; stockMode: ${opts.stockMode !== false}`,
  };
}

/** Adobe technical video policy data with freshness tracking (doc §16). */
export interface AdobeVideoTechnicalPolicy {
  policyVersion: number;
  sourceUrl: string;
  verifiedAt: string;
  /** Days after which the policy must be re-verified against Adobe docs. */
  freshnessDays: number;
  acceptedContainers: string[];
  durationSec: { min: number; max: number };
  maxFileSizeBytes: number;
  frameRates: number[];
  resolutions: Array<{ width: number; height: number }>;
  codecs: string[];
}

export const ADOBE_VIDEO_TECHNICAL_POLICY: AdobeVideoTechnicalPolicy = {
  policyVersion: 1,
  sourceUrl: "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-videos/technical-requirements-for-video-submissions.html",
  verifiedAt: "2026-09-13",
  freshnessDays: 180,
  acceptedContainers: ["mov", "mpg", "mp4"],
  durationSec: { min: 5, max: 60 },
  maxFileSizeBytes: Math.round(3.9 * 1024 * 1024 * 1024),
  frameRates: [23.98, 24, 25, 29.97, 30, 50, 59.94, 60],
  resolutions: [
    { width: 1920, height: 1080 }, { width: 2048, height: 1080 },
    { width: 3840, height: 2160 }, { width: 4096, height: 2160 },
    { width: 4096, height: 2304 }, { width: 1080, height: 1920 },
    { width: 2160, height: 3840 }, { width: 2160, height: 4096 },
    { width: 2304, height: 4096 }, { width: 1080, height: 1080 },
    { width: 2160, height: 2160 },
  ],
  codecs: ["prores", "h264"],
};

/** POLICY_REVIEW_REQUIRED when the verified date is stale (doc §16). */
export function isPolicyStale(policy: AdobeVideoTechnicalPolicy, now = new Date()): boolean {
  const verified = new Date(policy.verifiedAt).getTime();
  return now.getTime() - verified > policy.freshnessDays * 24 * 60 * 60 * 1000;
}

export interface TechnicalInspection {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  container: string;
  fileSizeBytes: number;
  decodeOk: boolean;
}

/** Evaluate one inspection against the versioned policy. */
export function evaluateTechnicalGate(
  inspection: TechnicalInspection,
  policy: AdobeVideoTechnicalPolicy = ADOBE_VIDEO_TECHNICAL_POLICY,
): { pass: boolean; reasons: string[]; policyStale: boolean } {
  const reasons: string[] = [];
  if (inspection.durationSec < policy.durationSec.min || inspection.durationSec > policy.durationSec.max) {
    reasons.push(`duration ${inspection.durationSec.toFixed(2)}s outside ${policy.durationSec.min}-${policy.durationSec.max}s`);
  }
  const resolution = policy.resolutions.some((r) => r.width === inspection.width && r.height === inspection.height);
  if (!resolution) reasons.push(`resolution ${inspection.width}x${inspection.height} not in accepted list`);
  const fps = policy.frameRates.some((f) => Math.abs(f - inspection.fps) < 0.02);
  if (!fps) reasons.push(`frame rate ${inspection.fps} not in accepted list`);
  if (!policy.acceptedContainers.includes(inspection.container.toLowerCase())) {
    reasons.push(`container ${inspection.container} not accepted`);
  }
  if (!policy.codecs.some((c) => inspection.codec.toLowerCase().replace(/[^a-z0-9]/g, "").includes(c))) {
    reasons.push(`codec ${inspection.codec} not in recommended list`);
  }
  if (inspection.fileSizeBytes > policy.maxFileSizeBytes) reasons.push("file exceeds 3.9 GB");
  if (!inspection.decodeOk) reasons.push("decode integrity failed");
  return {
    pass: reasons.length === 0,
    reasons,
    policyStale: isPolicyStale(policy),
  };
}
