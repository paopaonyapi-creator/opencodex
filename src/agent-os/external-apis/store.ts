// Phase 20.63 — External API registry store (eap_* tables, schema v51).
//
// Consolidation note: the spec's 24 logical tables are represented with the
// same control-plane semantics in fewer physical tables — provider aliases/
// scores/evidence live on the provider row (JSON), spec snapshots on
// operations, reviews/revocations/sync runs in the audit + snapshot rows.
// All statements are short static SQL literals with bound parameters; wide
// rows insert in two statements.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { normalizeAuthType } from "./parser";
import type {
  CredentialProfile, DiscoveredApiRecord, ExternalApiOperation, ExternalApiProvider,
  GeneratedApiTool, HealthStatus, ProviderLifecycle, SourceValidationReport,
} from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
}

function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined ? null : String(v);
}

function numOrNull(row: Row, key: string): number | null {
  const v = row[key];
  return v === null || v === undefined ? null : Number(v);
}

function json<T>(row: Row, key: string, fallback: T): T {
  const raw = row[key];
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function rowToProvider(row: Row): ExternalApiProvider {
  return {
    id: str(row, "id"),
    slug: str(row, "slug"),
    displayName: str(row, "display_name"),
    description: strOrNull(row, "description"),
    homepageUrl: strOrNull(row, "homepage_url"),
    docsUrl: strOrNull(row, "docs_url"),
    hostname: str(row, "hostname"),
    sourceCategory: strOrNull(row, "source_category"),
    normalizedCategories: json<string[]>(row, "categories_json", []),
    upstreamAuthLabel: strOrNull(row, "auth_label"),
    authType: str(row, "auth_type") as ExternalApiProvider["authType"],
    upstreamHttps: row["upstream_https"] === null || row["upstream_https"] === undefined ? null : Number(row["upstream_https"]) === 1,
    upstreamCors: strOrNull(row, "upstream_cors") as ExternalApiProvider["upstreamCors"],
    lifecycle: str(row, "lifecycle") as ProviderLifecycle,
    health: str(row, "health") as HealthStatus,
    trustScore: numOrNull(row, "trust_score"),
    riskScore: numOrNull(row, "risk_score"),
    trustConfidence: numOrNull(row, "trust_confidence"),
    sourcePresence: str(row, "source_presence") as ExternalApiProvider["sourcePresence"],
    sourceSnapshotId: strOrNull(row, "source_snapshot_id"),
    rawEvidence: json<Record<string, unknown>>(row, "raw_json", {}),
    aliases: json<string[]>(row, "aliases_json", []),
    circuit: str(row, "circuit") as ExternalApiProvider["circuit"],
    lastObservedAt: strOrNull(row, "last_observed_at"),
    approvedAt: strOrNull(row, "approved_at"),
    revokedAt: strOrNull(row, "revoked_at"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToOperation(row: Row): ExternalApiOperation {
  return {
    id: str(row, "id"),
    providerId: str(row, "provider_id"),
    operationKey: str(row, "operation_key"),
    httpMethod: str(row, "http_method") as ExternalApiOperation["httpMethod"],
    pathTemplate: str(row, "path_template"),
    serverUrl: strOrNull(row, "server_url"),
    summary: strOrNull(row, "summary"),
    mutating: Number(row["mutating"] ?? 0) === 1,
    authRequired: Number(row["auth_required"] ?? 0) === 1,
    dataClasses: json<string[]>(row, "data_classes_json", []),
    riskLevel: str(row, "risk_level") as ExternalApiOperation["riskLevel"],
    lifecycle: str(row, "lifecycle") as ExternalApiOperation["lifecycle"],
    capabilityIds: json<string[]>(row, "capabilities_json", []),
    specSnapshotId: strOrNull(row, "spec_snapshot_id"),
    requestSchema: json<Record<string, unknown> | null>(row, "request_schema_json", null),
    responseSchema: json<Record<string, unknown> | null>(row, "response_schema_json", null),
    cacheable: Number(row["cacheable"] ?? 0) === 1,
    cacheTtlSeconds: numOrNull(row, "cache_ttl_seconds"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToTool(row: Row): GeneratedApiTool {
  return {
    id: str(row, "id"),
    operationId: str(row, "operation_id"),
    toolName: str(row, "tool_name"),
    displayName: str(row, "display_name"),
    inputSchema: json<Record<string, unknown>>(row, "input_schema_json", {}),
    riskLevel: str(row, "risk_level") as GeneratedApiTool["riskLevel"],
    mutating: Number(row["mutating"] ?? 0) === 1,
    approvalMode: str(row, "approval_mode") as GeneratedApiTool["approvalMode"],
    enabled: Number(row["enabled"] ?? 0) === 1,
    specSnapshotId: strOrNull(row, "spec_snapshot_id"),
    policyVersion: str(row, "policy_version"),
    contractTested: Number(row["contract_tested"] ?? 0) === 1,
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

export class ExternalApiStore {
  // --- sources + snapshots ---

  upsertSource(source: { key: string; sourceUrl: string; parserVersion: string }): void {
    openAgentOsDb()
      .query("INSERT INTO eap_sources (id, key, source_url, parser_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET source_url = excluded.source_url, parser_version = excluded.parser_version, updated_at = excluded.updated_at")
      .run(newId("eas"), source.key, source.sourceUrl, source.parserVersion, nowIso(), nowIso());
  }

  insertSnapshot(snapshot: {
    id: string; sourceKey: string; revision: string; contentSha256: string;
    parseStatus: string; recordCount: number; categoryCount: number;
    report: SourceValidationReport; lastKnownGood: boolean;
  }): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO eap_snapshots (id, source_key, upstream_revision, content_sha256, parse_status, record_count, category_count, warnings_json, last_known_good, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        snapshot.id, snapshot.sourceKey, snapshot.revision, snapshot.contentSha256,
        snapshot.parseStatus, snapshot.recordCount, snapshot.categoryCount,
        JSON.stringify({ warnings: snapshot.report.warnings, errors: snapshot.report.errors }),
        snapshot.lastKnownGood ? 1 : 0, nowIso(),
      );
    return Number(result.changes) > 0;
  }

  getSnapshot(id: string): Row | null {
    return openAgentOsDb().query("SELECT * FROM eap_snapshots WHERE id = ?").get(id) as Row | null;
  }

  latestLastKnownGoodSnapshot(sourceKey: string): Row | null {
    return openAgentOsDb().query("SELECT * FROM eap_snapshots WHERE source_key = ? AND last_known_good = 1 ORDER BY fetched_at DESC LIMIT 1").get(sourceKey) as Row | null;
  }

  // --- providers ---

  findProviderBySlug(slug: string): ExternalApiProvider | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_providers WHERE slug = ?").get(slug) as Row | null;
    if (!row) return null;
    return rowToProvider(row);
  }

  findProviderByHostnameAndName(hostname: string, name: string): ExternalApiProvider | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_providers WHERE hostname = ? AND display_name = ?").get(hostname, name) as Row | null;
    if (!row) return null;
    return rowToProvider(row);
  }

  getProvider(id: string): ExternalApiProvider | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_providers WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToProvider(row);
  }

  listProviders(filter?: { lifecycle?: string }): ExternalApiProvider[] {
    const rows = filter?.lifecycle
      ? openAgentOsDb().query("SELECT * FROM eap_providers WHERE lifecycle = ? ORDER BY display_name").all(filter.lifecycle)
      : openAgentOsDb().query("SELECT * FROM eap_providers ORDER BY display_name LIMIT 1000").all();
    return (rows as Row[]).map(rowToProvider);
  }

  insertProvider(provider: ExternalApiProvider): void {
    openAgentOsDb()
      .query(
        "INSERT INTO eap_providers (id, slug, display_name, description, homepage_url, docs_url, hostname, source_category, categories_json, auth_label, auth_type, upstream_https, upstream_cors, lifecycle, health, trust_score, risk_score, trust_confidence, source_presence, source_snapshot_id, raw_json, aliases_json, circuit, last_observed_at, approved_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?)",
      )
      .run(
        provider.id, provider.slug, provider.displayName, provider.description, provider.homepageUrl,
        provider.docsUrl, provider.hostname, provider.sourceCategory, JSON.stringify(provider.normalizedCategories),
        provider.upstreamAuthLabel, provider.authType, provider.upstreamHttps === null ? null : provider.upstreamHttps ? 1 : 0,
        provider.upstreamCors, provider.lifecycle, provider.health, provider.trustScore, provider.riskScore,
        provider.trustConfidence, provider.sourcePresence, provider.sourceSnapshotId,
        JSON.stringify(provider.rawEvidence), JSON.stringify(provider.aliases), provider.lastObservedAt,
        provider.approvedAt, provider.revokedAt, provider.createdAt, provider.updatedAt,
      );
  }

  updateProvider(id: string, patch: Partial<Pick<ExternalApiProvider, "lifecycle" | "health" | "trustScore" | "riskScore" | "trustConfidence" | "sourcePresence" | "sourceSnapshotId" | "circuit" | "lastObservedAt" | "approvedAt" | "revokedAt" | "docsUrl" | "description" | "aliases">>): void {
    const provider = this.getProvider(id);
    if (!provider) return;
    // Two short static statements; all values bound, no SQL construction.
    openAgentOsDb()
      .query("UPDATE eap_providers SET lifecycle = ?, health = ?, trust_score = ?, risk_score = ?, trust_confidence = ?, source_presence = ?, source_snapshot_id = ? WHERE id = ?")
      .run(
        patch.lifecycle ?? provider.lifecycle,
        patch.health ?? provider.health,
        patch.trustScore !== undefined ? patch.trustScore : provider.trustScore,
        patch.riskScore !== undefined ? patch.riskScore : provider.riskScore,
        patch.trustConfidence !== undefined ? patch.trustConfidence : provider.trustConfidence,
        patch.sourcePresence ?? provider.sourcePresence,
        patch.sourceSnapshotId !== undefined ? patch.sourceSnapshotId : provider.sourceSnapshotId,
        id,
      );
    openAgentOsDb()
      .query("UPDATE eap_providers SET circuit = ?, last_observed_at = ?, approved_at = ?, revoked_at = ?, docs_url = ?, description = ?, aliases_json = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.circuit ?? provider.circuit,
        patch.lastObservedAt !== undefined ? patch.lastObservedAt : provider.lastObservedAt,
        patch.approvedAt !== undefined ? patch.approvedAt : provider.approvedAt,
        patch.revokedAt !== undefined ? patch.revokedAt : provider.revokedAt,
        patch.docsUrl !== undefined ? patch.docsUrl : provider.docsUrl,
        patch.description !== undefined ? patch.description : provider.description,
        JSON.stringify(patch.aliases ?? provider.aliases),
        nowIso(),
        id,
      );
  }

  /** Raw upstream-field refresh during sync (bounded static statements). */
  updateProviderRawFields(id: string, record: DiscoveredApiRecord): void {
    openAgentOsDb()
      .query("UPDATE eap_providers SET homepage_url = ?, auth_label = ?, auth_type = ?, upstream_https = ?, upstream_cors = ? WHERE id = ?")
      .run(
        record.url,
        record.authLabel,
        normalizeAuthType(record.authLabel),
        record.https === null ? null : record.https ? 1 : 0,
        record.cors,
        id,
      );
  }

  // --- operations ---

  insertOperation(operation: ExternalApiOperation): void {
    openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO eap_operations (id, provider_id, operation_key, http_method, path_template, server_url, summary, mutating, auth_required, data_classes_json, risk_level, lifecycle, capabilities_json, spec_snapshot_id, request_schema_json, response_schema_json, cacheable, cache_ttl_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        operation.id, operation.providerId, operation.operationKey, operation.httpMethod,
        operation.pathTemplate, operation.serverUrl, operation.summary, operation.mutating ? 1 : 0,
        operation.authRequired ? 1 : 0, JSON.stringify(operation.dataClasses), operation.riskLevel,
        operation.lifecycle, JSON.stringify(operation.capabilityIds), operation.specSnapshotId,
        JSON.stringify(operation.requestSchema), JSON.stringify(operation.responseSchema),
        operation.cacheable ? 1 : 0, operation.cacheTtlSeconds, operation.createdAt, operation.updatedAt,
      );
  }

  getOperation(id: string): ExternalApiOperation | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_operations WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToOperation(row);
  }

  listOperations(providerId?: string): ExternalApiOperation[] {
    const rows = providerId
      ? openAgentOsDb().query("SELECT * FROM eap_operations WHERE provider_id = ? ORDER BY operation_key").all(providerId)
      : openAgentOsDb().query("SELECT * FROM eap_operations ORDER BY created_at DESC LIMIT 500").all();
    return (rows as Row[]).map(rowToOperation);
  }

  updateOperationLifecycle(id: string, lifecycle: ExternalApiOperation["lifecycle"], specSnapshotId?: string): void {
    const operation = this.getOperation(id);
    if (!operation) return;
    openAgentOsDb().query("UPDATE eap_operations SET lifecycle = ?, spec_snapshot_id = COALESCE(?, spec_snapshot_id), updated_at = ? WHERE id = ?")
      .run(lifecycle, specSnapshotId ?? null, nowIso(), id);
  }

  // --- credential profiles ---

  insertCredentialProfile(profile: CredentialProfile): void {
    openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO eap_credential_profiles (id, provider_id, auth_type, secret_ref, scopes_json, environment, owner_type, owner_id, status, header_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        profile.id, profile.providerId, profile.authType, profile.secretRef,
        JSON.stringify(profile.scopes), profile.environment, profile.ownerType,
        profile.ownerId, profile.status, profile.headerName, nowIso(),
      );
  }

  getCredentialProfile(id: string): CredentialProfile | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_credential_profiles WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return {
      id: str(row, "id"),
      providerId: str(row, "provider_id"),
      authType: str(row, "auth_type") as CredentialProfile["authType"],
      secretRef: strOrNull(row, "secret_ref"),
      scopes: json<string[]>(row, "scopes_json", []),
      environment: str(row, "environment") as CredentialProfile["environment"],
      ownerType: str(row, "owner_type") as CredentialProfile["ownerType"],
      ownerId: str(row, "owner_id"),
      status: str(row, "status") as CredentialProfile["status"],
      headerName: str(row, "header_name"),
    };
  }

  listCredentialProfiles(providerId?: string): CredentialProfile[] {
    const rows = providerId
      ? openAgentOsDb().query("SELECT * FROM eap_credential_profiles WHERE provider_id = ?").all(providerId)
      : openAgentOsDb().query("SELECT * FROM eap_credential_profiles").all();
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      providerId: str(row, "provider_id"),
      authType: str(row, "auth_type") as CredentialProfile["authType"],
      secretRef: strOrNull(row, "secret_ref"),
      scopes: json<string[]>(row, "scopes_json", []),
      environment: str(row, "environment") as CredentialProfile["environment"],
      ownerType: str(row, "owner_type") as CredentialProfile["ownerType"],
      ownerId: str(row, "owner_id"),
      status: str(row, "status") as CredentialProfile["status"],
      headerName: str(row, "header_name"),
    }));
  }

  // --- tools ---

  insertTool(tool: GeneratedApiTool): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO eap_tools (id, operation_id, tool_name, display_name, input_schema_json, risk_level, mutating, approval_mode, enabled, spec_snapshot_id, policy_version, contract_tested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        tool.id, tool.operationId, tool.toolName, tool.displayName,
        JSON.stringify(tool.inputSchema), tool.riskLevel, tool.mutating ? 1 : 0,
        tool.approvalMode, tool.enabled ? 1 : 0, tool.specSnapshotId, tool.policyVersion,
        tool.contractTested ? 1 : 0, tool.createdAt, tool.updatedAt,
      );
    return Number(result.changes) > 0;
  }

  getTool(id: string): GeneratedApiTool | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_tools WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToTool(row);
  }

  findToolByName(toolName: string): GeneratedApiTool | null {
    const row = openAgentOsDb().query("SELECT * FROM eap_tools WHERE tool_name = ?").get(toolName) as Row | null;
    if (!row) return null;
    return rowToTool(row);
  }

  listTools(filter?: { enabled?: boolean }): GeneratedApiTool[] {
    const rows = filter?.enabled !== undefined
      ? openAgentOsDb().query("SELECT * FROM eap_tools WHERE enabled = ? ORDER BY tool_name").all(filter.enabled ? 1 : 0)
      : openAgentOsDb().query("SELECT * FROM eap_tools ORDER BY tool_name").all();
    return (rows as Row[]).map(rowToTool);
  }

  setToolEnabled(id: string, enabled: boolean, contractTested?: boolean): void {
    const tool = this.getTool(id);
    if (!tool) return;
    openAgentOsDb().query("UPDATE eap_tools SET enabled = ?, contract_tested = COALESCE(?, contract_tested), updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, contractTested === undefined ? null : contractTested ? 1 : 0, nowIso(), id);
  }

  setToolContractTested(id: string, tested: boolean): void {
    openAgentOsDb().query("UPDATE eap_tools SET contract_tested = ?, updated_at = ? WHERE id = ?").run(tested ? 1 : 0, nowIso(), id);
  }

  disableToolsForProvider(providerId: string): number {
    const result = openAgentOsDb()
      .query(
        "UPDATE eap_tools SET enabled = 0, updated_at = ? WHERE operation_id IN (SELECT id FROM eap_operations WHERE provider_id = ?) AND enabled = 1",
      )
      .run(nowIso(), providerId);
    return Number(result.changes);
  }

  // --- health checks ---

  insertHealthCheck(check: { providerId: string; status: HealthStatus; httpStatus: number | null; latencyMs: number | null; errorCode: string | null; url: string | null }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO eap_health_checks (id, provider_id, status, http_status, latency_ms, error_code, url, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(newId("eah"), check.providerId, check.status, check.httpStatus, check.latencyMs, check.errorCode, check.url, nowIso());
  }

  recentHealthChecks(providerId: string, limit = 10): Array<{ status: HealthStatus; checkedAt: string }> {
    const rows = openAgentOsDb().query("SELECT status, checked_at FROM eap_health_checks WHERE provider_id = ? ORDER BY checked_at DESC LIMIT ?").all(providerId, limit) as Row[];
    return rows.map((row) => ({ status: str(row, "status") as HealthStatus, checkedAt: str(row, "checked_at") }));
  }

  // --- runtime calls ---

  insertRuntimeCall(call: {
    id: string; actorType: string; actorId: string; providerId: string; operationId: string;
    toolId: string | null; policyDecision: string; outcome: string; httpStatus: number | null;
    latencyMs: number | null; requestMetadata: Record<string, unknown>; responseMetadata: Record<string, unknown>;
  }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO eap_runtime_calls (id, actor_type, actor_id, provider_id, operation_id, tool_id, policy_decision, outcome, http_status, latency_ms, request_json, response_json, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        call.id, call.actorType, call.actorId, call.providerId, call.operationId, call.toolId,
        call.policyDecision, call.outcome, call.httpStatus, call.latencyMs,
        JSON.stringify(call.requestMetadata), JSON.stringify(call.responseMetadata), nowIso(),
      );
  }

  listRuntimeCalls(limit = 100): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM eap_runtime_calls ORDER BY started_at DESC LIMIT ?").all(limit) as Row[];
    return rows.map((row) => ({
      id: str(row, "id"),
      actorType: str(row, "actor_type"),
      actorId: str(row, "actor_id"),
      providerId: str(row, "provider_id"),
      operationId: str(row, "operation_id"),
      toolId: strOrNull(row, "tool_id"),
      policyDecision: str(row, "policy_decision"),
      outcome: str(row, "outcome"),
      httpStatus: numOrNull(row, "http_status"),
      latencyMs: numOrNull(row, "latency_ms"),
      request: json<Record<string, unknown>>(row, "request_json", {}),
      response: json<Record<string, unknown>>(row, "response_json", {}),
      startedAt: str(row, "started_at"),
    }));
  }

  // --- audit ---

  appendAudit(entry: { action: string; decision: string; providerId?: string | null; actorId: string; details?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO eap_audit (id, action, decision, provider_id, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("eaa"), entry.action, entry.decision, entry.providerId ?? null, entry.actorId, JSON.stringify(entry.details ?? {}), nowIso());
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM eap_audit ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
    return rows.map((row) => ({
      id: str(row, "id"),
      action: str(row, "action"),
      decision: str(row, "decision"),
      providerId: strOrNull(row, "provider_id"),
      actorId: str(row, "actor_id"),
      details: json<Record<string, unknown>>(row, "details_json", {}),
      createdAt: str(row, "created_at"),
    }));
  }
}
