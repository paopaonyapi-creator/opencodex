// Phase 20.20 — Social Intelligence MCP tools (spec sections 21, 22).
//
// route.preview never executes a paid job. Run-class tools pass through the central
// Cost Guard; approval-gated jobs answer with APPROVAL_REQUIRED plus the state needed
// to approve, never with raw provider errors.

import { openAgentOsDb } from "../db";
import { getSocialCostGuard } from "./cost-guard";
import { SocialError, toSocialError } from "./errors";
import { ApifyProvider } from "./apify-provider";
import { getSocialProvider, registerSocialProvider } from "./provider";
import { SocialToolRegistry } from "./registry";
import { SocialResearchOrchestrator } from "./research";
import { SocialRouter } from "./router";
import type { SocialCapability, SocialPlatform } from "./types";

export interface SocialMcpToolDefinition {
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

/** Idempotent bootstrap so handlers can assume the Apify provider exists. */
function ensureProviders(): void {
  getApifyProviderSingleton();
  function getApifyProviderSingleton(): ApifyProvider {
    const existing = getSocialProvider("apify");
    if (existing) return existing as ApifyProvider;
    const provider = new ApifyProvider();
    registerSocialProvider(provider);
    return provider;
  }
}

function parsePlatform(value: unknown): SocialPlatform | "any" {
  if (typeof value !== "string" || value.length === 0 || value === "any") return "any";
  return value as SocialPlatform;
}

function parseCapabilities(value: unknown): SocialCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is SocialCapability => typeof v === "string");
}

function errorPayload(error: unknown): Record<string, unknown> {
  const socialError = toSocialError(error);
  return { error: { code: socialError.code, message: socialError.message } };
}

