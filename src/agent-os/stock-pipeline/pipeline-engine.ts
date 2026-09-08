// End-to-End Autonomous Stock Production & Submission Pipeline Engine
//
// Master coordinator orchestrating:
// Stage 1: Trend Discovery & Intelligence (TrendResearchOrchestrator)
// Stage 2: Campaign Portfolio Planning (CampaignPlanner)
// Stage 3: Generative Batch Dispatch & GPU Router (CampaignDispatcher)
// Stage 4: Automated QC & IP Sanitizer (VisualQcGate, IpSanitizer, ReviewerCouncil)
// Stage 5: Adobe Stock CSV Manifest Packaging (CsvPackager)
// Stage 6: Browser Multi-Agent Web Mission (BrowserMultiAgentCoordinator)
// Stage 7: Human Supervisor Approval Gate & Submission

import { openAgentOsDb } from "../db";
import { TrendResearchOrchestrator } from "../trends/research-orchestrator";
import { planCampaign } from "../campaign/planner/campaign-planner";
import { dispatchCampaign, syncCampaignExecution } from "../campaign/execution/campaign-dispatcher";
import { evaluateCampaignItem } from "../campaign/qc/council-evaluator";
import { generateCampaignCsvManifest } from "../campaign/metadata/csv-packager";
import { BrowserMultiAgentCoordinator } from "../browser/multi-agent/coordinator";
import { UploadWebAgent } from "../browser/multi-agent/agents/upload-agent";
import { QAWebAgent } from "../browser/multi-agent/agents/qa-agent";
import { ReviewerWebAgent } from "../browser/multi-agent/agents/reviewer-agent";
import { getBrowserApprovalManager } from "../browser/security/approval-manager";
import type {
  PipelineFilter,
  PipelineStageName,
  PipelineStatus,
  PipelineStepResult,
  StartPipelineInput,
  StockPipelineRun,
} from "./types";

export class StockAutonomousPipelineEngine {
  private trendOrchestrator: TrendResearchOrchestrator;
  private browserCoordinator: BrowserMultiAgentCoordinator;
  private uploadWebAgent: UploadWebAgent;
  private qaWebAgent: QAWebAgent;
  private reviewerWebAgent: ReviewerWebAgent;

  constructor() {
    this.trendOrchestrator = new TrendResearchOrchestrator();
    this.browserCoordinator = new BrowserMultiAgentCoordinator();
    this.uploadWebAgent = new UploadWebAgent();
    this.qaWebAgent = new QAWebAgent();
    this.reviewerWebAgent = new ReviewerWebAgent();
  }

  // =========================================================================
  // Lifecycle Management & Persistence
  // =========================================================================

  public createPipelineRun(input: StartPipelineInput): StockPipelineRun {
    const db = openAgentOsDb();
    const id = `pipe_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const run: StockPipelineRun = {
      id,
      query: input.query.trim(),
      market: input.market || "US",
      targetAssetCount: input.targetAssetCount || 10,
      status: "pending",
      currentStage: 1,
      conceptSummary: {},
      campaignSummary: {},
      qcSummary: {},
      browserSummary: {},
      summary: {},
      createdAt: now,
      updatedAt: now,
    };

    db.query(`
      INSERT INTO stock_autonomous_pipeline_runs (
        id, query, market, target_asset_count, status, current_stage,
        trend_job_id, campaign_id, browser_mission_id, approval_id,
        concept_summary_json, campaign_summary_json, qc_summary_json,
        browser_summary_json, summary_json, error_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.query,
      run.market,
      run.targetAssetCount,
      run.status,
      run.currentStage,
      null,
      null,
      null,
      null,
      JSON.stringify(run.conceptSummary),
      JSON.stringify(run.campaignSummary),
      JSON.stringify(run.qcSummary),
      JSON.stringify(run.browserSummary),
      JSON.stringify(run.summary),
      null,
      run.createdAt,
      run.updatedAt,
    );

    return run;
  }

