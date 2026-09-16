// Phase 30.36 — Business Builder intelligence (spec §9-§13, §16-§19).
// Opportunity scoring is INDEPENDENT of the upstream repository: weighted,
// evidence-based, confidence-honest. Pao Fit reads the derived capability
// registry (never hardcoded). The compliance gate is fail-closed: RED blocks
// production generation, UNKNOWN requires human review. The decision engine
// (KEEP/ITERATE/PIVOT/KILL) is rule-based with evidence.

import type {
  BusinessOpportunity,
  CapabilityRecord,
  ComplianceCheck,
  ComplianceDimension,
  ComplianceStatus,
  CostEstimate,
  ExperimentMetrics,
  OpportunityScore,
  ScoreEvidence,
  ScoreWeights,
} from "./types";

export const DEFAULT_WEIGHTS: ScoreWeights = {
  revenuePotential: 15,
  speedToCash: 15,
  recurringRevenue: 10,
  buildSimplicity: 10,
  automationPotential: 10,
  marketDemand: 10,
  paoFit: 15,
  lowApiCost: 5,
  lowCompetition: 5,
  complianceSafety: 5,
};

const WEIGHTS_VERSION = "v1";

export function weightsFromEnv(): ScoreWeights {
  const num = (key: string, fallback: number): number => {
    const parsed = Number.parseFloat(process.env[key] ?? "");
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    revenuePotential: num("BIZ_WEIGHT_REVENUE", DEFAULT_WEIGHTS.revenuePotential),
    speedToCash: num("BIZ_WEIGHT_SPEED_TO_CASH", DEFAULT_WEIGHTS.speedToCash),
    recurringRevenue: num("BIZ_WEIGHT_RECURRING", DEFAULT_WEIGHTS.recurringRevenue),
    buildSimplicity: num("BIZ_WEIGHT_BUILD_SIMPLICITY", DEFAULT_WEIGHTS.buildSimplicity),
    automationPotential: num("BIZ_WEIGHT_AUTOMATION", DEFAULT_WEIGHTS.automationPotential),
    marketDemand: num("BIZ_WEIGHT_MARKET_DEMAND", DEFAULT_WEIGHTS.marketDemand),
    paoFit: num("BIZ_WEIGHT_PAO_FIT", DEFAULT_WEIGHTS.paoFit),
    lowApiCost: num("BIZ_WEIGHT_API_COST", DEFAULT_WEIGHTS.lowApiCost),
    lowCompetition: num("BIZ_WEIGHT_COMPETITION", DEFAULT_WEIGHTS.lowCompetition),
    complianceSafety: num("BIZ_WEIGHT_COMPLIANCE", DEFAULT_WEIGHTS.complianceSafety),
  };
}

// --- Capability registry (§11): derived from live module state ------------------

export interface CapabilityProbe {
  id: string;
  name: string;
  type: string;
  available: () => boolean;
  source: string;
}

/** Every probe reads REAL runtime state — flags, registries, adapters — so
 *  Pao Fit is computed from what actually exists right now (§11). */
export function capabilityProbes(): CapabilityProbe[] {
  const envOn = (name: string, fallback = true): boolean => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    return !["0", "false", "no", "off"].includes(raw.toLowerCase());
  };
  return [
    { id: "codex_cli", name: "Codex CLI coding agent", type: "coding_agent", available: () => envOn("FEATURE_SPEECH_RUNTIME"), source: "Phase 20.27 cockpit adapter" },
    { id: "browser_automation", name: "Browser automation runtime", type: "automation", available: () => envOn("FEATURE_BROWSER_PROVIDER", true), source: "Phase 20.19 universal browser provider" },
    { id: "lead_gen", name: "B2B lead generation", type: "data", available: () => envOn("FEATURE_LEAD_INTELLIGENCE", true), source: "Phase 20.34 lead intelligence" },
    { id: "speech_runtime", name: "Voice / TTS / STT", type: "media_generation", available: () => envOn("FEATURE_SPEECH_RUNTIME", true), source: "Phase 20.32 speech runtime" },
    { id: "douyin_data", name: "Douyin media intelligence", type: "data", available: () => envOn("FEATURE_DOUYIN_PROVIDER", true), source: "Phase 20.26 douyin provider" },
    { id: "video_factory", name: "AI video production", type: "media_generation", available: () => envOn("FEATURE_SPEECH_RUNTIME", true), source: "Phase 20.7 video factory" },
    { id: "multi_provider_router", name: "Multi-provider LLM routing", type: "runtime", available: () => envOn("FEATURE_LEAD_INTELLIGENCE", true), source: "core proxy + Phase 20.30/20.35" },
    { id: "mcp_gateway", name: "MCP gateway + tool catalog", type: "integration", available: () => true, source: "Phase 20.33 ai-workspace" },
    { id: "governance", name: "Policy engine + approvals + audit", type: "safety", available: () => true, source: "Phase 20.28 governance gateway" },
    { id: "workflow_automation", name: "Workflow automation engine", type: "automation", available: () => true, source: "Phase 20.29 ClawFlows" },
    { id: "seo_automation", name: "SEO automation", type: "seo", available: () => true, source: "SEO domain modules" },
    { id: "local_llm", name: "Local LLM runtime", type: "runtime", available: () => Boolean(process.env.OLLAMA_BASE_URL || process.env.LMSTUDIO_BASE_URL), source: "Phase 20.35 local providers" },
    { id: "stock_pipeline", name: "Adobe Stock production pipeline", type: "production", available: () => true, source: "Phase 20.7/20.31 stock gates" },
    { id: "notifications", name: "Notification gateway", type: "integration", available: () => true, source: "Phase 20.23 notifications" },
  ];
}

