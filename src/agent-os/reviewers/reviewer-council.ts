// Pao AI Media Factory — Reviewer Council Orchestrator (Phase 16)
//
// Orchestrates the 5 Reviewer Council agents, records findings into stock_qc_reviews,
// determines the final decision contract, and transitions asset lifecycle state.

import {
  runTechnicalQcAgent,
  runVisualArtifactAgent,
  runCommercialValueReviewer,
  runSimilarityReviewer,
  runComplianceReviewer,
  type ReviewerReport,
} from "./stock-reviewers";
import {
  getStockAsset,
  updateStockAssetStatus,
  recordStockQcReview,
  type StockAsset,
  type AssetStatus,
} from "../stock-models";
import type { AssetSignature } from "../similarity/similarity-engine";

export type CouncilDecision =
  | "READY_FOR_HUMAN_SUBMISSION_REVIEW"
  | "NEEDS_FIXES"
  | "HOLD_FOR_COMPLIANCE_REVIEW"
  | "REJECT_INTERNALLY";

export interface CouncilEvaluationSummary {
  assetId: string;
  decision: CouncilDecision;
  compositeScore: number; // 0 to 100
  reports: ReviewerReport[];
  recommendedAssetStatus: AssetStatus;
  notes: string;
  evaluatedAt: string;
}

export interface ReviewCouncilOptions {
  siblings?: AssetSignature[];
  artifactFlags?: Parameters<typeof runVisualArtifactAgent>[1];
  commercialContext?: Parameters<typeof runCommercialValueReviewer>[1];
  metadata?: { title?: string; keywords?: string[] };
}

/**
 * Runs the 5 Reviewer Council agents against a target asset, records the reports,
 * calculates the final decision, and transitions the asset state in the database.
 */
export function evaluateAssetByCouncil(
  asset: StockAsset,
  options: ReviewCouncilOptions = {},
): CouncilEvaluationSummary {
  const reports: ReviewerReport[] = [
    runTechnicalQcAgent(asset),
    runVisualArtifactAgent(asset, options.artifactFlags),
    runCommercialValueReviewer(asset, options.commercialContext),
    runSimilarityReviewer(asset, options.siblings ?? []),
    runComplianceReviewer(asset, options.metadata),
  ];

  // Persist each review report in SQLite
  for (const report of reports) {
    recordStockQcReview({
      assetId: asset.id,
      reviewer: report.reviewer,
      verdict: report.verdict,
      score: report.score,
      report: {
        issues: report.issues,
        recommendations: report.recommendations,
        ...report.details,
      },
    });
  }

  // Determine Council Decision Contract
  const technical = reports.find((r) => r.reviewer === "technical_qc_agent")!;
  const visual = reports.find((r) => r.reviewer === "visual_artifact_agent")!;
  const commercial = reports.find((r) => r.reviewer === "commercial_value_reviewer")!;
  const similarity = reports.find((r) => r.reviewer === "similarity_reviewer")!;
  const compliance = reports.find((r) => r.reviewer === "compliance_reviewer")!;

  let decision: CouncilDecision = "READY_FOR_HUMAN_SUBMISSION_REVIEW";
  let recommendedStatus: AssetStatus = "HUMAN_REVIEW";
  let notes = "All Reviewer Council checks passed. Asset is ready for human approval.";

  if (compliance.verdict === "warn" || (compliance.details.flaggedTerms as string[])?.length > 0) {
    decision = "HOLD_FOR_COMPLIANCE_REVIEW";
    recommendedStatus = "HOLD_COMPLIANCE";
    notes = "Potential trademark/IP risk flagged. Asset held for human compliance verification.";
  } else if (similarity.verdict === "fail" || commercial.verdict === "fail") {
    decision = "REJECT_INTERNALLY";
    recommendedStatus = "REJECT_INTERNAL";
    notes = similarity.verdict === "fail"
      ? "Rejected internally: Duplicate asset detected in batch."
      : "Rejected internally: Low commercial utility.";
  } else if (technical.verdict === "fail" || visual.verdict === "fail") {
    decision = "NEEDS_FIXES";
    recommendedStatus = "NEEDS_FIXES";
    notes = "Quality issues detected: Requires technical resize, inpainting, or prompt refinement.";
  }

  // Calculate weighted composite score
  const weights: Record<string, number> = {
    technical_qc_agent: 0.25,
    visual_artifact_agent: 0.25,
    commercial_value_reviewer: 0.20,
    similarity_reviewer: 0.15,
    compliance_reviewer: 0.15,
  };

  const compositeScore = Math.round(
    reports.reduce((sum, r) => sum + r.score * (weights[r.reviewer] ?? 0.2), 0),
  );

  // Update asset status in database
  updateStockAssetStatus(asset.id, recommendedStatus);

  return {
    assetId: asset.id,
    decision,
    compositeScore,
    reports,
    recommendedAssetStatus: recommendedStatus,
    notes,
    evaluatedAt: new Date().toISOString(),
  };
}

/** Human Override of a Council decision with mandatory reason note */
export function applyHumanCouncilOverride(
  assetId: string,
  newDecision: "APPROVED" | "REJECTED" | "RETURNED_FOR_FIX",
  operatorNote: string,
  operatorName = "dashboard-operator",
): { success: boolean; newStatus: AssetStatus } {
  if (!operatorNote || operatorNote.trim().length === 0) {
    throw new Error("Human override requires an explanatory operator note.");
  }

  const asset = getStockAsset(assetId);
  if (!asset) {
    throw new Error(`Asset ${assetId} not found.`);
  }

  let newStatus: AssetStatus = "NEEDS_FIXES";
  if (newDecision === "APPROVED") {
    newStatus = "EXPORT_READY";
  } else if (newDecision === "REJECTED") {
    newStatus = "REJECT_INTERNAL";
  } else if (newDecision === "RETURNED_FOR_FIX") {
    newStatus = "NEEDS_FIXES";
  }

  recordStockQcReview({
    assetId,
    reviewer: "human_supervisor",
    verdict: newDecision === "APPROVED" ? "pass" : "fail",
    score: newDecision === "APPROVED" ? 100 : 0,
    report: {
      action: "human_override",
      operator: operatorName,
      previousStatus: asset.status,
      newStatus,
      note: operatorNote,
    },
  });

  updateStockAssetStatus(assetId, newStatus);
  return { success: true, newStatus };
}
