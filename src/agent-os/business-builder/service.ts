// Phase 30.36 — BusinessBuilderService: the orchestration core (spec §6-§19).
// Import (dry-run/incremental/duplicate-safe) → registry → score → Pao Fit →
// compliance gate → cost → compare → compile → experiments → decisions, all
// audited via the shared event trail + biz_audit.

import { recordAgentEvent } from "../events";
import { BusinessError } from "./sources";
import { contentHash, normalizePlaybook, parsePlaybookMarkdown, playbookSourceRoot, scanSourceDirectory } from "./sources";
import { computePaoFit, deriveCapabilityRegistry, estimateCost, evaluateCompliance, evaluateExperiment, scoreOpportunity } from "./policy";
import { buildMvpFeatures, compileMvp } from "./compiler";
import { BusinessStore } from "./store";
import type {
  BusinessOpportunity,
  ComplianceCheck,
  CostEstimate,
  ExperimentMetrics,
  MvpSpec,
  OpportunityScore,
  RevenueExperiment,
} from "./types";

const HUMAN_ACTOR = /^(operator|dashboard|user|human|owner)/i;

export class BusinessBuilderService {
  private store = new BusinessStore();

  // --- import (§7.1, §6) --------------------------------------------------------

  importPlaybooks(input: { dryRun?: boolean; sourceDir?: string; actor?: string }): {
    sourceId: string; license: string; dryRun: boolean; filesSeen: number;
    created: number; updated: number; skippedDuplicates: number; conflicts: Array<{ slug: string; reason: string }>;
    importRecordId: string;
  } {
    const actor = input.actor ?? "dashboard";
    const scan = scanSourceDirectory(input.sourceDir ?? playbookSourceRoot());
    const sourceId = this.store.upsertSource({
      repo: process.env.BUSINESS_PLAYBOOKS_REPO || "https://github.com/cporter202/software-income-playbooks",
      license: scan.license,
      commit: scan.commit,
      url: process.env.BUSINESS_PLAYBOOKS_REPO || null,
    });

    let created = 0;
    let updated = 0;
    let skippedDuplicates = 0;
    const conflicts: Array<{ slug: string; reason: string }> = [];

    for (const file of scan.files) {
      const warnings: string[] = [];
      const parsed = parsePlaybookMarkdown(file.markdown, warnings);
      if (!parsed.fields.name) continue; // not a playbook document
      const draft = normalizePlaybook(
        parsed,
        {
          type: "software_income_playbooks",
          repo: process.env.BUSINESS_PLAYBOOKS_REPO || "https://github.com/cporter202/software-income-playbooks",
          url: `file://${file.path}`,
          path: file.path,
          commit: scan.commit ?? undefined,
          license: scan.license,
        },
        file.hash,
      );

      const existingBySlug = this.store.getOpportunityBySlug(draft.slug);
      const existingByHash = existingBySlug && existingBySlug.source.contentHash === draft.source.contentHash ? existingBySlug : null;
      if (existingByHash) { skippedDuplicates += 1; continue; } // identical content — nothing to do
      if (existingBySlug) {
        if (existingBySlug.editedManually) {
          // §6: never silently overwrite manual edits — report the conflict.
          conflicts.push({ slug: draft.slug, reason: "existing record has manual edits; refresh skipped (resolve manually or clear the manual flag)" });
          continue;
        }
        if (!input.dryRun) {
          const next: BusinessOpportunity = { ...draft, id: existingBySlug.id, createdAt: existingBySlug.createdAt, status: existingBySlug.status === "imported" ? "normalized" : existingBySlug.status };
          this.store.insertOpportunityVersion(existingBySlug, actor, "upstream refresh");
          this.store.updateOpportunityPayload(next);
          updated += 1;
        }
        continue;
      }
      if (!input.dryRun) {
        this.store.insertOpportunity(draft);
        this.store.insertOpportunityVersion(draft, actor, "initial import");
        created += 1;
      }
    }

    const importRecordId = this.store.insertImportRecord({
      sourceId, dryRun: input.dryRun === true, filesSeen: scan.files.length,
      created, updated, skippedDuplicates, conflicts: conflicts.length,
    });
    this.store.appendAudit({ actor, event: "SOURCE_IMPORTED", entity: "source", entityId: sourceId, reason: input.dryRun ? "dry-run" : "import", metadata: { files: scan.files.length, created, updated, skippedDuplicates, license: scan.license } });
    recordAgentEvent({ kind: "business.source.imported", payload: { dryRun: input.dryRun === true, created, updated, skippedDuplicates } });
    return { sourceId, license: scan.license, dryRun: input.dryRun === true, filesSeen: scan.files.length, created, updated, skippedDuplicates, conflicts, importRecordId };
  }