export const SOCIAL_MCP_TOOLS: Record<string, SocialMcpToolDefinition> = {
  "social.providers.list": {
    name: "social.providers.list",
    description: "List registered social data providers with health status.",
    riskTier: "LOW",
    parameters: { type: "object", properties: {} },
    handler: () => {
      ensureProviders();
      const registry = new SocialToolRegistry();
      return { providers: registry.listProviders() };
    },
  },

  "social.tools.search": {
    name: "social.tools.search",
    description: "Search the local social tool registry by platform, capability, or text.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Platform filter (tiktok, youtube, reddit, ... or 'any')" },
        capability: { type: "string", description: "Required capability, e.g. search_videos" },
        query: { type: "string", description: "Free-text filter over name/title/description" },
        enabledOnly: { type: "boolean", default: true },
        limit: { type: "number", default: 20 },
      },
    },
    handler: (args) => {
      const registry = new SocialToolRegistry();
      const tools = registry.listTools({
        platform: parsePlatform(args.platform),
        capability: typeof args.capability === "string" ? (args.capability as SocialCapability) : undefined,
        search: typeof args.query === "string" ? args.query : undefined,
        enabledOnly: args.enabledOnly !== false,
        limit: typeof args.limit === "number" ? args.limit : 20,
      });
      return {
        tools: tools.map((tool) => ({
          id: tool.id,
          provider: tool.providerId,
          name: tool.name,
          platform: tool.platform,
          capabilities: tool.capabilities,
          health: registryHealth(tool),
          pricingState: tool.pricingState,
          estimatedCost: tool.estimatedUnitCost,
        })),
        count: tools.length,
      };
    },
  },

  "social.tools.get": {
    name: "social.tools.get",
    description: "Fetch one registered social tool with its observed internal reliability.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: { toolId: { type: "string" } },
      required: ["toolId"],
    },
    handler: (args) => {
      const registry = new SocialToolRegistry();
      const tool = registry.getTool(String(args.toolId));
      if (!tool) return { error: { code: "TOOL_NOT_FOUND", message: `tool ${String(args.toolId)} not found` } };
      return {
        tool: {
          ...tool,
          observedReliability: observedReliability(tool),
        },
      };
    },
  },

  "social.registry.refresh": {
    name: "social.registry.refresh",
    description: "Refresh the local tool catalog from a provider (paginated, idempotent upsert; missing tools are disabled, never deleted).",
    riskTier: "MEDIUM",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", default: "apify" },
        maxPages: { type: "number", default: 3 },
        search: { type: "string" },
      },
    },
    handler: async (args) => {
      try {
        ensureProviders();
        const registry = new SocialToolRegistry();
        const summary = await registry.refresh(
          typeof args.provider === "string" ? args.provider : "apify",
          {
            maxPages: typeof args.maxPages === "number" ? args.maxPages : 3,
            search: typeof args.search === "string" ? args.search : undefined,
          },
        );
        return { refresh: summary };
      } catch (error) {
        return errorPayload(error);
      }
    },
  },

  "social.route.preview": {
    name: "social.route.preview",
    description: "Preview which tool the router would select for a request, with explainable scoring. NEVER executes a paid job.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        maxItems: { type: "number" },
        maxCostUsd: { type: "number" },
      },
      required: ["capabilities"],
    },
    handler: async (args) => {
      const orchestrator = new SocialResearchOrchestrator();
      const { decision, selectedTool, budget } = await orchestrator.previewRoute({
        platform: parsePlatform(args.platform),
        capabilities: parseCapabilities(args.capabilities),
        query: typeof args.query === "string" ? args.query : undefined,
        maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
        maxCostUsd: typeof args.maxCostUsd === "number" ? args.maxCostUsd : undefined,
      });
      return {
        selectedToolId: decision.selectedToolId,
        selectedToolName: selectedTool?.name ?? null,
        score: decision.candidates[0]?.score ?? null,
        estimatedCostUsd: decision.estimatedCostUsd,
        requiresApproval: decision.requiresApproval,
        budgetState: budget?.state ?? null,
        alternatives: decision.candidates.slice(1).map((c) => ({ toolId: c.toolId, score: c.score })),
        reasons: decision.candidates[0]?.reasons ?? [],
        risks: decision.candidates[0]?.risks ?? [],
        blockedReason: decision.blockedReason,
      };
    },
  },

  "social.run": {
    name: "social.run",
    description: "Route and execute a social research run through the central Cost Guard. Paid runs may answer APPROVAL_REQUIRED with instructions.",
    riskTier: "HIGH",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string" },
        capability: { type: "string", description: "Primary required capability" },
        capabilities: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        maxItems: { type: "number" },
        maxCostUsd: { type: "number" },
        approvalToken: { type: "string", description: "Single-use token issued by social.approve when the job required approval" },
      },
      required: ["capabilities"],
    },
    handler: async (args) => {
      try {
        const capabilities = parseCapabilities(args.capabilities);
        if (capabilities.length === 0 && typeof args.capability === "string") capabilities.push(args.capability as SocialCapability);
        const orchestrator = new SocialResearchOrchestrator();
        const job = orchestrator.createJob({
          platform: parsePlatform(args.platform),
          capabilities,
          query: typeof args.query === "string" ? args.query : undefined,
          maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
          maxCostUsd: typeof args.maxCostUsd === "number" ? args.maxCostUsd : undefined,
        });
        const result = await orchestrator.runJob(job.id, {
          approvalToken: typeof args.approvalToken === "string" ? args.approvalToken : undefined,
        });
        return {
          researchJobId: result.job.id,
          state: result.job.state,
          selectedTool: result.job.selectedToolId,
          estimatedCost: result.job.estimatedCostUsd,
          fallbackHistory: result.job.fallbackHistory,
          itemCount: result.items.length,
          signalCount: result.signals,
          opportunityCount: result.opportunities,
          resultSummary: result.job.resultSummary,
        };
      } catch (error) {
        if (error instanceof SocialError && error.code === "APPROVAL_REQUIRED") {
          return { error: { code: "APPROVAL_REQUIRED", message: error.message } };
        }
        return errorPayload(error);
      }
    },
  },

  "social.run.status": {
    name: "social.run.status",
    description: "Fetch a research job with its provider run history and fallback trail.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: { researchJobId: { type: "string" } },
      required: ["researchJobId"],
    },
    handler: (args) => {
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.getJob(String(args.researchJobId));
      if (!job) return { error: { code: "TOOL_NOT_FOUND", message: `job ${String(args.researchJobId)} not found` } };
      return { job, runs: orchestrator.listRuns(job.id) };
    },
  },

  "social.research": {
    name: "social.research",
    description: "Run one research job per requested platform and return aggregated evidence summaries. Respects the same budget and approval gates per job.",
    riskTier: "HIGH",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        capabilities: { type: "array", items: { type: "string" }, description: "Defaults to search_videos for video platforms, search_posts otherwise" },
        maxItems: { type: "number" },
        maxCostUsd: { type: "number", description: "Per-job cost limit" },
        approvalTokens: {
          type: "object",
          description: "Map of researchJobId to single-use approval token for jobs that required approval",
          additionalProperties: { type: "string" },
        },
      },
      required: ["topic", "platforms"],
    },
    handler: async (args) => {
      const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p): p is string => typeof p === "string") : [];
      if (platforms.length === 0) return { error: { code: "INVALID_INPUT", message: "platforms must be a non-empty array" } };
      const approvalTokens = (args.approvalTokens && typeof args.approvalTokens === "object")
        ? args.approvalTokens as Record<string, string>
        : {};
      const orchestrator = new SocialResearchOrchestrator();
      const perPlatform: Array<Record<string, unknown>> = [];

      for (const platform of platforms.slice(0, 6)) {
        const capabilities = parseCapabilities(args.capabilities);
        if (capabilities.length === 0) {
          capabilities.push(platform === "youtube" || platform === "tiktok" ? "search_videos" : "search_posts");
        }
        const job = orchestrator.createJob({
          platform: platform as SocialPlatform,
          capabilities,
          query: String(args.topic),
          maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
          maxCostUsd: typeof args.maxCostUsd === "number" ? args.maxCostUsd : undefined,
        });
        const result = await orchestrator.runJob(job.id, { approvalToken: approvalTokens[job.id] });
        perPlatform.push({
          platform,
          researchJobId: result.job.id,
          state: result.job.state,
          selectedTool: result.job.selectedToolId,
          itemCount: result.items.length,
          uniqueCount: result.job.resultSummary.uniqueCount ?? null,
          signalCount: result.signals,
          errorCode: result.job.errorCode,
        });
      }

      return { topic: String(args.topic), perPlatform };
    },
  },

  "social.trends": {
    name: "social.trends",
    description: "Read computed trend signals (keyword/hashtag frequency, cross-platform recurrence) for a research job.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: { researchJobId: { type: "string" } },
      required: ["researchJobId"],
    },
    handler: (args) => {
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.getJob(String(args.researchJobId));
      if (!job) return { error: { code: "TOOL_NOT_FOUND", message: `job ${String(args.researchJobId)} not found` } };
      const signals = querySignals(job.id);
      return {
        researchJobId: job.id,
        // Evidence labeling is part of the contract, not decoration.
        label: "Social trend signal (observed social data; not buyer demand)",
        signals,
        count: signals.length,
      };
    },
  },

  "social.compare_platforms": {
    name: "social.compare_platforms",
    description: "Compare observed evidence for a research job across platforms (item counts, engagement sums).",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: { researchJobId: { type: "string" } },
      required: ["researchJobId"],
    },
    handler: (args) => {
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.getJob(String(args.researchJobId));
      if (!job) return { error: { code: "TOOL_NOT_FOUND", message: `job ${String(args.researchJobId)} not found` } };
      const items = orchestrator.listEvidence(job.id).filter((item) => !item.duplicateOf);
      const byPlatform = new Map<string, { items: number; views: number | null; likes: number | null; comments: number | null }>();
      for (const item of items) {
        const entry = byPlatform.get(item.platform) ?? { items: 0, views: null, likes: null, comments: null };
        entry.items++;
        entry.views = sumNullable(entry.views, item.metrics.views);
        entry.likes = sumNullable(entry.likes, item.metrics.likes);
        entry.comments = sumNullable(entry.comments, item.metrics.comments);
        byPlatform.set(item.platform, entry);
      }
      return {
        researchJobId: job.id,
        label: "Observed social engagement sums (provider-reported, not audited)",
        platforms: [...byPlatform.entries()].map(([platform, entry]) => ({ platform, ...entry })),
      };
    },
  },

  "social.stock_opportunities": {
    name: "social.stock_opportunities",
    description: "Research a topic across platforms and return structured ORIGINAL-concept opportunity proposals with evidence confidence (decision support, not sales predictions).",
    riskTier: "HIGH",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        maxCostUsd: { type: "number" },
        maxItems: { type: "number" },
        limit: { type: "number", default: 5 },
      },
      required: ["topic", "platforms"],
    },
    handler: async (args) => {
      const research = SOCIAL_MCP_TOOLS["social.research"].handler(args);
      const awaited = research instanceof Promise ? await research : research;
      const jobIds = (awaited.perPlatform as Array<{ researchJobId: string }>)
        .map((entry) => entry.researchJobId);
      const opportunities = jobIds.flatMap((jobId) => queryOpportunities(jobId));
      return {
        topic: String(args.topic),
        researchJobs: jobIds,
        opportunities: opportunities.slice(0, typeof args.limit === "number" ? args.limit : 5),
        disclaimer: "Opportunity proposals are research decision support for ORIGINAL concept work. Scores are heuristics over observed social signals, not demand or sales predictions.",
      };
    },
  },

  "social.usage.summary": {
    name: "social.usage.summary",
    description: "Usage ledger summary: estimated vs actual spend against daily and monthly budgets.",
    riskTier: "LOW",
    parameters: { type: "object", properties: {} },
    handler: () => {
      return { usage: getSocialCostGuard().getUsageSummary() };
    },
  },
};

