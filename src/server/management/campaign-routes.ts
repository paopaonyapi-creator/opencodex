// Pao Stock Autonomous Campaign Planner — Management API Routes (Phase 21)
//
// Endpoints under /api/campaign/* (and /api/agent-os/campaign/*):
// - GET /api/campaign/trends — list scored trend signals
// - POST /api/campaign/trends/scan — trigger market trend scanning and NVS scoring
// - POST /api/campaign/plan — formulate 10-shot diverse campaign portfolio
// - GET /api/campaign/list — list planned campaigns
// - GET /api/campaign/:id — get campaign detail, items, and linked trend signal

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getCampaign,
  getCampaignItems,
  listCampaigns,
  planCampaign,
} from "../../agent-os/campaign/planner/campaign-planner";
import {
  getTrendSignal,
  listTrendSignals,
  scanMarketTrends,
} from "../../agent-os/campaign/trends/signal-collector";
import {
  dispatchCampaign,
  syncCampaignExecution,
} from "../../agent-os/campaign/execution/campaign-dispatcher";
import {
  evaluateCampaignItem,
  getQcRecordsForItem,
} from "../../agent-os/campaign/qc/council-evaluator";
import { generateCampaignCsvManifest } from "../../agent-os/campaign/metadata/csv-packager";
import type {
  PlanCampaignRequest,
  TrendScanRequest,
  TrendSignalStatus,
} from "../../agent-os/campaign/types";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

export async function handleCampaignRoutes(
  ctx: ManagementContext
): Promise<Response | null> {
  const { url, req } = ctx;

  let subPath = "";
  if (url.pathname.startsWith("/api/campaign/")) {
    subPath = url.pathname.slice("/api/campaign/".length);
  } else if (url.pathname.startsWith("/api/agent-os/campaign/")) {
    subPath = url.pathname.slice("/api/agent-os/campaign/".length);
  } else if (url.pathname === "/api/campaign" || url.pathname === "/api/agent-os/campaign") {
    subPath = "";
  } else {
    return null;
  }

  // 1. GET /api/campaign/trends — list scored trend signals
  if (subPath === "trends" && req.method === "GET") {
    const category = url.searchParams.get("category") || undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? (statusParam as TrendSignalStatus) : undefined;
    const minScoreParam = url.searchParams.get("minScore");
    const minScore = minScoreParam ? parseFloat(minScoreParam) : undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    const signals = listTrendSignals({ category, status, minScore, limit });
    return jsonResponse(
      {
        ok: true,
        count: signals.length,
        signals,
      },
      200,
      req,
      {}
    );
  }

  // 2. POST /api/campaign/trends/scan — trigger market trend scanning
  if (subPath === "trends/scan" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as TrendScanRequest;
    const signals = await scanMarketTrends({
      categories: body.categories,
      minViabilityScore: body.minViabilityScore,
    });

    return jsonResponse(
      {
        ok: true,
        count: signals.length,
        signals,
      },
      200,
      req,
      {}
    );
  }

  // 3. POST /api/campaign/plan — plan structured 10-shot campaign
  if (subPath === "plan" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as PlanCampaignRequest | null;
    if (!body) {
      return badRequest(req, "Request body is required");
    }

    const { campaign, items } = planCampaign(body);
    return jsonResponse(
      {
        ok: true,
        campaign,
        items,
      },
      201,
      req,
      {}
    );
  }

  // 4. GET /api/campaign/list — list campaigns
  if ((subPath === "list" || subPath === "") && req.method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const campaigns = listCampaigns({
      status: status as never,
      limit,
    });

    return jsonResponse(
      {
        ok: true,
        count: campaigns.length,
        campaigns,
      },
      200,
      req,
      {}
    );
  }

  // 5. POST /api/campaign/:id/dispatch — dispatch pending items to generation queue
  if (req.method === "POST" && subPath.endsWith("/dispatch")) {
    const campaignId = subPath.replace(/\/dispatch$/, "");
    try {
      const result = dispatchCampaign(campaignId);
      return jsonResponse(result, 200, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return notFound(req, msg);
      return badRequest(req, msg);
    }
  }

  // 6. POST /api/campaign/:id/sync — sync execution status from generation queue
  if (req.method === "POST" && subPath.endsWith("/sync")) {
    const campaignId = subPath.replace(/\/sync$/, "");
    try {
      const result = syncCampaignExecution(campaignId);
      return jsonResponse(result, 200, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return badRequest(req, msg);
    }
  }

  // 7. POST /api/campaign/items/:id/qc — run technical QC and Reviewer Council evaluation
  if (req.method === "POST" && subPath.startsWith("items/") && subPath.endsWith("/qc")) {
    const itemId = subPath.slice("items/".length, subPath.length - "/qc".length);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const result = evaluateCampaignItem({
        campaignItemId: itemId,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        blurEstimate: typeof body.blurEstimate === "number" ? body.blurEstimate : undefined,
        compressionArtifacts: typeof body.compressionArtifacts === "number" ? body.compressionArtifacts : undefined,
        colorBanding: typeof body.colorBanding === "number" ? body.colorBanding : undefined,
      });
      return jsonResponse(result, 200, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return notFound(req, msg);
      return badRequest(req, msg);
    }
  }

  // 8. GET /api/campaign/items/:id/qc — list QC records for item
  if (req.method === "GET" && subPath.startsWith("items/") && subPath.endsWith("/qc")) {
    const itemId = subPath.slice("items/".length, subPath.length - "/qc".length);
    const records = getQcRecordsForItem(itemId);
    return jsonResponse({ ok: true, count: records.length, records }, 200, req, {});
  }

  // 9. GET /api/campaign/:id/export — export Adobe Stock CSV manifest
  if (req.method === "GET" && subPath.endsWith("/export")) {
    const campaignId = subPath.replace(/\/export$/, "");
    try {
      const manifest = generateCampaignCsvManifest(campaignId);
      if (url.searchParams.get("format") === "csv") {
        return new Response(manifest.csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${campaignId}-manifest.csv"`,
          },
        });
      }
      return jsonResponse({ ok: true, manifest }, 200, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return notFound(req, msg);
      return badRequest(req, msg);
    }
  }

  // 10. GET /api/campaign/:id — get campaign detail and items
  if (req.method === "GET" && subPath && !subPath.includes("/")) {
    const campaignId = subPath;
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      return notFound(req, `Campaign not found: ${campaignId}`);
    }

    const items = getCampaignItems(campaignId);
    const trendSignal = campaign.trendSignalId
      ? getTrendSignal(campaign.trendSignalId)
      : null;

    return jsonResponse(
      {
        ok: true,
        campaign,
        items,
        trendSignal,
      },
      200,
      req,
      {}
    );
  }

  return null;
}

