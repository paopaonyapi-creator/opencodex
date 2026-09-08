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
import {
  normalizeKeyword,
  classifyCommercialCategory,
  extractCommercialIntent,
  analyzeTrendKeyword,
} from "../src/agent-os/campaign/trends/keyword-normalizer";
import { allocatePortfolioRatios } from "../src/agent-os/campaign/planner/portfolio-allocator";
import {
  dispatchCampaign,
  syncCampaignExecution,
  resolveDimensions,
} from "../src/agent-os/campaign/execution/campaign-dispatcher";
import { evaluateVisualQc } from "../src/agent-os/campaign/qc/visual-qc-gate";
import { scanIpClearance } from "../src/agent-os/campaign/qc/ip-sanitizer";
import {
  evaluateCampaignItem,
  getQcRecordsForItem,
} from "../src/agent-os/campaign/qc/council-evaluator";
import {
  buildStockTitle,
  generateStockKeywords,
  generateMetadataForItem,
} from "../src/agent-os/campaign/metadata/stock-metadata-engine";
import { generateCampaignCsvManifest } from "../src/agent-os/campaign/metadata/csv-packager";
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

  describe("7. Commercial Keyword Normalizer & Intent Classifier", () => {
    test("normalizes raw search terms and removes noise", () => {
      const normalized = normalizeKeyword("  Electric !! Vehicle @@ CHARGING #Stations   ");
      expect(normalized).toBe("electric vehicle charging stations");
    });

    test("accurately classifies commercial categories", () => {
      expect(classifyCommercialCategory("solar cell array farm").category).toBe("clean_tech");
      expect(classifyCommercialCategory("autonomous ev fleet logistics").category).toBe("sustainable_mobility");
      expect(classifyCommercialCategory("collaborative industrial robot arm").category).toBe("robotics");
      expect(classifyCommercialCategory("ai server rack datacenter").category).toBe("ai_infrastructure");
      expect(classifyCommercialCategory("hydroponic indoor vertical farm").category).toBe("agritech");
      expect(classifyCommercialCategory("dna sequencing laboratory crispr").category).toBe("biotech");
      expect(classifyCommercialCategory("mobile payment contactless terminal").category).toBe("fintech");
      expect(classifyCommercialCategory("unknown generic subject").category).toBe("commercial_editorial");
    });

    test("extracts commercial intent from modifiers", () => {
      expect(extractCommercialIntent("enterprise cloud computing platform").intentScore).toBeGreaterThanOrEqual(0.70);
      expect(extractCommercialIntent("industrial manufacturing robotic arm").modifiers).toContain("industrial");
      expect(extractCommercialIntent("consumer portable espresso maker").modifiers).toContain("consumer");
      expect(extractCommercialIntent("innovative green energy concept").modifiers).toContain("concept");
    });

    test("generates complete trend keyword analysis", () => {
      const analysis = analyzeTrendKeyword("Industrial Automation Sensors Factory");
      expect(analysis.normalized).toBe("industrial automation sensors factory");
      expect(analysis.category).toBe("robotics");
      expect(analysis.commercialIntent).toBeGreaterThanOrEqual(0.70);
      expect(analysis.detectedModifiers.length).toBeGreaterThan(0);
      expect(analysis.isHighValueNiche).toBe(true);
    });
  });

  describe("8. Dynamic Portfolio Allocator", () => {
    test("allocates asset mix summing precisely to target count", () => {
      const plan = allocatePortfolioRatios({
        category: "clean_tech",
        targetAssetCount: 10,
      });

      expect(plan.targetAssetCount).toBe(10);
      expect(plan.videoCount + plan.photoCount + plan.isolatedCount).toBe(10);
      expect(plan.ratios.video + plan.ratios.photo + plan.ratios.isolated).toBeCloseTo(1.0);
    });

    test("adapts portfolio ratio distribution based on category preferences", () => {
      const mobilityPlan = allocatePortfolioRatios({
        category: "sustainable_mobility",
        targetAssetCount: 10,
      });
      // Mobility prefers motion / video
      expect(mobilityPlan.videoCount).toBeGreaterThanOrEqual(4);

      const fintechPlan = allocatePortfolioRatios({
        category: "fintech",
        targetAssetCount: 10,
      });
      // Fintech prefers editorial / photos and isolated cards
      expect(fintechPlan.photoCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("9. Campaign Batch Dispatcher to Generation Queue", () => {
    test("dispatches campaign items into gen_jobs table", () => {
      const { campaign, items } = planCampaign({
        keyword: "dispatch test",
        targetAssetCount: 3,
      });

      const dispatchResult = dispatchCampaign(campaign.id);
      expect(dispatchResult.ok).toBe(true);
      expect(dispatchResult.dispatchedCount).toBe(3);
      expect(dispatchResult.jobIds.length).toBe(3);

      const refreshed = getCampaign(campaign.id);
      expect(refreshed?.status).toBe("active");

      const refreshedItems = getCampaignItems(campaign.id);
      for (const it of refreshedItems) {
        expect(it.renderStatus).toBe("rendering");
        expect(it.gpuJobId).toBeDefined();
        expect(it.gpuJobId?.startsWith("job_")).toBe(true);
      }
    });

    test("dispatch is idempotent and skips already rendering items", () => {
      const { campaign } = planCampaign({
        keyword: "idempotent dispatch test",
        targetAssetCount: 2,
      });

      const firstDispatch = dispatchCampaign(campaign.id);
      expect(firstDispatch.dispatchedCount).toBe(2);

      const secondDispatch = dispatchCampaign(campaign.id);
      expect(secondDispatch.dispatchedCount).toBe(0);
      expect(secondDispatch.skippedCount).toBe(2);
    });

    test("resolves correct dimensions for stock aspect ratios", () => {
      const videoDim = resolveDimensions("16:9", "video_4k");
      expect(videoDim.width).toBe(1920);
      expect(videoDim.height).toBe(1080);

      const photoDim169 = resolveDimensions("16:9", "photo_raw");
      expect(photoDim169.width).toBe(1824);
      expect(photoDim169.height).toBe(1024);

      const photoDim11 = resolveDimensions("1:1", "photo_raw");
      expect(photoDim11.width).toBe(1024);
      expect(photoDim11.height).toBe(1024);
    });
  });

  describe("10. Campaign Execution Status Synchronization", () => {
    test("syncCampaignExecution reflects job completion and campaign progress", () => {
      const { campaign } = planCampaign({
        keyword: "sync test",
        targetAssetCount: 2,
      });
      dispatchCampaign(campaign.id);

      const db = openAgentOsDb();
      const items = getCampaignItems(campaign.id);
      expect(items[0].gpuJobId).toBeDefined();

      // Simulate first job completed in gen_jobs
      db.query("UPDATE gen_jobs SET status = 'completed' WHERE id = ?").run(items[0].gpuJobId!);

      const syncResult = syncCampaignExecution(campaign.id);
      expect(syncResult.ok).toBe(true);
      expect(syncResult.completedCount).toBe(1);
      expect(syncResult.remainingCount).toBe(1);

      const updatedItems = getCampaignItems(campaign.id);
      expect(updatedItems[0].renderStatus).toBe("passed_qc");
    });
  });

  describe("11. Visual QC Gate", () => {
    test("approves high-resolution, sharp stock images", () => {
      const result = evaluateVisualQc({
        assetType: "photo_raw",
        width: 3840,
        height: 2160,
        aspectRatio: "16:9",
        rawMetrics: {
          blurEstimate: 0.05,
          compressionArtifacts: 0.02,
          colorBanding: 0.01,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.megapixels).toBeGreaterThanOrEqual(8.0);
      expect(result.sharpnessScore).toBeGreaterThanOrEqual(90);
      expect(result.artifactPenalty).toBeLessThanOrEqual(10);
      expect(result.errors.length).toBe(0);
    });

    test("fails images below Adobe Stock 4.0 MP minimum", () => {
      const result = evaluateVisualQc({
        assetType: "photo_raw",
        width: 1200,
        height: 800, // 0.96 MP
        aspectRatio: "3:2",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("below Adobe Stock minimum of 4.0 MP"))).toBe(true);
    });

    test("applies artifact penalties for compression artifacts", () => {
      const result = evaluateVisualQc({
        assetType: "photo_raw",
        width: 3840,
        height: 2160,
        rawMetrics: {
          compressionArtifacts: 0.8,
          colorBanding: 0.5,
        },
      });

      expect(result.artifactPenalty).toBeGreaterThan(25);
      expect(result.valid).toBe(false);
    });
  });

  describe("12. IP & Trademark Sanitizer", () => {
    test("flags prohibited trademark brands", () => {
      const resApple = scanIpClearance("Person holding an Apple iPhone 15 Pro Max");
      expect(resApple.cleared).toBe(false);
      expect(resApple.status).toBe("flagged_trademark");
      expect(resApple.flaggedTerms).toContain("apple");
      expect(resApple.flaggedTerms).toContain("iphone");

      const resTesla = scanIpClearance("Sleek Tesla Cybertruck driving on highway");
      expect(resTesla.cleared).toBe(false);
      expect(resTesla.flaggedTerms).toContain("tesla");
    });

    test("flags celebrity likeness without release", () => {
      const res = scanIpClearance("Photorealistic portrait of Elon Musk in laboratory");
      expect(res.cleared).toBe(false);
      expect(res.status).toBe("flagged_likeness");
      expect(res.flaggedTerms).toContain("portrait of elon musk");
    });

    test("clears generic commercial concept prompts", () => {
      const res = scanIpClearance(
        "Commercial stock photo of modern autonomous electric vehicle charging at solar station with green trees"
      );
      expect(res.cleared).toBe(true);
      expect(res.status).toBe("cleared");
      expect(res.riskScore).toBe(0);
    });
  });

  describe("13. Reviewer Council Evaluator & stock_qc_records", () => {
    test("approves compliant item and persists record to stock_qc_records", () => {
      const { campaign, items } = planCampaign({
        keyword: "council approval test",
        targetAssetCount: 1,
      });
      const item = items[0];

      const evaluation = evaluateCampaignItem({
        campaignItemId: item.id,
        width: 3840,
        height: 2160,
        blurEstimate: 0.05,
        compressionArtifacts: 0.05,
      });

      expect(evaluation.ok).toBe(true);
      expect(evaluation.record.councilVerdict).toBe("approve");
      expect(evaluation.record.ipClearanceStatus).toBe("cleared");

      const records = getQcRecordsForItem(item.id);
      expect(records.length).toBe(1);
      expect(records[0].id).toBe(evaluation.record.id);
      expect(records[0].sharpnessScore).toBeGreaterThanOrEqual(80);

      const refreshed = getCampaignItems(campaign.id);
      expect(refreshed[0].renderStatus).toBe("passed_qc");
    });

    test("rejects item containing trademark violation", () => {
      const db = openAgentOsDb();
      const { campaign, items } = planCampaign({
        keyword: "council reject test",
        targetAssetCount: 1,
      });
      const item = items[0];

      // Inject trademark into prompt
      db.query("UPDATE stock_campaign_items SET prompt = ? WHERE id = ?").run(
        "Close up shot of Nike sneakers on running track",
        item.id
      );

      const evaluation = evaluateCampaignItem({
        campaignItemId: item.id,
      });

      expect(evaluation.record.councilVerdict).toBe("reject");
      expect(evaluation.record.ipClearanceStatus).toBe("flagged_trademark");
      expect(evaluation.reasons.some((r) => r.includes("Trademark violation"))).toBe(true);

      const refreshed = getCampaignItems(campaign.id);
      expect(refreshed[0].renderStatus).toBe("failed_qc");
    });
  });

  describe("14. Adobe Stock Metadata Engine & CSV Packager", () => {
    test("builds concise, professional stock titles under 70 chars", () => {
      const title = buildStockTitle(
        "Photorealistic cinematic ultra hd 8k modern solar panel farm in desert with mountains, bright sunlight"
      );
      expect(title.length).toBeLessThanOrEqual(70);
      expect(title.toLowerCase()).not.toContain("photorealistic");
      expect(title.toLowerCase()).not.toContain("8k");
    });

    test("generates 25-45 hierarchical tags", () => {
      const keywords = generateStockKeywords({
        prompt: "Autonomous electric delivery drone flying over warehouse logistics center",
        keyword: "delivery drone",
        category: "robotics",
        assetType: "video_4k",
      });

      expect(keywords.length).toBeGreaterThanOrEqual(25);
      expect(keywords.length).toBeLessThanOrEqual(45);
      expect(keywords).toContain("drone");
      expect(keywords).toContain("video");
      expect(keywords).toContain("commercial");
    });

    test("assembles full item metadata with category mapping", () => {
      const meta = generateMetadataForItem({
        prompt: "Solar panels on sustainable green roof in modern smart city",
        keyword: "solar panels",
        category: "clean_tech",
      });

      expect(meta.categoryNumber).toBe(17); // Environment
      expect(meta.categoryName).toBe("Environment");
      expect(meta.title.length).toBeGreaterThan(5);
      expect(meta.keywords.length).toBeGreaterThanOrEqual(25);
    });

    test("generates complete Adobe Stock CSV manifest", () => {
      const { campaign } = planCampaign({
        keyword: "csv export test",
        targetAssetCount: 3,
      });

      const manifest = generateCampaignCsvManifest(campaign.id);
      expect(manifest.rowCount).toBe(3);
      expect(manifest.campaignId).toBe(campaign.id);

      const lines = manifest.csv.split("\r\n");
      expect(lines[0]).toBe("Filename,Title,Keywords,Category,Releases");
      expect(lines.length).toBe(4); // 1 header + 3 rows
    });
  });

  describe("15. Extended Management API Endpoints", () => {
    test("POST /api/campaign/:id/dispatch executes batch dispatch via API", async () => {
      const { campaign } = planCampaign({
        keyword: "api dispatch test",
        targetAssetCount: 2,
      });

      const res = await handleCampaignRoutes(
        mockCtx(`/api/campaign/${campaign.id}/dispatch`, "POST")
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; dispatchedCount: number };
      expect(body.ok).toBe(true);
      expect(body.dispatchedCount).toBe(2);
    });

    test("POST /api/campaign/:id/sync synchronizes execution status via API", async () => {
      const { campaign } = planCampaign({
        keyword: "api sync test",
        targetAssetCount: 2,
      });
      dispatchCampaign(campaign.id);

      const res = await handleCampaignRoutes(
        mockCtx(`/api/campaign/${campaign.id}/sync`, "POST")
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const body = (await res?.json()) as { ok: boolean; remainingCount: number };
      expect(body.ok).toBe(true);
      expect(body.remainingCount).toBe(2);
    });

    test("POST & GET /api/campaign/items/:id/qc runs and retrieves QC via API", async () => {
      const { items } = planCampaign({
        keyword: "api qc test",
        targetAssetCount: 1,
      });
      const item = items[0];

      // POST item QC
      const postRes = await handleCampaignRoutes(
        mockCtx(`/api/campaign/items/${item.id}/qc`, "POST", {
          width: 3840,
          height: 2160,
          blurEstimate: 0.05,
        })
      );
      expect(postRes).not.toBeNull();
      expect(postRes?.status).toBe(200);

      const postBody = (await postRes?.json()) as { ok: boolean; record: { councilVerdict: string } };
      expect(postBody.ok).toBe(true);
      expect(postBody.record.councilVerdict).toBe("approve");

      // GET item QC
      const getRes = await handleCampaignRoutes(
        mockCtx(`/api/campaign/items/${item.id}/qc`, "GET")
      );
      expect(getRes).not.toBeNull();
      expect(getRes?.status).toBe(200);

      const getBody = (await getRes?.json()) as { ok: boolean; count: number };
      expect(getBody.ok).toBe(true);
      expect(getBody.count).toBe(1);
    });

    test("GET /api/campaign/:id/export returns manifest in JSON and CSV format", async () => {
      const { campaign } = planCampaign({
        keyword: "api export test",
        targetAssetCount: 2,
      });

      // JSON export
      const jsonRes = await handleCampaignRoutes(
        mockCtx(`/api/campaign/${campaign.id}/export`)
      );
      expect(jsonRes).not.toBeNull();
      expect(jsonRes?.status).toBe(200);
      const jsonBody = (await jsonRes?.json()) as { ok: boolean; manifest: { rowCount: number } };
      expect(jsonBody.ok).toBe(true);
      expect(jsonBody.manifest.rowCount).toBe(2);

      // Raw CSV export
      const csvRes = await handleCampaignRoutes(
        mockCtx(`/api/campaign/${campaign.id}/export?format=csv`)
      );
      expect(csvRes).not.toBeNull();
      expect(csvRes?.status).toBe(200);
      expect(csvRes?.headers.get("Content-Type")).toContain("text/csv");
      const csvText = await csvRes?.text();
      expect(csvText).toContain("Filename,Title,Keywords,Category,Releases");
    });
  });
});

