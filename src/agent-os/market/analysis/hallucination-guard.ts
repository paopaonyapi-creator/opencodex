/**
 * Pao Market Signal Control Plane — hallucination guard (Phase 20.52 §15).
 *
 * Before AI output may join a proposal, every numeric market claim in its
 * text fields is checked against the TRUSTED context (the signal itself and
 * deterministic account/risk values). Unsupported numbers are flagged; the
 * model can never successfully introduce a price, volume, market cap, or any
 * other fabricated figure.
 */

import type { AnalysisValidation } from "../types";
import type { MarketAIAnalysisDraft, TrustedNumericContext } from "./analysis-types";

export { type TrustedNumericContext } from "./analysis-types";

interface NumericClaim {
  readonly text: string;
  readonly value: number;
  readonly kind: "currency" | "percent" | "number";
}

const NUMERIC_PATTERN = /(\$?\s?-?\d[\d,]*\.?\d*\s?%?)/g;

function classifyClaim(raw: string): NumericClaim | null {
  const cleaned = raw.replace(/[\s,]/g, "");
  if (!cleaned) return null;
  const isPercent = cleaned.endsWith("%");
  const isCurrency = cleaned.startsWith("$");
  const value = Number(cleaned.replace(/[%$]/g, ""));
  if (!Number.isFinite(value)) return null;
  return {
    text: raw.trim(),
    value,
    kind: isPercent ? "percent" : isCurrency ? "currency" : "number",
  };
}

function trustedValuesFor(_claim: NumericClaim, ctx: TrustedNumericContext): readonly number[] {
  // Set membership is the guard's job, not formatting pedantry: a price can
  // appear with or without a "$" and a percent may be restated as a decimal.
  // Any number outside the full trusted set is unsupported.
  return [...ctx.currencyValues, ...ctx.percentValues, ...ctx.plainValues];
}

function closeTo(value: number, trusted: readonly number[]): boolean {
  // Exact match first; then a tight tolerance for rounding introduced by
  // formatting (e.g. "200.25" vs 200.2499 after percent math).
  return trusted.some(t => t === value || Math.abs(t - value) <= Math.max(0.01, Math.abs(t) * 0.005));
}

/**
 * Validate one draft analysis against the trusted numeric context of its
 * signal. Numbers in the summary/factors/notes must exist in the trusted
 * context, or they are reported as unsupported claims.
 */
export function validateAnalysisNumbers(
  analysis: Pick<MarketAIAnalysisDraft, "summary" | "bullishFactors" | "bearishFactors" | "invalidationFactors" | "riskNotes">,
  ctx: TrustedNumericContext,
): AnalysisValidation {
  const unsupportedClaims: string[] = [];
  const warnings: string[] = [];

  const fields: Array<[string, readonly string[]]> = [
    ["summary", [analysis.summary]],
    ["bullishFactors", analysis.bullishFactors],
    ["bearishFactors", analysis.bearishFactors],
    ["invalidationFactors", analysis.invalidationFactors],
    ["riskNotes", analysis.riskNotes],
  ];

  for (const [fieldName, texts] of fields) {
    for (const text of texts) {
      const matches = text.match(NUMERIC_PATTERN) ?? [];
      for (const match of matches) {
        const claim = classifyClaim(match);
        if (!claim) continue;
        // Bare integers used as enumerations (e.g. "3 factors") with small
        // magnitudes are tolerated as counts, not market claims.
        if (claim.kind === "number" && Number.isInteger(claim.value) && Math.abs(claim.value) <= 12) continue;
        const trusted = trustedValuesFor(claim, ctx);
        if (!closeTo(claim.value, trusted)) {
          unsupportedClaims.push(`${fieldName}: "${claim.text}"`);
        }
      }
    }
  }

  if (unsupportedClaims.length > 0) {
    warnings.push(
      "Numeric claims not present in trusted context were flagged; they must not be treated as market facts.",
    );
  }

  return {
    valid: unsupportedClaims.length === 0,
    unsupportedClaims,
    warnings,
  };
}

/** Phrases the model may never present as verified facts. */
const FABRICATION_HINTS: readonly string[] = [
  "earnings date",
  "earnings on",
  "market cap of",
  "analyst rating",
  "analysts rate",
  "reported volume",
  "current price is",
  "the stock is trading at",
];

export function detectFabricationPhrases(
  analysis: Pick<MarketAIAnalysisDraft, "summary" | "bullishFactors" | "bearishFactors" | "riskNotes">,
): string[] {
  const hits: string[] = [];
  const haystacks: Array<[string, string]> = [
    ["summary", analysis.summary],
    ...analysis.bullishFactors.map(f => ["bullishFactors", f] as [string, string]),
    ...analysis.bearishFactors.map(f => ["bearishFactors", f] as [string, string]),
    ...analysis.riskNotes.map(n => ["riskNotes", n] as [string, string]),
  ];
  for (const [field, text] of haystacks) {
    const lowered = text.toLowerCase();
    for (const hint of FABRICATION_HINTS) {
      if (lowered.includes(hint)) {
        hits.push(`${field}: "${hint}"`);
      }
    }
  }
  return hits;
}
