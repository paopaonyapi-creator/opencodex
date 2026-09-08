// Pao Stock Autonomous Campaign Planner — Reviewer Council Evaluator (Phase 21)
//
// Orchestrates multi-factor Reviewer Council authorization for campaign items,
// evaluating technical quality, IP safety, and persisting verdicts into stock_qc_records.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { CouncilVerdict, QcRecord } from "../types";
import { scanIpClearance } from "./ip-sanitizer";
import { evaluateVisualQc } from "./visual-qc-gate";

export interface EvaluateItemInput {
  campaignItemId: string;
  width?: number;
  height?: number;
  blurEstimate?: number;
  compressionArtifacts?: number;
  colorBanding?: number;
}

export interface CouncilEvaluationResult {
  ok: boolean;
  record: QcRecord;
  reasons: string[];
  recommendation: string;
}

/**
 * Runs full technical QC and Reviewer Council clearance on a campaign item.
 */
export function evaluateCampaignItem(input: EvaluateItemInput): CouncilEvaluationResult {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  // 1. Fetch item details
  const item = db
    .query("SELECT * FROM stock_campaign_items WHERE id = ?")
    .get(input.campaignItemId) as Record<string, unknown> | undefined;

  if (!item) {
    throw new Error(`Campaign item '${input.campaignItemId}' not found`);
  }

  const prompt = (item.prompt as string) || "";
  const negativePrompt = (item.negative_prompt as string) || "";
  const assetType = item.asset_type as "video_4k" | "photo_raw" | "isolated_element";
  const aspectRatio = (item.aspect_ratio as string) || "16:9";

  // Default dimensions if not provided (assume 4K or 8MP for standard generation)
  const width = input.width ?? (assetType === "video_4k" ? 1920 : 3840);
  const height = input.height ?? (assetType === "video_4k" ? 1080 : 2160);

  // 2. Run Visual QC Gate
  const visualQc = evaluateVisualQc({
    assetType,
    width,
    height,
    aspectRatio,
    rawMetrics: {
      blurEstimate: input.blurEstimate,
      compressionArtifacts: input.compressionArtifacts,
      colorBanding: input.colorBanding,
    },
  });

  // 3. Run IP & Trademark Sanitizer
  const ipResult = scanIpClearance(`${prompt} ${negativePrompt}`);

  // 4. Formulate Reviewer Council Verdict
  const reasons: string[] = [];
  let verdict: CouncilVerdict = "approve";

  if (!ipResult.cleared) {
    if (ipResult.status === "flagged_trademark") {
      verdict = "reject";
      reasons.push(`Trademark violation detected: ${ipResult.flaggedTerms.join(", ")}`);
    } else {
      verdict = "human_review";
      reasons.push(`Likeness flag: requires model release verification`);
    }
  }

  if (!visualQc.valid) {
    if (visualQc.sharpnessScore < 50 || visualQc.artifactPenalty > 30) {
      verdict = "reject";
      reasons.push(...visualQc.errors);
    } else {
      if (verdict !== "reject") verdict = "human_review";
      reasons.push(...visualQc.errors, ...visualQc.warnings);
    }
  } else if (visualQc.warnings.length > 0 && verdict === "approve") {
    // Minor warnings don't block approval, but add notice
    reasons.push(...visualQc.warnings);
  }

  // 5. Persist to stock_qc_records table
  const qcId = `qc_${randomUUID().slice(0, 10)}`;
  db.query(`
    INSERT INTO stock_qc_records
      (id, campaign_item_id, sharpness_score, artifact_penalty, ip_clearance_status, council_verdict, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    qcId,
    input.campaignItemId,
    visualQc.sharpnessScore,
    visualQc.artifactPenalty,
    ipResult.status,
    verdict,
    now
  );

  // 6. Update render_status of campaign item
  if (verdict === "approve") {
    db.query("UPDATE stock_campaign_items SET render_status = 'passed_qc' WHERE id = ?").run(input.campaignItemId);
  } else if (verdict === "reject") {
    db.query("UPDATE stock_campaign_items SET render_status = 'failed_qc' WHERE id = ?").run(input.campaignItemId);
  }

  const record: QcRecord = {
    id: qcId,
    campaignItemId: input.campaignItemId,
    sharpnessScore: visualQc.sharpnessScore,
    artifactPenalty: visualQc.artifactPenalty,
    ipClearanceStatus: ipResult.status,
    councilVerdict: verdict,
    verifiedAt: now,
  };

  return {
    ok: true,
    record,
    reasons,
    recommendation: ipResult.recommendation,
  };
}

/**
 * Retrieves all QC records for a specific campaign item.
 */
export function getQcRecordsForItem(campaignItemId: string): QcRecord[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM stock_qc_records WHERE campaign_item_id = ? ORDER BY verified_at DESC")
    .all(campaignItemId) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r.id as string,
    campaignItemId: r.campaign_item_id as string,
    sharpnessScore: r.sharpness_score as number,
    artifactPenalty: r.artifact_penalty as number,
    ipClearanceStatus: r.ip_clearance_status as QcRecord["ipClearanceStatus"],
    councilVerdict: r.council_verdict as CouncilVerdict,
    verifiedAt: r.verified_at as string,
  }));
}
