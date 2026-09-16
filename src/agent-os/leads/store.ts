// Phase 20.34 — Lead Intelligence persistence over the shared agent-os SQLite
// store (spec §23 mapped to the repo's single-DB convention; PostgreSQL would
// duplicate infrastructure the repo does not run). All statements are static
// single-line literals with bound parameters; writes are check-then-insert.

import { openAgentOsDb } from "../db";
import type {
  CanonicalLead,
  CompanyProfile,
  ContactPoint,
  FieldEvidence,
  LeadJob,
  PersonProfile,
  PipelineDefinition,
  PipelineRun,
  ProviderDefinition,
  ProviderHealth,
  ScoringProfile,
  SocialProfile,
  SourceRecord,
  SuppressionEntry,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class LeadStore {
  // --- leads -----------------------------------------------------------------

  upsertLead(lead: CanonicalLead): CanonicalLead {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM lead_profiles WHERE id = ?").get(lead.id);
    if (existing) {
      db.query("UPDATE lead_profiles SET kind = ?, status = ?, confidence = ?, canonical_key = ?, company_json = ?, person_json = ?, score_json = ?, updated_at = ? WHERE id = ?")
        .run(lead.kind, lead.status, lead.confidence, this.canonicalKey(lead), JSON.stringify(lead.company ?? null), JSON.stringify(lead.person ?? null), JSON.stringify(lead.score ?? null), nowIso(), lead.id);
    } else {
      db.query("INSERT INTO lead_profiles (id, kind, status, confidence, canonical_key, company_json, person_json, score_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(lead.id, lead.kind, lead.status, lead.confidence, this.canonicalKey(lead), JSON.stringify(lead.company ?? null), JSON.stringify(lead.person ?? null), JSON.stringify(lead.score ?? null), nowIso(), nowIso());
    }
    return lead;
  }

  private canonicalKey(lead: CanonicalLead): string {
    if (lead.company?.domain) return "domain:" + lead.company.domain;
    if (lead.company?.canonicalName) return "company:" + lead.company.canonicalName.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (lead.person?.companyDomain) return "person:" + lead.person.fullName.toLowerCase() + "@" + lead.person.companyDomain;
    if (lead.person?.fullName) return "person:" + lead.person.fullName.toLowerCase();
    return "lead:" + lead.id;
  }

  getLead(id: string): CanonicalLead | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_profiles WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapLeadRow(row) : null;
  }

  findByCanonicalKey(key: string): CanonicalLead | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_profiles WHERE canonical_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(key) as Record<string, unknown> | null;
    return row ? mapLeadRow(row) : null;
  }

  listLeads(filters: { status?: string; kind?: string; limit?: number } = {}): CanonicalLead[] {
    const db = openAgentOsDb();
    const limit = Math.min(filters.limit ?? 100, 500);
    let rows: Array<Record<string, unknown>>;
    if (filters.status && filters.kind) {
      rows = db.query("SELECT * FROM lead_profiles WHERE status = ? AND kind = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(filters.status, filters.kind, limit) as Array<Record<string, unknown>>;
    } else if (filters.status) {
      rows = db.query("SELECT * FROM lead_profiles WHERE status = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(filters.status, limit) as Array<Record<string, unknown>>;
    } else if (filters.kind) {
      rows = db.query("SELECT * FROM lead_profiles WHERE kind = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(filters.kind, limit) as Array<Record<string, unknown>>;
    } else {
      rows = db.query("SELECT * FROM lead_profiles ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    return rows.map(mapLeadRow);
  }

  countLeads(): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM lead_profiles").get() as { n: number };
    return Number(row.n);
  }

  // --- contact points / socials / sources / evidence ----------------------------

  addContactPoint(leadId: string, point: ContactPoint): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM lead_contact_points WHERE lead_id = ? AND type = ? AND normalized_value = ?").get(leadId, point.type, point.normalizedValue);
    if (existing) return;
    db.query("INSERT INTO lead_contact_points (id, lead_id, type, value, normalized_value, source_provider_id, confidence, verification_status, verified_at, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("cp"), leadId, point.type, point.value, point.normalizedValue, point.sourceProviderId, point.confidence, point.verificationStatus, point.verifiedAt ?? null, point.isPrimary ? 1 : 0, nowIso());
  }

  listContactPoints(leadId: string): ContactPoint[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_contact_points WHERE lead_id = ? ORDER BY confidence DESC, rowid ASC").all(leadId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      type: String(row.type) as ContactPoint["type"],
      value: String(row.value),
      normalizedValue: String(row.normalized_value),
      sourceProviderId: String(row.source_provider_id),
      confidence: Number(row.confidence),
      verificationStatus: String(row.verification_status) as ContactPoint["verificationStatus"],
      verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
      isPrimary: Number(row.is_primary ?? 0) === 1,
    }));
  }

  /** Verification update path: swaps a contact point's verification fields
   *  without ever creating a second row for the same normalized value. */
  replaceContactPoint(leadId: string, type: string, normalizedValue: string, updated: ContactPoint): void {
    openAgentOsDb()
      .query("UPDATE lead_contact_points SET verification_status = ?, verified_at = ?, confidence = ? WHERE lead_id = ? AND type = ? AND normalized_value = ?")
      .run(updated.verificationStatus, updated.verifiedAt ?? null, updated.confidence, leadId, type, normalizedValue);
  }

  addSocialProfile(leadId: string, profile: SocialProfile): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM lead_social_profiles WHERE lead_id = ? AND platform = ? AND url = ?").get(leadId, profile.platform, profile.url);
    if (existing) return;
    db.query("INSERT INTO lead_social_profiles (id, lead_id, platform, url, source_provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("sp"), leadId, profile.platform, profile.url, profile.sourceProviderId, nowIso());
  }

  listSocialProfiles(leadId: string): SocialProfile[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_social_profiles WHERE lead_id = ? ORDER BY rowid ASC").all(leadId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ platform: String(row.platform), url: String(row.url), sourceProviderId: String(row.source_provider_id) }));
  }

  addSourceRecord(leadId: string, record: Omit<SourceRecord, "id">): SourceRecord {
    const id = newId("src");
    openAgentOsDb().query("INSERT INTO lead_source_records (id, lead_id, provider_id, provider_run_id, source_url, raw_ref, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, leadId, record.providerId, record.providerRunId ?? null, record.sourceUrl ?? null, record.rawRef ?? null, record.collectedAt);
    return { id, ...record };
  }

  listSourceRecords(leadId: string): SourceRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_source_records WHERE lead_id = ? ORDER BY collected_at ASC, rowid ASC").all(leadId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      providerId: String(row.provider_id),
      providerRunId: row.provider_run_id ? String(row.provider_run_id) : undefined,
      sourceUrl: row.source_url ? String(row.source_url) : undefined,
      rawRef: row.raw_ref ? String(row.raw_ref) : undefined,
      collectedAt: String(row.collected_at),
    }));
  }

  countSourceRecords(leadId: string): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM lead_source_records WHERE lead_id = ?").get(leadId) as { n: number };
    return Number(row.n);
  }

  addFieldEvidence(leadId: string, evidence: Omit<FieldEvidence, "id"> & { leadId: string }): void {
    openAgentOsDb().query("INSERT INTO lead_field_evidence (id, lead_id, field, value_preview, provider_id, confidence, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("ev"), evidence.leadId, evidence.field, evidence.valuePreview.slice(0, 200), evidence.providerId, evidence.confidence, evidence.collectedAt);
  }

  listFieldEvidence(leadId: string): Array<FieldEvidence & { leadId: string }> {
    const rows = openAgentOsDb().query("SELECT * FROM lead_field_evidence WHERE lead_id = ? ORDER BY collected_at DESC, rowid DESC").all(leadId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      leadId: String(row.lead_id),
      field: String(row.field),
      valuePreview: String(row.value_preview),
      providerId: String(row.provider_id),
      confidence: Number(row.confidence),
      collectedAt: String(row.collected_at),
    }));
  }

  // --- provider registry / health / usage ---------------------------------------

  upsertProvider(definition: ProviderDefinition): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM lead_providers WHERE id = ?").get(definition.id);
    if (existing) {
      db.query("UPDATE lead_providers SET name = ?, adapter = ?, enabled = ?, capabilities_json = ?, pricing_model = ?, cost_per_1000 = ?, currency = ?, timeout_ms = ?, max_concurrency = ?, quality_score = ?, reliability_score = ?, requires_approval = ?, secret_ref = ?, config_json = ?, updated_at = ? WHERE id = ?")
        .run(definition.name, definition.adapter, definition.enabled ? 1 : 0, JSON.stringify(definition.capabilities), definition.pricingModel, definition.estimatedCostPer1000, definition.currency, definition.timeoutMs, definition.maxConcurrency, definition.qualityScore, definition.reliabilityScore, definition.requiresApproval ? 1 : 0, definition.secretRef, JSON.stringify(definition.config), nowIso(), definition.id);
      return;
    }
    db.query("INSERT INTO lead_providers (id, name, adapter, enabled, capabilities_json, pricing_model, cost_per_1000, currency, timeout_ms, max_concurrency, quality_score, reliability_score, requires_approval, secret_ref, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(definition.id, definition.name, definition.adapter, definition.enabled ? 1 : 0, JSON.stringify(definition.capabilities), definition.pricingModel, definition.estimatedCostPer1000, definition.currency, definition.timeoutMs, definition.maxConcurrency, definition.qualityScore, definition.reliabilityScore, definition.requiresApproval ? 1 : 0, definition.secretRef, JSON.stringify(definition.config), nowIso(), nowIso());
  }

  getProvider(id: string): ProviderDefinition | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_providers WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapProviderRow(row) : null;
  }

  listProviders(): ProviderDefinition[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_providers ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapProviderRow);
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    openAgentOsDb().query("UPDATE lead_providers SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, nowIso(), id);
  }

  saveProviderHealth(providerId: string, health: ProviderHealth): void {
    openAgentOsDb().query("INSERT INTO lead_provider_health (id, provider_id, checked_at, status, latency_ms, last_message) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("lph"), providerId, nowIso(), health.status, health.latencyMs ?? null, health.message ?? null);
  }

  latestProviderHealth(providerId: string): ProviderHealth | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_provider_health WHERE provider_id = ? ORDER BY checked_at DESC, rowid DESC LIMIT 1").get(providerId) as Record<string, unknown> | null;
    if (!row) return null;
    return { status: String(row.status) as ProviderHealth["status"], latencyMs: row.latency_ms === null || row.latency_ms === undefined ? undefined : Number(row.latency_ms), message: row.last_message ? String(row.last_message) : undefined };
  }

  recordUsage(providerId: string, runId: string, operation: string, units: number, estimatedCost: number, actualCost: number | null, currency: string): void {
    openAgentOsDb().query("INSERT INTO lead_provider_usage (id, provider_id, run_id, operation, units, estimated_cost, actual_cost, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("lu"), providerId, runId, operation, units, estimatedCost, actualCost, currency, nowIso());
  }

  costSummary(): Array<{ providerId: string; estimated: number; actual: number; currency: string; calls: number }> {
    const rows = openAgentOsDb().query("SELECT provider_id, SUM(estimated_cost) AS est, SUM(COALESCE(actual_cost, estimated_cost)) AS act, currency, COUNT(*) AS n FROM lead_provider_usage GROUP BY provider_id, currency ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ providerId: String(row.provider_id), estimated: Number(row.est ?? 0), actual: Number(row.act ?? 0), currency: String(row.currency), calls: Number(row.n) }));
  }

  // --- jobs ----------------------------------------------------------------------

  insertJob(job: LeadJob): void {
    openAgentOsDb().query("INSERT INTO lead_jobs (id, type, status, request_json, strategy, budget_json, selected_providers_json, estimated_cost, actual_cost, currency, result_json, error_code, error_message, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.id, job.type, job.status, JSON.stringify(job.request), job.strategy, JSON.stringify(job.budget), JSON.stringify(job.selectedProviders), job.estimatedCost, job.actualCost, job.currency, job.result ? JSON.stringify(job.result) : null, job.errorCode, job.errorMessage, job.createdAt, job.startedAt, job.completedAt);
  }

  getJob(id: string): LeadJob | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_jobs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapJobRow(row) : null;
  }

  listJobs(limit = 50): LeadJob[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map(mapJobRow);
  }

  saveJob(job: LeadJob): void {
    openAgentOsDb().query("UPDATE lead_jobs SET status = ?, selected_providers_json = ?, estimated_cost = ?, actual_cost = ?, result_json = ?, error_code = ?, error_message = ?, started_at = ?, completed_at = ? WHERE id = ?")
      .run(job.status, JSON.stringify(job.selectedProviders), job.estimatedCost, job.actualCost, job.result ? JSON.stringify(job.result) : null, job.errorCode, job.errorMessage, job.startedAt, job.completedAt, job.id);
  }

  // --- pipelines -------------------------------------------------------------------

  upsertPipeline(pipeline: PipelineDefinition): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM lead_pipelines WHERE id = ?").get(pipeline.id);
    if (existing) {
      db.query("UPDATE lead_pipelines SET name = ?, steps_json = ?, enabled = ?, updated_at = ? WHERE id = ?")
        .run(pipeline.name, JSON.stringify(pipeline.steps), pipeline.enabled ? 1 : 0, nowIso(), pipeline.id);
      return;
    }
    db.query("INSERT INTO lead_pipelines (id, name, steps_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(pipeline.id, pipeline.name, JSON.stringify(pipeline.steps), pipeline.enabled ? 1 : 0, nowIso(), nowIso());
  }

  getPipeline(id: string): PipelineDefinition | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_pipelines WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return { id: String(row.id), name: String(row.name), steps: JSON.parse(String(row.steps_json)) as PipelineDefinition["steps"], enabled: Number(row.enabled ?? 1) === 1 };
  }

  listPipelines(): PipelineDefinition[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_pipelines ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), steps: JSON.parse(String(row.steps_json)) as PipelineDefinition["steps"], enabled: Number(row.enabled ?? 1) === 1 }));
  }

  insertPipelineRun(run: PipelineRun): void {
    openAgentOsDb().query("INSERT INTO lead_pipeline_runs (id, pipeline_id, status, request_json, steps_json, estimated_cost, actual_cost, error_code, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, run.pipelineId, run.status, JSON.stringify(run.request), JSON.stringify(run.steps), run.estimatedCost, run.actualCost, run.errorCode, run.createdAt, run.startedAt, run.completedAt);
  }

  getPipelineRun(id: string): PipelineRun | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_pipeline_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id),
      pipelineId: String(row.pipeline_id),
      status: String(row.status) as PipelineRun["status"],
      request: JSON.parse(String(row.request_json)) as Record<string, unknown>,
      steps: JSON.parse(String(row.steps_json)) as PipelineRun["steps"],
      estimatedCost: Number(row.estimated_cost ?? 0),
      actualCost: Number(row.actual_cost ?? 0),
      errorCode: row.error_code ? String(row.error_code) : null,
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
    };
  }

  savePipelineRun(run: PipelineRun): void {
    openAgentOsDb().query("UPDATE lead_pipeline_runs SET status = ?, steps_json = ?, estimated_cost = ?, actual_cost = ?, error_code = ?, started_at = ?, completed_at = ? WHERE id = ?")
      .run(run.status, JSON.stringify(run.steps), run.estimatedCost, run.actualCost, run.errorCode, run.startedAt, run.completedAt, run.id);
  }

  listPipelineRuns(limit = 25): PipelineRun[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_pipeline_runs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 100)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.getPipelineRun(String(row.id))!);
  }

  // --- suppression / exports / audit --------------------------------------------------

  addSuppression(entry: Omit<SuppressionEntry, "id" | "createdAt">): SuppressionEntry {
    const record: SuppressionEntry = { id: newId("sup"), createdAt: nowIso(), ...entry };
    openAgentOsDb().query("INSERT INTO lead_suppression (id, match_type, match_value, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.matchType, record.matchValue.toLowerCase(), record.reason, record.createdBy, record.createdAt);
    return record;
  }

  getSuppression(id: string): SuppressionEntry | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_suppression WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapSuppressionRow(row) : null;
  }

  listSuppression(): SuppressionEntry[] {
    const rows = openAgentOsDb().query("SELECT * FROM lead_suppression ORDER BY created_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
    return rows.map(mapSuppressionRow);
  }

  removeSuppression(id: string): boolean {
    const result = openAgentOsDb().query("DELETE FROM lead_suppression WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  insertExport(id: string, format: string, requestedBy: string, rowCount: number, filtersJson: string, content: string): void {
    openAgentOsDb().query("INSERT INTO lead_exports (id, format, requested_by, row_count, filters_json, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, format, requestedBy, rowCount, filtersJson, content, nowIso());
  }

  getExport(id: string): { id: string; format: string; requestedBy: string; rowCount: number; content: string; createdAt: string } | null {
    const row = openAgentOsDb().query("SELECT * FROM lead_exports WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return { id: String(row.id), format: String(row.format), requestedBy: String(row.requested_by), rowCount: Number(row.row_count), content: String(row.content), createdAt: String(row.created_at) };
  }

  appendAudit(entry: { actorType: string; actorId: string; action: string; resourceType: string; resourceId: string; metadata?: Record<string, unknown> }): void {
    openAgentOsDb().query("INSERT INTO lead_audit (ts, actor_type, actor_id, action, resource_type, resource_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nowIso(), entry.actorType, entry.actorId, entry.action, entry.resourceType, entry.resourceId, JSON.stringify(entry.metadata ?? {}));
  }

  listAudit(limit = 50): Array<{ ts: string; actorType: string; actorId: string; action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> }> {
    const rows = openAgentOsDb().query("SELECT * FROM lead_audit ORDER BY ts DESC, id DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ts: String(row.ts),
      actorType: String(row.actor_type),
      actorId: String(row.actor_id),
      action: String(row.action),
      resourceType: String(row.resource_type),
      resourceId: String(row.resource_id),
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : {},
    }));
  }
}

// --- row mappers -----------------------------------------------------------------

function mapLeadRow(row: Record<string, unknown>): CanonicalLead {
  const lead: CanonicalLead = {
    id: String(row.id),
    kind: String(row.kind) as CanonicalLead["kind"],
    status: String(row.status) as CanonicalLead["status"],
    company: row.company_json ? (JSON.parse(String(row.company_json)) as CompanyProfile) : undefined,
    person: row.person_json ? (JSON.parse(String(row.person_json)) as PersonProfile) : undefined,
    contactPoints: [],
    socialProfiles: [],
    score: row.score_json ? (JSON.parse(String(row.score_json)) as CanonicalLead["score"]) : undefined,
    confidence: Number(row.confidence ?? 0),
    sourceRecords: [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  return lead;
}

function mapProviderRow(row: Record<string, unknown>): ProviderDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    adapter: String(row.adapter) as ProviderDefinition["adapter"],
    enabled: Number(row.enabled ?? 0) === 1,
    capabilities: JSON.parse(String(row.capabilities_json)) as ProviderDefinition["capabilities"],
    pricingModel: String(row.pricing_model) as ProviderDefinition["pricingModel"],
    currency: String(row.currency ?? "USD"),
    estimatedCostPer1000: Number(row.cost_per_1000 ?? 0),
    timeoutMs: Number(row.timeout_ms ?? 60000),
    maxConcurrency: Number(row.max_concurrency ?? 2),
    qualityScore: Number(row.quality_score ?? 0.5),
    reliabilityScore: Number(row.reliability_score ?? 0.5),
    requiresApproval: Number(row.requires_approval ?? 0) === 1,
    secretRef: row.secret_ref ? String(row.secret_ref) : null,
    config: row.config_json ? (JSON.parse(String(row.config_json)) as Record<string, unknown>) : {},
  };
}

function mapJobRow(row: Record<string, unknown>): LeadJob {
  return {
    id: String(row.id),
    type: String(row.type) as LeadJob["type"],
    status: String(row.status) as LeadJob["status"],
    request: JSON.parse(String(row.request_json)) as Record<string, unknown>,
    strategy: String(row.strategy) as LeadJob["strategy"],
    budget: JSON.parse(String(row.budget_json)) as LeadJob["budget"],
    selectedProviders: JSON.parse(String(row.selected_providers_json ?? "[]")) as string[],
    estimatedCost: Number(row.estimated_cost ?? 0),
    actualCost: Number(row.actual_cost ?? 0),
    currency: String(row.currency ?? "USD"),
    result: row.result_json ? (JSON.parse(String(row.result_json)) as Record<string, unknown>) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapSuppressionRow(row: Record<string, unknown>): SuppressionEntry {
  return {
    id: String(row.id),
    matchType: String(row.match_type) as SuppressionEntry["matchType"],
    matchValue: String(row.match_value),
    reason: String(row.reason) as SuppressionEntry["reason"],
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

export { newId as newLeadId, nowIso as leadNowIso };
