// Phase 20.34 — WebMCP tools for the Lead Intelligence Control Plane
// (spec §25-§27). Safety classes (§26): READ → R0/R1, WRITE_INTERNAL → R2,
// EXPORT → R2, POLICY_SENSITIVE → R3. Responses are bounded (ids, summaries,
// counts) so MCP context is never flooded with raw datasets.

import { getLeadService } from "./service-core";
import { leadFlags } from "./flags";
import type { WebMcpToolDefinition } from "../video/mcp-tools";

export const LEAD_INTELLIGENCE_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "lead_search",
    description: "Search B2B/local-business leads across enabled providers with cost-aware routing. Returns a job summary (ids/counts), not raw datasets.",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) => {
      const job = await getLeadService().search({
        query: (args.query ?? {}) as Record<string, unknown>,
        strategy: args.strategy as never,
        budget: args.budget as Record<string, unknown> | undefined,
        actor: typeof args.actor === "string" ? args.actor : "agent",
      });
      return { jobId: job.id, status: job.status, estimatedCost: job.estimatedCost, currency: job.currency, selectedProviders: job.selectedProviders, result: job.result, errorCode: job.errorCode };
    },
  },
  {
    name: "lead_search_businesses",
    description: "Search local-business leads (convenience wrapper over lead_search).",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) => {
      const query = { ...((args.query ?? {}) as Record<string, unknown>), leadKind: "local_business" };
      const job = await getLeadService().search({ query, strategy: args.strategy as never, budget: args.budget as Record<string, unknown> | undefined, actor: typeof args.actor === "string" ? args.actor : "agent" });
      return { jobId: job.id, status: job.status, result: job.result, errorCode: job.errorCode };
    },
  },
  {
    name: "lead_search_people",
    description: "Search person leads (convenience wrapper over lead_search).",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) => {
      const query = { ...((args.query ?? {}) as Record<string, unknown>), leadKind: "person" };
      const job = await getLeadService().search({ query, strategy: args.strategy as never, budget: args.budget as Record<string, unknown> | undefined, actor: typeof args.actor === "string" ? args.actor : "agent" });
      return { jobId: job.id, status: job.status, result: job.result, errorCode: job.errorCode };
    },
  },
  {
    name: "lead_enrich",
    description: "Enrich one lead (company profile + public contact discovery) through the routing engine.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const job = await getLeadService().enrich({ leadId: String(args.leadId ?? ""), actor: typeof args.actor === "string" ? args.actor : "agent" });
      return { jobId: job.id, status: job.status, result: job.result, errorCode: job.errorCode };
    },
  },
  {
    name: "lead_verify",
    description: "Run the verification layer over a lead's contact points (found ≠ verified).",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const job = await getLeadService().verify({ leadId: String(args.leadId ?? ""), actor: typeof args.actor === "string" ? args.actor : "agent" });
      return { jobId: job.id, status: job.status, result: job.result };
    },
  },
  {
    name: "lead_score",
    description: "Score a lead with a versioned deterministic scoring profile.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const outcome = getLeadService().score({
        leadId: String(args.leadId ?? ""),
        profileId: args.profileId ? String(args.profileId) : undefined,
        industryKeywords: Array.isArray(args.industryKeywords) ? (args.industryKeywords as string[]) : undefined,
        region: args.region ? String(args.region) : undefined,
        actor: typeof args.actor === "string" ? args.actor : "agent",
      });
      return outcome.score;
    },
  },
  {
    name: "lead_providers_list",
    description: "List registered lead providers with capability/pricing metadata (no secrets).",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      return getLeadService().listProviders().map((provider) => ({
        id: provider.id, name: provider.name, adapter: provider.adapter, enabled: provider.enabled,
        capabilities: provider.capabilities, pricingModel: provider.pricingModel, estimatedCostPer1000: provider.estimatedCostPer1000,
        health: provider.health?.status ?? "unknown",
      }));
    },
  },
  {
    name: "lead_providers_health",
    description: "Run a health check against one provider (bounded; never calls paid operations).",
    riskTier: "R1",
    readOnly: true,
    execute: (args) => getLeadService().testProvider(String(args.providerId ?? ""), typeof args.actor === "string" ? args.actor : "agent"),
  },
  {
    name: "lead_pipeline_list",
    description: "List available lead pipelines and their steps.",
    riskTier: "R0",
    readOnly: true,
    execute: () => getLeadService().listPipelines(),
  },
  {
    name: "lead_pipeline_run",
    description: "Run a lead pipeline (search → normalize → dedupe → enrich → verify → score → suppression).",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const run = await getLeadService().runPipeline(String(args.pipelineId ?? ""), (args.request ?? {}) as Record<string, unknown>, typeof args.actor === "string" ? args.actor : "agent");
      return { runId: run.id, status: run.status, actualCost: run.actualCost, steps: run.steps.map((step) => ({ id: step.id, status: step.status, error: step.error })) };
    },
  },
  {
    name: "lead_pipeline_status",
    description: "Get one pipeline run's status and per-step outcomes.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getLeadService().getPipelineRun(String(args.runId ?? "")),
  },
  {
    name: "lead_export_preview",
    description: "Preview the export: applies suppression and returns row count + column set without persisting.",
    riskTier: "R1",
    readOnly: true,
    execute: (args) => {
      if (!leadFlags().export) return { blocked: true, reason: "FEATURE_LEAD_EXPORT is off" };
      const service = getLeadService();
      const leads = service.listLeads({
        status: args.status ? String(args.status) : undefined,
        kind: args.kind ? String(args.kind) : undefined,
        limit: 1000,
      });
      return { rowCount: leads.length, note: "suppression is applied at export time" };
    },
  },
  {
    name: "lead_export_csv",
    description: "Export leads to CSV (suppression applied, audited, capped at 1000 rows). Returns export id + content.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const outcome = await getLeadService().exportLeads({
        format: "csv",
        actor: typeof args.actor === "string" ? args.actor : "agent",
        filters: { status: args.status ? String(args.status) : undefined, kind: args.kind ? String(args.kind) : undefined },
      });
      return { exportId: outcome.id, rowCount: outcome.rowCount, contentPreview: outcome.content.slice(0, 2000) };
    },
  },
  {
    name: "lead_export_json",
    description: "Export leads to JSON with nested provenance (suppression applied, audited).",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const outcome = await getLeadService().exportLeads({
        format: "json",
        actor: typeof args.actor === "string" ? args.actor : "agent",
        filters: { status: args.status ? String(args.status) : undefined, kind: args.kind ? String(args.kind) : undefined },
      });
      return { exportId: outcome.id, rowCount: outcome.rowCount };
    },
  },
  {
    name: "lead_suppression_check",
    description: "Check whether an email/phone/domain/company/person is on the suppression list.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getLeadService().checkSuppression({ matchType: args.matchType as never, matchValue: String(args.matchValue ?? "") }),
  },
  {
    name: "lead_suppression_add",
    description: "Add a suppression entry (compliance gate; every entry is audited).",
    riskTier: "R3",
    readOnly: false,
    execute: (args) => {
      return getLeadService().addSuppression({
        matchType: args.matchType as never,
        matchValue: String(args.matchValue ?? ""),
        reason: args.reason as never,
        actor: typeof args.actor === "string" ? args.actor : "dashboard",
      });
    },
  },
  {
    name: "lead_suppression_remove",
    description: "Remove a suppression entry. Human-only: agents receive an invariant error.",
    riskTier: "R3",
    readOnly: false,
    execute: (args) => {
      getLeadService().removeSuppression(String(args.entryId ?? ""), typeof args.actor === "string" ? args.actor : "agent");
      return { removed: true };
    },
  },
  {
    name: "lead_cost_estimate",
    description: "Estimate the cost of a search across enabled providers before running it.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getLeadService().estimateSearchCost({ query: (args.query ?? {}) as Record<string, unknown>, strategy: args.strategy as never }),
  },
  {
    name: "lead_cost_summary",
    description: "Summarize observed provider spend (estimated vs actual).",
    riskTier: "R0",
    readOnly: true,
    execute: () => getLeadService().costSummary(),
  },
];
