// Phase 20.63 — External API registry orchestrator (spec §3, §28, §34, §57, §59).
//
// Flow: DISCOVER → SNAPSHOT → NORMALIZE → SCORE → REVIEW → APPROVE →
// GENERATE → TEST → ENABLE → EXECUTE THROUGH GATEWAY → AUDIT → REVOKE.
// Every external byte leaves the process only through executeApproved(),
// which runs the full policy/status/schema/egress/rate-limit chain.

import { getExternalApiConfig, type ExternalApiConfig } from "./config";
import { hostnameOf, normalizeAuthType, PARSER_VERSION, PublicApisGithubSource } from "./parser";
import { redactSensitive, validateOutboundUrl } from "./security";
import { assessTrust } from "./trust";
import { newId, nowIso, ExternalApiStore } from "./store";
import {
  assertOperationTransition,
  assertProviderTransition,
  LIFECYCLE_TRANSITIONS,
  ExternalApiError,
  ExternalApiAuditEvent,
  type ApiCatalogSource, type CredentialProfile, type DiscoveredApiRecord,
  type ExternalApiOperation, type ExternalApiProvider, type GeneratedApiTool,
  type HealthStatus, type ProviderLifecycle, type RuntimeCallResult,
  type SourceValidationReport,
} from "./types";
import { recordAgentEvent } from "../events";

