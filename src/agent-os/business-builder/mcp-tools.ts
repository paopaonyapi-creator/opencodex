// Phase 30.36 — WebMCP tools for the Business Builder (spec §24). Namespace
// business.*; safety tiers follow the repo R0-R4 convention. Mutating
// governance actions (suppression of upstream content over manual edits,
// compliance review) are human-only inside the service.

import { getBusinessBuilderService } from "./service";
import type { WebMcpToolDefinition } from "../video/mcp-tools";

export const BUSINESS_BUILDER_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "business_list_opportunities",
    description: "List business opportunities with optional status/market filters (bounded).",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().listOpportunities({
      status: args.status ? String(args.status) : undefined,
      market: args.market ? String(args.market) : undefined,
      limit: typeof args.limit === "number" ? args.limit : 50,
    }).map((opportunity) => ({
      id: opportunity.id, slug: opportunity.slug, name: opportunity.name, status: opportunity.status,
      opportunityScore: opportunity.opportunityScore, paoFitScore: opportunity.paoFitScore,
      speedToCash: opportunity.speedToCash, difficulty: opportunity.difficulty,
    })),
  },
  {
    name: "business_get_opportunity",
    description: "Fetch one opportunity with full normalized detail and provenance.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().getOpportunity(String(args.opportunityId ?? "")),
  },
  {
    name: "business_score_opportunity",
    description: "Run the weighted scoring engine + Pao Fit for one opportunity (score, confidence, evidence).",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => getBusinessBuilderService().score(String(args.opportunityId ?? ""), typeof args.actor === "string" ? args.actor : "agent"),
  },
  {
    name: "business_compare_opportunities",
    description: "Compare 2–5 opportunities across aligned metrics with a reasoned recommendation.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().compare(Array.isArray(args.opportunityIds) ? (args.opportunityIds as string[]) : []),
  },
  {
    name: "business_import_playbooks",
    description: "Import playbooks from the locally prepared source directory (dry-run supported; untrusted content is data only).",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => getBusinessBuilderService().importPlaybooks({
      dryRun: args.dryRun === true,
      sourceDir: args.sourceDir ? String(args.sourceDir) : undefined,
      actor: typeof args.actor === "string" ? args.actor : "agent",
    }),
  },
  {
    name: "business_get_pao_fit",
    description: "Compute the Pao Fit Score from the live capability registry.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().computePaoFitFor(String(args.opportunityId ?? "")),
  },
  {
    name: "business_check_compliance",
    description: "Run the compliance gate (GREEN/YELLOW/RED/UNKNOWN; never assumes scrapers are safe).",
    riskTier: "R1",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().checkCompliance(String(args.opportunityId ?? "")),
  },
  {
    name: "business_get_cost_estimate",
    description: "Estimate prototype/monthly cost, margin per customer and break-even customers.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getBusinessBuilderService().estimateCostFor(String(args.opportunityId ?? ""), (args.apiMonthly ?? {}) as Record<string, number>),
  },
  {
    name: "business_compile_mvp",
    description: "Compile the reduced MVP spec artifacts (blocked unless the compliance gate permits).",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const spec = getBusinessBuilderService().compileMvp(String(args.opportunityId ?? ""), typeof args.actor === "string" ? args.actor : "agent");
      return { id: spec.id, slug: spec.slug, blocked: spec.blocked, blockReasons: spec.blockReasons, warnings: spec.warnings, outputDir: spec.outputDir, artifacts: Object.keys(spec.artifacts) };
    },
  },
  {
    name: "business_generate_codex_pack",
    description: "Generate the Codex implementation pack (spec §34/§35 file set) — blocked while the compliance gate blocks.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const pack = getBusinessBuilderService().generateCodexPack(String(args.opportunityId ?? ""), typeof args.actor === "string" ? args.actor : "agent");
      return { slug: pack.slug, outputDir: pack.outputDir, files: Object.keys(pack.artifacts) };
    },
  },
  {
    name: "business_create_experiment",
    description: "Open a revenue experiment for an opportunity (hypothesis/offer/price/channel).",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const experiment = getBusinessBuilderService().createExperiment({
        opportunityId: String(args.opportunityId ?? ""),
        hypothesis: String(args.hypothesis ?? ""),
        customerSegment: String(args.customerSegment ?? ""),
        offer: String(args.offer ?? ""),
        price: Number(args.price ?? 0),
        currency: args.currency ? String(args.currency) : undefined,
        acquisitionChannel: args.acquisitionChannel ? String(args.acquisitionChannel) : undefined,
        landingPageUrl: args.landingPageUrl ? String(args.landingPageUrl) : undefined,
        actor: typeof args.actor === "string" ? args.actor : "agent",
      });
      return { id: experiment.id, status: experiment.status };
    },
  },
  {
    name: "business_update_experiment_metrics",
    description: "Update experiment funnel metrics (leads/replies/trials/paid/revenue/cost) and derived conversions.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const experiment = getBusinessBuilderService().updateMetrics(String(args.experimentId ?? ""), (args.metrics ?? {}) as Record<string, number>, typeof args.actor === "string" ? args.actor : "agent");
      return { id: experiment.id, metrics: experiment.metrics, conversion: experiment.conversion };
    },
  },
  {
    name: "business_evaluate_experiment",
    description: "Evaluate an experiment: KEEP / ITERATE / PIVOT / KILL with reasons and evidence.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const experiment = getBusinessBuilderService().evaluateExperiment(String(args.experimentId ?? ""), typeof args.actor === "string" ? args.actor : "agent");
      return { id: experiment.id, decision: experiment.decision, reasons: experiment.decisionReasons };
    },
  },
  {
    name: "business_list_capabilities",
    description: "List the derived Pao-hubPro capability registry (status derived from live module state).",
    riskTier: "R0",
    readOnly: true,
    execute: () => getBusinessBuilderService().listCapabilities(),
  },
];
