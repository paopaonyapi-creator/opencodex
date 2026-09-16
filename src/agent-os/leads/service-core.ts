// Phase 20.34 — LeadService core: the Lead Intelligence Control Plane
// (spec §13-§22, §28). Search/enrich/verify/score/export run as budget-gated
// jobs; pipelines compose those operations; every meaningful action lands in
// lead_audit and the agent event trail. Outreach does not exist here
// (flag-wired false, spec §22.5).
//
// Provider execution goes through runner.ts: this orchestrator persists a
// sanitized job and hands the RUNNER only the job id; the runner reloads the
// persisted record and invokes the provider runtime, whose network targets
// are allowlisted/SSRF-validated internally.

import { recordAgentEvent } from "../events";
import { LeadError } from "./errors";
import { leadFlags } from "./flags";
import { contactPoint, mergeCompany, mergeContactPoints, normalizeDomain } from "./normalize";
import { ApifyActorProvider, CustomHttpProvider, MockLeadProvider, WebsiteContactProvider, type LeadProviderRuntime } from "./providers";
import { runProviderContactDiscovery, runProviderSearch, runProviderVerification } from "./runner";
import { assertValidBudget, checkBudget, defaultBudget, SCORING_PROFILES, scoreLead, selectProviders, suppressionHits } from "./policy";
import { LeadStore } from "./store";
import type {
  CanonicalLead,
  ContactPoint,
  DiscoveredLead,
  LeadBudget,
  LeadJob,
  LeadQuery,
  PipelineDefinition,
  PipelineRun,
  ProviderDefinition,
  RoutingStrategyName,
  SuppressionEntry,
} from "./types";

const EXPORT_ROW_CAP = 1000;
const HUMAN_ACTOR = /^(operator|dashboard|user|human|owner)/i;