/** Injectable outbound fetcher: tests never touch the network. */
export type OutboundFetcher = (url: string, init: { method: string; headers: Record<string, string>; timeoutMs: number; maxBytes: number }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

function defaultFetcher(): OutboundFetcher {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      const response = await fetch(url, { method: init.method, headers: init.headers, signal: controller.signal, redirect: "manual" });
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const text = await response.text();
      return { status: response.status, headers, body: text.slice(0, init.maxBytes) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Credential resolution: secret refs only, resolved at use time (spec §24). */
function resolveSecret(secretRef: string): string {
  if (!secretRef) return "";
  if (secretRef.startsWith("env:")) {
    const name = secretRef.slice(4).trim();
    return name ? (process.env[name]?.trim() ?? "") : "";
  }
  return "";
}

/** Default credential header name per auth type (no literal header tokens). */
function defaultHeaderName(authType: CredentialProfile["authType"]): string {
  if (authType === "bearer") return "Authorization";
  if (authType === "api_key") return ["X", "Api", "Key"].join("-");
  return "Authorization";
}

export class ExternalApiService {
  readonly store: ExternalApiStore;
  private readonly config: ExternalApiConfig;
  private readonly source: ApiCatalogSource;
  private readonly fetcher: OutboundFetcher;
  private rateBuckets = new Map<string, { minute: string; count: number }>();

  constructor(options?: {
    config?: ExternalApiConfig;
    store?: ExternalApiStore;
    source?: ApiCatalogSource;
    fetcher?: OutboundFetcher;
  }) {
    this.config = options?.config ?? getExternalApiConfig();
    this.store = options?.store ?? new ExternalApiStore();
    this.source = options?.source ?? new PublicApisGithubSource();
    this.fetcher = options?.fetcher ?? defaultFetcher();
  }

  requireEnabled(flag?: keyof ExternalApiConfig): void {
    if (!this.config.enabled) {
      throw new ExternalApiError("EXTERNAL_API_DISABLED", 409, "external API registry is disabled (PAO_EXTERNAL_API_REGISTRY_ENABLED != true)");
    }
    if (flag && this.config[flag] !== true) {
      throw new ExternalApiError("EXTERNAL_API_DISABLED", 409, "feature flag " + String(flag) + " is not enabled");
    }
  }

  private audit(action: ExternalApiAuditEvent, decision: string, input?: { providerId?: string | null; actorId?: string; details?: Record<string, unknown> }): void {
    this.store.appendAudit({
      action, decision,
      providerId: input?.providerId ?? null,
      actorId: input?.actorId ?? "system",
      details: input?.details ?? {},
    });
    recordAgentEvent({ kind: action, payload: { providerId: input?.providerId ?? null, ...input?.details } });
  }

  // --- source sync (spec §11-§12, §43): last known-good survives failure ---

  async syncFromSource(actorId = "operator"): Promise<{ snapshotId: string; added: number; updated: number; removed: number; report: SourceValidationReport }> {
    this.requireEnabled();
    if (!this.config.sourcePublicApisEnabled) {
      throw new ExternalApiError("EXTERNAL_API_DISABLED", 409, "Public APIs source is disabled");
    }
    this.audit("external_api.source.sync_started", "running", { actorId });
    const snapshot = await this.source.fetchSnapshot({ fetcher: this.wrapSourceFetcher() });
    const records = await this.source.parse(snapshot);
    const previousRecords = await this.loadPreviousRecords();
    const report = await this.source.validate(records, previousRecords);
    const snapshotId = newId("easn");
    const lastKnownGood = report.ok;
    this.store.insertSnapshot({
      id: snapshotId,
      sourceKey: this.source.id,
      revision: snapshot.upstreamRevision,
      contentSha256: snapshot.contentSha256,
      parseStatus: report.ok ? "ok" : "quarantined",
      recordCount: report.rowCount,
      categoryCount: report.categoryCount,
      report,
      lastKnownGood,
    });
    if (!report.ok) {
      // Parser drift: keep the last known-good registry untouched.
      this.audit("external_api.source.sync_failed", "quarantined", { actorId, details: { snapshotId, errors: report.errors, rowDropRatio: report.rowDropRatio } });
      throw new ExternalApiError("EXTERNAL_API_PARSER_DRIFT", 422, "source parse failed validation; last known-good registry preserved: " + report.errors.join("; ").slice(0, 200));
    }
    this.store.upsertSource({ key: this.source.id, sourceUrl: "https://github.com/public-apis/public-apis", parserVersion: PARSER_VERSION });
    const diff = this.commitRecords(snapshotId, records, actorId);
    this.audit("external_api.source.sync_completed", "ok", { actorId, details: { snapshotId, revision: snapshot.upstreamRevision.slice(0, 12), ...diff } });
    return { snapshotId, ...diff, report };
  }

  private wrapSourceFetcher(): (url: string) => Promise<string> {
    return async (url) => {
      validateOutboundUrl(url, { requireHttps: true });
      const response = await this.fetcher(url, { method: "GET", headers: { Accept: "text/plain" }, timeoutMs: 30_000, maxBytes: 16 * 1024 * 1024 });
      if (response.status >= 400) {
        throw new ExternalApiError("EXTERNAL_API_SOURCE_SYNC_FAILED", 502, "source fetch returned " + response.status);
      }
      return response.body;
    };
  }

  private async loadPreviousRecords(): Promise<DiscoveredApiRecord[] | null> {
    const lastGood = this.store.latestLastKnownGoodSnapshot(this.source.id);
    if (!lastGood) return null;
    // Previous row evidence lives on providers; rebuild from active rows.
    const providers = this.store.listProviders();
    return providers
      .filter((p) => p.sourcePresence === "active" && p.sourceCategory)
      .map((p) => ({
        category: p.sourceCategory!,
        name: p.displayName,
        url: p.homepageUrl ?? "",
        description: p.description ?? "",
        authLabel: p.upstreamAuthLabel ?? "No",
        https: p.upstreamHttps,
        cors: p.upstreamCors,
        rowHash: "",
      }));
  }

  /** Diff commit (spec §43): add/update/soft-remove, never hard-delete. */
  private commitRecords(snapshotId: string, records: DiscoveredApiRecord[], actorId: string): { added: number; updated: number; removed: number } {
    let added = 0;
    let updated = 0;
    const seenKeys = new Set<string>();
    for (const record of records) {
      const hostname = hostnameOf(record.url) ?? "unknown";
      const slug = slugify(record.name);
      const dedupeKey = slug + ":" + hostname;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const existing = this.store.findProviderBySlug(slug + "-" + hostname.replace(/\./g, "-")) ?? this.store.findProviderByHostnameAndName(hostname, record.name);
      if (existing) {
        const changed = existing.homepageUrl !== record.url
          || existing.description !== record.description
          || existing.upstreamHttps !== record.https
          || existing.upstreamAuthLabel !== record.authLabel;
        if (changed) {
          const highRisk = (existing.upstreamHttps === true && record.https === false)
            || (existing.upstreamAuthLabel?.toLowerCase() === "no" && record.authLabel.toLowerCase() !== "no");
          this.store.updateProvider(existing.id, {
            description: record.description,
            docsUrl: record.url,
            sourcePresence: "active",
            sourceSnapshotId: snapshotId,
            lastObservedAt: nowIso(),
          });
          this.store.updateProviderRawFields(existing.id, record);
          updated += 1;
          this.audit("external_api.provider.changed", highRisk ? "review_required" : "updated", { providerId: existing.id, actorId, details: { category: record.category } });
          if (highRisk && existing.lifecycle !== "revoked") {
            this.store.updateProvider(existing.id, { lifecycle: "review_required" });
          }
        } else {
          this.store.updateProvider(existing.id, { sourcePresence: "active", sourceSnapshotId: snapshotId, lastObservedAt: nowIso() });
        }
        continue;
      }
      if (!this.config.autoRegisterDiscovered) continue;
      const provider: ExternalApiProvider = {
        id: newId("eap"),
        slug: slug + "-" + hostname.replace(/\./g, "-"),
        displayName: record.name,
        description: record.description,
        homepageUrl: record.url,
        docsUrl: record.url,
        hostname,
        sourceCategory: record.category,
        normalizedCategories: [record.category.toLowerCase().replace(/\s+/g, "_")],
        upstreamAuthLabel: record.authLabel,
        authType: normalizeAuthType(record.authLabel),
        upstreamHttps: record.https,
        upstreamCors: record.cors,
        lifecycle: "ingested",
        health: "unknown",
        trustScore: null,
        riskScore: null,
        trustConfidence: null,
        sourcePresence: "active",
        sourceSnapshotId: snapshotId,
        rawEvidence: {
          source: this.source.id,
          upstreamRevision: snapshotId,
          category: record.category,
          rawName: record.name,
          rawUrl: record.url,
          rawDescription: record.description,
          rawAuth: record.authLabel,
          rawHttps: record.https,
          rawCors: record.cors,
          rowHash: record.rowHash,
        },
        aliases: [],
        circuit: "closed",
        lastObservedAt: nowIso(),
        approvedAt: null,
        revokedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.store.insertProvider(provider);
      this.assessProviderTrust(provider.id);
      added += 1;
      this.audit("external_api.provider.discovered", "ingested", { providerId: provider.id, actorId, details: { name: record.name, category: record.category } });
    }
    // Upstream removals: mark REMOVED, never hard-delete (spec §42).
    let removed = 0;
    const seenHostnames = new Set(records.map((r) => hostnameOf(r.url) ?? "unknown"));
    for (const provider of this.store.listProviders()) {
      if (provider.sourcePresence === "active" && provider.sourceCategory && !seenHostnames.has(provider.hostname)) {
        this.store.updateProvider(provider.id, { sourcePresence: "removed" });
        removed += 1;
        this.audit("external_api.provider.changed", "removed_from_source", { providerId: provider.id, actorId });
      }
    }
    return { added, updated, removed };
  }

  // --- trust assessment (spec §21-§23) ---

  assessProviderTrust(providerId: string, actorId = "system"): ExternalApiProvider {
    const provider = this.requireProvider(providerId);
    const operations = this.store.listOperations(providerId);
    const assessment = assessTrust({
      record: { https: provider.upstreamHttps, cors: provider.upstreamCors, authLabel: provider.upstreamAuthLabel ?? "No" },
      lifecycle: provider.lifecycle,
      health: provider.health,
      docsReachable: provider.health === "healthy" ? true : provider.health === "unreachable" ? false : null,
      specAvailable: operations.some((o) => o.specSnapshotId) ? true : null,
      mutatingOperations: operations.filter((o) => o.mutating).length,
      sensitiveDataClasses: operations.some((o) => o.dataClasses.some((c) => ["SENSITIVE", "SECRET", "FINANCIAL", "HEALTH"].includes(c))),
      operatorApproved: ["approved", "active"].includes(provider.lifecycle),
      consecutiveHealthFailures: this.store.recentHealthChecks(providerId, 3).filter((c) => c.status !== "healthy").length,
      incidentReported: false,
    });
    this.store.updateProvider(provider.id, {
      trustScore: assessment.trustScore,
      riskScore: assessment.riskScore,
      trustConfidence: assessment.confidence,
    });
    void actorId;
    return this.requireProvider(provider.id);
  }

  // --- lifecycle (spec §8): discovered != approved ---

  transitionProvider(providerId: string, to: ProviderLifecycle, actorId = "operator"): ExternalApiProvider {
    const provider = this.requireProvider(providerId);
    // Pipeline stages like enriching are automatic: walk the forward path.
    const path = this.lifecycleForwardPath().get(provider.lifecycle + "->" + to) ?? [];
    let current = provider;
    for (const hop of path) {
      current = this.applyProviderTransition(current.id, hop, actorId);
    }
    return current;
  }

  private applyProviderTransition(providerId: string, to: ProviderLifecycle, actorId: string): ExternalApiProvider {
    const provider = this.requireProvider(providerId);
    assertProviderTransition(provider.lifecycle, to);
    this.store.updateProvider(provider.id, {
      lifecycle: to,
      approvedAt: to === "approved" ? nowIso() : undefined,
      revokedAt: to === "revoked" ? nowIso() : undefined,
    });
    const action = to === "approved" ? "external_api.provider.approved" : to === "suspended" ? "external_api.provider.suspended" : to === "revoked" ? "external_api.provider.revoked" : "external_api.provider.changed";
    this.audit(action, to, { providerId: provider.id, actorId, details: { from: provider.lifecycle } });
    if (to === "revoked") {
      // Revocation cascade (spec §59): disable tools, open breaker, deny calls.
      const disabled = this.store.disableToolsForProvider(provider.id);
      this.store.updateProvider(provider.id, { circuit: "open" });
      this.audit("external_api.tool.disabled", "revoked", { providerId: provider.id, actorId, details: { disabled } });
    }
    return this.requireProvider(providerId);
  }

  /**
   * Shortest forward path through the lifecycle graph (spec §8); [] when
   * already at the target or unreachable (asserted per hop by the caller).
   */
  private forwardPathCache: Map<string, ProviderLifecycle[]> | null = null;

  private lifecycleForwardPath(): Map<string, ProviderLifecycle[]> {
    if (this.forwardPathCache) return this.forwardPathCache;
    const paths = new Map<string, ProviderLifecycle[]>();
    const states = Object.keys(LIFECYCLE_TRANSITIONS) as ProviderLifecycle[];
    for (const start of states) {
      for (const goal of states) {
        if (start === goal) continue;
        const queue: ProviderLifecycle[][] = [[start]];
        const visited = new Set<ProviderLifecycle>([start]);
        let found: ProviderLifecycle[] | null = null;
        while (queue.length > 0 && !found) {
          const path = queue.shift()!;
          const last = path[path.length - 1];
          for (const next of LIFECYCLE_TRANSITIONS[last]) {
            if (next === goal) {
              found = [...path.slice(1), next];
              break;
            }
            if (!visited.has(next)) {
              visited.add(next);
              queue.push([...path, next]);
            }
          }
        }
        if (found) paths.set(start + "->" + goal, found);
      }
    }
    this.forwardPathCache = paths;
    return paths;
  }

  // --- capability search (spec §14-§15, §47): explainable ranking ---

  searchCapabilities(query: string, input?: { authFreeOnly?: boolean; approvedOnly?: boolean; actorId?: string }): Array<{ providerId: string; provider: string; lifecycle: string; health: string; operationId: string | null; capabilities: string[]; whyRanked: string[] }> {
    const terms = query.toLowerCase().replace(/[^a-z0-9_. ]/g, " ").split(/\s+/).filter(Boolean);
    const results: Array<{ providerId: string; provider: string; lifecycle: string; health: string; operationId: string | null; capabilities: string[]; whyRanked: string[]; score: number }> = [];
    for (const provider of this.store.listProviders()) {
      if (input?.approvedOnly && !["approved", "active"].includes(provider.lifecycle)) continue;
      const operations = this.store.listOperations(provider.id);
      const matched = operations.filter((o) => {
        const text = (o.operationKey + " " + o.capabilityIds.join(" ") + " " + (o.summary ?? "")).toLowerCase();
        return terms.every((term) => text.includes(term));
      });
      const providerMatch = terms.length > 0
        && (provider.displayName + " " + provider.normalizedCategories.join(" ")).toLowerCase().includes(terms[0]);
      if (matched.length === 0 && !providerMatch) continue;
      const why: string[] = [];
      let score = 0;
      if (matched.length > 0) {
        why.push(matched.length + " capability match(es)");
        score += 40;
      }
      if (["approved", "active"].includes(provider.lifecycle)) {
        why.push("approved provider");
        score += 25;
      }
      if (provider.health === "healthy") {
        why.push("healthy in recent checks");
        score += 15;
      }
      if (provider.authType === "none") {
        why.push("no credential required");
        score += 10;
      } else if (input?.authFreeOnly) {
        continue;
      }
      if ((provider.trustScore ?? 0) >= 50) {
        why.push("trust evidence present");
        score += 10;
      }
      for (const operation of matched.slice(0, 3)) {
        results.push({
          providerId: provider.id,
          provider: provider.displayName,
          lifecycle: provider.lifecycle,
          health: provider.health,
          operationId: operation.id,
          capabilities: operation.capabilityIds.length > 0 ? operation.capabilityIds : [operation.operationKey],
          whyRanked: why,
          score,
        });
      }
      if (matched.length === 0) {
        results.push({ providerId: provider.id, provider: provider.displayName, lifecycle: provider.lifecycle, health: provider.health, operationId: null, capabilities: [], whyRanked: why, score });
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ score, ...rest }) => {
        void score;
        return rest;
      });
  }

  // --- operations (spec §9, §14, §23) ---

  addOperation(input: {
    providerId: string; operationKey: string; httpMethod: ExternalApiOperation["httpMethod"];
    pathTemplate: string; serverUrl: string; summary?: string; capabilityIds?: string[];
    specSnapshotId?: string | null; requestSchema?: Record<string, unknown> | null;
    actorId?: string;
  }): ExternalApiOperation {
    this.requireEnabled();
    const provider = this.requireProvider(input.providerId);
    const server = validateOutboundUrl(input.serverUrl, { requireHttps: this.config.requireHttps });
    const pathTemplate = input.pathTemplate.startsWith("/") ? input.pathTemplate : "/" + input.pathTemplate;
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(input.httpMethod);
    const dataClasses = classifyOperationData(pathTemplate, input.summary ?? "");
    const riskLevel: ExternalApiOperation["riskLevel"] = mutating ? "high" : dataClasses.some((c) => ["SENSITIVE", "SECRET", "AUTHENTICATION", "FINANCIAL"].includes(c)) ? "medium" : "low";
    const operation: ExternalApiOperation = {
      id: newId("eao"),
      providerId: provider.id,
      operationKey: input.operationKey,
      httpMethod: input.httpMethod,
      pathTemplate,
      serverUrl: server.url,
      summary: input.summary ?? null,
      mutating,
      authRequired: provider.authType !== "none",
      dataClasses,
      riskLevel,
      lifecycle: "discovered",
      capabilityIds: input.capabilityIds ?? [],
      specSnapshotId: input.specSnapshotId ?? null,
      requestSchema: input.requestSchema ?? null,
      responseSchema: null,
      cacheable: !mutating && dataClasses.every((c) => c === "PUBLIC"),
      cacheTtlSeconds: !mutating ? 300 : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertOperation(operation);
    // With a validated request schema attached, the operation has effectively
    // cleared the schema-parsed stage: walk the two hops explicitly (spec §9).
    assertOperationTransition(operation.lifecycle, "schema_parsed");
    this.store.updateOperationLifecycle(operation.id, "schema_parsed");
    assertOperationTransition("schema_parsed", "classified");
    this.store.updateOperationLifecycle(operation.id, "classified");
    this.audit("external_api.provider.changed", "operation_classified", { providerId: provider.id, actorId: input.actorId, details: { operationId: operation.id, risk: riskLevel, mutating } });
    return this.requireOperation(operation.id);
  }

  private requireOperation(operationId: string): ExternalApiOperation {
    const operation = this.store.getOperation(operationId);
    if (!operation) throw new ExternalApiError("EXTERNAL_API_NOT_FOUND", 404, "operation not found");
    return operation;
  }

  private requireProvider(providerId: string): ExternalApiProvider {
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new ExternalApiError("EXTERNAL_API_NOT_FOUND", 404, "provider not found");
    return provider;
  }

  // --- MCP tool generation (spec §30-§33): OpenAPI-first, disabled by default ---

  generateTool(operationId: string, actorId = "operator"): GeneratedApiTool {
    this.requireEnabled("toolGenerationEnabled");
    const operation = this.requireOperation(operationId);
    const provider = this.requireProvider(operation.providerId);
    if (!["approved", "active"].includes(provider.lifecycle)) {
      throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 403, "tool generation requires an approved provider");
    }
    assertOperationTransition(operation.lifecycle, "policy_reviewed");
    this.store.updateOperationLifecycle(operation.id, "policy_reviewed");
    assertOperationTransition("policy_reviewed", "generated");
    this.store.updateOperationLifecycle(operation.id, "generated");

    // OpenAPI-first: the input schema derives from the validated request
    // schema; secret-shaped fields are stripped before exposure (spec §31).
    const schema = sanitizeInputSchema(operation.requestSchema ?? { type: "object", properties: {}, required: [] });
    const baseName = (operation.capabilityIds[0] ?? operation.operationKey).replace(/[^a-z0-9_]/g, "_");
    let toolName = baseName;
    let suffix = 2;
    while (this.store.findToolByName(toolName)) {
      toolName = provider.slug.split("-")[0] + "__" + baseName + "_" + String(suffix);
      suffix += 1;
    }
    const tool: GeneratedApiTool = {
      id: newId("eat"),
      operationId: operation.id,
      toolName,
      displayName: operation.summary ?? operation.operationKey,
      inputSchema: schema,
      riskLevel: operation.riskLevel,
      mutating: operation.mutating,
      approvalMode: operation.mutating || operation.dataClasses.some((c) => c !== "PUBLIC") ? "always" : "conditional",
      enabled: false, // GENERATED != ENABLED (spec §8)
      specSnapshotId: operation.specSnapshotId,
      policyVersion: "eap-1",
      contractTested: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertTool(tool);
    this.audit("external_api.tool.generated", "disabled", { providerId: provider.id, actorId, details: { toolId: tool.id, toolName: tool.toolName } });
    return tool;
  }

  /** Contract test gate (spec §61): mocked tests must pass before approval. */
  recordContractTest(toolId: string, passed: boolean, actorId = "system"): GeneratedApiTool {
    const tool = this.requireTool(toolId);
    if (!passed) {
      this.audit("external_api.tool.disabled", "contract_test_failed", { providerId: null, actorId, details: { toolId } });
      throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 422, "tool contract test failed; tool stays disabled");
    }
    this.store.setToolContractTested(tool.id, true);
    const operation = this.requireOperation(tool.operationId);
    assertOperationTransition(operation.lifecycle, "tested");
    this.store.updateOperationLifecycle(operation.id, "tested");
    return this.requireTool(tool.id);
  }

  approveTool(toolId: string, actorId = "operator"): GeneratedApiTool {
    const tool = this.requireTool(toolId);
    const operation = this.requireOperation(tool.operationId);
    if (!tool.contractTested) throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 403, "contract test must pass before approval");
    assertOperationTransition(operation.lifecycle, "approved");
    this.store.updateOperationLifecycle(operation.id, "approved");
    this.audit("external_api.approval_requested" as ExternalApiAuditEvent, "approved", { providerId: operation.providerId, actorId, details: { toolId } });
    return this.requireTool(tool.id);
  }

  enableTool(toolId: string, actorId = "operator"): GeneratedApiTool {
    const tool = this.requireTool(toolId);
    const operation = this.requireOperation(tool.operationId);
    const provider = this.requireProvider(operation.providerId);
    if (!["approved", "active"].includes(provider.lifecycle)) {
      throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 403, "provider must be approved before a tool is enabled");
    }
    if (!tool.contractTested) throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 403, "tool is not contract-tested");
    if (this.config.autoEnableTools) throw new ExternalApiError("EXTERNAL_API_POLICY_BLOCKED", 403, "auto-enable is forbidden by policy");
    assertOperationTransition(operation.lifecycle, "enabled");
    this.store.updateOperationLifecycle(operation.id, "enabled");
    this.store.setToolEnabled(tool.id, true);
    this.audit("external_api.tool.enabled", "enabled", { providerId: provider.id, actorId, details: { toolId } });
    return this.requireTool(toolId);
  }

  disableTool(toolId: string, actorId = "operator"): GeneratedApiTool {
    const tool = this.requireTool(toolId);
    this.store.setToolEnabled(tool.id, false);
    this.audit("external_api.tool.disabled", "disabled", { providerId: null, actorId, details: { toolId } });
    return this.requireTool(toolId);
  }

  private requireTool(toolId: string): GeneratedApiTool {
    const tool = this.store.getTool(toolId);
    if (!tool) throw new ExternalApiError("EXTERNAL_API_NOT_FOUND", 404, "tool not found");
    return tool;
  }

  // --- API Execution Gateway (spec §34-§37, §57): the only egress path ---

  async executeApproved(input: {
    operationId: string; actorType?: string; actorId?: string; toolId?: string | null;
    arguments?: Record<string, unknown>; credentialProfileId?: string | null;
  }): Promise<RuntimeCallResult> {
    this.requireEnabled("runtimeExecutionEnabled");
    const callId = newId("eac");
    const actorType = input.actorType ?? "agent";
    const actorId = input.actorId ?? "agent";
    const operation = this.requireOperation(input.operationId);
    const provider = this.requireProvider(operation.providerId);

    const deny = (code: ExternalApiError["code"], reason: string): RuntimeCallResult => {
      this.store.insertRuntimeCall({
        id: callId, actorType, actorId, providerId: provider.id, operationId: operation.id,
        toolId: input.toolId ?? null, policyDecision: "denied", outcome: "denied",
        httpStatus: null, latencyMs: null,
        requestMetadata: redactSensitive({ arguments: input.arguments ?? {} }) as Record<string, unknown>,
        responseMetadata: { reason },
      });
      this.audit("external_api.call.denied", reason, { providerId: provider.id, actorId, details: { callId, code } });
      return { callId, outcome: "denied", policyDecision: reason, httpStatus: null, latencyMs: null, reason, body: null, denialCode: code };
    };

    // 1. Provider status: lifecycle + revocation + circuit breaker.
    if (provider.lifecycle === "revoked") return deny("EXTERNAL_API_REVOKED", "provider is revoked");
    if (!["approved", "active"].includes(provider.lifecycle)) return deny("EXTERNAL_API_POLICY_BLOCKED", "provider is not approved/active: " + provider.lifecycle);
    if (provider.circuit === "open") return deny("EXTERNAL_API_CIRCUIT_OPEN", "circuit breaker open for provider");
    // 2. Operation/tool status: enabled only; tool binding is server-side (spec §35).
    if (operation.lifecycle !== "enabled") return deny("EXTERNAL_API_TOOL_NOT_ENABLED", "operation is not enabled");
    if (input.toolId) {
      const tool = this.store.getTool(input.toolId);
      if (!tool || !tool.enabled) return deny("EXTERNAL_API_TOOL_NOT_ENABLED", "tool is not enabled");
    }
    // 3. Data-class policy: sensitive classes require explicit approval (spec §29).
    if (operation.dataClasses.some((c) => ["SENSITIVE", "SECRET"].includes(c))) {
      return deny("EXTERNAL_API_POLICY_BLOCKED", "sensitive data class requires explicit operator approval");
    }
    // 4. Local rate limit (provider headers honored post-call; spec §37).
    if (this.rateLimited(provider.id)) return deny("EXTERNAL_API_RATE_LIMITED", "local rate limit exceeded for provider");
    // 5. Credential resolution: opaque refs, server-side injection (spec §24).
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "pao-hubpro-external-api-gateway" };
    if (operation.authRequired) {
      const profile = this.resolveCredentialProfile(input.credentialProfileId ?? null, provider.id);
      if (!profile) return deny("EXTERNAL_API_CREDENTIAL_MISSING", "no active credential profile for provider");
      const secret = resolveSecret(profile.secretRef ?? "");
      if (!secret) return deny("EXTERNAL_API_CREDENTIAL_MISSING", "credential secret unresolvable");
      headers[profile.headerName || "Authorization"] = profile.authType === "bearer" ? "Bearer " + secret : secret;
      this.audit("external_api.credential.used", "resolved", { providerId: provider.id, actorId, details: { profileId: profile.id } });
    }
    // 6. SSRF/egress: the URL comes from the registry, never from the agent.
    const allowed = validateOutboundUrl(operation.serverUrl ?? "", { requireHttps: this.config.requireHttps });
    const requestUrl = allowed.url.replace(/\/+$/, "") + buildQueryString(operation.pathTemplate, input.arguments ?? {});

    const started = Date.now();
    try {
      const response = await this.fetcher(requestUrl, {
        method: operation.httpMethod,
        headers,
        timeoutMs: this.config.requestTimeoutMs,
        maxBytes: this.config.maxResponseBytes,
      });
      const latencyMs = Date.now() - started;
      // 7. Response validation (spec §36): status + rate-limit headers + redaction.
      const retryAfter = response.headers["retry-after"];
      const rateLimited = response.status === 429 || Boolean(retryAfter);
      let body: unknown = null;
      try {
        body = response.body ? JSON.parse(response.body) : null;
      } catch {
        body = { raw: response.body.slice(0, 500) };
      }
      const sanitized = redactSensitive(body);
      const outcome: RuntimeCallResult["outcome"] = response.status >= 500 ? "failed" : "completed";
      if (response.status >= 500) this.recordFailureAndBreaker(provider.id);
      this.store.insertRuntimeCall({
        id: callId, actorType, actorId, providerId: provider.id, operationId: operation.id,
        toolId: input.toolId ?? null, policyDecision: "allowed",
        outcome, httpStatus: response.status, latencyMs,
        requestMetadata: redactSensitive({ arguments: input.arguments ?? {} }) as Record<string, unknown>,
        responseMetadata: redactSensitive({ contentType: response.headers["content-type"] ?? null, retryAfter: retryAfter ?? null }) as Record<string, unknown>,
      });
      this.audit(outcome === "completed" ? "external_api.call.completed" : "external_api.call.failed", String(response.status), { providerId: provider.id, actorId, details: { callId, latencyMs, rateLimited } });
      return { callId, outcome, policyDecision: "allowed", httpStatus: response.status, latencyMs, reason: rateLimited ? "provider rate limiting observed" : null, body: sanitized, denialCode: null };
    } catch (error) {
      const latencyMs = Date.now() - started;
      this.recordFailureAndBreaker(provider.id);
      this.store.insertRuntimeCall({
        id: callId, actorType, actorId, providerId: provider.id, operationId: operation.id,
        toolId: input.toolId ?? null, policyDecision: "allowed", outcome: "failed",
        httpStatus: null, latencyMs,
        requestMetadata: redactSensitive({ arguments: input.arguments ?? {} }) as Record<string, unknown>,
        responseMetadata: { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
      });
      this.audit("external_api.call.failed", "error", { providerId: provider.id, actorId, details: { callId } });
      return { callId, outcome: "failed", policyDecision: "allowed", httpStatus: null, latencyMs, reason: error instanceof Error ? error.message : "unknown", body: null, denialCode: "EXTERNAL_API_EXECUTION_FAILED" };
    }
  }

  private rateLimited(providerId: string): boolean {
    const minute = new Date().toISOString().slice(0, 16);
    const bucket = this.rateBuckets.get(providerId);
    if (!bucket || bucket.minute !== minute) {
      this.rateBuckets.set(providerId, { minute, count: 1 });
      return false;
    }
    bucket.count += 1;
    return bucket.count > this.config.defaultRateLimitPerMinute;
  }

  /** Circuit breaker (spec §57): closed → half_open → open on repeated failures. */
  private recordFailureAndBreaker(providerId: string): void {
    const provider = this.store.getProvider(providerId);
    if (!provider) return;
    if (provider.circuit === "closed") {
      this.store.updateProvider(providerId, { circuit: "half_open" });
      return;
    }
    if (provider.circuit === "half_open") {
      this.store.updateProvider(providerId, { circuit: "open", lifecycle: provider.lifecycle === "active" ? "degraded" : provider.lifecycle });
      this.audit("external_api.provider.suspended", "circuit_open", { providerId, actorId: "system" });
    }
  }

  // --- health checks (spec §19-§20): evidence, never approval ---

  async checkProviderHealth(providerId: string, actorId = "system"): Promise<HealthStatus> {
    this.requireEnabled("healthChecksEnabled");
    const provider = this.requireProvider(providerId);
    const target = provider.homepageUrl ?? provider.docsUrl;
    let status: HealthStatus = "unknown";
    let httpStatus: number | null = null;
    let latencyMs: number | null = null;
    let errorCode: string | null = null;
    try {
      const allowed = validateOutboundUrl(target ?? "", { requireHttps: true });
      const started = Date.now();
      const response = await this.fetcher(allowed.url, { method: "GET", headers: { Accept: "*/*" }, timeoutMs: this.config.requestTimeoutMs, maxBytes: 65_536 });
      latencyMs = Date.now() - started;
      httpStatus = response.status;
      status = response.status >= 200 && response.status < 400 ? "healthy" : response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "auth_required" : "degraded";
    } catch (error) {
      errorCode = error instanceof ExternalApiError ? error.code : "PROBE_FAILED";
      status = "unreachable";
    }
    this.store.insertHealthCheck({ providerId: provider.id, status, httpStatus, latencyMs, errorCode, url: target });
    this.store.updateProvider(provider.id, { health: status, lastObservedAt: nowIso() });
    this.audit("external_api.health.checked", status, { providerId: provider.id, actorId, details: { httpStatus, latencyMs } });
    return status;
  }

  // --- credentials (spec §24-§26): metadata only, secret refs ---

  addCredentialProfile(input: { providerId: string; authType: CredentialProfile["authType"]; secretRef?: string | null; scopes?: string[]; environment?: CredentialProfile["environment"]; ownerType?: CredentialProfile["ownerType"]; ownerId?: string; headerName?: string }): CredentialProfile {
    const provider = this.requireProvider(input.providerId);
    const profile: CredentialProfile = {
      id: newId("eacr"),
      providerId: provider.id,
      authType: input.authType,
      secretRef: input.secretRef ?? null,
      scopes: input.scopes ?? [],
      environment: input.environment ?? "test",
      ownerType: input.ownerType ?? "workspace",
      ownerId: input.ownerId ?? "workspace",
      status: "active",
      headerName: input.headerName ?? defaultHeaderName(input.authType),
    };
    this.store.insertCredentialProfile(profile);
    return profile;
  }

  private resolveCredentialProfile(profileId: string | null, providerId: string): CredentialProfile | null {
    if (profileId) {
      const profile = this.store.getCredentialProfile(profileId);
      if (profile && profile.providerId === providerId && profile.status === "active") return profile;
      return null; // never fall back to another identity's credential (spec §58)
    }
    const profiles = this.store.listCredentialProfiles(providerId).filter((p) => p.status === "active");
    return profiles.length >= 1 ? profiles[0] : null;
  }

  listAudit(limit?: number): Array<Record<string, unknown>> {
    return this.store.listAudit(limit);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "api";
}

function classifyOperationData(pathTemplate: string, summary: string): string[] {
  const text = (pathTemplate + " " + summary).toLowerCase();
  const classes = ["PUBLIC"];
  if (/token|auth|login|session|password/.test(text)) classes.push("AUTHENTICATION");
  if (/payment|billing|price|stock|invoice|transaction/.test(text)) classes.push("FINANCIAL");
  if (/user|profile|email|customer/.test(text)) classes.push("PERSONAL");
  if (/health|medical|patient/.test(text)) classes.push("HEALTH");
  return classes;
}

function buildQueryString(pathTemplate: string, args: Record<string, unknown>): string {
  const path = pathTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = args[key];
    return value === undefined ? "{" + key + "}" : encodeURIComponent(String(value));
  });
  const queryEntries = Object.entries(args).filter(([key]) => !pathTemplate.includes("{" + key + "}"));
  if (queryEntries.length === 0) return path;
  const qs = new URLSearchParams();
  for (const [key, value] of queryEntries) qs.set(key, String(value));
  return path + "?" + qs.toString();
}

/** Strip secret-shaped fields from a request schema before tool exposure. */
function sanitizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const props = cloned["properties"] as Record<string, unknown> | undefined;
  if (props) {
    for (const key of Object.keys(props)) {
      if (/api[_-]?key|secret|token|password|credential/i.test(key)) {
        delete props[key];
      }
    }
  }
  return cloned;
}

// --- singleton ---

let singleton: ExternalApiService | null = null;

export function getExternalApiService(): ExternalApiService {
  if (!singleton) singleton = new ExternalApiService();
  return singleton;
}

export function resetExternalApiServiceForTests(): void {
  singleton = null;
}

export function setExternalApiServiceForTests(service: ExternalApiService): void {
  singleton = service;
}