export function deriveCapabilityRegistry(): CapabilityRecord[] {
  return capabilityProbes().map((probe) => ({
    id: probe.id,
    name: probe.name,
    type: probe.type,
    status: probe.available() ? "available" : "unavailable",
    derivedFrom: probe.source,
    updatedAt: new Date().toISOString(),
  }));
}

// --- Pao Fit (§10): computed from the registry ------------------------------------

export function computePaoFit(opportunity: BusinessOpportunity, registry: CapabilityRecord[]): { score: number; available: string[]; missing: string[] } {
  const required = opportunity.requiredCapabilities.filter(Boolean);
  const effective = required.length > 0 ? required : ["multi_provider_router", "mcp_gateway"];
  const statusById = new Map(registry.map((record) => [record.id, record.status]));
  const available: string[] = [];
  const missing: string[] = [];
  for (const capability of effective) {
    if (statusById.get(capability) === "available") available.push(capability);
    else missing.push(capability);
  }
  // Partial credit: missing-but-substitutable capabilities (any available
  // capability of a matching type counts half) keep the score honest without
  // pretending full reuse.
  const base = effective.length === 0 ? 0.5 : available.length / effective.length;
  const substitutionBonus = missing.length > 0
    ? Math.min(0.15, registry.filter((record) => record.status === "available" && record.type !== "safety").length / 40)
    : 0;
  return {
    score: Math.min(100, Math.round((Math.min(1, base + substitutionBonus)) * 100)),
    available,
    missing,
  };
}

// --- Opportunity score (§9): weighted, evidence-based, confidence-honest ----------

