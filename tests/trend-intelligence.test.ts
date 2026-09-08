// Phase 20.10 — Pao Trend Intelligence × Apify MCP × Adobe Stock Research Engine Test Suite.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { openAgentOsDb, closeAgentOsDbForTests } from "../src/agent-os/db";
import {
  getActorRegistry,
  BUILTIN_ACTORS,
} from "../src/agent-os/trends/actor-registry";
import { ApifyGateway } from "../src/agent-os/trends/apify-gateway";
import { normalizeRawItem } from "../src/agent-os/trends/normalizer";
import { calculateOpportunityScore } from "../src/agent-os/trends/scoring-engine";
import { analyzeBuyerIntent } from "../src/agent-os/trends/buyer-intent";
import { sanitizeTrademarks, validateProductionInputPolicy } from "../src/agent-os/trends/copyright-guard";
import { generateStockConcepts } from "../src/agent-os/trends/concept-generator";
import { CostGuard } from "../src/agent-os/trends/cost-guard";
import { getTrendOrchestrator } from "../src/agent-os/trends/research-orchestrator";
import { TREND_MCP_TOOLS } from "../src/agent-os/trends/mcp-tools";
import { handleTrendRoutes } from "../src/server/management/trend-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.10: Pao Trend Intelligence", () => {
  beforeEach(() => {
    closeAgentOsDbForTests();
  });

  afterEach(() => {
    closeAgentOsDbForTests();
  });

  describe("Actor Registry & Routing", () => {
    test("seeds built-in scrapers and actors", () => {
      const registry = getActorRegistry();
      const actors = registry.listActors();
      expect(actors.length).toBeGreaterThanOrEqual(4);

      const adobe = registry.getActor("adobe-stock-primary");
      expect(adobe).not.toBeNull();
      expect(adobe?.category).toBe("stock_market");
      expect(adobe?.capabilities).toContain("ai_filter");
      expect(adobe?.pricing.model).toBe("per_result");
    });

    test("routes source platform to best actor", () => {
      const registry = getActorRegistry();
      const adobeActor = registry.getBestActorForSource("adobe_stock");
      expect(adobeActor?.id).toBe("adobe-stock-primary");

      const ytActor = registry.getBestActorForSource("youtube");
      expect(ytActor?.id).toBe("youtube-trend-scraper");

      const ttActor = registry.getBestActorForSource("tiktok");
      expect(ttActor?.id).toBe("tiktok-tag-scraper");
    });
  });

  describe("Apify Gateway Simulation", () => {
    test("executes actor simulation producing platform-specific items", async () => {
      const gateway = new ApifyGateway();
      const registry = getActorRegistry();
      const actor = registry.getActor("adobe-stock-primary")!;

      const res = await gateway.executeActor(actor, "smart farming drone", "US", 5);
      expect(res.resultCount).toBe(5);
      expect(res.costUsd).toBeGreaterThan(0);
      expect(res.items.length).toBe(5);
      expect(res.items[0].downloads).toBeGreaterThan(0);
      expect(res.items[0].source_url).toContain("stock.adobe.com");
    });
  });

  describe("Signal Normalizer & Scoring Engine", () => {
    test("normalizes raw platform items into unified signals", () => {
      const raw = {
        id: "raw_123",
        title: "Modern AI Drone for Sustainable Smart Farm",
        views: 10000,
        downloads: 250,
        keywords: ["business", "smart", "farming", "drone", "technology"],
        ai_generated: true,
      };

      const norm = normalizeRawItem("adobe_stock", "smart farming", raw);
      expect(norm.id).toBe("raw_123");
      expect(norm.views).toBe(10000);
      expect(norm.downloads).toBe(250);
      expect(norm.aiGenerated).toBe(true);
      expect(norm.commercialBuyerIntentScore).toBeGreaterThan(50);
    });

    test("calculates comprehensive multi-dimensional opportunity score", () => {
      const signals = [
        {
          id: "s1",
          source: "adobe_stock" as const,
          topic: "smart farming drone",
          title: "Autonomous drone sprayer",
          views: 5000,
          downloads: 420,
          engagementRate: 0.05,
          aiGenerated: false,
          keywords: ["agriculture", "smart", "drone", "commercial", "enterprise"],
          commercialBuyerIntentScore: 85,
        },
        {
          id: "s2",
          source: "youtube" as const,
          topic: "smart farming drone",
          title: "How drones revolutionize smart agriculture",
          views: 120000,
          downloads: 0,
          engagementRate: 0.08,
          aiGenerated: false,
          keywords: ["drone", "agriculture", "tutorial"],
          commercialBuyerIntentScore: 70,
        },
      ];

      const score = calculateOpportunityScore("smart farming drone", signals);
      expect(score.demandScore).toBeGreaterThan(40);
      expect(score.momentumScore).toBeGreaterThan(40);
      expect(score.buyerIntentScore).toBeGreaterThan(60);
      expect(score.opportunityScore).toBeGreaterThanOrEqual(50);
      expect(["MUST_PRODUCE", "GOOD_OPPORTUNITY", "EXPLORE"]).toContain(score.recommendation);
      expect(score.reasoning.pros.length).toBeGreaterThan(0);
    });

    test("returns AVOID recommendation when signals are empty", () => {
      const score = calculateOpportunityScore("obscure unknown niche", []);
      expect(score.recommendation).toBe("AVOID");
      expect(score.opportunityScore).toBeLessThan(35);
    });
  });

  describe("Buyer Intent Engine", () => {
    test("detects target industry, buyers, and commercial use cases", () => {
      const analysis = analyzeBuyerIntent("autonomous solar panel cleaning robot", ["clean", "energy", "solar"]);
      expect(analysis.targetIndustry).toContain("Clean Energy");
      expect(analysis.buyerPersonas.length).toBeGreaterThan(0);
      expect(analysis.commercialUseCases.length).toBeGreaterThan(0);
      expect(analysis.painPoints.length).toBeGreaterThan(0);
      expect(analysis.buyerIntentScore).toBeGreaterThanOrEqual(40);
    });
  });

  describe("Copyright & Trademark Guard", () => {
    test("detects and auto-genericizes trademarked brands to protect commercial stock eligibility", () => {
      const promptWithBrands = "Cinematic shot of a Tesla Cybertruck with Apple iPhone navigation and Nike shoes";
      const result = sanitizeTrademarks(promptWithBrands);

      expect(result.wasGenericized).toBe(true);
      expect(result.detectedBrands).toContain("Tesla");
      expect(result.detectedBrands).toContain("Cybertruck");
      expect(result.detectedBrands).toContain("Apple");
      expect(result.detectedBrands).toContain("iPhone");
      expect(result.detectedBrands).toContain("Nike");

      expect(result.sanitizedText).not.toContain("Tesla");
      expect(result.sanitizedText).not.toContain("iPhone");
      expect(result.sanitizedText).toContain("electric vehicle");
      expect(result.sanitizedText).toContain("smartphone");
    });

    test("blocks direct third-party media attachment per Adobe Stock original creation rule", () => {
      const allowed = validateProductionInputPolicy({
        isOriginalPrompt: true,
        derivedFromSignalOnly: true,
        hasDirectMediaAttachment: false,
      });
      expect(allowed.allowed).toBe(true);

      const blocked = validateProductionInputPolicy({
        isOriginalPrompt: true,
        derivedFromSignalOnly: true,
        hasDirectMediaAttachment: true,
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.violationReason).toContain("strictly prohibited");
    });
  });

  describe("Stock Concept Generator", () => {
    test("synthesizes original stock concepts with visual direction and prompts", () => {
      const concepts = generateStockConcepts({
        researchJobId: "rjob_test",
        topic: "smart farming automated drone",
        opportunityScore: 88,
        count: 2,
      });

      expect(concepts.length).toBe(2);
      expect(concepts[0].title).toContain("smart farming");
      expect(concepts[0].assetTypes).toContain("video_4k");
      expect(concepts[0].payload.recommendedPrompt).toContain("4K");
      expect(concepts[0].mustInclude.length).toBeGreaterThan(0);
      expect(concepts[0].mustAvoid.length).toBeGreaterThan(0);
      expect(concepts[1].assetTypes).toContain("photo_raw");
    });

    test("genericizes brand names in concept topics and prompts", () => {
      const concepts = generateStockConcepts({
        researchJobId: "rjob_test_brand",
        topic: "Tesla supercharger station in desert",
        opportunityScore: 82,
        count: 1,
      });

      expect(concepts[0].title).not.toContain("Tesla");
      expect(concepts[0].title).toContain("electric vehicle");
      expect(concepts[0].payload.recommendedPrompt).not.toContain("Tesla");
    });
  });

  describe("Financial Cost Guard", () => {
    test("tracks usage and enforces budget limits", () => {
      const orchestrator = getTrendOrchestrator();
      const parentJob = orchestrator.createJob({ query: "cost test" });
      const costGuard = new CostGuard();
      const jobId = parentJob.id;

      const beforeSpend = costGuard.getDailySpendUsd();
      costGuard.recordUsage({
        jobId,
        provider: "apify",
        actorId: "adobe-stock-scraper",
        costUsd: 0.15,
        units: 75,
      });

      const afterSpend = costGuard.getDailySpendUsd();
      expect(afterSpend).toBeCloseTo(beforeSpend + 0.15, 2);

      const checkValid = costGuard.canExecute(jobId, 0.50);
      expect(checkValid.allowed).toBe(true);

      const checkExceed = costGuard.canExecute(jobId, 999.00);
      expect(checkExceed.allowed).toBe(false);
      expect(checkExceed.reason).toContain("exceeded");
    });
  });

  describe("Trend Research Orchestrator End-to-End", () => {
    test("executes full research workflow from query to opportunity score & concepts", async () => {
      const orchestrator = getTrendOrchestrator();
      const job = orchestrator.createJob({
        query: "industrial warehouse robotics",
        market: "US",
        assetType: "all",
        requestedSources: ["adobe_stock", "youtube"],
      });

      expect(job.status).toBe("pending");

      const result = await orchestrator.runJob(job.id);
      expect(result.job.status).toBe("completed");
      expect(result.opportunity).not.toBeNull();
      expect(result.concepts.length).toBeGreaterThanOrEqual(2);
      expect(result.signalCount).toBeGreaterThan(0);
      expect(result.totalCostUsd).toBeGreaterThan(0);

      // Verify queries
      const retrieved = orchestrator.getJob(job.id);
      expect(retrieved?.status).toBe("completed");

      const signals = orchestrator.getJobSignals(job.id);
      expect(signals.length).toBeGreaterThan(0);

      const opps = orchestrator.getJobOpportunities(job.id);
      expect(opps.length).toBe(1);
      expect(opps[0].opportunityScore).toBeGreaterThan(0);

      const concepts = orchestrator.getJobConcepts(job.id);
      expect(concepts.length).toBe(2);
      expect(concepts[0].status).toBe("draft");

      // Dispatch to Pao Studio
      const dispatchRes = orchestrator.dispatchConceptToStudio(concepts[0].id);
      expect(dispatchRes.success).toBe(true);
      expect(dispatchRes.genJobId).toBeDefined();

      const updatedConcepts = orchestrator.getJobConcepts(job.id);
      expect(updatedConcepts[0].status).toBe("dispatched");
    });

    test("cancels a pending or running job", () => {
      const orchestrator = getTrendOrchestrator();
      const job = orchestrator.createJob({ query: "to cancel" });
      const cancelled = orchestrator.cancelJob(job.id);
      expect(cancelled).toBe(true);

      const retrieved = orchestrator.getJob(job.id);
      expect(retrieved?.status).toBe("cancelled");
    });
  });

  describe("Trend Intelligence MCP Tools", () => {
    test("all 6 canonical tools are registered with schemas", () => {
      const expectedTools = [
        "trend_research_topic",
        "trend_get_opportunities",
        "trend_generate_stock_concepts",
        "trend_dispatch_to_studio",
        "trend_get_cost_summary",
        "trend_list_actors",
      ];

      for (const name of expectedTools) {
        const tool = TREND_MCP_TOOLS[name];
        expect(tool).toBeDefined();
        expect(tool.name).toBe(name);
        expect(tool.description).toBeTruthy();
        expect(tool.parameters.type).toBe("object");
        expect(typeof tool.handler).toBe("function");
      }
    });

    test("trend_research_topic and trend_get_opportunities MCP execution", async () => {
      const researchTool = TREND_MCP_TOOLS["trend_research_topic"];
      const res = (await researchTool.handler({
        query: "clean energy hydrogen fuel cell",
        sources: ["adobe_stock"],
      })) as any;

      expect(res.job_id).toBeDefined();
      expect(res.opportunity).toBeDefined();
      expect(res.concepts_count).toBeGreaterThan(0);

      const oppsTool = TREND_MCP_TOOLS["trend_get_opportunities"];
      const oppsRes = (await oppsTool.handler({ job_id: res.job_id })) as any;
      expect(oppsRes.count).toBe(1);

      const costTool = TREND_MCP_TOOLS["trend_get_cost_summary"];
      const costRes = (await costTool.handler({})) as any;
      expect(costRes.dailyCapUsd).toBeGreaterThan(0);
      expect(costRes.canSpend).toBe(true);

      const actorsTool = TREND_MCP_TOOLS["trend_list_actors"];
      const actorsRes = (await actorsTool.handler({})) as any;
      expect(actorsRes.count).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Management REST API", () => {
    function mockCtx(method: string, path: string, body?: any): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const headers = new Headers();
      headers.set("content-type", "application/json");
      const req = new Request(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        url,
        req,
        pathname: url.pathname,
        principal: { actor: "user", localOnly: true } as any,
        deps: {} as any,
        config: {} as any,
      };
    }

    test("GET /api/trends/status", async () => {
      const ctx = mockCtx("GET", "/api/trends/status");
      const res = await handleTrendRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(data.status).toBe("online");
      expect(data.version).toBe("20.10.0");
      expect(data.cost).toBeDefined();
    });

    test("POST /api/trends/jobs and sub-routes", async () => {
      const ctxPost = mockCtx("POST", "/api/trends/jobs", {
        query: "vertical farming hydroponics",
        market: "US",
        sources: ["adobe_stock"],
      });
      const resPost = await handleTrendRoutes(ctxPost);
      expect(resPost?.status).toBe(201);
      const postData = await resPost?.json();
      expect(postData.job).toBeDefined();
      expect(postData.opportunity).toBeDefined();

      const jobId = postData.job.id;

      // GET /api/trends/jobs/:id
      const ctxGet = mockCtx("GET", `/api/trends/jobs/${jobId}`);
      const resGet = await handleTrendRoutes(ctxGet);
      expect(resGet?.status).toBe(200);

      // GET /api/trends/jobs/:id/signals
      const ctxSig = mockCtx("GET", `/api/trends/jobs/${jobId}/signals`);
      const resSig = await handleTrendRoutes(ctxSig);
      expect(resSig?.status).toBe(200);
      const sigData = await resSig?.json();
      expect(sigData.count).toBeGreaterThan(0);

      // GET /api/trends/jobs/:id/opportunities
      const ctxOpp = mockCtx("GET", `/api/trends/jobs/${jobId}/opportunities`);
      const resOpp = await handleTrendRoutes(ctxOpp);
      expect(resOpp?.status).toBe(200);

      // GET /api/trends/actors
      const ctxActors = mockCtx("GET", "/api/trends/actors");
      const resActors = await handleTrendRoutes(ctxActors);
      expect(resActors?.status).toBe(200);

      // GET /api/trends/costs
      const ctxCosts = mockCtx("GET", "/api/trends/costs");
      const resCosts = await handleTrendRoutes(ctxCosts);
      expect(resCosts?.status).toBe(200);
    });
  });
});
