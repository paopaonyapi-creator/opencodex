// Tests for End-to-End Autonomous Stock Production & Submission Pipeline (Phase 21.1)
//
// Verifies:
// 1. Database schema v24 migration and persistence
// 2. 7-Stage autonomous coordinator lifecycle (Trends -> Plan -> Gen -> QC -> CSV -> Browser -> Approval)
// 3. Reviewer Council & Human Supervisor Gate enforcement
// 4. Canonical MCP tools under stock.pipeline.* namespace
// 5. REST management API endpoints and /api/agent-os/* parity

import { describe, expect, test, beforeEach } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  StockAutonomousPipelineEngine,
  getStockPipelineEngine,
} from "../src/agent-os/stock-pipeline/pipeline-engine";
import {
  STOCK_PIPELINE_MCP_TOOLS,
  executeStockPipelineMcpTool,
} from "../src/agent-os/stock-pipeline/mcp-tools";
import { handleStockPipelineRoutes } from "../src/server/management/stock-pipeline-routes";
import type { ManagementContext } from "../src/server/management/context";
import { getBrowserApprovalManager } from "../src/agent-os/browser/security/approval-manager";

describe("End-to-End Autonomous Stock Pipeline", () => {
  beforeEach(() => {
    // Ensure DB is initialized
    openAgentOsDb();
  });

  // =========================================================================
  // 1. Schema & Migration Tests
  // =========================================================================
  test("schema version is 24 and stock_autonomous_pipeline_runs table exists", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBe(24);

    const db = openAgentOsDb();
    const tableInfo = db
      .query("PRAGMA table_info(stock_autonomous_pipeline_runs)")
      .all() as { name: string }[];

    const columnNames = tableInfo.map((col) => col.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("query");
    expect(columnNames).toContain("market");
    expect(columnNames).toContain("target_asset_count");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("current_stage");
    expect(columnNames).toContain("trend_job_id");
    expect(columnNames).toContain("campaign_id");
    expect(columnNames).toContain("browser_mission_id");
    expect(columnNames).toContain("approval_id");
    expect(columnNames).toContain("concept_summary_json");
    expect(columnNames).toContain("campaign_summary_json");
    expect(columnNames).toContain("qc_summary_json");
    expect(columnNames).toContain("browser_summary_json");
    expect(columnNames).toContain("summary_json");
  });

  // =========================================================================
  // 2. Coordinator 7-Stage Lifecycle
  // =========================================================================
  test("creates, steps through all 7 stages, and completes with human approval", async () => {
    const engine = new StockAutonomousPipelineEngine();

    // Stage 0: Create
    const run = engine.createPipelineRun({
      query: "Cyberpunk Solar Roof",
      market: "US",
      targetAssetCount: 4,
    });

    expect(run.id).toStartWith("pipe_run_");
    expect(run.query).toBe("Cyberpunk Solar Roof");
    expect(run.status).toBe("pending");
    expect(run.currentStage).toBe(1);

    // Stage 1: Trend Discovery
    const stage1 = await engine.stepTrends(run.id);
    expect(stage1.stage).toBe(1);
    expect(stage1.run.status).toBe("planning");
    expect(stage1.run.trendJobId).toBeDefined();
    expect(stage1.output.topConcept).toBeDefined();

    // Stage 2: Campaign Planning
    const stage2 = engine.stepPlanCampaign(run.id);
    expect(stage2.stage).toBe(2);
    expect(stage2.run.status).toBe("rendering");
    expect(stage2.run.campaignId).toBeDefined();

    // Stage 3: Generative Batch Dispatch
    const stage3 = engine.stepDispatchGeneration(run.id);
    expect(stage3.stage).toBe(3);
    expect(stage3.run.status).toBe("qc_evaluating");

    // Stage 4: Automated QC & IP Sanitizer
    const stage4 = engine.stepRunQc(run.id);
    expect(stage4.stage).toBe(4);
    expect(stage4.run.status).toBe("browser_preparing");
    expect(stage4.output.totalEvaluated).toBeGreaterThan(0);

    // Stage 5: CSV Manifest Packaging
    const stage5 = engine.stepPackageManifest(run.id);
    expect(stage5.stage).toBe(5);
    expect(stage5.run.status).toBe("waiting_approval");
    expect(stage5.output.rowCount).toBeGreaterThan(0);

    // Stage 6: Browser Mission Preparation & Approval Gate
    const stage6 = await engine.stepPrepareBrowserMission(run.id, "stock.adobe.com");
    expect(stage6.stage).toBe(6);
    expect(stage6.run.status).toBe("waiting_approval");
    expect(stage6.run.browserMissionId).toBeDefined();
    expect(stage6.run.approvalId).toBeDefined();

    // Verify approval request was recorded in browser_approvals
    const approvalMgr = getBrowserApprovalManager();
    const approval = approvalMgr.getApproval(stage6.run.approvalId!);
    expect(approval).not.toBeNull();
    expect(approval?.status).toBe("pending");

    // Stage 7: Human Supervisor Approval Gate — Approve
    const stage7 = engine.stepFinalizeSubmission(run.id, "approve");
    expect(stage7.stage).toBe(7);
    expect(stage7.run.status).toBe("completed");
    expect(stage7.run.completedAt).toBeDefined();

    // Verify persisted state in database
    const refreshed = engine.getPipelineRun(run.id);
    expect(refreshed?.status).toBe("completed");
  });

  test("rejects submission when operator declines in Stage 7", async () => {
    const engine = new StockAutonomousPipelineEngine();
    const run = engine.createPipelineRun({ query: "Rejected Test Query", targetAssetCount: 2 });

    await engine.stepTrends(run.id);
    engine.stepPlanCampaign(run.id);
    engine.stepDispatchGeneration(run.id);
    engine.stepRunQc(run.id);
    engine.stepPackageManifest(run.id);
    await engine.stepPrepareBrowserMission(run.id);

    const stage7 = engine.stepFinalizeSubmission(run.id, "reject", "Quality below threshold");
    expect(stage7.run.status).toBe("cancelled");
    expect(stage7.run.summary.finalDecision).toBe("rejected");
    expect(stage7.run.summary.rejectionReason).toBe("Quality below threshold");
  });

  test("runFullPipeline executes entire flow until human approval gate", async () => {
    const engine = getStockPipelineEngine();
    const run = await engine.runFullPipeline({
      query: "Neon Hydroponics",
      targetAssetCount: 3,
    });

    expect(run.status).toBe("waiting_approval");
    expect(run.currentStage).toBe(6);
    expect(run.trendJobId).toBeDefined();
    expect(run.campaignId).toBeDefined();
    expect(run.browserMissionId).toBeDefined();
    expect(run.approvalId).toBeDefined();
  });

  // =========================================================================
  // 3. Canonical MCP Tools
  // =========================================================================
  test("MCP tools registry contains all stock.pipeline.* tools", () => {
    const toolNames = STOCK_PIPELINE_MCP_TOOLS.map((t) => t.name);
    expect(toolNames).toContain("stock.pipeline.run");
    expect(toolNames).toContain("stock.pipeline.create");
    expect(toolNames).toContain("stock.pipeline.get");
    expect(toolNames).toContain("stock.pipeline.list");
    expect(toolNames).toContain("stock.pipeline.step");
    expect(toolNames).toContain("stock.pipeline.finalize");
    expect(toolNames).toContain("stock.pipeline.cancel");
  });

  test("executes stock.pipeline MCP tool calls", async () => {
    // 1. Create
    const createRes = (await executeStockPipelineMcpTool("stock.pipeline.create", {
      query: "Futuristic Vertical Farm",
      targetAssetCount: 2,
    })) as { ok: boolean; run: { id: string } };
    expect(createRes.ok).toBe(true);
    const runId = createRes.run.id;

    // 2. Get
    const getRes = (await executeStockPipelineMcpTool("stock.pipeline.get", {
      runId,
    })) as { ok: boolean; run: { id: string; query: string } };
    expect(getRes.ok).toBe(true);
    expect(getRes.run.query).toBe("Futuristic Vertical Farm");

    // 3. List
    const listRes = (await executeStockPipelineMcpTool("stock.pipeline.list", {
      limit: 10,
    })) as { ok: boolean; count: number; runs: unknown[] };
    expect(listRes.ok).toBe(true);
    expect(listRes.count).toBeGreaterThan(0);

    // 4. Step
    const step1 = (await executeStockPipelineMcpTool("stock.pipeline.step", {
      runId,
      stage: 1,
    })) as { ok: boolean; stage: number };
    expect(step1.ok).toBe(true);
    expect(step1.stage).toBe(1);

    // 5. Cancel
    const cancelRes = (await executeStockPipelineMcpTool("stock.pipeline.cancel", {
      runId,
      reason: "User cancelled test",
    })) as { ok: boolean };
    expect(cancelRes.ok).toBe(true);
  });

  // =========================================================================
  // 4. REST Management API Routes
  // =========================================================================
  test("management API handles /api/stock/pipeline/* endpoints", async () => {
    function makeCtx(path: string, method: string, body?: unknown): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const req = new Request(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        url,
        req,
        config: {} as any,
        deps: {} as any,
        principal: { type: "admin" } as any,
        convergeCodexCatalog: (async () => ({} as any)) as any,
        syncClaudeAgentDefsBestEffort: async () => {},
      };
    }

    // POST /api/stock/pipeline/create
    const postCtx = makeCtx("/api/stock/pipeline/create", "POST", {
      query: "Smart Cities 2030",
      targetAssetCount: 3,
    });
    const postRes = await handleStockPipelineRoutes(postCtx);
    expect(postRes).not.toBeNull();
    expect(postRes?.status).toBe(201);
    const postData = (await postRes?.json()) as { ok: boolean; run: { id: string } };
    expect(postData.ok).toBe(true);
    const runId = postData.run.id;

    // GET /api/stock/pipeline/runs
    const listCtx = makeCtx("/api/stock/pipeline/runs", "GET");
    const listRes = await handleStockPipelineRoutes(listCtx);
    expect(listRes?.status).toBe(200);
    const listData = (await listRes?.json()) as { ok: boolean; count: number };
    expect(listData.count).toBeGreaterThan(0);

    // GET /api/stock/pipeline/runs/:id
    const getCtx = makeCtx(`/api/stock/pipeline/runs/${runId}`, "GET");
    const getRes = await handleStockPipelineRoutes(getCtx);
    expect(getRes?.status).toBe(200);
    const getData = (await getRes?.json()) as { ok: boolean; run: { query: string } };
    expect(getData.run.query).toBe("Smart Cities 2030");

    // POST /api/stock/pipeline/runs/:id/step
    const stepCtx = makeCtx(`/api/stock/pipeline/runs/${runId}/step`, "POST", { stage: 1 });
    const stepRes = await handleStockPipelineRoutes(stepCtx);
    expect(stepRes?.status).toBe(200);

    // POST /api/agent-os/stock/pipeline/runs/:id parity route
    const parityCtx = makeCtx(`/api/agent-os/stock/pipeline/runs/${runId}`, "GET");
    const parityRes = await handleStockPipelineRoutes(parityCtx);
    expect(parityRes?.status).toBe(200);
  });
});
