// Pao Stock Autonomous Campaign Planner — Workload Execution Dispatcher (Phase 21)
//
// Bridges campaign prompt matrices to Phase 19/20 Generation Queue & Workload Router,
// converting planned campaign items into active background GPU generation jobs.

import { openAgentOsDb } from "../../db";
import { createJob } from "../../generation/queue";
import type { CampaignItem, StockCampaign } from "../types";

export interface DispatchItemResult {
  itemId: string;
  jobId: string;
  assetType: string;
  dimensions: { width: number; height: number };
}

export interface CampaignDispatchResult {
  ok: boolean;
  campaignId: string;
  dispatchedCount: number;
  items: DispatchItemResult[];
  jobIds: string[];
  alreadyRenderingCount: number;
  skippedCount: number;
}

export interface CampaignSyncResult {
  ok: boolean;
  campaignId: string;
  totalItems: number;
  completedItems: number;
  completedCount: number;
  renderingItems: number;
  remainingCount: number;
  failedItems: number;
  campaignStatus: string;
}

/**
 * Maps standard aspect ratios to optimal pixel dimensions for generation.
 */
export function resolveDimensions(aspectRatio: string, assetType: string): { width: number; height: number } {
  if (assetType === "video_4k") {
    // Default 1080p standard ratio (can be upscaled to 4K downstream)
    if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
    return { width: 1920, height: 1080 };
  }

  switch (aspectRatio) {
    case "16:9":
      return { width: 1824, height: 1024 };
    case "3:2":
      return { width: 1536, height: 1024 };
    case "2:3":
      return { width: 1024, height: 1536 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:5":
      return { width: 1024, height: 1280 };
    case "9:16":
      return { width: 1024, height: 1824 };
    default:
      return { width: 1024, height: 1024 };
  }
}

/**
 * Dispatches all pending items of a campaign into the persistent generation queue.
 */
export function dispatchCampaign(campaignId: string): CampaignDispatchResult {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  // 1. Verify campaign exists
  const campaign = db.query("SELECT * FROM stock_campaigns WHERE id = ?").get(campaignId) as StockCampaign | undefined;
  if (!campaign) {
    throw new Error(`Campaign '${campaignId}' not found`);
  }

  // 2. Fetch pending items
  const pendingRows = db
    .query("SELECT * FROM stock_campaign_items WHERE campaign_id = ? AND render_status = 'pending'")
    .all(campaignId) as Record<string, unknown>[];

  const renderingCountRow = db
    .query("SELECT COUNT(*) as count FROM stock_campaign_items WHERE campaign_id = ? AND render_status = 'rendering'")
    .get(campaignId) as { count: number };

  const dispatched: DispatchItemResult[] = [];

  for (const row of pendingRows) {
    const itemId = row.id as string;
    const assetType = row.asset_type as string;
    const prompt = row.prompt as string;
    const negativePrompt = (row.negative_prompt as string) || "";
    const aspectRatio = (row.aspect_ratio as string) || "16:9";
    const assignedProvider = (row.assigned_provider as string) || "comfyui";

    const dimensions = resolveDimensions(aspectRatio, assetType);
    const jobType = assetType === "video_4k" ? "text_to_video" : "text_to_image";
    const parameters: Record<string, unknown> = {
      campaign_id: campaignId,
      campaign_item_id: itemId,
      aspect_ratio: aspectRatio,
    };

    if (assetType === "isolated_element") {
      parameters.output_mode = "transparent";
    }

    // Enqueue job via Phase 19/20 persistent queue
    const { job } = createJob({
      projectId: null,
      jobType,
      providerId: assignedProvider,
      prompt,
      negativePrompt,
      width: dimensions.width,
      height: dimensions.height,
      stockMode: true,
      autoReview: true,
      parameters,
    });

    // Link job back to campaign item
    db.query(
      "UPDATE stock_campaign_items SET gpu_job_id = ?, render_status = 'rendering' WHERE id = ?"
    ).run(job.id, itemId);

    dispatched.push({
      itemId,
      jobId: job.id,
      assetType,
      dimensions,
    });
  }

  // If campaign was in draft, transition to active
  if (dispatched.length > 0 && campaign.status === "draft") {
    db.query("UPDATE stock_campaigns SET status = 'active', updated_at = ? WHERE id = ?").run(now, campaignId);
  }

  return {
    ok: true,
    campaignId,
    dispatchedCount: dispatched.length,
    items: dispatched,
    jobIds: dispatched.map((d) => d.jobId),
    alreadyRenderingCount: renderingCountRow.count,
    skippedCount: renderingCountRow.count,
  };
}

/**
 * Synchronizes execution states between gen_jobs and stock_campaign_items.
 */
export function syncCampaignExecution(campaignId: string): CampaignSyncResult {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  // Find all items currently marked as rendering with a linked job
  const renderingItems = db
    .query("SELECT id, gpu_job_id FROM stock_campaign_items WHERE campaign_id = ? AND render_status = 'rendering' AND gpu_job_id IS NOT NULL")
    .all(campaignId) as Array<{ id: string; gpu_job_id: string }>;

  for (const item of renderingItems) {
    const job = db.query("SELECT status, progress FROM gen_jobs WHERE id = ?").get(item.gpu_job_id) as
      | { status: string; progress: number }
      | undefined;

    if (!job) continue;

    if (job.status === "completed") {
      db.query("UPDATE stock_campaign_items SET render_status = 'passed_qc' WHERE id = ?").run(item.id);
    } else if (job.status === "failed" || job.status === "cancelled") {
      db.query("UPDATE stock_campaign_items SET render_status = 'failed_qc' WHERE id = ?").run(item.id);
    }
  }

  // Tally current statuses
  const counts = db
    .query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN render_status = 'passed_qc' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN render_status = 'rendering' THEN 1 ELSE 0 END) as rendering,
        SUM(CASE WHEN render_status = 'failed_qc' THEN 1 ELSE 0 END) as failed
      FROM stock_campaign_items
      WHERE campaign_id = ?
    `)
    .get(campaignId) as { total: number; completed: number; rendering: number; failed: number };

  const total = counts.total || 0;
  const completed = counts.completed || 0;
  const rendering = counts.rendering || 0;
  const failed = counts.failed || 0;

  // Update campaign's completed_asset_count
  db.query(
    "UPDATE stock_campaigns SET completed_asset_count = ?, updated_at = ? WHERE id = ?"
  ).run(completed, now, campaignId);

  // If all items finished and none rendering or pending, update campaign status
  let campaignStatus = "active";
  if (total > 0 && rendering === 0 && completed + failed >= total) {
    campaignStatus = completed > 0 ? "completed" : "paused";
    db.query("UPDATE stock_campaigns SET status = ?, updated_at = ? WHERE id = ?").run(campaignStatus, now, campaignId);
  }

  return {
    ok: true,
    campaignId,
    totalItems: total,
    completedItems: completed,
    completedCount: completed,
    renderingItems: rendering,
    remainingCount: rendering,
    failedItems: failed,
    campaignStatus,
  };
}
