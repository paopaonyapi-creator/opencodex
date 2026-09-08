// Phase 20.10 — Trend Intelligence MCP Tools (spec section 27).
//
// 6 canonical Model Context Protocol tools for research execution, opportunity analysis,
// concept generation, studio production dispatch, cost monitoring, and actor listing.

import { getActorRegistry } from "./actor-registry";
import { getTrendOrchestrator } from "./research-orchestrator";
import type { TrendPlatformSource } from "./types";

export interface TrendMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export const TREND_MCP_TOOLS: Record<string, TrendMcpToolDefinition> = {
  trend_research_topic: {
    name: "trend_research_topic",
    description: "Research stock market demand and social trend signals for a topic, calculate opportunity score, and generate stock production concepts.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or trend topic to research" },
        market: { type: "string", description: "Target market region (e.g. US, GLOBAL)", default: "US" },
        asset_type: {
          type: "string",
          enum: ["image", "video", "vector", "illustration", "all"],
          description: "Target asset type",
          default: "all",
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Platforms to query (adobe_stock, youtube, tiktok, instagram)",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const orchestrator = getTrendOrchestrator();
      const job = orchestrator.createJob({
        query: String(args.query),
        market: args.market ? String(args.market) : "US",
        assetType: args.asset_type ? String(args.asset_type) : "all",
        requestedSources: Array.isArray(args.sources) ? (args.sources as TrendPlatformSource[]) : undefined,
      });

      const result = await orchestrator.runJob(job.id);
      return {
        job_id: result.job.id,
        status: result.job.status,
        query: result.job.query,
        opportunity: result.opportunity,
        concepts_count: result.concepts.length,
        concepts: result.concepts,
        signal_count: result.signalCount,
        total_cost_usd: result.totalCostUsd,
      };
    },
  },

  trend_get_opportunities: {
    name: "trend_get_opportunities",
    description: "Retrieve evaluated stock production opportunity scores and recommendations for a research job.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Research job ID" },
      },
      required: ["job_id"],
    },
    handler: (args) => {
      const orchestrator = getTrendOrchestrator();
      const opps = orchestrator.getJobOpportunities(String(args.job_id));
      return {
        job_id: String(args.job_id),
        opportunities: opps,
        count: opps.length,
      };
    },
  },

  trend_generate_stock_concepts: {
    name: "trend_generate_stock_concepts",
    description: "Retrieve or generate original stock production concepts for an evaluated topic with trademark genericization.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Research job ID" },
      },
      required: ["job_id"],
    },
    handler: (args) => {
      const orchestrator = getTrendOrchestrator();
      const concepts = orchestrator.getJobConcepts(String(args.job_id));
      return {
        job_id: String(args.job_id),
        concepts,
        count: concepts.length,
      };
    },
  },

  trend_dispatch_to_studio: {
    name: "trend_dispatch_to_studio",
    description: "Dispatch an approved stock concept to Pao AI Generation Studio (ComfyUI / MiniMax H3 queue).",
    riskTier: "MEDIUM",
    parameters: {
      type: "object",
      properties: {
        concept_id: { type: "string", description: "Stock concept ID to dispatch" },
      },
      required: ["concept_id"],
    },
    handler: (args) => {
      const orchestrator = getTrendOrchestrator();
      const result = orchestrator.dispatchConceptToStudio(String(args.concept_id));
      return result;
    },
  },

  trend_get_cost_summary: {
    name: "trend_get_cost_summary",
    description: "Get current research spending against daily financial guardrail caps.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: () => {
      const orchestrator = getTrendOrchestrator();
      return orchestrator.getCostSummary();
    },
  },

  trend_list_actors: {
    name: "trend_list_actors",
    description: "List registered scrapers and intelligence actors with health scores and pricing models.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by actor category" },
      },
    },
    handler: (args) => {
      const registry = getActorRegistry();
      const actors = registry.listActors(args.category ? String(args.category) : undefined);
      return {
        actors,
        count: actors.length,
      };
    },
  },
};
