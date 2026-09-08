import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_OS_SCHEMA_VERSION,
  closeAgentOsDbForTests,
  openAgentOsDb,
} from "../src/agent-os/db";
import {
  calculateNVS,
  evaluatePriorityTier,
  filterAndSortSignals,
  NVS_THRESHOLDS,
  NVS_WEIGHTS,
} from "../src/agent-os/campaign/trends/niche-scorer";
import {
  COMMERCIAL_TREND_SEEDS,
  getTrendSignal,
  getTrendSignalByKeyword,
  listTrendSignals,
  saveTrendSignal,
  scanMarketTrends,
  updateTrendSignalStatus,
} from "../src/agent-os/campaign/trends/signal-collector";
import {
  DEFAULT_STOCK_NEGATIVE_PROMPT,
  getCampaign,
  getCampaignItems,
  listCampaigns,
  planCampaign,
  updateCampaignItemStatus,
  updateCampaignStatus,
} from "../src/agent-os/campaign/planner/campaign-planner";
import { handleCampaignRoutes } from "../src/server/management/campaign-routes";
import type { ManagementContext } from "../src/server/management/context";
import type { TrendSignal } from "../src/agent-os/campaign/types";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "campaign-planner-test-"));
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

function mockCtx(
  path: string,
  method = "GET",
  body?: unknown
): ManagementContext {
  const url = new URL(`http://127.0.0.1:18080${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    config: {} as never,
    principal: { role: "admin", isLoopback: true } as never,
    deps: {} as never,
  };
}

describe("Phase 21: Pao Stock Autonomous Campaign Planner", () => {
  describe("1. Database Schema v16 Migration", () => {
    test("schema version is bumped to 16", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBe(16);
    });

    test("all 5 campaign relational tables exist and are writable", () => {
      const db = openAgentOsDb();
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stock_%'"
        )
        .all() as { name: string }[];

      const tableNames = new Set(tables.map((t) => t.name));
      expect(tableNames.has("stock_trend_signals")).toBe(true);
      expect(tableNames.has("stock_campaigns")).toBe(true);
      expect(tableNames.has("stock_campaign_items")).toBe(true);
      expect(tableNames.has("stock_qc_records")).toBe(true);
      expect(tableNames.has("stock_portfolio_performance")).toBe(true);
    });
  });

  describe("2. Niche Viability Scoring Engine (NVS Formula)", () => {
    test("calculates exact mathematical NVS formula", () => {
      // NVS = ((C * 0.40) + (V * 0.35) - (S * 0.25)) / (1 + P_risk)
      const input = {
        commercialIntent: 0.9,
        searchVelocity: 0.8,
        saturationIndex: 0.2,
        ipRiskPenalty: 0.0,
      };

      // Numerator: 0.9 * 0.40 + 0.8 * 0.35 - 0.2 * 0.25 = 0.36 + 0.28 - 0.05 = 0.59
      // Denominator: 1 + 0.0 = 1.0
      const result = calculateNVS(input);
      expect(result.nvs).toBe(0.59);
      expect(result.priorityTier).toBe("secondary");
      expect(result.breakdown.commercialIntent).toBe(0.9);
      expect(result.breakdown.searchVelocity).toBe(0.8);
      expect(result.breakdown.saturationIndex).toBe(0.2);
      expect(result.breakdown.ipRiskPenalty).toBe(0);
    });

    test("assigns high_priority tier when NVS >= 0.75", () => {
      const input = {
        commercialIntent: 1.0,
        searchVelocity: 1.0,
        saturationIndex: 0.0,
        ipRiskPenalty: 0.0,
      };
      // 1.0*0.40 + 1.0*0.35 - 0 = 0.75
      const result = calculateNVS(input);
      expect(result.nvs).toBe(0.75);
      expect(result.priorityTier).toBe("high_priority");
    });

    test("assigns rejected tier when NVS < 0.50", () => {
      const input = {
        commercialIntent: 0.4,
        searchVelocity: 0.3,
        saturationIndex: 0.7,
        ipRiskPenalty: 0.1,
      };
      // Numerator: 0.16 + 0.105 - 0.175 = 0.09
      // Denominator: 1.1 => 0.0818
      const result = calculateNVS(input);
      expect(result.nvs).toBeLessThan(0.5);
      expect(result.priorityTier).toBe("rejected");
    });

    test("dampens score when IP risk penalty is high", () => {
      const baseInput = {
        commercialIntent: 1.0,
        searchVelocity: 1.0,
        saturationIndex: 0.0,
        ipRiskPenalty: 0.0,
      };
      const penalizedInput = {
        commercialIntent: 1.0,
        searchVelocity: 1.0,
        saturationIndex: 0.0,
        ipRiskPenalty: 0.5,
      };

      const baseResult = calculateNVS(baseInput);
      const penalizedResult = calculateNVS(penalizedInput);

      expect(baseResult.nvs).toBe(0.75);
      expect(penalizedResult.nvs).toBe(0.5); // 0.75 / 1.5 = 0.5
      expect(penalizedResult.priorityTier).toBe("secondary");
    });

    test("clamps negative results to 0", () => {
      const input = {
        commercialIntent: 0.0,
        searchVelocity: 0.0,
        saturationIndex: 1.0,
        ipRiskPenalty: 0.0,
      };
      const result = calculateNVS(input);
      expect(result.nvs).toBe(0);
      expect(result.priorityTier).toBe("rejected");
    });

    test("evaluates priority tiers correctly against threshold constants", () => {
      expect(evaluatePriorityTier(0.85)).toBe("high_priority");
      expect(evaluatePriorityTier(0.75)).toBe("high_priority");
      expect(evaluatePriorityTier(0.7499)).toBe("secondary");
      expect(evaluatePriorityTier(0.5)).toBe("secondary");
      expect(evaluatePriorityTier(0.499)).toBe("rejected");
      expect(evaluatePriorityTier(0.1)).toBe("rejected");
    });

    test("filters and sorts signals by NVS descending", () => {
      const now = new Date().toISOString();
      const signals: TrendSignal[] = [
        {
          id: "1",
          keyword: "low",
          category: "c",
          source: "s",
          searchVelocity: 0.2,
          commercialIntent: 0.2,
          saturationIndex: 0.8,
          nicheViabilityScore: 0.3,
          priorityTier: "rejected",
          status: "new",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "2",
          keyword: "high",
          category: "c",
          source: "s",
          searchVelocity: 0.9,
          commercialIntent: 0.9,
          saturationIndex: 0.1,
          nicheViabilityScore: 0.82,
          priorityTier: "high_priority",
          status: "new",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "3",
          keyword: "mid",
          category: "c",
          source: "s",
          searchVelocity: 0.7,
          commercialIntent: 0.7,
          saturationIndex: 0.3,
          nicheViabilityScore: 0.61,
          priorityTier: "secondary",
          status: "new",
          createdAt: now,
          updatedAt: now,
        },
      ];

      const filtered = filterAndSortSignals(signals, 0.5);
      expect(filtered.length).toBe(2);
      expect(filtered[0].id).toBe("2");
      expect(filtered[1].id).toBe("3");
    });
  });

  describe("3. Trend Signal Collector & Storage", () => {
    test("saves and retrieves a trend signal from SQLite", () => {
      const now = new Date().toISOString();
      const signal: TrendSignal = {
        id: "sig_test_01",
        keyword: "solid state battery manufacturing",
        category: "clean_tech",
        source: "battery_insider",
        searchVelocity: 0.88,
        commercialIntent: 0.92,
        saturationIndex: 0.18,
        nicheViabilityScore: 0.63,
        priorityTier: "secondary",
        status: "new",
        createdAt: now,
        updatedAt: now,
      };

      saveTrendSignal(signal);
      const retrieved = getTrendSignal("sig_test_01");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.keyword).toBe("solid state battery manufacturing");
      expect(retrieved?.nicheViabilityScore).toBe(0.63);
      expect(retrieved?.priorityTier).toBe("secondary");

      const byKeyword = getTrendSignalByKeyword(
        "solid state battery manufacturing"
      );
      expect(byKeyword?.id).toBe("sig_test_01");
    });

    test("scans commercial trend seeds and persists them with NVS scores", async () => {
      const scanned = await scanMarketTrends({ minViabilityScore: 0.5 });
      expect(scanned.length).toBeGreaterThan(0);

      // Verify all scanned signals exceed minViabilityScore
      for (const s of scanned) {
        expect(s.nicheViabilityScore).toBeGreaterThanOrEqual(0.5);
        expect(s.status).toBe("new");
      }

      // Check DB persistence
      const list = listTrendSignals({ minScore: 0.5 });
      expect(list.length).toBe(scanned.length);
    });

    test("filters market trends by category", async () => {
      await scanMarketTrends();
      const cleanTech = listTrendSignals({ category: "clean_tech" });
      expect(cleanTech.length).toBeGreaterThan(0);
      for (const s of cleanTech) {
        expect(s.category).toBe("clean_tech");
      }
    });

    test("updates trend signal status", () => {
      const now = new Date().toISOString();
      const signal: TrendSignal = {
        id: "sig_status_01",
        keyword: "autonomous delivery rover",
        category: "robotics",
        source: "robotics_feed",
        searchVelocity: 0.8,
        commercialIntent: 0.85,
        saturationIndex: 0.25,
        nicheViabilityScore: 0.58,
        priorityTier: "secondary",
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
      saveTrendSignal(signal);

      updateTrendSignalStatus("sig_status_01", "producing");
      const updated = getTrendSignal("sig_status_01");
      expect(updated?.status).toBe("producing");
    });
  });

  describe("4. Campaign Matrix Planner", () => {
    test("generates a structured 10-shot diverse campaign portfolio", () => {
      const result = planCampaign({
        keyword: "green hydrogen fuel cell logistics",
        category: "clean_tech",
        targetAssetCount: 10,
        preferredProvider: "comfyui",
      });

      expect(result.campaign).toBeDefined();
      expect(result.campaign.status).toBe("active");
      expect(result.campaign.targetAssetCount).toBe(10);
      expect(result.items.length).toBe(10);

      // Verify asset type distribution
      const videoItems = result.items.filter((i) => i.assetType === "video_4k");
      const photoItems = result.items.filter((i) => i.assetType === "photo_raw");
      const isolateItems = result.items.filter(
        (i) => i.assetType === "isolated_element"
      );

      expect(videoItems.length).toBe(3);
      expect(photoItems.length).toBe(5);
      expect(isolateItems.length).toBe(2);

      // Verify shot diversity in angles
      const angles = new Set(result.items.map((i) => i.angle));
      expect(angles.has("wide_establishing")).toBe(true);
      expect(angles.has("eye_level")).toBe(true);
      expect(angles.has("drone_overhead")).toBe(true);
      expect(angles.has("low_angle_hero")).toBe(true);
      expect(angles.has("close_up_macro")).toBe(true);
      expect(angles.has("isometric_overview")).toBe(true);

      // Verify negative prompt applied
      for (const item of result.items) {
        expect(item.negativePrompt).toBe(DEFAULT_STOCK_NEGATIVE_PROMPT);
        expect(item.renderStatus).toBe("pending");
        expect(item.assignedProvider).toBe("comfyui");
      }
    });

    test("persists campaign and items in SQLite and links to trend signal", () => {
      const now = new Date().toISOString();
      const signal: TrendSignal = {
        id: "sig_plan_01",
        keyword: "floating wind turbine array",
        category: "clean_tech",
        source: "energy_news",
        searchVelocity: 0.9,
        commercialIntent: 0.95,
        saturationIndex: 0.15,
        nicheViabilityScore: 0.71,
        priorityTier: "secondary",
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
      saveTrendSignal(signal);

      const { campaign, items } = planCampaign({
        trendSignalId: "sig_plan_01",
        targetAssetCount: 10,
      });

      // Verify signal status updated to 'planned'
      const updatedSignal = getTrendSignal("sig_plan_01");
      expect(updatedSignal?.status).toBe("planned");

      // Verify retrieval from SQLite
      const retrieved = getCampaign(campaign.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.trendSignalId).toBe("sig_plan_01");

      const retrievedItems = getCampaignItems(campaign.id);
      expect(retrievedItems.length).toBe(items.length);
    });

    test("updates campaign status and item render status", () => {
      const { campaign, items } = planCampaign({
        keyword: "smart grid telemetry",
        targetAssetCount: 5,
      });

      updateCampaignStatus(campaign.id, "completed");
      const updatedCamp = getCampaign(campaign.id);
      expect(updatedCamp?.status).toBe("completed");

      const firstItem = items[0];
      updateCampaignItemStatus(firstItem.id, "rendering", "gpu_job_123");
      const itemsAfter = getCampaignItems(campaign.id);
      expect(itemsAfter[0].renderStatus).toBe("rendering");
      expect(itemsAfter[0].gpuJobId).toBe("gpu_job_123");
    });
  });

  describe("5. REST Management API Routes (/api/campaign/*)", () => {
    test("POST /api/campaign/trends/scan scans and returns scored signals", async () => {
      const res = await handleCampaignRoutes(
        mockCtx("/api/campaign/trends/scan", "POST", { minViabilityScore: 0.5 })
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; count: number; signals: TrendSignal[] };
      expect(body.ok).toBe(true);
      expect(body.count).toBeGreaterThan(0);
      expect(Array.isArray(body.signals)).toBe(true);
    });

    test("GET /api/campaign/trends lists scored signals", async () => {
      await scanMarketTrends();
      const res = await handleCampaignRoutes(
        mockCtx("/api/campaign/trends?category=robotics")
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; count: number; signals: TrendSignal[] };
      expect(body.ok).toBe(true);
      expect(body.signals.every((s) => s.category === "robotics")).toBe(true);
    });

    test("POST /api/campaign/plan plans a new campaign", async () => {
      const res = await handleCampaignRoutes(
        mockCtx("/api/campaign/plan", "POST", {
          keyword: "ai robotics in warehouse logistics",
          targetAssetCount: 10,
        })
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(201);

      const body = (await res?.json()) as { ok: boolean; campaign: { id: string }; items: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.campaign.id).toBeDefined();
      expect(body.items.length).toBe(10);
    });

    test("GET /api/campaign/list lists planned campaigns", async () => {
      planCampaign({ keyword: "campaign list test", targetAssetCount: 2 });
      const res = await handleCampaignRoutes(mockCtx("/api/campaign/list"));
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; count: number; campaigns: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.count).toBeGreaterThan(0);
    });

    test("GET /api/campaign/:id retrieves campaign detail and items", async () => {
      const { campaign } = planCampaign({
        keyword: "retrieval test",
        targetAssetCount: 4,
      });

      const res = await handleCampaignRoutes(
        mockCtx(`/api/campaign/${campaign.id}`)
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; campaign: { id: string }; items: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.campaign.id).toBe(campaign.id);
      expect(body.items.length).toBe(4);
    });

    test("GET /api/campaign/:id returns 404 for unknown campaign", async () => {
      const res = await handleCampaignRoutes(
        mockCtx("/api/campaign/cmp_nonexistent")
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(404);
    });

    test("routes correctly via /api/agent-os/campaign/* alias", async () => {
      const res = await handleCampaignRoutes(
        mockCtx("/api/agent-os/campaign/trends")
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
    });
  });
});