  // --- registry -----------------------------------------------------------------

  listOpportunities(filters: { status?: string; market?: string; limit?: number }) {
    return this.store.listOpportunities(filters);
  }

  listOpportunityVersions(opportunityId: string, limit = 10) {
    return this.store.listOpportunityVersions(opportunityId, limit);
  }

  listImportHistory(limit = 20) {
    return this.store.listImportHistory(limit);
  }

  getOpportunity(id: string) {
    return this.store.getOpportunity(id);
  }

  /** Manual create/update. Manual edits are flagged so upstream refreshes
   *  never overwrite them silently (spec §6). */
  upsertManual(input: {
    id?: string;
    opportunity: Partial<BusinessOpportunity>;
    actor?: string;
    reason?: string;
  }): BusinessOpportunity {
    const actor = input.actor ?? "dashboard";
    const now = new Date().toISOString();
    if (input.id) {
      const existing = this.store.getOpportunity(input.id);
      if (!existing) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${input.id}`);
      const next: BusinessOpportunity = {
        ...existing, ...input.opportunity, id: existing.id, slug: existing.slug,
        source: existing.source, editedManually: true, updatedAt: now,
      };
      this.store.insertOpportunityVersion(existing, actor, input.reason ?? "manual edit");
      this.store.updateOpportunityPayload(next);
      this.store.appendAudit({ actor, event: "OPPORTUNITY_UPDATED", entity: "opportunity", entityId: next.id, reason: input.reason ?? "manual edit" });
      return next;
    }
    const slug = (input.opportunity.name ?? "opportunity").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "opportunity";
    const draft: BusinessOpportunity = {
      id: "bopp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      slug,
      name: input.opportunity.name ?? "Unnamed Opportunity",
      summary: input.opportunity.summary ?? "",
      market: input.opportunity.market ?? "",
      category: input.opportunity.category ?? "",
      customerSegments: input.opportunity.customerSegments ?? [],
      buyerRoles: input.opportunity.buyerRoles ?? [],
      painPoints: input.opportunity.painPoints ?? [],
      valueProposition: input.opportunity.valueProposition ?? "",
      solution: input.opportunity.solution ?? "",
      businessModel: input.opportunity.businessModel ?? "productized_service",
      pricingModel: input.opportunity.pricingModel ?? "one_time",
      suggestedPrice: input.opportunity.suggestedPrice ?? null,
      currency: input.opportunity.currency ?? "USD",
      deliveryModel: input.opportunity.deliveryModel ?? "productized_service",
      requiredApis: input.opportunity.requiredApis ?? [],
      requiredCapabilities: input.opportunity.requiredCapabilities ?? [],
      requiredModels: input.opportunity.requiredModels ?? [],
      requiredDataSources: input.opportunity.requiredDataSources ?? [],
      difficulty: input.opportunity.difficulty ?? "medium",
      estimatedBuildHours: input.opportunity.estimatedBuildHours ?? 40,
      estimatedTimeToMvpDays: input.opportunity.estimatedTimeToMvpDays ?? 7,
      revenuePotential: input.opportunity.revenuePotential ?? 50,
      recurringRevenuePotential: input.opportunity.recurringRevenuePotential ?? 40,
      speedToCash: input.opportunity.speedToCash ?? 50,
      automationPotential: input.opportunity.automationPotential ?? 50,
      marketDemand: input.opportunity.marketDemand ?? 50,
      competitionLevel: input.opportunity.competitionLevel ?? 50,
      complianceRisk: input.opportunity.complianceRisk ?? 40,
      apiCostLevel: input.opportunity.apiCostLevel ?? 40,
      paoFitScore: null, opportunityScore: null, scoreConfidence: null, scoreEvidence: [],
      gtmChannels: input.opportunity.gtmChannels ?? [],
      salesMotion: input.opportunity.salesMotion ?? "",
      validationPlan: input.opportunity.validationPlan ?? "",
      source: { type: "manual", importedAt: now, contentHash: contentHash(JSON.stringify(input.opportunity)), license: "N/A" },
      editedManually: true,
      status: "normalized",
      tags: input.opportunity.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertOpportunity(draft);
    this.store.insertOpportunityVersion(draft, actor, "manual create");
    this.store.appendAudit({ actor, event: "OPPORTUNITY_CREATED", entity: "opportunity", entityId: draft.id });
    return draft;
  }

  archive(id: string, actor: string): void {
    this.store.archiveOpportunity(id);
    this.store.appendAudit({ actor, event: "OPPORTUNITY_ARCHIVED", entity: "opportunity", entityId: id });
  }

  // --- capability registry + pao fit (§10-§11) -----------------------------------

  refreshCapabilities(): ReturnType<BusinessStore["listCapabilities"]> {
    const records = deriveCapabilityRegistry();
    this.store.replaceCapabilityRegistry(records);
    this.store.appendAudit({ actor: "system", event: "CAPABILITY_REGISTRY_REFRESHED", entity: "capability_registry", entityId: "all", metadata: { available: records.filter((record) => record.status === "available").length, total: records.length } });
    return this.store.listCapabilities();
  }

  listCapabilities(): ReturnType<BusinessStore["listCapabilities"]> {
    if (this.store.listCapabilities().length === 0) return this.refreshCapabilities();
    return this.store.listCapabilities();
  }

  computePaoFitFor(opportunityId: string): { score: number; available: string[]; missing: string[] } {
    const opportunity = this.store.getOpportunity(opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${opportunityId}`);
    const fit = computePaoFit(opportunity, this.listCapabilities());
    opportunity.paoFitScore = fit.score;
    this.store.updateOpportunityPayload(opportunity);
    this.store.appendAudit({ actor: "system", event: "PAO_FIT_CALCULATED", entity: "opportunity", entityId: opportunityId, metadata: { score: fit.score, missing: fit.missing } });
    return fit;
  }