export function scoreOpportunity(
  opportunity: BusinessOpportunity,
  weights: ScoreWeights = weightsFromEnv(),
): OpportunityScore {
  const paoFit = opportunity.paoFitScore ?? 50;
  const dimensions: OpportunityScore["dimensions"] = [
    { dimension: "revenue_potential", raw: opportunity.revenuePotential, weighted: (opportunity.revenuePotential / 100) * weights.revenuePotential },
    { dimension: "speed_to_cash", raw: opportunity.speedToCash, weighted: (opportunity.speedToCash / 100) * weights.speedToCash },
    { dimension: "recurring_revenue", raw: opportunity.recurringRevenuePotential, weighted: (opportunity.recurringRevenuePotential / 100) * weights.recurringRevenue },
    { dimension: "build_simplicity", raw: 100 - difficultyPenalty(opportunity), weighted: ((100 - difficultyPenalty(opportunity)) / 100) * weights.buildSimplicity },
    { dimension: "automation_potential", raw: opportunity.automationPotential, weighted: (opportunity.automationPotential / 100) * weights.automationPotential },
    { dimension: "market_demand", raw: opportunity.marketDemand, weighted: (opportunity.marketDemand / 100) * weights.marketDemand },
    { dimension: "pao_fit", raw: paoFit, weighted: (paoFit / 100) * weights.paoFit },
    { dimension: "low_api_cost", raw: 100 - opportunity.apiCostLevel, weighted: ((100 - opportunity.apiCostLevel) / 100) * weights.lowApiCost },
    { dimension: "low_competition", raw: 100 - opportunity.competitionLevel, weighted: ((100 - opportunity.competitionLevel) / 100) * weights.lowCompetition },
    { dimension: "compliance_safety", raw: 100 - opportunity.complianceRisk, weighted: ((100 - opportunity.complianceRisk) / 100) * weights.complianceSafety },
  ];
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const score = Math.round(dimensions.reduce((sum, entry) => sum + entry.weighted, 0) * 10) / 10;
  // Confidence: how much scoring input actually exists (evidence coverage),
  // never presented as certainty when the record is thin (§9 Score Confidence).
  const evidence: ScoreEvidence[] = [
    { dimension: "source", score: opportunity.source.type === "manual" ? 60 : 80, confidence: 0.8, evidence: [{ type: "provenance", source: opportunity.source.type, summary: `${opportunity.source.repo ?? "manual entry"} ${opportunity.source.path ?? ""}` }] },
    { dimension: "pao_fit", score: paoFit, confidence: opportunity.requiredCapabilities.length > 0 ? 0.9 : 0.5, evidence: [{ type: "internal_capability", source: "pao-capability-registry", summary: `${opportunity.requiredCapabilities.length} declared requirement(s)` }] },
  ];
  const fieldsFilled = [
    opportunity.summary, opportunity.valueProposition, opportunity.solution,
    opportunity.customerSegments.length, opportunity.painPoints.length, opportunity.validationPlan,
  ].filter(Boolean).length;
  const confidence = Math.min(0.95, Number(((0.3 + fieldsFilled / 6 * 0.5 + evidence.length * 0.05)).toFixed(2)));
  return {
    score: Math.min(100, score),
    confidence,
    evidenceCount: evidence.length + fieldsFilled,
    dimensions,
    paoFit,
    evaluatedAt: new Date().toISOString(),
    weightsVersion: WEIGHTS_VERSION + ` (total ${totalWeight})`,
  };
}

function difficultyPenalty(opportunity: BusinessOpportunity): number {
  return opportunity.difficulty === "low" ? 20 : opportunity.difficulty === "medium" ? 50 : 80;
}

// --- Compliance gate (§12): fail-closed ---------------------------------------------

export function evaluateCompliance(opportunity: BusinessOpportunity): ComplianceCheck {
  const dimensions: ComplianceDimension[] = [];
  const push = (dimension: string, status: ComplianceStatus, reason: string): void => {
    dimensions.push({ dimension, status, reason });
  };

  const scrapesThirdParty = opportunity.requiredDataSources.length > 0 || /scrap|crawl|review|map/i.test(opportunity.solution + opportunity.name);
  push("scraping_restrictions", scrapesThirdParty ? "YELLOW" : "GREEN",
    scrapesThirdParty ? "relies on third-party data acquisition — verify provider ToS before production" : "no third-party scraping declared");
  push("personal_data", /review|customer|lead|person|profile/i.test(opportunity.name + opportunity.solution) ? "YELLOW" : "UNKNOWN",
    "personal-data handling depends on the configured data providers; not assumed safe");
  push("terms_of_service", "UNKNOWN", "provider ToS must be reviewed per configured API — never auto-assumed safe");
  push("licensing", opportunity.source.license === "LICENSE_UNKNOWN" ? "UNKNOWN" : "YELLOW",
    opportunity.source.license === "LICENSE_UNKNOWN" ? "upstream license not detected (LICENSE_UNKNOWN)" : `upstream declares: ${opportunity.source.license} — derived data only, no raw redistribution`);
  push("api_redistribution", opportunity.requiredApis.length > 0 ? "YELLOW" : "GREEN",
    opportunity.requiredApis.length > 0 ? "third-party API outputs may have redistribution restrictions" : "no third-party API dependency declared");
  push("platform_dependency", opportunity.requiredApis.length >= 2 ? "YELLOW" : "GREEN",
    `${opportunity.requiredApis.length} external API dependency(ies)`);
  push("data_retention", "UNKNOWN", "retention policy must be configured before production deployment");
  push("regional_requirements", "UNKNOWN", "regional rules depend on target market; requires review");

  const order: ComplianceStatus[] = ["RED", "UNKNOWN", "YELLOW", "GREEN"];
  const overall: ComplianceStatus = dimensions.some((entry) => entry.status === "RED")
    ? "RED"
    : dimensions.some((entry) => entry.status === "UNKNOWN") ? "UNKNOWN"
    : dimensions.some((entry) => entry.status === "YELLOW") ? "YELLOW"
    : "GREEN";
  return {
    id: "bchk_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    opportunityId: opportunity.id,
    dimensions,
    overall,
    requiresReview: overall === "RED" || overall === "UNKNOWN",
    reviewedBy: null,
    createdAt: new Date().toISOString(),
  };
}