  public getPipelineRun(id: string): StockPipelineRun | null {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM stock_autonomous_pipeline_runs WHERE id = ? LIMIT 1")
      .get(id) as Record<string, unknown> | null;

    if (!row) return null;

    const parseJson = (val: unknown) => {
      try {
        return JSON.parse(String(val || "{}"));
      } catch {
        return {};
      }
    };

    return {
      id: String(row.id),
      query: String(row.query),
      market: String(row.market),
      targetAssetCount: Number(row.target_asset_count),
      status: row.status as PipelineStatus,
      currentStage: Number(row.current_stage),
      trendJobId: row.trend_job_id ? String(row.trend_job_id) : undefined,
      campaignId: row.campaign_id ? String(row.campaign_id) : undefined,
      browserMissionId: row.browser_mission_id ? String(row.browser_mission_id) : undefined,
      approvalId: row.approval_id ? String(row.approval_id) : undefined,
      conceptSummary: parseJson(row.concept_summary_json),
      campaignSummary: parseJson(row.campaign_summary_json),
      qcSummary: parseJson(row.qc_summary_json),
      browserSummary: parseJson(row.browser_summary_json),
      summary: parseJson(row.summary_json),
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }

  public listPipelineRuns(filter?: PipelineFilter): StockPipelineRun[] {
    const db = openAgentOsDb();
    const limit = filter?.limit || 50;
    let query = "SELECT * FROM stock_autonomous_pipeline_runs WHERE 1=1";
    const params: (string | number)[] = [];

    if (filter?.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...params) as Record<string, unknown>[];

    const parseJson = (val: unknown) => {
      try {
        return JSON.parse(String(val || "{}"));
      } catch {
        return {};
      }
    };

    return rows.map((row) => ({
      id: String(row.id),
      query: String(row.query),
      market: String(row.market),
      targetAssetCount: Number(row.target_asset_count),
      status: row.status as PipelineStatus,
      currentStage: Number(row.current_stage),
      trendJobId: row.trend_job_id ? String(row.trend_job_id) : undefined,
      campaignId: row.campaign_id ? String(row.campaign_id) : undefined,
      browserMissionId: row.browser_mission_id ? String(row.browser_mission_id) : undefined,
      approvalId: row.approval_id ? String(row.approval_id) : undefined,
      conceptSummary: parseJson(row.concept_summary_json),
      campaignSummary: parseJson(row.campaign_summary_json),
      qcSummary: parseJson(row.qc_summary_json),
      browserSummary: parseJson(row.browser_summary_json),
      summary: parseJson(row.summary_json),
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    }));
  }

  private updateRun(run: StockPipelineRun): void {
    const db = openAgentOsDb();
    run.updatedAt = Date.now();
    db.query(`
      UPDATE stock_autonomous_pipeline_runs SET
        status = ?,
        current_stage = ?,
        trend_job_id = ?,
        campaign_id = ?,
        browser_mission_id = ?,
        approval_id = ?,
        concept_summary_json = ?,
        campaign_summary_json = ?,
        qc_summary_json = ?,
        browser_summary_json = ?,
        summary_json = ?,
        error_message = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `).run(
      run.status,
      run.currentStage,
      run.trendJobId || null,
      run.campaignId || null,
      run.browserMissionId || null,
      run.approvalId || null,
      JSON.stringify(run.conceptSummary),
      JSON.stringify(run.campaignSummary),
      JSON.stringify(run.qcSummary),
      JSON.stringify(run.browserSummary),
      JSON.stringify(run.summary),
      run.errorMessage || null,
      run.updatedAt,
      run.completedAt || null,
      run.id,
    );
  }

  // =========================================================================
  // Stage 1: Trend Discovery & Intelligence
  // =========================================================================

  public async stepTrends(runId: string): Promise<PipelineStepResult> {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);

    run.status = "trends_running";
    run.currentStage = 1;
    this.updateRun(run);

    try {
      // 1. Create and execute trend research job
      const rJob = this.trendOrchestrator.createJob({
        query: run.query,
        market: run.market,
        assetType: "all",
      });
      run.trendJobId = rJob.id;

      const result = await this.trendOrchestrator.runJob(rJob.id);

      const topConcept = result.concepts[0] || {
        title: `${run.query} Commercial Concept`,
        prompt: `High quality commercial visual of ${run.query}, modern studio lighting, ultra detailed`,
        negativePrompt: "watermark, bad anatomy, blur, trademark",
        targetIndustries: ["Technology", "Renewable Energy"],
        category: "technology",
      };

      run.conceptSummary = {
        trendJobId: rJob.id,
        opportunityScore: result.opportunity?.opportunityScore ?? 85,
        priorityTier: result.opportunity?.recommendation ?? "MUST_PRODUCE",
        signalCount: result.signalCount,
        topConcept,
      };

      run.status = "planning";
      run.currentStage = 2;
      this.updateRun(run);

      return {
        run,
        stage: 1,
        stageName: "trend_discovery",
        output: run.conceptSummary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 1 (Trends) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 2: Campaign Portfolio Planning
  // =========================================================================

  public stepPlanCampaign(runId: string): PipelineStepResult {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);

    run.status = "planning";
    run.currentStage = 2;
    this.updateRun(run);

    try {
      const concept = run.conceptSummary.topConcept as Record<string, unknown> | undefined;
      const title = (concept?.title as string) || `${run.query} Campaign`;
      const category = (concept?.category as string) || "technology";

      // Formulate 10/20 shot campaign portfolio
      const planRes = planCampaign({
        title,
        keyword: run.query,
        targetAssetCount: run.targetAssetCount,
        category,
      });

      run.campaignId = planRes.campaign.id;
      run.campaignSummary = {
        campaignId: planRes.campaign.id,
        title: planRes.campaign.title,
        status: planRes.campaign.status,
        totalItems: planRes.items.length,
      };

      run.status = "rendering";
      run.currentStage = 3;
      this.updateRun(run);

      return {
        run,
        stage: 2,
        stageName: "campaign_planning",
        output: run.campaignSummary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 2 (Planning) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 3: Generative Batch Dispatch & Workload Router
  // =========================================================================

  public stepDispatchGeneration(runId: string): PipelineStepResult {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);
    if (!run.campaignId) throw new Error(`Campaign not planned for run '${runId}'`);

    run.status = "rendering";
    run.currentStage = 3;
    this.updateRun(run);

    try {
      // 1. Dispatch campaign items into gen_jobs
      const dispatchRes = dispatchCampaign(run.campaignId);

      // 2. Sync execution status
      const syncRes = syncCampaignExecution(run.campaignId);

      const output = {
        campaignId: run.campaignId,
        dispatchedCount: dispatchRes.dispatchedCount,
        jobIds: dispatchRes.jobIds,
        completedCount: syncRes.completedCount,
        remainingCount: syncRes.remainingCount,
        campaignStatus: syncRes.campaignStatus,
      };

      run.campaignSummary = {
        ...run.campaignSummary,
        ...output,
      };

      run.status = "qc_evaluating";
      run.currentStage = 4;
      this.updateRun(run);

      return {
        run,
        stage: 3,
        stageName: "generative_dispatch",
        output,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 3 (Generation) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 4: Automated QC & IP Sanitizer
  // =========================================================================

  public stepRunQc(runId: string): PipelineStepResult {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);
    if (!run.campaignId) throw new Error(`Campaign missing for run '${runId}'`);

    run.status = "qc_evaluating";
    run.currentStage = 4;
    this.updateRun(run);

    try {
      const db = openAgentOsDb();
      const items = db
        .query("SELECT * FROM stock_campaign_items WHERE campaign_id = ?")
        .all(run.campaignId) as Record<string, unknown>[];

      let passedCount = 0;
      let rejectedCount = 0;
      const evaluations: Record<string, unknown>[] = [];

      for (const item of items) {
        const itemId = String(item.id);

        // evaluateCampaignItem executes both visual QC and IP clearance
        const evalRes = evaluateCampaignItem({
          campaignItemId: itemId,
          width: 3840,
          height: 2160,
        });

        const isApproved = evalRes.record.councilVerdict === "approve";
        if (isApproved) {
          passedCount++;
        } else {
          rejectedCount++;
        }

        evaluations.push({
          itemId,
          verdict: evalRes.record.councilVerdict,
          sharpnessScore: evalRes.record.sharpnessScore,
          ipStatus: evalRes.record.ipClearanceStatus,
          reasons: evalRes.reasons,
        });
      }

      run.qcSummary = {
        totalEvaluated: items.length,
        passedCount,
        rejectedCount,
        allPassed: rejectedCount === 0,
        evaluations,
      };

      run.status = "browser_preparing";
      run.currentStage = 5;
      this.updateRun(run);

      return {
        run,
        stage: 4,
        stageName: "qc_evaluation",
        output: run.qcSummary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 4 (QC) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 5: Adobe Stock CSV Manifest Packaging
  // =========================================================================

  public stepPackageManifest(runId: string): PipelineStepResult {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);
    if (!run.campaignId) throw new Error(`Campaign missing for run '${runId}'`);

    run.status = "browser_preparing";
    run.currentStage = 5;
    this.updateRun(run);

    try {
      const manifestRes = generateCampaignCsvManifest(run.campaignId);

      const output = {
        campaignId: run.campaignId,
        rowCount: manifestRes.rowCount,
        csvBytes: manifestRes.csv.length,
        csvPreview: manifestRes.csv.split("\n").slice(0, 3).join("\n"),
      };

      run.summary = {
        ...run.summary,
        manifest: output,
      };

      run.status = "waiting_approval";
      run.currentStage = 6;
      this.updateRun(run);

      return {
        run,
        stage: 5,
        stageName: "metadata_csv_packager",
        output,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 5 (Manifest) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 6: Browser Multi-Agent Web Operations Mission Preparation
  // =========================================================================

  public async stepPrepareBrowserMission(runId: string, targetDomain = "stock.adobe.com"): Promise<PipelineStepResult> {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);

    run.status = "waiting_approval";
    run.currentStage = 6;
    this.updateRun(run);

    try {
      // 1. Create Multi-Agent Web Mission
      const mission = this.browserCoordinator.createMission({
        name: `Adobe Stock Auto-Submit: ${run.query}`,
        targetDomain,
        goal: `Upload and submit generated stock asset portfolio for '${run.query}'`,
        assignedAgents: ["researcher", "metadata", "uploader", "qa", "reviewer"],
        contextData: {
          pipelineRunId: run.id,
          campaignId: run.campaignId,
          query: run.query,
          manifestSummary: run.summary?.manifest,
        },
      });
      run.browserMissionId = mission.id;

      // 2. Formulate Reviewer Council Proposal & Human Approval Request
      const proposal = this.reviewerWebAgent.evaluateAction(
        "submit_stock_portfolio",
        `https://${targetDomain}/contributor/upload`,
        {
          pipelineRunId: run.id,
          missionId: mission.id,
          campaignId: run.campaignId,
          targetAssetCount: run.targetAssetCount,
        },
      );

      const approvalRes = await this.reviewerWebAgent.submitForHumanApproval(
        proposal,
        "stock-autonomous-pipeline",
        false,
      );
      run.approvalId = approvalRes.approvalId;

      run.browserSummary = {
        missionId: mission.id,
        approvalId: approvalRes.approvalId,
        approvalStatus: approvalRes.status,
        targetDomain,
      };

      run.status = "waiting_approval";
      this.updateRun(run);

      return {
        run,
        stage: 6,
        stageName: "browser_preparation",
        output: run.browserSummary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.errorMessage = `Stage 6 (Browser Mission) failed: ${msg}`;
      this.updateRun(run);
      throw err;
    }
  }

  // =========================================================================
  // Stage 7: Human Supervisor Approval Gate & Submission
  // =========================================================================

  public stepFinalizeSubmission(runId: string, decision: "approve" | "reject", reason?: string): PipelineStepResult {
    const run = this.getPipelineRun(runId);
    if (!run) throw new Error(`Pipeline run '${runId}' not found`);
    if (!run.approvalId) throw new Error(`No pending approval request found for run '${runId}'`);

    const approvalMgr = getBrowserApprovalManager();

    if (decision === "approve") {
      approvalMgr.approve(run.approvalId, "once", "operator");
      run.status = "completed";
      run.currentStage = 7;
      run.completedAt = Date.now();
      run.summary = {
        ...run.summary,
        finalDecision: "approved",
        submittedAt: run.completedAt,
      };
    } else {
      approvalMgr.reject(run.approvalId, "operator");
      run.status = "cancelled";
      run.currentStage = 7;
      run.completedAt = Date.now();
      run.summary = {
        ...run.summary,
        finalDecision: "rejected",
        rejectionReason: reason || "Operator rejected submission",
      };
    }

    this.updateRun(run);

    return {
      run,
      stage: 7,
      stageName: "human_approval_submission",
      output: run.summary,
    };
  }

  // =========================================================================
  // End-to-End Runner
  // =========================================================================

  public async runFullPipeline(input: StartPipelineInput): Promise<StockPipelineRun> {
    const run = this.createPipelineRun(input);

    // Step 1: Trends
    await this.stepTrends(run.id);

    // Step 2: Plan Campaign
    this.stepPlanCampaign(run.id);

    // Step 3: Dispatch Generation
    if (input.autoDispatchGen !== false) {
      this.stepDispatchGeneration(run.id);
    }

    // Step 4: Automated QC
    this.stepRunQc(run.id);

    // Step 5: Package Manifest
    this.stepPackageManifest(run.id);

    // Step 6: Browser Mission & Approval Gate
    if (!input.skipBrowserUpload) {
      await this.stepPrepareBrowserMission(run.id, input.targetDomain);
    }

    return this.getPipelineRun(run.id)!;
  }
}

// Global Singleton
let pipelineEngineInstance: StockAutonomousPipelineEngine | null = null;

export function getStockPipelineEngine(): StockAutonomousPipelineEngine {
  if (!pipelineEngineInstance) {
    pipelineEngineInstance = new StockAutonomousPipelineEngine();
  }
  return pipelineEngineInstance;
}
