// Phase 19 — Reviewer Council integration for Generation Studio assets.
//
// REUSES the Phase 16 Reviewer Council building blocks (stock validators,
// ADOBE_STOCK_RULES, similarity hooks) instead of duplicating them. Produces
// normalized 0-100 scores, per-reviewer GenerationReviews persisted in
// gen_reviews, and the spec section 25 decision contract.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { ADOBE_STOCK_RULES } from "../config/adobe-stock-rules";
import { validateStockJpeg } from "../validators/stock-jpeg-validator";
import { validateStockPng } from "../validators/stock-png-validator";
import { validateStockVideo } from "../validators/stock-video-validator";
import { findExactDuplicateBySha, updateAssetScores } from "./storage";
import { getStockMetadata } from "./stock";
import type {
  GeneratedAsset,
  GenerationReview,
  GenerationReviewIssue,
  ReviewDecision,
} from "./types";

interface GenerationConfigView {
  stockReadyScore: number;
  stockManualReviewScore: number;
}

let configView: GenerationConfigView = { stockReadyScore: 85, stockManualReviewScore: 75 };

/** Called at startup with the loaded GenerationConfig. */
export function configureReviewerThresholds(config: GenerationConfigView): void {
  configView = { ...configView, ...config };
}

function rowToReview(row: Record<string, unknown>): GenerationReview {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    reviewer: row.reviewer as string,
    reviewType: row.review_type as string,
    score: (row.score as number | null) ?? null,
    verdict: row.verdict as GenerationReview["verdict"],
    decision: row.decision as ReviewDecision,
    issues: JSON.parse((row.issues_json as string) ?? "[]") as GenerationReviewIssue[],
    suggestions: JSON.parse((row.suggestions_json as string) ?? "[]") as string[],
    raw: JSON.parse((row.raw_json as string) ?? "{}") as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

function insertReview(review: Omit<GenerationReview, "id" | "createdAt">): GenerationReview {
  const db = openAgentOsDb();
  const id = `genrev_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_reviews (id, asset_id, reviewer, review_type, score, verdict, decision,
      issues_json, suggestions_json, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, review.assetId, review.reviewer, review.reviewType, review.score,
    review.verdict, review.decision, JSON.stringify(review.issues),
    JSON.stringify(review.suggestions), JSON.stringify(review.raw), now,
  );
  return { ...review, id, createdAt: now };
}

interface TechnicalSpec {
  width?: number | null;
  height?: number | null;
  fileSizeBytes?: number | null;
  format?: string | null;
  colorProfile?: string | null;
  durationSeconds?: number | null;
  fps?: number | null;
  codec?: string | null;
}

function megapixels(width?: number | null, height?: number | null): number | null {
  if (!width || !height) return null;
  return Number(((width * height) / 1_000_000).toFixed(2));
}

/**
 * Resolution-driven commercial heuristic. Documented limitation: replaced by
 * the vision-analyzer-driven score in a later phase; never silently widened.
 */
function commercialScoreHeuristic(asset: GeneratedAsset): number {
  const mp = megapixels(asset.width, asset.height);
  if (mp === null) return 70;
  if (mp >= 16) return 95;
  if (mp >= 8) return 88;
  if (mp >= 4) return 78;
  return 55;
}

/** Technical QC via the existing Phase 16 validators. */
export function runTechnicalReview(asset: GeneratedAsset): GenerationReview {
  const spec: TechnicalSpec = {
    width: asset.width,
    height: asset.height,
    fileSizeBytes: asset.fileSize,
    format: asset.mimeType.includes("png") ? "png" : asset.mimeType.includes("jpeg") || asset.mimeType.includes("jpg") ? "jpeg" : asset.mimeType.replace("image/", ""),
    colorProfile: "sRGB",
    durationSeconds: asset.durationSeconds,
    fps: asset.fps,
    codec: (asset.generationMetadata.codec as string) ?? null,
  };
  const issues: GenerationReviewIssue[] = [];
  const suggestions: string[] = [];
  let score = 100;
  let verdict: GenerationReview["verdict"] = "pass";

  if (asset.assetType === "image") {
    const isPng = spec.format === "png";
    const isJpeg = spec.format === "jpeg" || spec.format === "jpg";
    const errors: string[] = [];
    const warnings: string[] = [];
    let jpegScore: number | null = null;
    if (isJpeg) {
      const result = validateStockJpeg({
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        fileSizeBytes: asset.fileSize,
        format: "jpeg",
      });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      // JPEG is the normal stock raster: technical score comes from the validator.
      jpegScore = result.valid ? (result.warnings.length === 0 ? 100 : 85) : Math.max(20, 70 - result.errors.length * 25);
    } else if (isPng) {
      // PNG mode is for TRANSPARENT assets only (Phase 16 rule). A regular
      // opaque PNG is judged with the generic image MP/size rules instead of
      // the alpha pipeline, otherwise every normal PNG would fail alpha checks.
      const isTransparentAsset = String((asset.generationMetadata.output_mode ?? "")).includes("transparent");
      if (isTransparentAsset) {
        const result = validateStockPng({
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          fileSizeBytes: asset.fileSize,
          format: "png",
        });
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      } else {
        const mp = megapixels(asset.width, asset.height);
        if (mp !== null && (mp < ADOBE_STOCK_RULES.image.minMegapixels || mp > ADOBE_STOCK_RULES.image.maxMegapixels)) {
          errors.push(`Resolution ${mp}MP outside ${ADOBE_STOCK_RULES.image.minMegapixels}-${ADOBE_STOCK_RULES.image.maxMegapixels}MP stock range`);
        }
        if (asset.fileSize > ADOBE_STOCK_RULES.image.maxFileSizeBytes) {
          errors.push(`File size exceeds ${Math.round(ADOBE_STOCK_RULES.image.maxFileSizeBytes / 1_000_000)}MB stock limit`);
        }
      }
    } else {
      warnings.push(`Format ${spec.format ?? "unknown"} is not a stock raster; manual review required`);
    }
    const genericScore = errors.length === 0 ? (warnings.length === 0 ? 100 : 85) : Math.max(20, 70 - errors.length * 25);
    const score = isJpeg && jpegScore !== null ? jpegScore : genericScore;
    for (const error of errors) {
      issues.push({ code: "QC_TECHNICAL", severity: "blocking", message: error, suggestedAction: "rework" });
    }
    for (const warning of warnings) {
      issues.push({ code: "QC_TECHNICAL_WARN", severity: "low", message: warning, suggestedAction: "manual_review" });
    }
  } else if (asset.assetType === "video") {
    const result = validateStockVideo(spec as never);
    for (const error of result.errors) {
      issues.push({ code: "QC_TECHNICAL", severity: "blocking", message: error, suggestedAction: "rework" });
    }
    for (const warning of result.warnings) {
      issues.push({ code: "QC_TECHNICAL_WARN", severity: "low", message: warning, suggestedAction: "manual_review" });
    }
    score = result.valid ? (result.warnings.length === 0 ? 100 : 85) : Math.max(20, 60 - result.errors.length * 20);
  } else {
    // Non image/video types pass technical review structurally.
    score = 100;
  }
  if (score < 100 && issues.length === 0) issues.push({ code: "QC_MINOR", severity: "info", message: "Minor technical deductions", suggestedAction: "manual_review" });
  verdict = issues.some(i => i.severity === "blocking") ? "fail" : issues.length > 0 ? "warn" : "pass";
  if (verdict === "fail") suggestions.push("Regenerate at compliant resolution/format before stock submission.");
  return insertReview({
    assetId: asset.id,
    reviewer: "generation_technical_qc",
    reviewType: "technical_quality",
    score,
    verdict,
    decision: verdict === "fail" ? "REJECT" : verdict === "warn" ? "PASS_WITH_WARNING" : "PASS",
    issues,
    suggestions,
    raw: { spec, megapixels: megapixels(asset.width, asset.height) },
  });
}

/** Exact-hash duplicate detection; near-dup stays a Phase 20 similarity hook. */
export function runDuplicateReview(asset: GeneratedAsset): GenerationReview {
  const duplicate = findExactDuplicateBySha(asset.sha256, asset.id);
  const issues: GenerationReviewIssue[] = duplicate
    ? [{ code: "EXACT_DUPLICATE", severity: "high", message: `SHA-256 matches existing asset ${duplicate.id}`, suggestedAction: "reject" }]
    : [];
  const score = duplicate ? 10 : 100;
  return insertReview({
    assetId: asset.id,
    reviewer: "generation_duplicate_check",
    reviewType: "similarity",
    score,
    verdict: duplicate ? "fail" : "pass",
    decision: duplicate ? "REJECT" : "PASS",
    issues,
    suggestions: duplicate ? ["Remove duplicate or vary the prompt/seed."] : [],
    raw: { duplicateOf: duplicate?.id ?? null },
  });
}

/** Metadata quality review once metadata exists (warn, never block, pre-metadata). */
export function runMetadataReview(asset: GeneratedAsset): GenerationReview {
  const meta = getStockMetadata(asset.id);
  const issues: GenerationReviewIssue[] = [];
  let score = meta ? 90 : 60;
  if (meta) {
    if (meta.title.length < ADOBE_STOCK_RULES.metadata.minTitleLength) {
      issues.push({ code: "METADATA_TITLE_SHORT", severity: "medium", message: "Title below Adobe minimum", suggestedAction: "rework" });
      score -= 25;
    }
    if (meta.keywords.length < ADOBE_STOCK_RULES.metadata.minKeywords) {
      issues.push({ code: "METADATA_KEYWORDS_LOW", severity: "medium", message: "Too few keywords", suggestedAction: "rework" });
      score -= 20;
    }
    if (meta.keywords.length >= ADOBE_STOCK_RULES.metadata.recommendedKeywordsTarget) score = 100;
  } else {
    issues.push({ code: "METADATA_MISSING", severity: "low", message: "Stock metadata not generated yet", suggestedAction: "manual_review" });
  }
  const verdict: GenerationReview["verdict"] = score >= 90 ? "pass" : score >= 60 ? "warn" : "fail";
  return insertReview({
    assetId: asset.id,
    reviewer: "generation_metadata_review",
    reviewType: "metadata_quality",
    score: Math.max(0, score),
    verdict,
    decision: verdict === "fail" ? "REWORK" : verdict === "warn" ? "PASS_WITH_WARNING" : "PASS",
    issues,
    suggestions: meta ? [] : ["Run metadata generation before export."],
    raw: { hasMetadata: Boolean(meta) },
  });
}

/**
 * Full council: technical + duplicate (+ metadata when present). Persists
 * reviews, writes normalized scores on the asset, and returns the decision.
 */
export function evaluateAssetByGenerationCouncil(asset: GeneratedAsset): {
  decision: ReviewDecision;
  overallScore: number;
  reviews: GenerationReview[];
} {
  const reviews: GenerationReview[] = [
    runTechnicalReview(asset),
    runDuplicateReview(asset),
  ];
  const meta = getStockMetadata(asset.id);
  if (meta) reviews.push(runMetadataReview(asset));

  const technical = reviews.find(r => r.reviewType === "technical_quality")!;
  const duplicate = reviews.find(r => r.reviewType === "similarity")!;
  const metadata = reviews.find(r => r.reviewType === "metadata_quality");

  const technicalScore = technical.score ?? 100;
  const visualScore = Math.min(100, technicalScore); // heuristic pending vision analyzer (documented limitation)
  const commercialScore = commercialScoreHeuristic(asset);
  const policyScore = duplicate.verdict === "fail" ? 10 : 100;
  const metadataScore = metadata?.score ?? 60;
  const overallScore = Math.round(
    technicalScore * 0.3 + visualScore * 0.25 + commercialScore * 0.2 + policyScore * 0.15 + metadataScore * 0.1,
  );

  let decision: ReviewDecision;
  if (duplicate.verdict === "fail" || technical.verdict === "fail") decision = "REJECT";
  else if (overallScore >= configView.stockReadyScore) decision = "PASS";
  else if (overallScore >= configView.stockManualReviewScore) decision = "PASS_WITH_WARNING";
  else decision = "REWORK";

  updateAssetScores(asset.id, {
    technicalScore,
    visualScore,
    commercialScore,
    policyScore,
    overallScore,
    reviewStatus: decision === "REJECT" ? "rejected" : decision === "REWORK" ? "needs_fixes" : decision === "PASS" ? "approved" : "hold",
    stockStatus: decision === "PASS" ? "ready" : decision === "PASS_WITH_WARNING" ? "manual_review" : decision === "REJECT" ? "rejected" : "none",
  });
  return { decision, overallScore, reviews };
}

export function listReviewsForAsset(assetId: string): GenerationReview[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM gen_reviews WHERE asset_id = ? ORDER BY created_at, id")
    .all(assetId) as Record<string, unknown>[];
  return rows.map(rowToReview);
}
