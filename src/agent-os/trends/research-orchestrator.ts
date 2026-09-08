// Phase 20.10 — Research Orchestrator (spec section 6, 373).
//
// End-to-end coordinator for Adobe Stock market research, social trend scraping,
// signal normalization, multi-dimensional opportunity scoring, original concept generation,
// and dispatch to Pao AI Generation Studio.

import { openAgentOsDb } from "../db";
import { getActorRegistry } from "./actor-registry";
import { getApifyGateway } from "./apify-gateway";
import { analyzeBuyerIntent } from "./buyer-intent";
import { generateStockConcepts } from "./concept-generator";
import { getTrendConfig } from "./config";
import { getCostGuard } from "./cost-guard";
import { normalizeRawItem } from "./normalizer";
import { calculateOpportunityScore } from "./scoring-engine";
import type {
  NormalizedTrendSignal,
  OpportunityScore,
  ResearchJob,
  ResearchJobStatus,
  StockConcept,
  TrendPlatformSource,
  TrendSignal,
} from "./types";

export interface CreateResearchJobInput {
  query: string;
  market?: string;
  assetType?: string;
  requestedSources?: TrendPlatformSource[];
  config?: Record<string, unknown>;
}

export interface ResearchJobResult {
  job: ResearchJob;
  opportunity: OpportunityScore | null;
  concepts: StockConcept[];
  signalCount: number;
  totalCostUsd: number;
}

export class TrendResearchOrchestrator {
  createJob(input: CreateResearchJobInput): ResearchJob {
    const db = openAgentOsDb();
    const config = getTrendConfig();
    const id = `rjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const sources = input.requestedSources && input.requestedSources.length > 0
      ? input.requestedSources
      : config.defaultSources;

    const job: ResearchJob = {
      id,
      query: input.query.trim(),
      market: input.market || config.defaultMarket,
      assetType: input.assetType || "all",
      status: "pending",
      requestedSources: sources,
      config: input.config || {},
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };

    db.query(`INSERT INTO trend_research_jobs (
      id, query, market, asset_type, status, requested_sources_json, config_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      job.id,
      job.query,
      job.market,
      job.assetType,
      job.status,
      JSON.stringify(job.requestedSources),
      JSON.stringify(job.config),
      job.createdAt,
    );

    return job;
  }

