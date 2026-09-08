// Pao Stock Autonomous Campaign Planner — Campaign Matrix Planner (Phase 21)
//
// Formulates structured 10-shot diverse campaign portfolios (video_4k, photo_raw, isolated_element)
// with diverse angles, lighting, aspect ratios, and stock-optimized prompts.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import {
  getTrendSignal,
  updateTrendSignalStatus,
} from "../trends/signal-collector";
import type {
  AssetType,
  CampaignItem,
  CampaignStatus,
  PlanCampaignRequest,
  RenderStatus,
  StockCampaign,
} from "../types";

export const DEFAULT_STOCK_NEGATIVE_PROMPT =
  "watermark, text, signature, low quality, artifacts, blur, oversaturated, deformed fingers, extra limbs, bad anatomy, copyright logo, trademark brand, noise, compression artifacts";

interface ShotSpec {
  assetType: AssetType;
  angle: string;
  lighting: string;
  aspectRatio: string;
  shotDescription: string;
}

// 10-shot diversity template matrix
const DIVERSE_SHOT_MATRIX: ShotSpec[] = [
  // Motion Video Assets (4K)
  {
    assetType: "video_4k",
    angle: "wide_establishing",
    lighting: "cinematic_golden_hour",
    aspectRatio: "16:9",
    shotDescription: "Cinematic wide establishing shot, smooth slow camera push, professional documentary grade",
  },
  {
    assetType: "video_4k",
    angle: "eye_level",
    lighting: "natural_diffused",
    aspectRatio: "16:9",
    shotDescription: "Realistic eye-level footage, organic movement, commercial editorial depth of field",
  },
  {
    assetType: "video_4k",
    angle: "drone_overhead",
    lighting: "dramatic_high_contrast",
    aspectRatio: "16:9",
    shotDescription: "Smooth aerial top-down crane orbit, expansive scale, ultra HD high framerate",
  },
  // High-Resolution RAW Stills
  {
    assetType: "photo_raw",
    angle: "low_angle_hero",
    lighting: "clean_commercial_studio",
    aspectRatio: "3:2",
    shotDescription: "Hero perspective, dynamic low angle, crisp optical clarity, 50mm f/1.8 aesthetic",
  },
  {
    assetType: "photo_raw",
    angle: "close_up_macro",
    lighting: "natural_diffused",
    aspectRatio: "3:2",
    shotDescription: "High-detail macro focus on intricate texture and engineered components, shallow focus",
  },
  {
    assetType: "photo_raw",
    angle: "isometric_overview",
    lighting: "clean_commercial_studio",
    aspectRatio: "16:9",
    shotDescription: "Clean technical isometric viewpoint, corporate presentation ready, ample copy space",
  },
  {
    assetType: "photo_raw",
    angle: "eye_level",
    lighting: "cinematic_golden_hour",
    aspectRatio: "3:2",
    shotDescription: "Authentic environmental photo, warm sunset rim light, genuine commercial editorial look",
  },
  {
    assetType: "photo_raw",
    angle: "wide_establishing",
    lighting: "dramatic_high_contrast",
    aspectRatio: "16:9",
    shotDescription: "Architectural wide angle, clean lines, professional magazine cover composition",
  },
  // Isolated PNG / Transparent Elements
  {
    assetType: "isolated_element",
    angle: "eye_level",
    lighting: "clean_commercial_studio",
    aspectRatio: "1:1",
    shotDescription: "Isolated on solid clean background, studio rim lighting, crisp alpha cutout boundary",
  },
  {
    assetType: "isolated_element",
    angle: "isometric_overview",
    lighting: "clean_commercial_studio",
    aspectRatio: "1:1",
    shotDescription: "Isolated 3D isometric asset, neutral shadow underneath, transparent background ready",
  },
];

