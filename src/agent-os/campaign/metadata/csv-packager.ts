// Pao Stock Autonomous Campaign Planner — Adobe Stock CSV Packager (Phase 21)
//
// Formats and builds compliant Adobe Stock batch upload CSV manifests
// containing filenames, titles, comma-separated keywords, category numbers, and release flags.

import { openAgentOsDb } from "../../db";
import { generateMetadataForItem } from "./stock-metadata-engine";

export interface CsvManifestResult {
  csv: string;
  rowCount: number;
  campaignId: string;
  campaignTitle: string;
}

function escapeCsvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Builds the Adobe Stock upload manifest for all completed or ready items of a campaign.
 */
export function generateCampaignCsvManifest(campaignId: string): CsvManifestResult {
  const db = openAgentOsDb();

  const campaign = db
    .query("SELECT id, title, metadata_json FROM stock_campaigns WHERE id = ?")
    .get(campaignId) as { id: string; title: string; metadata_json: string } | undefined;

  if (!campaign) {
    throw new Error(`Campaign '${campaignId}' not found`);
  }

  let campaignMeta: Record<string, unknown> = {};
  try {
    campaignMeta = JSON.parse(campaign.metadata_json);
  } catch {
    campaignMeta = {};
  }

  const category = (campaignMeta.category as string) || "general";
  const keyword = (campaignMeta.keyword as string) || "";

  // Fetch items for campaign (all passed_qc or items in campaign)
  const items = db
    .query("SELECT * FROM stock_campaign_items WHERE campaign_id = ?")
    .all(campaignId) as Record<string, unknown>[];

  const header = "Filename,Title,Keywords,Category,Releases";
  const rows: string[] = [header];

  for (const item of items) {
    const itemId = item.id as string;
    const assetType = item.asset_type as string;
    const prompt = (item.prompt as string) || "";
    const angle = (item.angle as string) || "";
    const lighting = (item.lighting as string) || "";

    const ext = assetType === "video_4k" ? "mp4" : assetType === "isolated_element" ? "png" : "jpg";
    const filename = `${itemId}.${ext}`;

    const meta = generateMetadataForItem({
      prompt,
      keyword,
      category,
      assetType,
      angle,
      lighting,
    });

    const keywordsFormatted = meta.keywords.join(", ");

    const line = [
      escapeCsvField(filename),
      escapeCsvField(meta.title),
      escapeCsvField(keywordsFormatted),
      meta.categoryNumber.toString(),
      "", // No model releases required for clean AI commercial generative assets
    ].join(",");

    rows.push(line);
  }

  return {
    csv: rows.join("\r\n"),
    rowCount: items.length,
    campaignId,
    campaignTitle: campaign.title,
  };
}