function registryHealth(tool: { successCount: number; failureCount: number; timeoutCount: number; enabled: boolean }): string {
  if (!tool.enabled) return "disabled";
  const completed = tool.successCount + tool.failureCount + tool.timeoutCount;
  if (completed === 0) return "unproven";
  const rate = tool.successCount / completed;
  return rate >= 0.9 ? "healthy" : rate >= 0.6 ? "degraded" : "unhealthy";
}

function observedReliability(tool: { successCount: number; failureCount: number; timeoutCount: number }): { completedRuns: number; successRate: number | null; source: string } {
  const completed = tool.successCount + tool.failureCount + tool.timeoutCount;
  return {
    completedRuns: completed,
    successRate: completed > 0 ? Math.round((tool.successCount / completed) * 100) / 100 : null,
    source: "Internal observed reliability (Pao-hubPro runs only)",
  };
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function querySignals(jobId: string): unknown[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM social_trend_signals WHERE research_job_id = ? ORDER BY occurrences DESC")
    .all(jobId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    key: row.key,
    platforms: safeArray(row.platforms_json),
    occurrences: row.occurrences,
    stats: safeObject(row.stats_json),
    evidenceRefCount: safeArray(row.evidence_refs_json).length,
    observedAt: row.observed_at,
  }));
}

function queryOpportunities(jobId: string): unknown[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM social_opportunities WHERE research_job_id = ? ORDER BY created_at DESC")
    .all(jobId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id,
    researchJobId: row.research_job_id,
    title: row.title,
    buyerProblem: row.buyer_problem,
    commercialUseCases: safeArray(row.commercial_use_cases_json),
    observedThemes: safeArray(row.observed_themes_json),
    evidenceConfidence: row.evidence_confidence,
    opportunityScore: row.opportunity_score,
    scoreBasis: row.score_basis,
    risks: safeArray(row.risks_json),
    suggestedOriginalDirections: safeArray(row.suggested_directions_json),
  }));
}

function safeArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