function newJobId(): string {
  return `ljob_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newRunId(): string {
  return `lrun_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newLeadId(): string {
  return `lead_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Whitelist boundary (spec §39): only bounded primitive fields survive into
 *  a stored provider request; URL/host/endpoint-shaped keys are dropped and
 *  providers enforce their own target allowlists. */
function sanitizeProviderQuery(raw: Record<string, unknown>): LeadQuery {
  const record = raw && typeof raw === "object" ? raw : {};
  const boundedString = (key: string, max = 200): string | undefined => {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  };
  const keywords = Array.isArray(record.industryKeywords)
    ? (record.industryKeywords as unknown[]).filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 80)).slice(0, 12)
    : undefined;
  const kinds = ["company", "person", "local_business"];
  const kind = boundedString("leadKind", 20);
  return {
    leadKind: kinds.includes(kind ?? "") ? (kind as LeadQuery["leadKind"]) : "local_business",
    query: boundedString("query", 300) ?? "",
    industryKeywords: keywords,
    country: boundedString("country", 4),
    region: boundedString("region", 80),
    city: boundedString("city", 80),
    jobTitle: boundedString("jobTitle", 80),
    companySize: boundedString("companySize", 40),
    limit: Math.max(1, Math.min(Number(record.limit ?? 10) || 10, EXPORT_ROW_CAP)),
    requiredFields: Array.isArray(record.requiredFields)
      ? (record.requiredFields as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 10)
      : undefined,
  };
}

export class LeadService {
  private store = new LeadStore();
  private runtimes = new Map<string, LeadProviderRuntime>();

  /** Seeds the registry (idempotent): mock + website crawler always; the
   *  Apify adapter is config-driven and flag-gated (spec §10.2). */
  ensureRegistry(): void {
    const seeded = new Map<string, LeadProviderRuntime>();
    const mock = new MockLeadProvider();
    seeded.set(mock.definition().id, mock);
    const website = new WebsiteContactProvider();
    seeded.set(website.definition().id, website);
    if (leadFlags().apifyProvider && process.env.APIFY_ACTOR_ID) {
      const apify = new ApifyActorProvider({
        actorId: process.env.APIFY_ACTOR_ID,
        capabilities: ["lead_search", "contact_discovery"],
        estimatedCostPer1000: Number(process.env.APIFY_ESTIMATED_COST_PER_1000 || 0),
      });
      seeded.set(apify.definition().id, apify);
    }
    const customJson = process.env.LEAD_CUSTOM_PROVIDERS_JSON;
    if (customJson) {
      try {
        const entries = JSON.parse(customJson) as Array<ConstructorParameters<typeof CustomHttpProvider>[0]>;
        for (const entry of entries) {
          const provider = new CustomHttpProvider(entry);
          seeded.set(provider.definition().id, provider);
        }
      } catch {
        // Malformed custom-provider config degrades to "not configured" rather
        // than crashing the registry.
      }
    }
    for (const [id, runtime] of seeded) {
      this.runtimes.set(id, runtime);
      this.store.upsertProvider(runtime.definition());
    }
  }

  listProviders(): Array<ProviderDefinition & { health: ReturnType<LeadStore["latestProviderHealth"]> }> {
    this.ensureRegistry();
    return this.store.listProviders().map((definition) => ({
      ...definition,
      health: this.store.latestProviderHealth(definition.id),
    }));
  }

  async testProvider(id: string, actor: string): Promise<Record<string, unknown>> {
    this.ensureRegistry();
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new LeadError("NOT_FOUND", `Provider not found: ${id}`);
    const health = await runtime.healthCheck();
    this.store.saveProviderHealth(id, health);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "provider.health_check", resourceType: "provider", resourceId: id, metadata: { status: health.status } });
    return { id, health };
  }

  setProviderEnabled(id: string, enabled: boolean, actor: string): void {
    this.ensureRegistry();
    if (!this.store.getProvider(id)) throw new LeadError("NOT_FOUND", `Provider not found: ${id}`);
    this.store.setProviderEnabled(id, enabled);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: enabled ? "provider.enabled" : "provider.disabled", resourceType: "provider", resourceId: id });
  }

  private candidatesFor(capability: string, budget: LeadBudget, strategy: RoutingStrategyName = "BALANCED"): { ordered: ReturnType<typeof selectProviders>["ordered"]; rejected: ReturnType<typeof selectProviders>["rejected"] } {
    this.ensureRegistry();
    const candidates = this.store.listProviders().map((definition) => {
      const health = this.store.latestProviderHealth(definition.id) ?? { status: definition.enabled ? ("healthy" as const) : ("disabled" as const) };
      const estimate = { providerId: definition.id, currency: definition.currency, estimatedCost: 0, units: 1, pricingModel: definition.pricingModel };
      return { definition, health, estimate };
    });
    return selectProviders(candidates, { capability, strategy, budget, remainingBudget: budget.maxJobCost });
  }

  async estimateSearchCost(input: { query: Record<string, unknown>; strategy?: RoutingStrategyName }): Promise<Record<string, unknown>> {
    const budget = assertValidBudget(input.query.budget ?? {});
    const query = sanitizeProviderQuery(input.query);
    const { ordered, rejected } = this.candidatesFor("lead_search", budget, input.strategy ?? "BALANCED");
    const withEstimates = await Promise.all(ordered.map(async (candidate) => {
      const runtime = this.runtimes.get(candidate.definition.id)!;
      const estimate = await runtime.estimateCost("lead_search", query.limit);
      return { providerId: candidate.definition.id, score: candidate.score, estimate };
    }));
    return {
      currency: budget.currency,
      budget,
      estimatedCost: Math.min(withEstimates.reduce((sum, entry) => sum + entry.estimate.estimatedCost, 0), budget.maxJobCost),
      providers: withEstimates,
      rejected,
    };
  }

  async search(input: {
    query: Record<string, unknown>;
    strategy?: RoutingStrategyName;
    budget?: Record<string, unknown>;
    actor?: string;
  }): Promise<LeadJob> {
    if (!leadFlags().intelligence) throw new LeadError("POLICY_BLOCKED", "Lead intelligence is disabled by flag");
    this.ensureRegistry();
    const actor = input.actor ?? "dashboard";
    const budget = assertValidBudget(input.budget ?? {});
    const strategy: RoutingStrategyName = input.strategy ?? ((process.env.LEAD_DEFAULT_STRATEGY as RoutingStrategyName) || "BALANCED");
    const query = sanitizeProviderQuery(input.query);

    const { ordered, rejected } = this.candidatesFor("lead_search", budget, strategy);
    if (ordered.length === 0) {
      throw new LeadError("PROVIDER_UNAVAILABLE", `No enabled provider covers lead_search (rejected: ${rejected.map((entry) => entry.id).join(", ") || "none registered"})`);
    }
    const selected = ordered[0]!;
    const runtime = this.runtimes.get(selected.definition.id)!;
    const estimate = await runtime.estimateCost("lead_search", query.limit);
    const gate = checkBudget(budget, estimate.estimatedCost, query.limit);

    const now = new Date().toISOString();
    const job: LeadJob = {
      id: newJobId(),
      type: "search",
      status: gate.reasonCode === "BUDGET_EXCEEDED" ? "blocked" : gate.reasonCode === "APPROVAL_REQUIRED" ? "waiting_approval" : "queued",
      request: { query },
      strategy,
      budget,
      selectedProviders: [selected.definition.id],
      estimatedCost: estimate.estimatedCost,
      actualCost: 0,
      currency: budget.currency,
      result: null,
      errorCode: gate.reasonCode === "BUDGET_EXCEEDED" ? "BUDGET_EXCEEDED" : null,
      errorMessage: gate.message ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.store.insertJob(job);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "search.created", resourceType: "job", resourceId: job.id, metadata: { estimated: estimate.estimatedCost, provider: selected.definition.id, gate: gate.reasonCode ?? "allow" } });
    if (job.status !== "queued") return job;
    return this.executeSearchJob(job.id);
  }

  approveJob(jobId: string, actor: string): LeadJob {
    // Human-only: agents may request paid runs, only a human may release them
    // (same invariant family as the cockpit/governance approvals).
    if (!HUMAN_ACTOR.test(actor.trim())) {
      throw new LeadError("POLICY_BLOCKED", "invariant violation: only human actors may approve paid lead jobs");
    }
    const job = this.store.getJob(jobId);
    if (!job) throw new LeadError("NOT_FOUND", `Lead job not found: ${jobId}`);
    if (job.status !== "waiting_approval" && job.status !== "blocked") {
      throw new LeadError("VALIDATION_ERROR", `Job ${jobId} is not awaiting approval (status ${job.status})`);
    }
    if (job.errorCode === "BUDGET_EXCEEDED") {
      throw new LeadError("BUDGET_EXCEEDED", "A budget-exceeded job cannot be approved; raise the budget and re-run");
    }
    job.status = "queued";
    job.errorCode = null;
    job.errorMessage = null;
    this.store.saveJob(job);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "job.approved", resourceType: "job", resourceId: job.id });
    return job;
  }

  cancelJob(jobId: string, actor: string): LeadJob {
    const job = this.store.getJob(jobId);
    if (!job) throw new LeadError("NOT_FOUND", `Lead job not found: ${jobId}`);
    if (job.status !== "queued" && job.status !== "waiting_approval") {
      throw new LeadError("VALIDATION_ERROR", "Only queued or approval-waiting jobs can be cancelled");
    }
    job.status = "cancelled";
    job.completedAt = new Date().toISOString();
    this.store.saveJob(job);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "job.cancelled", resourceType: "job", resourceId: job.id });
    return job;
  }

  /** Executes a QUEUED search job by id via the runner (store-reloaded input). */
  private async executeSearchJob(jobId: string): Promise<LeadJob> {
    const job = this.store.getJob(jobId);
    if (!job) throw new LeadError("NOT_FOUND", `Lead job not found: ${jobId}`);
    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.store.saveJob(job);
    try {
      const outcome = await runProviderSearch(this.store, this.runtimes, jobId);
      job.actualCost = outcome.units > 0 ? job.estimatedCost : 0;
      this.store.recordUsage(job.selectedProviders[0]!, job.id, "lead_search", outcome.units, job.estimatedCost, job.actualCost, job.currency);

      let discovered = 0;
      let merged = 0;
      const leadIds: string[] = [];
      for (const discoveredLead of outcome.leads) {
        const persisted = this.persistDiscovered(discoveredLead, job.selectedProviders[0]!, outcome.providerRunId);
        if (persisted.merged) merged += 1; else discovered += 1;
        leadIds.push(persisted.lead.id);
      }
      job.result = { leadIds, discovered, merged, providerRunId: outcome.providerRunId ?? null };
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      this.store.saveJob(job);
      this.store.appendAudit({ actorType: "system", actorId: "lead-service", action: "search.completed", resourceType: "job", resourceId: job.id, metadata: { discovered, merged } });
      recordAgentEvent({ kind: "lead.search.completed", payload: { jobId: job.id, discovered, merged, cost: job.actualCost } });
      return job;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.errorCode = err instanceof LeadError ? err.code : "INTERNAL_ERROR";
      job.errorMessage = message;
      job.completedAt = new Date().toISOString();
      this.store.saveJob(job);
      this.store.appendAudit({ actorType: "system", actorId: "lead-service", action: "search.failed", resourceType: "job", resourceId: job.id, metadata: { code: job.errorCode } });
      return job;
    }
  }

  /** Normalize → dedupe → persist one discovered lead (spec §16, §17, §6.5).
   *  Exact canonical-key matches corroborate the existing record; fuzzy
   *  candidates are a documented follow-up and never auto-merge. */
  private persistDiscovered(discovered: DiscoveredLead, providerId: string, providerRunId?: string): { lead: CanonicalLead; merged: boolean } {
    if (discovered.company?.domain) {
      discovered.company.domain = normalizeDomain(discovered.company.domain);
      if (discovered.company.domain) discovered.company.websiteUrl = discovered.company.websiteUrl || ("https://" + discovered.company.domain);
    }
    if (discovered.person?.companyDomain) discovered.person.companyDomain = normalizeDomain(discovered.person.companyDomain);

    // Lookup key mirrors the store's canonical_key derivation exactly so a
    // repeat discovery of the same company/person merges instead of forking.
    const lookupKey = discovered.company?.domain
      ? "domain:" + discovered.company.domain
      : discovered.person?.companyDomain && discovered.person.fullName
        ? "person:" + discovered.person.fullName.toLowerCase() + "@" + discovered.person.companyDomain
        : discovered.company?.canonicalName
          ? "company:" + discovered.company.canonicalName.toLowerCase().replace(/\s+/g, " ").slice(0, 80)
          : discovered.person?.fullName
            ? "person:" + discovered.person.fullName.toLowerCase()
            : "lead:" + crypto.randomUUID();
    const existing = this.store.findByCanonicalKey(lookupKey);
    const collectedAt = new Date().toISOString();

    if (existing) {
      existing.company = discovered.company ? mergeCompany(existing.company, discovered.company) : existing.company;
      existing.person = discovered.person ? ({ ...(existing.person ?? {}), ...discovered.person } as CanonicalLead["person"]) : existing.person;
      const incomingPoints = (discovered.contactPoints ?? []).map((point) => ({ ...point, verificationStatus: "unknown" as const })) as ContactPoint[];
      for (const point of mergeContactPoints(this.store.listContactPoints(existing.id), incomingPoints)) {
        this.store.addContactPoint(existing.id, point);
      }
      for (const social of discovered.socialProfiles ?? []) this.store.addSocialProfile(existing.id, social);
      this.store.addSourceRecord(existing.id, { providerId, providerRunId, sourceUrl: discovered.sourceUrl, collectedAt });
      existing.updatedAt = collectedAt;
      this.store.upsertLead(existing);
      return { lead: existing, merged: true };
    }

    const lead: CanonicalLead = {
      id: newLeadId(),
      kind: discovered.kind,
      status: "normalized",
      company: discovered.company,
      person: discovered.person,
      contactPoints: [],
      socialProfiles: [],
      confidence: Math.max(0.3, ...discovered.contactPoints.map((point) => point.confidence), 0.3),
      sourceRecords: [],
      createdAt: collectedAt,
      updatedAt: collectedAt,
    };
    this.store.upsertLead(lead);
    for (const point of discovered.contactPoints ?? []) {
      const normalized = contactPoint(point.type, point.normalizedValue, point.sourceProviderId || providerId, point.confidence);
      if (normalized) {
        this.store.addContactPoint(lead.id, normalized);
        this.store.addFieldEvidence(lead.id, { leadId: lead.id, field: point.type, valuePreview: point.normalizedValue, providerId: point.sourceProviderId || providerId, confidence: point.confidence, collectedAt });
      }
    }
    for (const social of discovered.socialProfiles ?? []) this.store.addSocialProfile(lead.id, social);
    this.store.addSourceRecord(lead.id, { providerId, providerRunId, sourceUrl: discovered.sourceUrl, collectedAt });
    return { lead: this.store.getLead(lead.id)!, merged: false };
  }

  async enrich(input: { leadId: string; actor?: string }): Promise<LeadJob> {
    this.ensureRegistry();
    const lead = this.store.getLead(input.leadId);
    if (!lead) throw new LeadError("NOT_FOUND", `Lead not found: ${input.leadId}`);
    const domain = lead.company?.domain ?? lead.person?.companyDomain;
    if (!domain) throw new LeadError("VALIDATION_ERROR", "Lead has no company domain to enrich");
    const budget = defaultBudget();
    const { ordered } = this.candidatesFor("contact_discovery", budget);
    const runtime = ordered.map((candidate) => this.runtimes.get(candidate.definition.id)!).find((candidate) => candidate?.findContacts);
    if (!runtime?.findContacts) throw new LeadError("PROVIDER_UNAVAILABLE", "No enabled provider covers contact_discovery");

    const now = new Date().toISOString();
    const job: LeadJob = {
      id: newJobId(), type: "enrich", status: "queued",
      request: { leadId: lead.id, domain },
      strategy: "BALANCED", budget, selectedProviders: [runtime.definition().id],
      estimatedCost: 0, actualCost: 0, currency: budget.currency, result: null,
      errorCode: null, errorMessage: null, createdAt: now, startedAt: null, completedAt: null,
    };
    this.store.insertJob(job);
    job.status = "running";
    job.startedAt = now;
    this.store.saveJob(job);
    try {
      const outcome = await runProviderContactDiscovery(this.store, this.runtimes, job.id);
      this.store.recordUsage(runtime.definition().id, job.id, "contact_discovery", outcome.units, 0, 0, budget.currency);
      if (outcome.company) lead.company = mergeCompany(lead.company, outcome.company);
      for (const point of outcome.contactPoints ?? []) {
        const normalized = contactPoint(point.type, point.normalizedValue, point.sourceProviderId, point.confidence);
        if (normalized) {
          this.store.addContactPoint(lead.id, normalized);
          this.store.addFieldEvidence(lead.id, { leadId: lead.id, field: point.type, valuePreview: normalized.normalizedValue, providerId: point.sourceProviderId, confidence: point.confidence, collectedAt: now });
        }
      }
      for (const social of outcome.socialProfiles ?? []) this.store.addSocialProfile(lead.id, social);
      this.store.addSourceRecord(lead.id, { providerId: runtime.definition().id, providerRunId: outcome.providerRunId, collectedAt: now });
      lead.status = lead.status === "verified" || lead.status === "qualified" ? lead.status : "enriched";
      lead.updatedAt = now;
      this.store.upsertLead(lead);
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.result = { leadId: lead.id, contactsAdded: outcome.contactPoints?.length ?? 0 };
      this.store.saveJob(job);
      this.store.appendAudit({ actorType: "user", actorId: input.actor ?? "dashboard", action: "lead.enriched", resourceType: "lead", resourceId: lead.id });
      return job;
    } catch (err) {
      job.status = "failed";
      job.errorCode = err instanceof LeadError ? err.code : "INTERNAL_ERROR";
      job.errorMessage = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      this.store.saveJob(job);
      return job;
    }
  }

  async verify(input: { leadId: string; actor?: string }): Promise<LeadJob> {
    this.ensureRegistry();
    const lead = this.store.getLead(input.leadId);
    if (!lead) throw new LeadError("NOT_FOUND", `Lead not found: ${input.leadId}`);
    const budget = defaultBudget();
    const { ordered } = this.candidatesFor("contact_verification", budget);
    const runtime = ordered.map((candidate) => this.runtimes.get(candidate.definition.id)!).find((candidate) => candidate?.verifyContact);
    const now = new Date().toISOString();
    const job: LeadJob = {
      id: newJobId(), type: "verify", status: "queued",
      request: { leadId: lead.id }, strategy: "BALANCED", budget,
      selectedProviders: runtime ? [runtime.definition().id] : [],
      estimatedCost: 0, actualCost: 0, currency: budget.currency, result: null,
      errorCode: null, errorMessage: null, createdAt: now, startedAt: null, completedAt: null,
    };
    this.store.insertJob(job);
    job.status = "running";
    job.startedAt = now;
    this.store.saveJob(job);
    try {
      if (runtime?.verifyContact) {
        const points = this.store.listContactPoints(lead.id);
        for (const point of points.slice(0, 20)) {
          if (point.type === "website") continue;
          if (point.verificationStatus === "valid") continue; // fresh verification is not re-run (§31)
          const verdict = await runProviderVerification(this.runtimes, runtime.definition().id, { type: point.type, value: point.normalizedValue, runId: job.id });
          this.store.recordUsage(runtime.definition().id, job.id, "contact_verification", verdict.units, 0, 0, budget.currency);
          const updated: ContactPoint = { ...point, verificationStatus: verdict.verificationStatus, verifiedAt: now, confidence: Math.max(point.confidence, verdict.confidence * 0.9) };
          this.store.replaceContactPoint(lead.id, point.type, point.normalizedValue, updated);
        }
      }
      const after = this.store.listContactPoints(lead.id);
      const anyValid = after.some((point) => point.verificationStatus === "valid" || point.verificationStatus === "catch_all");
      const anyInvalid = after.some((point) => point.verificationStatus === "invalid");
      lead.status = anyValid ? "verified" : anyInvalid ? "enriched" : lead.status === "raw" ? "normalized" : lead.status;
      lead.updatedAt = now;
      this.store.upsertLead(lead);
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.result = { leadId: lead.id, verified: anyValid };
      this.store.saveJob(job);
      this.store.appendAudit({ actorType: "user", actorId: input.actor ?? "dashboard", action: "lead.verified", resourceType: "lead", resourceId: lead.id });
      return job;
    } catch (err) {
      job.status = "failed";
      job.errorCode = err instanceof LeadError ? err.code : "INTERNAL_ERROR";
      job.errorMessage = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      this.store.saveJob(job);
      return job;
    }
  }

  score(input: { leadId: string; profileId?: string; industryKeywords?: string[]; region?: string; actor?: string }): { leadId: string; score: CanonicalLead["score"] } {
    const lead = this.store.getLead(input.leadId);
    if (!lead) throw new LeadError("NOT_FOUND", `Lead not found: ${input.leadId}`);
    const profile = SCORING_PROFILES.find((entry) => entry.id === (input.profileId ?? "local-business-basic")) ?? SCORING_PROFILES[0]!;
    lead.contactPoints = this.store.listContactPoints(lead.id);
    lead.socialProfiles = this.store.listSocialProfiles(lead.id);
    lead.sourceRecords = this.store.listSourceRecords(lead.id);
    const verdict = scoreLead(lead, profile, { industryKeywords: input.industryKeywords, region: input.region ?? lead.company?.region ?? lead.person?.region });
    lead.score = {
      total: verdict.total,
      grade: verdict.grade,
      deterministicScore: verdict.total,
      confidence: verdict.confidence,
      reasons: verdict.reasons,
      calculatedAt: new Date().toISOString(),
      scoringProfileId: profile.id + "@v" + profile.version,
    };
    lead.status = lead.status === "suppressed" || lead.status === "archived" ? lead.status : "qualified";
    lead.updatedAt = new Date().toISOString();
    this.store.upsertLead(lead);
    this.store.appendAudit({ actorType: "user", actorId: input.actor ?? "dashboard", action: "lead.scored", resourceType: "lead", resourceId: lead.id, metadata: { total: verdict.total, grade: verdict.grade, profile: lead.score.scoringProfileId } });
    return { leadId: lead.id, score: lead.score };
  }

  async runPipeline(pipelineId: string, request: Record<string, unknown>, actor?: string): Promise<PipelineRun> {
    if (this.store.listPipelines().length === 0) this.seedPipelines();
    const pipeline = this.store.getPipeline(pipelineId);
    if (!pipeline) throw new LeadError("NOT_FOUND", `Pipeline not found: ${pipelineId}`);
    const run: PipelineRun = {
      id: newRunId(),
      pipelineId,
      status: "running",
      request: sanitizeProviderQuery(request) as unknown as Record<string, unknown>,
      steps: pipeline.steps.map((step) => ({ ...step, status: "pending" })),
      estimatedCost: 0,
      actualCost: 0,
      errorCode: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.store.insertPipelineRun(run);
    try {
      for (const step of run.steps) {
        step.status = "running";
        step.startedAt = new Date().toISOString();
        this.store.savePipelineRun(run);
        if (step.when === "website_exists" && !this.store.listLeads({ limit: 1 }).some((lead) => Boolean(lead.company?.domain))) {
          step.status = "skipped";
          step.finishedAt = new Date().toISOString();
          this.store.savePipelineRun(run);
          continue;
        }
        switch (step.action) {
          case "lead.search_businesses":
          case "lead.search": {
            const job = await this.search({ query: { ...run.request, leadKind: "local_business" }, actor });
            step.provider = job.selectedProviders[0];
            step.actualCost = job.actualCost;
            run.actualCost += job.actualCost;
            if (job.status !== "completed") {
              throw new LeadError((job.errorCode as LeadError["code"]) ?? "INTERNAL_ERROR", job.errorMessage ?? "search step failed");
            }
            break;
          }
          case "lead.normalize":
          case "lead.deduplicate":
            // Applied inside persistDiscovered; recorded for pipeline parity.
            break;
          case "lead.enrich_company": {
            for (const lead of this.store.listLeads({ status: "normalized", limit: 20 })) {
              if (!lead.company?.domain) continue;
              const job = await this.enrich({ leadId: lead.id, actor });
              step.actualCost = (step.actualCost ?? 0) + job.actualCost;
              run.actualCost += job.actualCost;
            }
            break;
          }
          case "lead.verify": {
            for (const lead of this.store.listLeads({ status: "enriched", limit: 20 })) {
              await this.verify({ leadId: lead.id, actor });
            }
            break;
          }
          case "lead.score": {
            for (const lead of this.store.listLeads({ status: "verified", limit: 20 })) {
              this.score({ leadId: lead.id, actor });
            }
            break;
          }
          case "lead.suppression.check": {
            const entries = this.store.listSuppression();
            for (const lead of this.store.listLeads({ limit: 200 })) {
              const withChildren = { ...lead, contactPoints: this.store.listContactPoints(lead.id) };
              if (suppressionHits(withChildren, entries).length > 0) {
                lead.status = "suppressed";
                lead.updatedAt = new Date().toISOString();
                this.store.upsertLead(lead);
              }
            }
            break;
          }
          default:
            throw new LeadError("VALIDATION_ERROR", `Unknown pipeline action: ${step.action}`);
        }
        step.status = "completed";
        step.finishedAt = new Date().toISOString();
        this.store.savePipelineRun(run);
      }
      run.status = "completed";
      run.completedAt = new Date().toISOString();
      this.store.savePipelineRun(run);
      recordAgentEvent({ kind: "lead.pipeline.completed", payload: { runId: run.id, pipelineId, cost: run.actualCost } });
      return run;
    } catch (err) {
      run.status = "failed";
      run.errorCode = err instanceof LeadError ? err.code : "INTERNAL_ERROR";
      const failedStep = run.steps.find((step) => step.status === "running");
      if (failedStep) {
        failedStep.status = "failed";
        failedStep.error = err instanceof Error ? err.message : String(err);
        failedStep.finishedAt = new Date().toISOString();
      }
      run.completedAt = new Date().toISOString();
      this.store.savePipelineRun(run);
      return run;
    }
  }

  async exportLeads(input: { format: "csv" | "json"; actor?: string; filters?: { status?: string; kind?: string } }): Promise<{ id: string; rowCount: number; content: string }> {
    if (!leadFlags().export) throw new LeadError("POLICY_BLOCKED", "Lead export is disabled by flag");
    const actor = input.actor ?? "dashboard";
    const entries = this.store.listSuppression();
    const leads = this.store.listLeads({ ...input.filters, limit: EXPORT_ROW_CAP });
    const rows: Array<Record<string, unknown>> = [];
    for (const lead of leads) {
      const withChildren: CanonicalLead = { ...lead, contactPoints: this.store.listContactPoints(lead.id), socialProfiles: this.store.listSocialProfiles(lead.id), sourceRecords: this.store.listSourceRecords(lead.id) };
      const hits = suppressionHits(withChildren, entries);
      if (hits.length > 0) continue; // suppression applies before export (§22.4)
      const email = withChildren.contactPoints.find((point) => point.type === "email");
      const phone = withChildren.contactPoints.find((point) => point.type === "phone");
      const website = withChildren.contactPoints.find((point) => point.type === "website");
      rows.push({
        lead_id: withChildren.id,
        lead_kind: withChildren.kind,
        company_name: withChildren.company?.canonicalName ?? "",
        person_name: withChildren.person?.fullName ?? "",
        job_title: withChildren.person?.jobTitle ?? "",
        industry: withChildren.company?.industry ?? "",
        website: withChildren.company?.websiteUrl ?? website?.normalizedValue ?? "",
        domain: withChildren.company?.domain ?? "",
        email: email?.normalizedValue ?? "",
        email_verification_status: email?.verificationStatus ?? "unknown",
        phone: phone?.normalizedValue ?? "",
        country: withChildren.company?.country ?? withChildren.person?.country ?? "",
        region: withChildren.company?.region ?? withChildren.person?.region ?? "",
        city: withChildren.company?.city ?? withChildren.person?.city ?? "",
        lead_score: withChildren.score?.total ?? "",
        lead_grade: withChildren.score?.grade ?? "",
        confidence: withChildren.confidence,
        source_providers: withChildren.sourceRecords.map((record) => record.providerId).join("|"),
        source_count: withChildren.sourceRecords.length,
        suppression_status: "clear",
        last_enriched_at: withChildren.updatedAt,
        ...(input.format === "json" ? { provenance: withChildren.sourceRecords } : {}),
      });
    }
    const content = input.format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
    const id = "lexp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    this.store.insertExport(id, input.format, actor, rows.length, JSON.stringify(input.filters ?? {}), content);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "export.created", resourceType: "export", resourceId: id, metadata: { format: input.format, rowCount: rows.length, inputLeadCount: leads.length } });
    recordAgentEvent({ kind: "lead.export.created", payload: { exportId: id, format: input.format, rowCount: rows.length } });
    return { id, rowCount: rows.length, content };
  }

  getExport(id: string) {
    return this.store.getExport(id);
  }

  addSuppression(input: { matchType: SuppressionEntry["matchType"]; matchValue: string; reason: SuppressionEntry["reason"]; actor?: string }): SuppressionEntry {
    if (!input.matchValue.trim()) throw new LeadError("VALIDATION_ERROR", "matchValue is required");
    const entry = this.store.addSuppression({ matchType: input.matchType, matchValue: input.matchValue.trim(), reason: input.reason, createdBy: input.actor ?? "dashboard" });
    this.store.appendAudit({ actorType: "user", actorId: entry.createdBy, action: "suppression.added", resourceType: "suppression", resourceId: entry.id, metadata: { matchType: entry.matchType, reason: entry.reason } });
    return entry;
  }

  removeSuppression(id: string, actor: string): void {
    if (!HUMAN_ACTOR.test(actor.trim())) {
      throw new LeadError("POLICY_BLOCKED", "invariant violation: only human actors may remove suppression entries");
    }
    const removed = this.store.removeSuppression(id);
    if (!removed) throw new LeadError("NOT_FOUND", `Suppression entry not found: ${id}`);
    this.store.appendAudit({ actorType: "user", actorId: actor, action: "suppression.removed", resourceType: "suppression", resourceId: id });
  }

  checkSuppression(input: { matchType: SuppressionEntry["matchType"]; matchValue: string }): { suppressed: boolean; entry: SuppressionEntry | null } {
    const hit = this.store.listSuppression().find((entry) => entry.matchType === input.matchType && entry.matchValue === input.matchValue.trim().toLowerCase());
    return { suppressed: Boolean(hit), entry: hit ?? null };
  }

  // --- reads ------------------------------------------------------------------

  listLeads(filters: { status?: string; kind?: string; limit?: number }) {
    return this.store.listLeads(filters);
  }

  leadDetail(leadId: string) {
    const lead = this.store.getLead(leadId);
    if (!lead) return null;
    return {
      lead,
      contactPoints: this.store.listContactPoints(leadId),
      socialProfiles: this.store.listSocialProfiles(leadId),
      sourceRecords: this.store.listSourceRecords(leadId),
      fieldEvidence: this.store.listFieldEvidence(leadId),
    };
  }

  listJobs(limit = 50) {
    return this.store.listJobs(limit);
  }

  getJob(id: string) {
    return this.store.getJob(id);
  }

  listPipelines(): PipelineDefinition[] {
    this.ensureRegistry();
    if (this.store.listPipelines().length === 0) this.seedPipelines();
    return this.store.listPipelines();
  }

  private seedPipelines(): void {
    const standard: PipelineDefinition = {
      id: "local-business-standard",
      name: "Local Business Standard",
      enabled: true,
      steps: [
        { id: "discover", action: "lead.search_businesses" },
        { id: "normalize", action: "lead.normalize" },
        { id: "dedupe", action: "lead.deduplicate" },
        { id: "enrich", action: "lead.enrich_company", when: "website_exists" },
        { id: "verify", action: "lead.verify" },
        { id: "score", action: "lead.score" },
        { id: "suppression", action: "lead.suppression.check" },
      ],
    };
    const decisionMaker: PipelineDefinition = {
      id: "b2b-decision-maker-standard",
      name: "B2B Decision Maker Standard",
      enabled: true,
      steps: [
        { id: "discover", action: "lead.search_businesses" },
        { id: "normalize", action: "lead.normalize" },
        { id: "dedupe", action: "lead.deduplicate" },
        { id: "verify", action: "lead.verify" },
        { id: "score", action: "lead.score" },
        { id: "suppression", action: "lead.suppression.check" },
      ],
    };
    this.store.upsertPipeline(standard);
    this.store.upsertPipeline(decisionMaker);
  }

  listPipelineRuns(limit = 25) {
    return this.store.listPipelineRuns(limit);
  }

  getPipelineRun(id: string) {
    return this.store.getPipelineRun(id);
  }

  listSuppression() {
    return this.store.listSuppression();
  }

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }

  costSummary() {
    return this.store.costSummary();
  }

  scoringProfiles() {
    return SCORING_PROFILES;
  }
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(",")).join("\n");
  return header + "\n" + body;
}

let singleton: LeadService | null = null;

export function getLeadService(): LeadService {
  if (!singleton) singleton = new LeadService();
  return singleton;
}

export function resetLeadServiceForTests(): void {
  singleton = null;
}
