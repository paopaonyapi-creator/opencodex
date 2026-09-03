// Pao AI Media Factory — Reviewer Council Agents (Phase 16)
//
// 5 specialized, independent reviewer agents evaluating stock assets against
// technical, visual, commercial, uniqueness, and compliance standards.

import { validateStockJpeg } from "../validators/stock-jpeg-validator";
import { validateStockPng } from "../validators/stock-png-validator";
import { validateStockVideo } from "../validators/stock-video-validator";
import { evaluateSimilarity, type AssetSignature, type SimilarityResult } from "../similarity/similarity-engine";
import { ADOBE_STOCK_RULES } from "../config/adobe-stock-rules";
import type { StockAsset } from "../stock-models";

export type ReviewerVerdict = "pass" | "warn" | "fail";

export interface ReviewerReport {
  reviewer: string;
  verdict: ReviewerVerdict;
  score: number; // 0 to 100
  issues: string[];
  recommendations: string[];
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Technical QC Agent
// ---------------------------------------------------------------------------
export function runTechnicalQcAgent(asset: StockAsset): ReviewerReport {
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (asset.type === "image") {
    const result = validateStockJpeg({
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      fileSizeBytes: (asset.prompt?.fileSizeBytes as number) ?? 4 * 1024 * 1024,
      format: "jpeg",
      colorProfile: (asset.prompt?.colorProfile as string) ?? "sRGB",
    });

    issues.push(...result.errors);
    recommendations.push(...result.warnings);

    const score = result.valid ? (result.warnings.length === 0 ? 100 : 85) : Math.max(20, 70 - result.errors.length * 25);
    const verdict: ReviewerVerdict = result.valid ? (result.warnings.length === 0 ? "pass" : "warn") : "fail";

    return {
      reviewer: "technical_qc_agent",
      verdict,
      score,
      issues,
      recommendations,
      details: { ...result.details, megapixels: result.megapixels },
    };
  }

  if (asset.type === "png") {
    const result = validateStockPng({
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      fileSizeBytes: (asset.prompt?.fileSizeBytes as number) ?? 5 * 1024 * 1024,
      format: "png",
      alphaStats: (asset.prompt?.alphaStats as Record<string, unknown>) ?? { hasAlphaChannel: true, transparentRatio: 0.35 },
    });

    issues.push(...result.errors);
    recommendations.push(...result.warnings);

    const score = result.valid ? (result.warnings.length === 0 ? 100 : 85) : Math.max(20, 60 - result.errors.length * 20);
    const verdict: ReviewerVerdict = result.valid ? (result.warnings.length === 0 ? "pass" : "warn") : "fail";

    return {
      reviewer: "technical_qc_agent",
      verdict,
      score,
      issues,
      recommendations,
      details: { ...result.details, megapixels: result.megapixels },
    };
  }

  if (asset.type === "video") {
    const result = validateStockVideo({
      durationSeconds: asset.durationSeconds ?? 0,
      container: (asset.prompt?.container as string) ?? "mp4",
      codec: asset.codec ?? "h264",
      fps: asset.fps ?? 30,
      width: asset.width ?? 1920,
      height: asset.height ?? 1080,
    });

    issues.push(...result.errors);
    recommendations.push(...result.warnings);

    const score = result.valid ? (result.warnings.length === 0 ? 100 : 85) : Math.max(20, 65 - result.errors.length * 20);
    const verdict: ReviewerVerdict = result.valid ? (result.warnings.length === 0 ? "pass" : "warn") : "fail";

    return {
      reviewer: "technical_qc_agent",
      verdict,
      score,
      issues,
      recommendations,
      details: result.details,
    };
  }

  return {
    reviewer: "technical_qc_agent",
    verdict: "fail",
    score: 0,
    issues: [`Unknown asset type: ${asset.type}`],
    recommendations: [],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// 2. Visual Artifact Reviewer Agent
// ---------------------------------------------------------------------------
export function runVisualArtifactAgent(
  asset: StockAsset,
  artifactFlags: {
    hasAnatomyDefect?: boolean;
    hasBlurOrOverSharpen?: boolean;
    hasMalformedText?: boolean;
    hasEdgeHalo?: boolean;
    hasTemporalInstability?: boolean;
    hasLimbMorphing?: boolean;
    detectedArtifacts?: string[];
  } = {},
): ReviewerReport {
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (artifactFlags.hasAnatomyDefect) {
    issues.push("Anatomical anomaly detected (distorted hands/limbs or facial asymmetry).");
  }
  if (artifactFlags.hasBlurOrOverSharpen) {
    issues.push("Visual quality defect: severe blur or unnatural over-sharpening halo.");
  }
  if (artifactFlags.hasMalformedText) {
    issues.push("Unreadable gibberish or distorted AI-generated text detected.");
  }
  if (artifactFlags.hasEdgeHalo) {
    issues.push("Transparent silhouette has edge fringe or color bleeding halo.");
  }
  if (artifactFlags.hasTemporalInstability) {
    issues.push("Video exhibits frame flicker or temporal lighting incoherence.");
  }
  if (artifactFlags.hasLimbMorphing) {
    issues.push("Video exhibits unnatural subject morphing or duplicate limbs across frames.");
  }
  if (artifactFlags.detectedArtifacts) {
    issues.push(...artifactFlags.detectedArtifacts);
  }

  const criticalIssues = issues.filter(
    (i) => i.includes("Anatomical") || i.includes("morphing") || i.includes("Malformed"),
  );

  let verdict: ReviewerVerdict = "pass";
  let score = 95;

  if (criticalIssues.length > 0) {
    verdict = "fail";
    score = Math.max(10, 60 - issues.length * 20);
    recommendations.push("Regenerate asset with refined negative prompt or apply targeted inpainting fix.");
  } else if (issues.length > 0) {
    verdict = "warn";
    score = Math.max(50, 85 - issues.length * 15);
    recommendations.push("Inspect preview carefully before final approval.");
  }

  return {
    reviewer: "visual_artifact_agent",
    verdict,
    score,
    issues,
    recommendations,
    details: { detectedArtifactsCount: issues.length, criticalIssuesCount: criticalIssues.length },
  };
}

// ---------------------------------------------------------------------------
// 3. Commercial Value Reviewer Agent
// ---------------------------------------------------------------------------
export function runCommercialValueReviewer(
  asset: StockAsset,
  commercialContext: {
    hasClearSubject?: boolean;
    hasCopySpace?: boolean;
    buyerUtilityRating?: number; // 1 to 5
    compositionClarity?: "excellent" | "good" | "cluttered" | "poor";
    notes?: string;
  } = {},
): ReviewerReport {
  const issues: string[] = [];
  const recommendations: string[] = [];

  const {
    hasClearSubject = true,
    hasCopySpace = true,
    buyerUtilityRating = 4,
    compositionClarity = "good",
  } = commercialContext;

  if (!hasClearSubject) {
    issues.push("Subject lacks clarity or focal dominance; unclear what buyer would use this for.");
  }
  if (compositionClarity === "poor" || compositionClarity === "cluttered") {
    issues.push("Composition is overly busy or unbalanced for standard commercial layout use.");
  }
  if (buyerUtilityRating < 2) {
    issues.push("Low commercial utility rating. Asset is visually abstract with no defined marketing application.");
  }

  if (!hasCopySpace) {
    recommendations.push("Consider framing with copy space (uncluttered third) to appeal to designers.");
  }

  let verdict: ReviewerVerdict = "pass";
  let score = 70 + buyerUtilityRating * 6; // ~94

  if (issues.length >= 2 || buyerUtilityRating <= 1) {
    verdict = "fail";
    score = Math.max(20, 50 - issues.length * 15);
    recommendations.push("Reject internally or re-frame with a distinct commercial use case.");
  } else if (issues.length === 1) {
    verdict = "warn";
    score = 72;
  }

  return {
    reviewer: "commercial_value_reviewer",
    verdict,
    score: Math.min(100, score),
    issues,
    recommendations,
    details: { buyerUtilityRating, compositionClarity, hasCopySpace },
  };
}

// ---------------------------------------------------------------------------
// 4. Similarity Reviewer Agent
// ---------------------------------------------------------------------------
export function runSimilarityReviewer(
  asset: StockAsset,
  siblings: AssetSignature[] = [],
): ReviewerReport {
  const candidate: AssetSignature = {
    id: asset.id,
    title: (asset.prompt?.title as string) ?? "",
    promptText: (asset.prompt?.positivePrompt as string) ?? (asset.prompt?.prompt as string) ?? "",
    conceptDescription: (asset.prompt?.description as string) ?? "",
    perceptualHash: (asset.prompt?.perceptualHash as string) ?? undefined,
  };

  const simResult: SimilarityResult = evaluateSimilarity(candidate, siblings);
  const issues: string[] = [];
  const recommendations: string[] = [];

  let verdict: ReviewerVerdict = "pass";
  let score = 95;

  if (simResult.category === "DUPLICATE") {
    verdict = "fail";
    score = 15;
    issues.push(simResult.reason);
    recommendations.push("Reject internally to avoid Adobe Stock account penalty for spam duplicates.");
  } else if (simResult.category === "TOO_SIMILAR") {
    verdict = "warn";
    score = 55;
    issues.push(simResult.reason);
    recommendations.push("Ensure meaningful differentiation in composition or customer story before exporting.");
  } else if (simResult.category === "RELATED_BUT_DISTINCT") {
    score = 85;
    recommendations.push("Complementary asset in series. Verify titles and keywords reflect unique attributes.");
  }

  return {
    reviewer: "similarity_reviewer",
    verdict,
    score,
    issues,
    recommendations,
    details: {
      category: simResult.category,
      similarityScore: simResult.score,
      matchedSiblingId: simResult.matchedSiblingId,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Compliance Reviewer Agent
// ---------------------------------------------------------------------------
export function runComplianceReviewer(
  asset: StockAsset,
  metadata?: { title?: string; keywords?: string[] },
): ReviewerReport {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const flaggedTerms: string[] = [];

  const textToScan = [
    asset.prompt?.positivePrompt,
    asset.prompt?.prompt,
    asset.prompt?.concept,
    metadata?.title,
    ...(metadata?.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  for (const pattern of ADOBE_STOCK_RULES.metadata.prohibitedPatterns) {
    const match = textToScan.match(pattern);
    if (match) {
      flaggedTerms.push(match[0]);
      issues.push(`Potential intellectual property/trademark risk flagged: "${match[0]}".`);
    }
  }

  if (!asset.generatedAi) {
    issues.push("Generative AI flag is disabled on AI-generated asset. Adobe requires mandatory AI labeling.");
  }

  let verdict: ReviewerVerdict = "pass";
  let score = 100;

  if (flaggedTerms.length > 0) {
    verdict = "warn"; // Compliance holds require human decision, not blind auto-fail
    score = 40;
    recommendations.push("Hold for Compliance Review: Human operator must inspect IP flags before release.");
  } else if (!asset.generatedAi) {
    verdict = "fail";
    score = 50;
    recommendations.push("Enable generatedAi flag before exporting.");
  }

  return {
    reviewer: "compliance_reviewer",
    verdict,
    score,
    issues,
    recommendations,
    details: {
      flaggedTerms,
      requiresHumanVerification: true,
      legalDisclaimer: "Automated scan only; final compliance is certified by human reviewer.",
    },
  };
}