interface StockCampaignRow {
  id: string;
  title: string;
  trend_signal_id: string | null;
  target_platform: string;
  target_asset_count: number;
  completed_asset_count: number;
  budget_cents: number;
  spent_cents: number;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface CampaignItemRow {
  id: string;
  campaign_id: string;
  asset_type: string;
  title: string;
  prompt: string;
  negative_prompt: string;
  aspect_ratio: string;
  lighting: string;
  angle: string;
  assigned_provider: string;
  gpu_job_id: string | null;
  render_status: string;
  created_at: string;
}

function mapRowToCampaign(row: StockCampaignRow): StockCampaign {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    title: row.title,
    trendSignalId: row.trend_signal_id,
    targetPlatform: row.target_platform,
    targetAssetCount: row.target_asset_count,
    completedAssetCount: row.completed_asset_count,
    budgetCents: row.budget_cents,
    spentCents: row.spent_cents,
    status: row.status as CampaignStatus,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToItem(row: CampaignItemRow): CampaignItem {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    assetType: row.asset_type as AssetType,
    title: row.title,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    aspectRatio: row.aspect_ratio,
    lighting: row.lighting,
    angle: row.angle,
    assignedProvider: row.assigned_provider,
    gpuJobId: row.gpu_job_id,
    renderStatus: row.render_status as RenderStatus,
    createdAt: row.created_at,
  };
}

/**
 * Plans a new campaign from a trend signal or custom keyword.
 * Generates a diverse matrix of 10 shot items and records them in SQLite.
 */
export function planCampaign(request: PlanCampaignRequest): {
  campaign: StockCampaign;
  items: CampaignItem[];
} {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  let keyword = request.keyword?.trim();
  let category = request.category ?? "commercial";
  const trendSignal = request.trendSignalId
    ? getTrendSignal(request.trendSignalId)
    : null;

  if (trendSignal) {
    keyword = trendSignal.keyword;
    category = trendSignal.category;
  }

  if (!keyword) {
    keyword = "sustainable green technology innovations";
  }

  const campaignId = `cmp_${randomUUID().slice(0, 8)}`;
  const title =
    request.title?.trim() ||
    `Campaign: ${keyword.slice(0, 40)} [${category}]`;

  const targetAssetCount = request.targetAssetCount ?? 10;
  const targetPlatform = request.targetPlatform ?? "adobe_stock";
  const budgetCents = request.budgetCents ?? 5000; // $50.00 default compute budget
  const preferredProvider = request.preferredProvider ?? "comfyui";

  const campaignMetadata = {
    category,
    keyword,
    trendSignalId: trendSignal?.id ?? null,
    nvsScore: trendSignal?.nicheViabilityScore ?? null,
    plannedBy: "pao_stock_planner_v1",
  };

  // 1. Insert Campaign Record
  db.query(`
    INSERT INTO stock_campaigns (
      id, title, trend_signal_id, target_platform,
      target_asset_count, completed_asset_count, budget_cents,
      spent_cents, status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 'active', ?, ?, ?)
  `).run(
    campaignId,
    title,
    trendSignal?.id ?? null,
    targetPlatform,
    targetAssetCount,
    budgetCents,
    JSON.stringify(campaignMetadata),
    now,
    now
  );

  // 2. Generate and Insert Items
  const items: CampaignItem[] = [];
  const countToGenerate = Math.min(targetAssetCount, DIVERSE_SHOT_MATRIX.length);

  for (let i = 0; i < countToGenerate; i++) {
    const spec = DIVERSE_SHOT_MATRIX[i];
    const itemId = `cmi_${randomUUID().slice(0, 8)}`;
    const itemTitle = `${keyword} - ${spec.angle} (${spec.assetType})`;

    const prompt = `${keyword}, ${spec.shotDescription}, professional photography, 8k resolution, stock photo excellence, copy space, highly detailed`;

    db.query(`
      INSERT INTO stock_campaign_items (
        id, campaign_id, asset_type, title, prompt,
        negative_prompt, aspect_ratio, lighting, angle,
        assigned_provider, gpu_job_id, render_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)
    `).run(
      itemId,
      campaignId,
      spec.assetType,
      itemTitle,
      prompt,
      DEFAULT_STOCK_NEGATIVE_PROMPT,
      spec.aspectRatio,
      spec.lighting,
      spec.angle,
      preferredProvider,
      now
    );

    items.push({
      id: itemId,
      campaignId,
      assetType: spec.assetType,
      title: itemTitle,
      prompt,
      negativePrompt: DEFAULT_STOCK_NEGATIVE_PROMPT,
      aspectRatio: spec.aspectRatio,
      lighting: spec.lighting,
      angle: spec.angle,
      assignedProvider: preferredProvider,
      gpuJobId: null,
      renderStatus: "pending",
      createdAt: now,
    });
  }

  // 3. Mark Trend Signal as planned if linked
  if (trendSignal) {
    updateTrendSignalStatus(trendSignal.id, "planned");
  }

  const campaign: StockCampaign = {
    id: campaignId,
    title,
    trendSignalId: trendSignal?.id ?? null,
    targetPlatform,
    targetAssetCount,
    completedAssetCount: 0,
    budgetCents,
    spentCents: 0,
    status: "active",
    metadata: campaignMetadata,
    createdAt: now,
    updatedAt: now,
  };

  return { campaign, items };
}

/**
 * Gets a Campaign by ID.
 */
export function getCampaign(id: string): StockCampaign | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM stock_campaigns WHERE id = ?")
    .get(id) as StockCampaignRow | undefined;
  return row ? mapRowToCampaign(row) : null;
}

/**
 * Lists Campaigns with optional status filtering.
 */
export function listCampaigns(options?: {
  status?: CampaignStatus;
  limit?: number;
}): StockCampaign[] {
  const db = openAgentOsDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : "LIMIT 50";

  const rows = db
    .query(`SELECT * FROM stock_campaigns ${whereClause} ORDER BY created_at DESC ${limitClause}`)
    .all(...params) as StockCampaignRow[];

  return rows.map(mapRowToCampaign);
}

/**
 * Gets all CampaignItems for a Campaign.
 */
export function getCampaignItems(campaignId: string): CampaignItem[] {
  const db = openAgentOsDb();
  const rows = db
    .query(
      "SELECT * FROM stock_campaign_items WHERE campaign_id = ? ORDER BY created_at ASC"
    )
    .all(campaignId) as CampaignItemRow[];

  return rows.map(mapRowToItem);
}

/**
 * Updates campaign status.
 */
export function updateCampaignStatus(
  id: string,
  status: CampaignStatus
): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`UPDATE stock_campaigns SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    id
  );
}

/**
 * Updates an individual campaign item's render status.
 */
export function updateCampaignItemStatus(
  itemId: string,
  renderStatus: RenderStatus,
  gpuJobId?: string | null
): void {
  const db = openAgentOsDb();
  if (gpuJobId !== undefined) {
    db.query(`
      UPDATE stock_campaign_items
      SET render_status = ?, gpu_job_id = ?
      WHERE id = ?
    `).run(renderStatus, gpuJobId, itemId);
  } else {
    db.query(`
      UPDATE stock_campaign_items
      SET render_status = ?
      WHERE id = ?
    `).run(renderStatus, itemId);
  }
}