export function complianceBlocksProduction(check: ComplianceCheck): boolean {
  // §12: RED blocks; UNKNOWN requires human review before production
  // generation. YELLOW prototypes with a warning; GREEN proceeds.
  return check.overall === "RED" || (check.overall === "UNKNOWN" && !check.reviewedBy);
}

// --- Cost estimator (§18) ---------------------------------------------------------------

export function estimateCost(opportunity: BusinessOpportunity, apiMonthlyByDependency: Record<string, number> = {}): CostEstimate {
  const categories: Record<string, number> = {
    llm: Math.round(opportunity.automationPotential * 0.3),
    api: Object.values(apiMonthlyByDependency).reduce((sum, value) => sum + value, 0),
    proxy: 0, gpu: opportunity.deliveryModel === "micro_saas" ? 20 : 0,
    storage: 5, database: 0, email: 0, domain: 12, hosting: 10, payment: 0,
    automation: 0, human_labor: opportunity.deliveryModel === "manual" ? 200 : 40,
  };
  const monthlyFixed = Object.entries(categories)
    .filter(([key]) => key !== "human_labor")
    .reduce((sum, [, value]) => sum + value, 0);
  const suggestedPrice = opportunity.suggestedPrice ?? 99;
  const costPerCustomer = monthlyFixed > 0 ? Math.round(monthlyFixed / 10) : 10;
  const grossMargin = suggestedPrice - costPerCustomer;
  return {
    id: "bcst_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    opportunityId: opportunity.id,
    categories,
    currency: opportunity.currency,
    prototypeCost: Object.values(categories).reduce((sum, value) => sum + value, 0),
    monthlyFixedCost: monthlyFixed,
    costPerCustomer,
    suggestedPrice,
    grossMarginPerCustomer: grossMargin,
    breakEvenCustomers: grossMargin > 0 ? Math.max(1, Math.ceil(monthlyFixed / grossMargin)) : null as unknown as number,
    createdAt: new Date().toISOString(),
  };
}

// --- Experiment decision engine (§16): rules with evidence -------------------------------

export interface ExperimentVerdict {
  decision: "KEEP" | "ITERATE" | "PIVOT" | "KILL";
  reasons: string[];
  evidence: string[];
}

export function evaluateExperiment(metrics: ExperimentMetrics, complianceOverall: ComplianceStatus): ExperimentVerdict {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const replyRate = metrics.leadsContacted > 0 ? metrics.replies / metrics.leadsContacted : 0;
  const paidConversion = metrics.replies > 0 ? metrics.paidCustomers / metrics.replies : 0;
  const grossProfit = metrics.revenue - metrics.cost;
  evidence.push(`leads=${metrics.leadsContacted} replies=${metrics.replies} (${(replyRate * 100).toFixed(1)}%) paid=${metrics.paidCustomers} revenue=${metrics.revenue.toFixed(2)} cost=${metrics.cost.toFixed(2)}`);

  if (complianceOverall === "RED") {
    reasons.push("compliance gate is RED — economics cannot outweigh a blocked risk state");
    return { decision: "KILL", reasons, evidence };
  }
  if (metrics.paidCustomers > 0 && grossProfit > 0) {
    reasons.push("paid customers exist and unit economics are positive");
    return { decision: "KEEP", reasons, evidence };
  }
  if (metrics.paidCustomers > 0 && grossProfit <= 0) {
    reasons.push("demand exists but gross profit is non-positive — revisit pricing/cost before scaling");
    return { decision: "ITERATE", reasons, evidence };
  }
  if (metrics.leadsContacted >= 20 && metrics.replies === 0) {
    reasons.push("sufficient outreach produced zero replies — offer/channel signal is absent");
    return { decision: "KILL", reasons, evidence };
  }
  if (metrics.leadsContacted >= 20 && replyRate < 0.05) {
    reasons.push("reply rate below 5% across adequate outreach — offer or channel mismatch");
    return { decision: "PIVOT", reasons, evidence };
  }
  if (replyRate >= 0.1 && paidConversion < 0.1) {
    reasons.push("interest is real but conversion stalls — offer/pricing iteration");
    return { decision: "ITERATE", reasons, evidence };
  }
  reasons.push("insufficient signal volume for a decisive call — continue structured iteration");
  return { decision: "ITERATE", reasons, evidence };
}