  // --- scoring (§9) ------------------------------------------------------------------

  score(opportunityId: string, actor?: string): OpportunityScore {
    const opportunity = this.store.getOpportunity(opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${opportunityId}`);
    const fit = computePaoFit(opportunity, this.listCapabilities());
    opportunity.paoFitScore = fit.score;
    const score = scoreOpportunity(opportunity);
    opportunity.opportunityScore = score.score;
    opportunity.scoreConfidence = score.confidence;
    opportunity.scoreEvidence = score.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      score: Math.round(dimension.raw),
      confidence: score.confidence,
      evidence: [{ type: "weighted_dimension", source: "business scoring engine " + score.weightsVersion, summary: `raw ${dimension.raw} → weighted ${dimension.weighted.toFixed(2)}` }],
    }));
    opportunity.status = opportunity.status === "imported" || opportunity.status === "normalized" ? "normalized" : opportunity.status;
    this.store.updateOpportunityPayload(opportunity);
    this.store.appendAudit({ actor: actor ?? "system", event: "SCORE_CALCULATED", entity: "opportunity", entityId: opportunityId, metadata: { score: score.score, confidence: score.confidence } });
    recordAgentEvent({ kind: "business.score.calculated", payload: { opportunityId, score: score.score, confidence: score.confidence } });
    return score;
  }

  /** Compare 2–5 opportunities (§23): aligned metric rows + a reasoned pick. */
  compare(ids: string[]): { rows: Record<string, Array<number | string | null>>; recommended: string | null; reasons: string[] } {
    if (ids.length < 2 || ids.length > 5) throw new BusinessError("VALIDATION_ERROR", "compare requires 2–5 opportunities");
    const opportunities = ids.map((id) => {
      const opportunity = this.store.getOpportunity(id);
      if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${id}`);
      return opportunity;
    });
    const rows: Record<string, Array<number | string | null>> = {
      opportunity_score: opportunities.map((entry) => entry.opportunityScore),
      pao_fit: opportunities.map((entry) => entry.paoFitScore),
      speed_to_cash: opportunities.map((entry) => entry.speedToCash),
      recurring_revenue: opportunities.map((entry) => entry.recurringRevenuePotential),
      build_difficulty: opportunities.map((entry) => ({ low: 20, medium: 50, high: 80 }[entry.difficulty])),
      compliance_risk: opportunities.map((entry) => entry.complianceRisk),
      mvp_days: opportunities.map((entry) => entry.estimatedTimeToMvpDays),
    };
    const scored = opportunities.map((entry) => ({
      id: entry.id,
      value: (entry.opportunityScore ?? 0) * 0.5 + (entry.paoFitScore ?? 0) * 0.3 + entry.speedToCash * 0.2,
    })).sort((a, b) => b.value - a.value);
    const recommended = opportunities.length > 0 ? scored[0]!.id : null;
    const winner = opportunities.find((entry) => entry.id === recommended);
    const reasons: string[] = [];
    if (winner) {
      reasons.push(`highest blended value (score/pao-fit/speed weighted 50/30/20)`);
      if ((winner.paoFitScore ?? 0) >= 70) reasons.push("strong reuse of existing Pao-hubPro capabilities");
      if (winner.estimatedTimeToMvpDays <= 7) reasons.push("fast validation window");
      if (winner.complianceRisk <= 50) reasons.push("moderate compliance exposure");
    }
    return { rows, recommended, reasons };
  }

  // --- compliance + cost (§12, §17-§18) -------------------------------------------------

  checkCompliance(opportunityId: string): ComplianceCheck {
    const opportunity = this.store.getOpportunity(opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${opportunityId}`);
    const check = evaluateCompliance(opportunity);
    this.store.insertComplianceCheck(check);
    this.store.appendAudit({ actor: "system", event: "COMPLIANCE_CHECKED", entity: "opportunity", entityId: opportunityId, metadata: { overall: check.overall } });
    return check;
  }

  reviewCompliance(opportunityId: string, actor: string): ComplianceCheck {
    if (!HUMAN_ACTOR.test(actor.trim())) {
      throw new BusinessError("POLICY_BLOCKED", "invariant violation: only human actors may review a compliance gate");
    }
    const reviewed = this.store.reviewCompliance(opportunityId, actor);
    if (!reviewed) throw new BusinessError("NOT_FOUND", `No compliance check recorded for ${opportunityId}`);
    this.store.appendAudit({ actor, event: "COMPLIANCE_REVIEWED", entity: "opportunity", entityId: opportunityId, reason: "human accepted the compliance state" });
    return this.store.latestComplianceCheck(opportunityId)!;
  }

  estimateCostFor(opportunityId: string, apiMonthly?: Record<string, number>): CostEstimate {
    const opportunity = this.store.getOpportunity(opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${opportunityId}`);
    const estimate = estimateCost(opportunity, apiMonthly);
    this.store.insertCostEstimate(estimate);
    this.store.appendAudit({ actor: "system", event: "COST_ESTIMATED", entity: "opportunity", entityId: opportunityId, metadata: { monthlyFixed: estimate.monthlyFixedCost, breakEven: estimate.breakEvenCustomers } });
    return estimate;
  }

  // --- MVP compiler + codex pack (§13-§14, §34-§35) ------------------------------------------

  compileMvp(opportunityId: string, actor?: string): MvpSpec {
    const opportunity = this.store.getOpportunity(opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${opportunityId}`);
    const compliance = this.store.latestComplianceCheck(opportunityId) ?? this.checkCompliance(opportunityId);
    const fit = computePaoFit(opportunity, this.listCapabilities());
    const score = opportunity.opportunityScore !== null
      ? { score: opportunity.opportunityScore, confidence: opportunity.scoreConfidence ?? 0, evidenceCount: opportunity.scoreEvidence.length, dimensions: [], paoFit: fit.score, evaluatedAt: opportunity.updatedAt, weightsVersion: "cached" }
      : null;
    const cost = this.store.latestCostEstimate(opportunityId);
    const spec = compileMvp({
      opportunity, score, compliance, cost, paoFit: fit,
    });
    this.store.insertMvpSpec(spec);
    this.store.appendAudit({
      actor: actor ?? "system", event: spec.blocked ? "MVP_COMPILE_BLOCKED" : "MVP_COMPILED",
      entity: "opportunity", entityId: opportunityId,
      metadata: { blocked: spec.blocked, reasons: spec.blockReasons, artifacts: Object.keys(spec.artifacts).length },
    });
    recordAgentEvent({ kind: spec.blocked ? "business.mvp.blocked" : "business.mvp.compiled", payload: { opportunityId, blocked: spec.blocked, reasons: spec.blockReasons } });
    return spec;
  }

  generateCodexPack(opportunityId: string, actor?: string): MvpSpec {
    const spec = this.compileMvp(opportunityId, actor);
    if (spec.blocked) {
      throw new BusinessError("POLICY_BLOCKED", `Codex pack generation is blocked: ${spec.blockReasons.join("; ")}`);
    }
    this.store.appendAudit({ actor: actor ?? "system", event: "CODEX_PACK_GENERATED", entity: "opportunity", entityId: opportunityId, metadata: { dir: spec.outputDir } });
    return spec;
  }

  listMvpSpecs(opportunityId: string) {
    return this.store.listMvpSpecs(opportunityId);
  }

  // --- revenue experiments (§15-§16) -------------------------------------------------------------

  createExperiment(input: {
    opportunityId: string;
    hypothesis: string;
    customerSegment: string;
    offer: string;
    price: number;
    currency?: string;
    acquisitionChannel?: string;
    landingPageUrl?: string;
    actor?: string;
  }): RevenueExperiment {
    const opportunity = this.store.getOpportunity(input.opportunityId);
    if (!opportunity) throw new BusinessError("NOT_FOUND", `Opportunity not found: ${input.opportunityId}`);
    const now = new Date().toISOString();
    const experiment: RevenueExperiment = {
      id: "bexp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      opportunityId: input.opportunityId,
      hypothesis: input.hypothesis,
      customerSegment: input.customerSegment,
      offer: input.offer,
      price: input.price,
      currency: input.currency ?? opportunity.currency,
      acquisitionChannel: input.acquisitionChannel ?? "",
      landingPageUrl: input.landingPageUrl ?? null,
      metrics: { leadsContacted: 0, replies: 0, qualified: 0, demos: 0, trials: 0, paidCustomers: 0, churned: 0, revenue: 0, cost: 0 },
      conversion: { replyRate: 0, qualifiedRate: 0, demoRate: 0, paidConversion: 0, cac: null },
      status: "running",
      decision: "PENDING",
      decisionReasons: [],
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    this.store.insertExperiment(experiment);
    opportunity.status = "in_experiment";
    this.store.updateOpportunityPayload(opportunity);
    this.store.appendAudit({ actor: input.actor ?? "dashboard", event: "EXPERIMENT_CREATED", entity: "experiment", entityId: experiment.id, metadata: { opportunityId: input.opportunityId } });
    return experiment;
  }

  updateMetrics(experimentId: string, metrics: Partial<ExperimentMetrics>, actor?: string): RevenueExperiment {
    const experiment = this.store.getExperiment(experimentId);
    if (!experiment) throw new BusinessError("NOT_FOUND", `Experiment not found: ${experimentId}`);
    const merged: ExperimentMetrics = { ...experiment.metrics, ...metrics };
    const conversion = {
      replyRate: merged.leadsContacted > 0 ? Number((merged.replies / merged.leadsContacted).toFixed(4)) : 0,
      qualifiedRate: merged.leadsContacted > 0 ? Number((merged.qualified / merged.leadsContacted).toFixed(4)) : 0,
      demoRate: merged.replies > 0 ? Number((merged.demos / merged.replies).toFixed(4)) : 0,
      paidConversion: merged.replies > 0 ? Number((merged.paidCustomers / merged.replies).toFixed(4)) : 0,
      cac: merged.paidCustomers > 0 ? Number((merged.cost / merged.paidCustomers).toFixed(2)) : null,
    };
    const updated = this.store.updateExperiment(experimentId, { metrics: merged, conversion });
    this.store.appendAudit({ actor: actor ?? "dashboard", event: "EXPERIMENT_METRICS_UPDATED", entity: "experiment", entityId: experimentId, metadata: { metrics: merged } });
    return updated!;
  }

  evaluateExperiment(experimentId: string, actor?: string): RevenueExperiment {
    const experiment = this.store.getExperiment(experimentId);
    if (!experiment) throw new BusinessError("NOT_FOUND", `Experiment not found: ${experimentId}`);
    const compliance = this.store.latestComplianceCheck(experiment.opportunityId);
    const verdict = evaluateExperiment(experiment.metrics, compliance?.overall ?? "UNKNOWN");
    const decided = this.store.updateExperiment(experimentId, {
      decision: verdict.decision,
      decisionReasons: [...verdict.reasons, ...verdict.evidence.map((entry) => `evidence: ${entry}`)],
      status: "decided",
      endedAt: new Date().toISOString(),
    });
    this.store.appendAudit({ actor: actor ?? "system", event: "EXPERIMENT_EVALUATED", entity: "experiment", entityId: experimentId, metadata: { decision: verdict.decision, reasons: verdict.reasons } });
    recordAgentEvent({ kind: "business.experiment.evaluated", payload: { experimentId, decision: verdict.decision } });
    return decided!;
  }

  listExperiments(opportunityId?: string) {
    return this.store.listExperiments(opportunityId);
  }

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }
}

let singleton: BusinessBuilderService | null = null;

export function getBusinessBuilderService(): BusinessBuilderService {
  if (!singleton) singleton = new BusinessBuilderService();
  return singleton;
}

export function resetBusinessBuilderForTests(): void {
  singleton = null;
}
