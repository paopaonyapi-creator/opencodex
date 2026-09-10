// Phase 20.15 — Domain Control Plane: persistent store.
//
// Additive tables on the existing Agent OS SQLite handle (the project convention
// for every phase subsystem, and the reason this phase does not need a second
// database, a migration tool, or a container).

import { openAgentOsDb } from "../db";
import type {
  ApprovalRequest,
  ApprovalStatus,
  AuditEvent,
  AuditResult,
  DeploymentBinding,
  DnsDiff,
  DnsRecord,
  DomainControlConfig,
  DomainEnvironment,
  RiskLevel,
} from "./types";

/** Hostnames and secrets are never returned from the store; this only shapes rows. */
interface DomainRow {
  id: string;
  fqdn: string;
  provider_id: string;
  environment: string;
  risk_level: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DomainRegistration {
  readonly id: string;
  readonly fqdn: string;
  readonly providerId: string;
  readonly environment: DomainEnvironment;
  readonly riskLevel: RiskLevel;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditQuery {
  readonly requestId?: string;
  readonly resource?: string;
  readonly operation?: string;
  readonly limit?: number;
}

export class DomainControlStore {
  private initialized = false;

  /**
   * Create this phase's tables. Idempotent and additive: it touches no table that
   * belongs to another phase, so an install that never enables the control plane
   * gains three empty tables and nothing else.
   */
  init(): void {
    if (this.initialized) return;
    const db = openAgentOsDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS dc_domains (
        id TEXT PRIMARY KEY,
        fqdn TEXT NOT NULL UNIQUE,
        provider_id TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'development',
        risk_level TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_domains_fqdn ON dc_domains(fqdn);

      -- Observed provider state, refreshed on read. A cache, never a source of
      -- truth: every verification re-reads the provider and overwrites this.
      CREATE TABLE IF NOT EXISTS dc_records_cache (
        id TEXT PRIMARY KEY,
        zone TEXT NOT NULL,
        record_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        ttl INTEGER NOT NULL DEFAULT 300,
        priority INTEGER,
        synced_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_records_zone ON dc_records_cache(zone);

      CREATE TABLE IF NOT EXISTS dc_approvals (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        resource TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        diff_json TEXT,
        requested_by TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dc_approvals_request ON dc_approvals(request_id);
      CREATE INDEX IF NOT EXISTS idx_dc_approvals_status ON dc_approvals(status);

      -- Append-only by convention: no code path UPDATEs or DELETEs an audit row.
      CREATE TABLE IF NOT EXISTS dc_audit_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        operation TEXT NOT NULL,
        resource TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        approval_id TEXT,
        provider TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL,
        error_code TEXT,
        verification_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_audit_request ON dc_audit_events(request_id);
      CREATE INDEX IF NOT EXISTS idx_dc_audit_resource ON dc_audit_events(resource);
      CREATE INDEX IF NOT EXISTS idx_dc_audit_created ON dc_audit_events(created_at);

      CREATE TABLE IF NOT EXISTS dc_idempotency (
        key TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        operation TEXT NOT NULL,
        resource TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dc_deployment_bindings (
        id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        target_ip TEXT NOT NULL,
        target_port INTEGER NOT NULL,
        proxy_type TEXT NOT NULL DEFAULT 'caddy',
        tls_mode TEXT NOT NULL DEFAULT 'auto',
        healthcheck_url TEXT,
        zone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_bindings_hostname ON dc_deployment_bindings(hostname);
      CREATE INDEX IF NOT EXISTS idx_dc_bindings_deployment ON dc_deployment_bindings(deployment_id);

      CREATE TABLE IF NOT EXISTS dc_provider_credentials (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE,
        -- A POINTER (env var name / keyring reference), never a credential value.
        -- Masked display is the only thing the UI ever receives.
        secret_ref TEXT NOT NULL,
        masked TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dc_verification_runs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_verify_host ON dc_verification_runs(hostname);
    `);
    this.initialized = true;
  }

  // -- Domains -------------------------------------------------------------

  upsertDomain(input: {
    fqdn: string;
    providerId: string;
    environment?: DomainEnvironment;
    riskLevel?: RiskLevel;
    status?: string;
  }): DomainRegistration {
    this.init();
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const existing = this.getDomain(input.fqdn);
    if (existing) {
      db.query(
        "UPDATE dc_domains SET provider_id = ?, environment = ?, status = ?, updated_at = ? WHERE fqdn = ?",
      ).run(
        input.providerId,
        input.environment ?? existing.environment,
        input.status ?? existing.status,
        now,
        input.fqdn,
      );
      return { ...existing, providerId: input.providerId, updatedAt: now };
    }
    const id = `dcdom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    db.query(
      "INSERT INTO dc_domains (id, fqdn, provider_id, environment, risk_level, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.fqdn,
      input.providerId,
      input.environment ?? "development",
      input.riskLevel ?? "medium",
      input.status ?? "active",
      now,
      now,
    );
    return {
      id,
      fqdn: input.fqdn,
      providerId: input.providerId,
      environment: input.environment ?? "development",
      riskLevel: input.riskLevel ?? "medium",
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  getDomain(fqdn: string): DomainRegistration | null {
    this.init();
    const row = openAgentOsDb()
      .query("SELECT * FROM dc_domains WHERE fqdn = ?")
      .get(fqdn.toLowerCase()) as DomainRow | undefined;
    return row ? mapDomain(row) : null;
  }

  listDomains(): DomainRegistration[] {
    this.init();
    return (openAgentOsDb()
      .query("SELECT * FROM dc_domains ORDER BY fqdn")
      .all() as DomainRow[]).map(mapDomain);
  }

  // -- Record cache --------------------------------------------------------

  replaceCachedRecords(zone: string, records: readonly DnsRecord[]): void {
    this.init();
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    db.query("DELETE FROM dc_records_cache WHERE zone = ?").run(zone);
    const insert = db.query(
      "INSERT INTO dc_records_cache (id, zone, record_id, name, type, content, ttl, priority, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const record of records) {
      insert.run(
        `${zone}:${record.id}`,
        zone,
        record.id,
        record.name,
        record.type,
        record.content,
        record.ttl,
        record.priority ?? null,
        now,
      );
    }
  }

  getCachedRecords(zone: string): DnsRecord[] {
    this.init();
    const rows = openAgentOsDb()
      .query(
        "SELECT record_id, name, type, content, ttl, priority FROM dc_records_cache WHERE zone = ? ORDER BY name, type",
      )
      .all(zone) as {
      record_id: string;
      name: string;
      type: string;
      content: string;
      ttl: number;
      priority: number | null;
    }[];
    return rows.map((row) => ({
      id: row.record_id,
      name: row.name,
      type: row.type as DnsRecord["type"],
      content: row.content,
      ttl: row.ttl,
      ...(row.priority === null ? {} : { priority: row.priority }),
    }));
  }

  // -- Approvals -----------------------------------------------------------

  createApproval(input: {
    requestId: string;
    operation: string;
    resource: string;
    riskLevel: RiskLevel;
    approvalMode: string;
    reasons: readonly string[];
    diff: DnsDiff | null;
    requestedBy: string;
    reason: string;
    /**
     * Absolute expiry timestamp. The CALLER computes it, so the same clock that
     * later decides whether an approval has expired also decided when it would.
     * Deriving it here from Date.now() would let a caller working in a different
     * clock domain (a test seam, or a replay of recorded time) create approvals
     * that can never expire and never verify.
     */
    expiresAt: number;
  }): ApprovalRequest {
    this.init();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const id = `dcappr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    openAgentOsDb()
      .query(
        `INSERT INTO dc_approvals
           (id, request_id, operation, resource, risk_level, approval_mode, reasons_json, diff_json, requested_by, reason, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.requestId,
        input.operation,
        input.resource,
        input.riskLevel,
        input.approvalMode,
        JSON.stringify(input.reasons),
        input.diff ? JSON.stringify(input.diff) : null,
        input.requestedBy,
        input.reason,
        input.expiresAt,
        nowIso,
      );
    return this.getApproval(id)!;
  }

  getApproval(id: string): ApprovalRequest | null {
    this.init();
    const row = openAgentOsDb().query("SELECT * FROM dc_approvals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapApproval(row) : null;
  }

  listApprovals(status?: ApprovalStatus): ApprovalRequest[] {
    this.init();
    const db = openAgentOsDb();
    const rows = status
      ? (db.query("SELECT * FROM dc_approvals WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status) as Record<
          string,
          unknown
        >[])
      : (db.query("SELECT * FROM dc_approvals ORDER BY created_at DESC LIMIT 200").all() as Record<
          string,
          unknown
        >[]);
    return rows.map(mapApproval);
  }

  decideApproval(id: string, decision: "grant" | "deny", decidedBy: string): ApprovalRequest | null {
    this.init();
    const db = openAgentOsDb();
    const current = this.getApproval(id);
    if (!current) return null;
    const status: ApprovalStatus = decision === "grant" ? "granted" : "denied";
    db.query("UPDATE dc_approvals SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?").run(
      status,
      decidedBy,
      new Date().toISOString(),
      id,
    );
    return this.getApproval(id);
  }

  /** Mark elapsed pending approvals expired. Called before every approval check. */
  expireStaleApprovals(now = Date.now()): number {
    this.init();
    const result = openAgentOsDb()
      .query("UPDATE dc_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
      .run(now);
    return Number(result.changes ?? 0);
  }

  // -- Audit ---------------------------------------------------------------

  appendAudit(event: Omit<AuditEvent, "id" | "createdAt">): AuditEvent {
    this.init();
    const id = `dcaud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    openAgentOsDb()
      .query(
        `INSERT INTO dc_audit_events
           (id, request_id, actor, operation, resource, before_json, after_json, approval_id, provider, result, error_code, verification_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        event.requestId,
        event.actor,
        event.operation,
        event.resource,
        jsonOrNull(event.before),
        jsonOrNull(event.after),
        event.approvalId,
        event.provider,
        event.result,
        event.errorCode,
        jsonOrNull(event.verification),
        createdAt,
      );
    return { ...event, id, createdAt };
  }

  listAudit(query: AuditQuery = {}): AuditEvent[] {
    this.init();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.requestId) {
      clauses.push("request_id = ?");
      params.push(query.requestId);
    }
    if (query.resource) {
      clauses.push("resource = ?");
      params.push(query.resource);
    }
    if (query.operation) {
      clauses.push("operation = ?");
      params.push(query.operation);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, query.limit ?? 100));
    const rows = openAgentOsDb()
      .query(`SELECT * FROM dc_audit_events ${where} ORDER BY created_at DESC LIMIT ${limit}`)
      .all(...(params as never[])) as Record<string, unknown>[];
    return rows.map(mapAudit);
  }

  // -- Idempotency ---------------------------------------------------------

  getIdempotent(key: string): { payloadHash: string; operation: string; result: unknown } | null {
    this.init();
    const row = openAgentOsDb()
      .query("SELECT payload_hash, operation, result_json FROM dc_idempotency WHERE key = ?")
      .get(key) as { payload_hash: string; operation: string; result_json: string } | undefined;
    if (!row) return null;
    return {
      payloadHash: row.payload_hash,
      operation: row.operation,
      result: JSON.parse(row.result_json) as unknown,
    };
  }

  putIdempotent(input: {
    key: string;
    payloadHash: string;
    operation: string;
    resource: string;
    result: unknown;
  }): void {
    this.init();
    openAgentOsDb()
      .query(
        `INSERT INTO dc_idempotency (key, payload_hash, operation, resource, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload_hash = excluded.payload_hash, result_json = excluded.result_json`,
      )
      .run(
        input.key,
        input.payloadHash,
        input.operation,
        input.resource,
        JSON.stringify(input.result ?? null),
        new Date().toISOString(),
      );
  }

  // -- Deployment bindings -------------------------------------------------

  createBinding(input: Omit<DeploymentBinding, "id" | "createdAt" | "updatedAt">): DeploymentBinding {
    this.init();
    const now = new Date().toISOString();
    const id = `dcbind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    openAgentOsDb()
      .query(
        `INSERT INTO dc_deployment_bindings
           (id, deployment_id, hostname, target_ip, target_port, proxy_type, tls_mode, healthcheck_url, zone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.deploymentId,
        input.hostname,
        input.targetIp,
        input.targetPort,
        input.proxyType,
        input.tlsMode,
        input.healthcheckUrl ?? null,
        input.zone,
        now,
        now,
      );
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  listBindings(): DeploymentBinding[] {
    this.init();
    return (openAgentOsDb()
      .query("SELECT * FROM dc_deployment_bindings ORDER BY hostname")
      .all() as Record<string, unknown>[]).map(mapBinding);
  }

  getBinding(hostname: string): DeploymentBinding | null {
    this.init();
    const row = openAgentOsDb()
      .query("SELECT * FROM dc_deployment_bindings WHERE hostname = ?")
      .get(hostname) as Record<string, unknown> | undefined;
    return row ? mapBinding(row) : null;
  }

  deleteBinding(hostname: string): boolean {
    this.init();
    const result = openAgentOsDb()
      .query("DELETE FROM dc_deployment_bindings WHERE hostname = ?")
      .run(hostname);
    return Number(result.changes ?? 0) > 0;
  }

  // -- Provider credential metadata ---------------------------------------

  /**
   * Store a REFERENCE to a credential, never the credential. The masked value is
   * the only thing a UI or MCP result may render.
   */
  upsertCredentialMetadata(input: {
    providerId: string;
    secretRef: string;
    masked: string;
  }): void {
    this.init();
    const now = new Date().toISOString();
    openAgentOsDb()
      .query(
        `INSERT INTO dc_provider_credentials (id, provider_id, secret_ref, masked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           secret_ref = excluded.secret_ref, masked = excluded.masked, updated_at = excluded.updated_at`,
      )
      .run(`dccred_${input.providerId}`, input.providerId, input.secretRef, input.masked, now, now);
  }

  listCredentialMetadata(): { providerId: string; secretRef: string; masked: string }[] {
    this.init();
    return (openAgentOsDb()
      .query("SELECT provider_id, secret_ref, masked FROM dc_provider_credentials ORDER BY provider_id")
      .all() as { provider_id: string; secret_ref: string; masked: string }[]).map((row) => ({
      providerId: row.provider_id,
      secretRef: row.secret_ref,
      masked: row.masked,
    }));
  }

  // -- Verification runs ---------------------------------------------------

  recordVerification(input: {
    requestId: string;
    hostname: string;
    kind: string;
    status: string;
    detail: unknown;
  }): void {
    this.init();
    openAgentOsDb()
      .query(
        "INSERT INTO dc_verification_runs (id, request_id, hostname, kind, status, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        `dcver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        input.requestId,
        input.hostname,
        input.kind,
        input.status,
        JSON.stringify(input.detail ?? null),
        new Date().toISOString(),
      );
  }

  listVerifications(hostname: string, limit = 50): Record<string, unknown>[] {
    this.init();
    const rows = openAgentOsDb()
      .query(
        "SELECT request_id, hostname, kind, status, detail_json, created_at FROM dc_verification_runs WHERE hostname = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(hostname, Math.max(1, Math.min(200, limit))) as Record<string, unknown>[];
    return rows.map((row) => ({
      requestId: row.request_id,
      hostname: row.hostname,
      kind: row.kind,
      status: row.status,
      detail: row.detail_json ? JSON.parse(String(row.detail_json)) : null,
      createdAt: row.created_at,
    }));
  }

  /** Test seam: drop this phase's rows without touching other phases' tables. */
  reset(): void {
    this.init();
    openAgentOsDb().exec(`
      DELETE FROM dc_domains;
      DELETE FROM dc_records_cache;
      DELETE FROM dc_approvals;
      DELETE FROM dc_audit_events;
      DELETE FROM dc_idempotency;
      DELETE FROM dc_deployment_bindings;
      DELETE FROM dc_provider_credentials;
      DELETE FROM dc_verification_runs;
    `);
  }
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function mapDomain(row: DomainRow): DomainRegistration {
  return {
    id: row.id,
    fqdn: row.fqdn,
    providerId: row.provider_id,
    environment: row.environment as DomainEnvironment,
    riskLevel: row.risk_level as RiskLevel,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApproval(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    operation: String(row.operation),
    resource: String(row.resource),
    riskLevel: String(row.risk_level) as RiskLevel,
    approvalMode: String(row.approval_mode) as ApprovalRequest["approvalMode"],
    reasons: row.reasons_json ? (JSON.parse(String(row.reasons_json)) as string[]) : [],
    diff: row.diff_json ? (JSON.parse(String(row.diff_json)) as DnsDiff) : null,
    requestedBy: String(row.requested_by),
    reason: String(row.reason ?? ""),
    status: String(row.status) as ApprovalStatus,
    expiresAt: Number(row.expires_at),
    createdAt: String(row.created_at),
    ...(row.approved_by ? { approvedBy: String(row.approved_by) } : {}),
    ...(row.approved_at ? { approvedAt: String(row.approved_at) } : {}),
  };
}

function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    actor: String(row.actor) as AuditEvent["actor"],
    operation: String(row.operation),
    resource: String(row.resource),
    before: row.before_json ? JSON.parse(String(row.before_json)) : null,
    after: row.after_json ? JSON.parse(String(row.after_json)) : null,
    approvalId: row.approval_id ? String(row.approval_id) : null,
    provider: String(row.provider ?? ""),
    result: String(row.result) as AuditResult,
    errorCode: row.error_code ? String(row.error_code) : null,
    verification: row.verification_json ? JSON.parse(String(row.verification_json)) : null,
    createdAt: String(row.created_at),
  };
}

function mapBinding(row: Record<string, unknown>): DeploymentBinding {
  return {
    id: String(row.id),
    deploymentId: String(row.deployment_id),
    hostname: String(row.hostname),
    targetIp: String(row.target_ip),
    targetPort: Number(row.target_port),
    proxyType: String(row.proxy_type) as DeploymentBinding["proxyType"],
    tlsMode: String(row.tls_mode) as DeploymentBinding["tlsMode"],
    ...(row.healthcheck_url ? { healthcheckUrl: String(row.healthcheck_url) } : {}),
    zone: String(row.zone),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

let storeInstance: DomainControlStore | null = null;

export function getDomainControlStore(): DomainControlStore {
  if (!storeInstance) storeInstance = new DomainControlStore();
  return storeInstance;
}

export function resetDomainControlStore(): void {
  if (storeInstance) storeInstance.reset();
  storeInstance = null;
}

export type { DomainControlConfig };