  async runJob(jobId: string): Promise<ResearchJobResult> {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Research job "${jobId}" not found`);
    }

    const now = new Date().toISOString();
    db.query("UPDATE trend_research_jobs SET status = 'running', started_at = ? WHERE id = ?").run(now, jobId);
    job.status = "running";
    job.startedAt = now;

    const actorRegistry = getActorRegistry();
    const gateway = getApifyGateway();
    const costGuard = getCostGuard();

    const normalizedSignals: NormalizedTrendSignal[] = [];
    let totalCostUsd = 0;

    try {
      for (const source of job.requestedSources) {
        const actor = actorRegistry.getBestActorForSource(source);
        if (!actor) continue;

        // Estimated cost check
        const estCost = 0.05;
        const check = costGuard.canExecute(jobId, estCost);
        if (!check.allowed) {
          console.warn(`[TrendResearchOrchestrator] Cost guard blocked execution for source ${source}: ${check.reason}`);
          continue;
        }

        const runResult = await gateway.executeActor(actor, job.query, job.market, 15);
        totalCostUsd += runResult.costUsd;

        // Record Actor Run
        const actorRunId = `arun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        db.query(`INSERT INTO trend_actor_runs (
          id, research_job_id, actor_registry_id, provider_run_id, status,
          result_count, estimated_cost, actual_cost, runtime_ms, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          actorRunId,
          jobId,
          actor.id,
          runResult.runId,
          "succeeded",
          runResult.resultCount,
          estCost,
          runResult.costUsd,
          runResult.runtimeMs,
          now,
          new Date().toISOString(),
        );

        // Record spend into cost guard
        costGuard.recordUsage({
          jobId,
          provider: actor.provider,
          actorId: actor.actorId,
          providerRunId: runResult.runId,
          costUsd: runResult.costUsd,
          units: runResult.resultCount,
          metadata: { source, query: job.query },
        });

        // Normalize and insert signals
        for (const item of runResult.items) {
          const norm = normalizeRawItem(source, job.query, item);
          normalizedSignals.push(norm);

          const sigId = `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          db.query(`INSERT INTO trend_signals (
            id, research_job_id, source, source_type, topic, title, description,
            keywords_json, hashtags_json, published_at, views, likes, comments_count,
            shares, downloads, engagement_rate, ai_generated, source_url, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            sigId,
            jobId,
            source,
            actor.category,
            job.query,
            norm.title,
            String(item.description || ""),
            JSON.stringify(norm.keywords),
            JSON.stringify(item.hashtags || []),
            norm.publishedAt ?? null,
            norm.views,
            Number(item.likes || 0),
            Number(item.comments_count || 0),
            Number(item.shares || 0),
            norm.downloads,
            norm.engagementRate,
            norm.aiGenerated ? 1 : 0,
            String(item.source_url || ""),
            JSON.stringify(item),
            now,
          );
        }
      }

      // Calculate multi-dimensional Opportunity Score
      const scoreBreakdown = calculateOpportunityScore(job.query, normalizedSignals);
      const oppId = `opp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      db.query(`INSERT INTO trend_opportunity_scores (
        id, research_job_id, topic, demand_score, momentum_score, buyer_intent_score,
        competition_score, competition_gap_score, freshness_score, production_feasibility_score,
        ai_saturation_score, opportunity_score, recommendation, reasoning_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        oppId,
        jobId,
        job.query,
        scoreBreakdown.demandScore,
        scoreBreakdown.momentumScore,
        scoreBreakdown.buyerIntentScore,
        scoreBreakdown.competitionScore,
        scoreBreakdown.competitionGapScore,
        scoreBreakdown.freshnessScore,
        scoreBreakdown.productionFeasibilityScore,
        scoreBreakdown.aiSaturationScore,
        scoreBreakdown.opportunityScore,
        scoreBreakdown.recommendation,
        JSON.stringify(scoreBreakdown.reasoning),
        now,
      );

      const opportunity: OpportunityScore = {
        id: oppId,
        researchJobId: jobId,
        topic: job.query,
        ...scoreBreakdown,
        createdAt: now,
      };

      // Generate Original Stock Concepts
      const buyerIntent = analyzeBuyerIntent(job.query, [], normalizedSignals);
      const generatedConcepts = generateStockConcepts({
        researchJobId: jobId,
        topic: job.query,
        opportunityScoreId: oppId,
        opportunityScore: scoreBreakdown.opportunityScore,
        signals: normalizedSignals,
        buyerIntent,
        count: 2,
      });

      for (const concept of generatedConcepts) {
        db.query(`INSERT INTO trend_stock_concepts (
          id, research_job_id, opportunity_score_id, title, buyer_json,
          asset_types_json, visual_direction, must_include_json, must_avoid_json,
          commercial_use_cases_json, production_difficulty, status, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          concept.id,
          jobId,
          oppId,
          concept.title,
          JSON.stringify(concept.buyer),
          JSON.stringify(concept.assetTypes),
          concept.visualDirection,
          JSON.stringify(concept.mustInclude),
          JSON.stringify(concept.mustAvoid),
          JSON.stringify(concept.commercialUseCases),
          concept.productionDifficulty,
          concept.status,
          JSON.stringify(concept.payload),
          concept.createdAt,
        );
      }

      // Mark Job Completed
      const completedAt = new Date().toISOString();
      db.query("UPDATE trend_research_jobs SET status = 'completed', completed_at = ? WHERE id = ?").run(
        completedAt,
        jobId,
      );
      job.status = "completed";
      job.completedAt = completedAt;

      return {
        job,
        opportunity,
        concepts: generatedConcepts,
        signalCount: normalizedSignals.length,
        totalCostUsd,
      };
    } catch (err) {
      db.query("UPDATE trend_research_jobs SET status = 'failed' WHERE id = ?").run(jobId);
      job.status = "failed";
      throw err;
    }
  }

  getJob(jobId: string): ResearchJob | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM trend_research_jobs WHERE id = ?").get(jobId) as Record<string, unknown> | null;
    if (!row) return null;

    return {
      id: String(row.id),
      query: String(row.query),
      market: String(row.market),
      assetType: String(row.asset_type),
      status: row.status as ResearchJobStatus,
      requestedSources: JSON.parse(String(row.requested_sources_json)),
      config: JSON.parse(String(row.config_json)),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
    };
  }

