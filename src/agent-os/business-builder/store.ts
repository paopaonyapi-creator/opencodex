// Phase 30.36 — Business Builder persistence over the shared agent-os SQLite
// store. Static single-line SQL with bound parameters; check-then-insert;
// version history protects manual edits from silent overwrite (spec §6, §8).

import { openAgentOsDb } from "../db";
import type {
  BusinessOpportunity,
  CapabilityRecord,
  ComplianceCheck,
  CostEstimate,
  ExperimentMetrics,
  MvpSpec,
  RevenueExperiment,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class BusinessStore {
  // --- opportunities -----------------------------------------------------------

  insertOpportunity(opportunity: BusinessOpportunity): void {
    openAgentOsDb()
      .query("INSERT INTO biz_opportunities (id, slug, name, status, edited_manually, payload_json, provenance_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(opportunity.id, opportunity.slug, opportunity.name, opportunity.status, opportunity.editedManually ? 1 : 0, JSON.stringify(opportunity), JSON.stringify(opportunity.source), opportunity.createdAt, opportunity.updatedAt);
  }

  updateOpportunityPayload(opportunity: BusinessOpportunity): void {
    openAgentOsDb()
      .query("UPDATE biz_opportunities SET name = ?, status = ?, edited_manually = ?, payload_json = ?, updated_at = ? WHERE id = ?")
      .run(opportunity.name, opportunity.status, opportunity.editedManually ? 1 : 0, JSON.stringify(opportunity), nowIso(), opportunity.id);
  }

  getOpportunity(id: string): BusinessOpportunity | null {
    const row = openAgentOsDb().query("SELECT * FROM biz_opportunities WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? JSON.parse(String(row.payload_json)) as BusinessOpportunity : null;
  }

  getOpportunityBySlug(slug: string): BusinessOpportunity | null {
    const row = openAgentOsDb().query("SELECT * FROM biz_opportunities WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(slug) as Record<string, unknown> | null;
    return row ? JSON.parse(String(row.payload_json)) as BusinessOpportunity : null;
  }

  listOpportunities(filters: { status?: string; market?: string; limit?: number } = {}): BusinessOpportunity[] {
    const db = openAgentOsDb();
    const limit = Math.min(filters.limit ?? 100, 500);
    let rows: Array<Record<string, unknown>>;
    if (filters.status && filters.market) {
      rows = db.query("SELECT payload_json FROM biz_opportunities WHERE status = ? AND market = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(filters.status, filters.market, limit) as Array<Record<string, unknown>>;
    } else if (filters.status) {
      rows = db.query("SELECT payload_json FROM biz_opportunities WHERE status = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(filters.status, limit) as Array<Record<string, unknown>>;
    } else {
      rows = db.query("SELECT payload_json FROM biz_opportunities ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    return rows.map((row) => JSON.parse(String(row.payload_json)) as BusinessOpportunity);
  }

  countOpportunities(): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM biz_opportunities").get() as { n: number };
    return Number(row.n);
  }

  archiveOpportunity(id: string): void {
    openAgentOsDb().query("UPDATE biz_opportunities SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  /** Version history (§8): a snapshot per meaningful change. */
  insertOpportunityVersion(opportunity: BusinessOpportunity, editor: string, reason: string): void {
    openAgentOsDb()
      .query("INSERT INTO biz_opportunity_versions (id, opportunity_id, snapshot_json, edited_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("bver"), opportunity.id, JSON.stringify(opportunity), editor, reason, nowIso());
  }

  listOpportunityVersions(opportunityId: string, limit = 10): Array<{ id: string; editedBy: string; reason: string; createdAt: string }> {
    const rows = openAgentOsDb().query("SELECT * FROM biz_opportunity_versions WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(opportunityId, Math.min(limit, 50)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), editedBy: String(row.edited_by), reason: String(row.reason), createdAt: String(row.created_at) }));
  }

  // --- sources / imports -----------------------------------------------------------

  upsertSource(source: { repo: string; license: string; commit: string | null; url: string | null }): string {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM biz_sources WHERE repo = ?").get(source.repo) as { id: string } | null;
    if (existing) {
      db.query("UPDATE biz_sources SET license = ?, source_commit = ?, url = ?, last_import_at = ? WHERE id = ?")
        .run(source.license, source.commit, source.url, nowIso(), existing.id);
      return existing.id;
    }
    const id = newId("bsrc");
    db.query("INSERT INTO biz_sources (id, repo, url, license, source_commit, last_import_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, source.repo, source.url, source.license, source.commit, nowIso(), nowIso());
    return id;
  }

  insertImportRecord(entry: { sourceId: string; dryRun: boolean; filesSeen: number; created: number; updated: number; skippedDuplicates: number; conflicts: number }): string {
    const id = newId("bimp");
    openAgentOsDb()
      .query("INSERT INTO biz_source_imports (id, source_id, dry_run, files_seen, opportunities_created, opportunities_updated, skipped_duplicates, conflicts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, entry.sourceId, entry.dryRun ? 1 : 0, entry.filesSeen, entry.created, entry.updated, entry.skippedDuplicates, entry.conflicts, nowIso());
    return id;
  }

  listImportHistory(limit = 20): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM biz_source_imports ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 100)) as Array<Record<string, unknown>>;
  }

  // --- capability registry -----------------------------------------------------------

  replaceCapabilityRegistry(records: CapabilityRecord[]): void {
    const db = openAgentOsDb();
    db.query("DELETE FROM biz_capability_registry").run();
    for (const record of records) {
      db.query("INSERT INTO biz_capability_registry (id, name, type, status, derived_from, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(record.id, record.name, record.type, record.status, record.derivedFrom, record.updatedAt);
    }
  }

  listCapabilities(): CapabilityRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM biz_capability_registry ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), type: String(row.type),
      status: String(row.status) as CapabilityRecord["status"],
      derivedFrom: String(row.derived_from), updatedAt: String(row.updated_at),
    }));
  }

  // --- compliance / costs / mvp ---------------------------------------------------------

  insertComplianceCheck(check: ComplianceCheck): void {
    openAgentOsDb()
      .query("INSERT INTO biz_compliance_checks (id, opportunity_id, dimensions_json, overall, requires_review, reviewed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(check.id, check.opportunityId, JSON.stringify(check.dimensions), check.overall, check.requiresReview ? 1 : 0, check.reviewedBy, check.createdAt);
  }

  latestComplianceCheck(opportunityId: string): ComplianceCheck | null {
    const row = openAgentOsDb().query("SELECT * FROM biz_compliance_checks WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(opportunityId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id), opportunityId: String(row.opportunity_id),
      dimensions: JSON.parse(String(row.dimensions_json)) as ComplianceCheck["dimensions"],
      overall: String(row.overall) as ComplianceCheck["overall"],
      requiresReview: Number(row.requires_review ?? 1) === 1,
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
      createdAt: String(row.created_at),
    };
  }

  /** Human review of an UNKNOWN/RED gate (§12): records who accepted the risk. */
  reviewCompliance(opportunityId: string, reviewer: string): boolean {
    const check = this.latestComplianceCheck(opportunityId);
    if (!check) return false;
    openAgentOsDb()
      .query("UPDATE biz_compliance_checks SET reviewed_by = ?, requires_review = 0 WHERE id = ?")
      .run(reviewer, check.id);
    check.reviewedBy = reviewer;
    check.requiresReview = false;
    return true;
  }

  insertCostEstimate(estimate: CostEstimate): void {
    openAgentOsDb()
      .query("INSERT INTO biz_cost_estimates (id, opportunity_id, categories_json, currency, prototype_cost, monthly_fixed_cost, cost_per_customer, suggested_price, gross_margin, break_even_customers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(estimate.id, estimate.opportunityId, JSON.stringify(estimate.categories), estimate.currency, estimate.prototypeCost, estimate.monthlyFixedCost, estimate.costPerCustomer, estimate.suggestedPrice, estimate.grossMarginPerCustomer, estimate.breakEvenCustomers ?? -1, estimate.createdAt);
  }

  latestCostEstimate(opportunityId: string): CostEstimate | null {
    const row = openAgentOsDb().query("SELECT * FROM biz_cost_estimates WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(opportunityId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id), opportunityId: String(row.opportunity_id),
      categories: JSON.parse(String(row.categories_json)) as Record<string, number>,
      currency: String(row.currency), prototypeCost: Number(row.prototype_cost),
      monthlyFixedCost: Number(row.monthly_fixed_cost), costPerCustomer: Number(row.cost_per_customer),
      suggestedPrice: Number(row.suggested_price), grossMarginPerCustomer: Number(row.gross_margin),
      breakEvenCustomers: Number(row.break_even_customers) < 0 ? null : Number(row.break_even_customers),
      createdAt: String(row.created_at),
    };
  }

  insertMvpSpec(spec: MvpSpec): void {
    openAgentOsDb()
      .query("INSERT INTO biz_mvp_specs (id, opportunity_id, slug, output_dir, artifacts_json, blocked, block_reasons_json, warnings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(spec.id, spec.opportunityId, spec.slug, spec.outputDir, JSON.stringify(spec.artifacts), spec.blocked ? 1 : 0, JSON.stringify(spec.blockReasons), JSON.stringify(spec.warnings), spec.createdAt);
  }

  listMvpSpecs(opportunityId: string, limit = 5): MvpSpec[] {
    const rows = openAgentOsDb().query("SELECT * FROM biz_mvp_specs WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(opportunityId, Math.min(limit, 20)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), opportunityId: String(row.opportunity_id), slug: String(row.slug),
      outputDir: String(row.output_dir), artifacts: JSON.parse(String(row.artifacts_json)) as Record<string, string>,
      blocked: Number(row.blocked ?? 0) === 1, blockReasons: JSON.parse(String(row.block_reasons_json ?? "[]")) as string[],
      warnings: JSON.parse(String(row.warnings_json ?? "[]")) as string[], createdAt: String(row.created_at),
    }));
  }

  // --- experiments -----------------------------------------------------------------------

  insertExperiment(experiment: RevenueExperiment): void {
    openAgentOsDb()
      .query("INSERT INTO biz_experiments (id, opportunity_id, hypothesis, customer_segment, offer, price, currency, acquisition_channel, landing_page_url, metrics_json, conversion_json, status, decision, decision_reasons_json, created_at, updated_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(experiment.id, experiment.opportunityId, experiment.hypothesis, experiment.customerSegment, experiment.offer, experiment.price, experiment.currency, experiment.acquisitionChannel, experiment.landingPageUrl, JSON.stringify(experiment.metrics), JSON.stringify(experiment.conversion), experiment.status, experiment.decision, JSON.stringify(experiment.decisionReasons), experiment.createdAt, experiment.updatedAt, experiment.endedAt);
  }

  getExperiment(id: string): RevenueExperiment | null {
    const row = openAgentOsDb().query("SELECT * FROM biz_experiments WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapExperimentRow(row) : null;
  }

  listExperiments(opportunityId?: string, limit = 50): RevenueExperiment[] {
    const db = openAgentOsDb();
    const rows = opportunityId
      ? db.query("SELECT * FROM biz_experiments WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(opportunityId, Math.min(limit, 200)) as Array<Record<string, unknown>>
      : db.query("SELECT * FROM biz_experiments ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map(mapExperimentRow);
  }

  updateExperiment(id: string, patch: { metrics?: ExperimentMetrics; conversion?: RevenueExperiment["conversion"]; status?: RevenueExperiment["status"]; decision?: RevenueExperiment["decision"]; decisionReasons?: string[]; endedAt?: string | null }): RevenueExperiment | null {
    const experiment = this.getExperiment(id);
    if (!experiment) return null;
    const next: RevenueExperiment = {
      ...experiment,
      metrics: patch.metrics ?? experiment.metrics,
      conversion: patch.conversion ?? experiment.conversion,
      status: patch.status ?? experiment.status,
      decision: patch.decision ?? experiment.decision,
      decisionReasons: patch.decisionReasons ?? experiment.decisionReasons,
      endedAt: patch.endedAt !== undefined ? patch.endedAt : experiment.endedAt,
      updatedAt: nowIso(),
    };
    openAgentOsDb()
      .query("UPDATE biz_experiments SET metrics_json = ?, conversion_json = ?, status = ?, decision = ?, decision_reasons_json = ?, updated_at = ?, ended_at = ? WHERE id = ?")
      .run(JSON.stringify(next.metrics), JSON.stringify(next.conversion), next.status, next.decision, JSON.stringify(next.decisionReasons), next.updatedAt, next.endedAt, id);
    return next;
  }

  // --- audit ------------------------------------------------------------------------------

  appendAudit(entry: { actor: string; event: string; entity: string; entityId: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string; metadata?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO biz_audit (ts, actor, event, entity, entity_id, before_json, after_json, reason, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(nowIso(), entry.actor, entry.event, entry.entity, entry.entityId, entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null, entry.reason ?? null, JSON.stringify(entry.metadata ?? {}));
  }

  listAudit(limit = 50): Array<{ ts: string; actor: string; event: string; entity: string; entityId: string; reason: string | null }> {
    const rows = openAgentOsDb().query("SELECT * FROM biz_audit ORDER BY ts DESC, id DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ts: String(row.ts), actor: String(row.actor), event: String(row.event),
      entity: String(row.entity), entityId: String(row.entity_id), reason: row.reason ? String(row.reason) : null,
    }));
  }
}

function mapExperimentRow(row: Record<string, unknown>): RevenueExperiment {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    hypothesis: String(row.hypothesis),
    customerSegment: String(row.customer_segment),
    offer: String(row.offer),
    price: Number(row.price ?? 0),
    currency: String(row.currency ?? "USD"),
    acquisitionChannel: String(row.acquisition_channel ?? ""),
    landingPageUrl: row.landing_page_url ? String(row.landing_page_url) : null,
    metrics: JSON.parse(String(row.metrics_json ?? "{}")) as ExperimentMetrics,
    conversion: JSON.parse(String(row.conversion_json ?? "{}")) as RevenueExperiment["conversion"],
    status: String(row.status) as RevenueExperiment["status"],
    decision: String(row.decision) as RevenueExperiment["decision"],
    decisionReasons: JSON.parse(String(row.decision_reasons_json ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
  };
}

export { newId as newBusinessId };