  listJobs(limit = 50): ResearchJob[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM trend_research_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      query: String(row.query),
      market: String(row.market),
      assetType: String(row.asset_type),
      status: row.status as ResearchJobStatus,
      requestedSources: JSON.parse(String(row.requested_sources_json)),
      config: JSON.parse(String(row.config_json)),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
    }));
  }

  getJobSignals(jobId: string): TrendSignal[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM trend_signals WHERE research_job_id = ? ORDER BY created_at ASC").all(jobId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      researchJobId: String(r.research_job_id),
      source: r.source as TrendPlatformSource,
      sourceType: String(r.source_type),
      topic: String(r.topic),
      title: String(r.title),
      description: String(r.description || ""),
      keywords: JSON.parse(String(r.keywords_json || "[]")),
      hashtags: JSON.parse(String(r.hashtags_json || "[]")),
      publishedAt: r.published_at ? String(r.published_at) : null,
      views: Number(r.views || 0),
      likes: Number(r.likes || 0),
      commentsCount: Number(r.comments_count || 0),
      shares: Number(r.shares || 0),
      downloads: Number(r.downloads || 0),
      engagementRate: Number(r.engagement_rate || 0),
      aiGenerated: Boolean(r.ai_generated),
      sourceUrl: String(r.source_url || ""),
      metadata: JSON.parse(String(r.metadata_json || "{}")),
      createdAt: String(r.created_at),
    }));
  }

  getJobOpportunities(jobId: string): OpportunityScore[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM trend_opportunity_scores WHERE research_job_id = ? ORDER BY created_at DESC").all(jobId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      researchJobId: String(r.research_job_id),
      topic: String(r.topic),
      demandScore: Number(r.demand_score),
      momentumScore: Number(r.momentum_score),
      buyerIntentScore: Number(r.buyer_intent_score),
      competitionScore: Number(r.competition_score),
      competitionGapScore: Number(r.competition_gap_score),
      freshnessScore: Number(r.freshness_score),
      productionFeasibilityScore: Number(r.production_feasibility_score),
      aiSaturationScore: Number(r.ai_saturation_score),
      opportunityScore: Number(r.opportunity_score),
      recommendation: r.recommendation as any,
      reasoning: JSON.parse(String(r.reasoning_json || "{}")),
      createdAt: String(r.created_at),
    }));
  }

  getJobConcepts(jobId: string): StockConcept[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM trend_stock_concepts WHERE research_job_id = ? ORDER BY created_at ASC").all(jobId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      researchJobId: String(r.research_job_id),
      opportunityScoreId: r.opportunity_score_id ? String(r.opportunity_score_id) : null,
      title: String(r.title),
      buyer: JSON.parse(String(r.buyer_json || "{}")),
      assetTypes: JSON.parse(String(r.asset_types_json || "[]")),
      visualDirection: String(r.visual_direction),
      mustInclude: JSON.parse(String(r.must_include_json || "[]")),
      mustAvoid: JSON.parse(String(r.must_avoid_json || "[]")),
      commercialUseCases: JSON.parse(String(r.commercial_use_cases_json || "[]")),
      productionDifficulty: Number(r.production_difficulty),
      status: r.status as any,
      payload: JSON.parse(String(r.payload_json || "{}")),
      createdAt: String(r.created_at),
    }));
  }

  cancelJob(jobId: string): boolean {
    const db = openAgentOsDb();
    const res = db.query("UPDATE trend_research_jobs SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'running')").run(jobId);
    return res.changes > 0;
  }

  dispatchConceptToStudio(conceptId: string): { success: boolean; genJobId?: string; message: string } {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM trend_stock_concepts WHERE id = ?").get(conceptId) as Record<string, unknown> | null;
    if (!row) {
      return { success: false, message: `Concept "${conceptId}" not found` };
    }

    const payload = JSON.parse(String(row.payload_json || "{}"));
    const genJobId = `gjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Check if gen_jobs table exists (Phase 19 Pao AI Generation Studio)
    const genTable = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gen_jobs'").get();
    if (genTable) {
      db.query(`INSERT INTO gen_jobs (
        id, job_type, status, stage, priority, prompt, negative_prompt,
        stock_mode, auto_review, auto_metadata, auto_export, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        genJobId,
        "txt2img",
        "queued",
        "intake",
        8, // High priority for approved stock opportunity
        String(payload.recommendedPrompt || row.title),
        String(payload.recommendedNegativePrompt || ""),
        1, // stock_mode = true
        1, // auto_review = true
        1, // auto_metadata = true
        0, // auto_export = false (needs reviewer approval)
        now,
      );
    }

    // Update concept status to dispatched
    db.query("UPDATE trend_stock_concepts SET status = 'dispatched' WHERE id = ?").run(conceptId);

    return {
      success: true,
      genJobId,
      message: `Concept "${String(row.title)}" dispatched to Pao AI Generation Studio queue (Job ID: ${genJobId})`,
    };
  }

  getCostSummary(): { todayCostUsd: number; dailyCapUsd: number; remainingBudgetUsd: number; canSpend: boolean } {
    const costGuard = getCostGuard();
    const config = getTrendConfig();
    const todayCostUsd = costGuard.getDailySpendUsd();
    const remainingBudgetUsd = Math.max(0, config.dailyCostCapUsd - todayCostUsd);
    return {
      todayCostUsd,
      dailyCapUsd: config.dailyCostCapUsd,
      remainingBudgetUsd,
      canSpend: remainingBudgetUsd > 0.05,
    };
  }
}

let orchestratorInstance: TrendResearchOrchestrator | null = null;
export function getTrendOrchestrator(): TrendResearchOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new TrendResearchOrchestrator();
  }
  return orchestratorInstance;
}
