// Phase 20.15 — Cloud Sandbox Plane: sidecar SQLite persistence ledger.
//
// Replaces the PostgreSQL schema in source spec §32: this repository has no Postgres, only
// `bun:sqlite`. Follows the sidecar precedent set by `src/agent-os/media-memory/db-store.ts`
// (own file, WAL, foreign_keys, `customPath` for tests) rather than joining the central
// `agent-os.sqlite3`, which is already 181 tables / schema v25 and is the single-writer
// contention point. Trade-off recorded in docs/governance/technical-debt.md.
//
// Two deliberate additions over the media-memory precedent:
//   1. `PRAGMA user_version` migration, because four related tables need an upgrade path.
//   2. `close()`, because commit a6b97c01b just fixed an EBUSY on Windows caused by an
//      un-released SQLite handle. WAL leaves `-wal`/`-shm` siblings, so a test that removes
//      its temp directory without closing the handle fails on this platform.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import type {
  CloudEndpointSet,
  CloudOperationRecord,
  CloudPromotionRecord,
  CloudProvider,
  CloudResource,
  CloudSandboxRecord,
  OperationStatus,
  PromotionStatus,
  RiskLevel,
  SandboxConfig,
  SandboxProfile,
  SandboxStatus,
  ServiceFidelity,
} from "./types";

export const CLOUD_SANDBOX_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS cloud_sandboxes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  actor_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  adapter TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  endpoint_json TEXT NOT NULL DEFAULT '{}',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  destroyed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_sandboxes_workspace ON cloud_sandboxes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sandboxes_expiry ON cloud_sandboxes(expires_at);
CREATE INDEX IF NOT EXISTS idx_cloud_sandboxes_status ON cloud_sandboxes(status);

CREATE TABLE IF NOT EXISTS cloud_resources (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL REFERENCES cloud_sandboxes(id),
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  external_id TEXT,
  name TEXT,
  region TEXT,
  state TEXT,
  fidelity TEXT NOT NULL DEFAULT 'UNKNOWN',
  tags_json TEXT NOT NULL DEFAULT '{}',
  parent_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT,
  discovered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_resources_sandbox ON cloud_resources(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_service ON cloud_resources(sandbox_id, service);

CREATE TABLE IF NOT EXISTS cloud_operations (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT REFERENCES cloud_sandboxes(id),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  approval_id TEXT,
  input_digest TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_operations_idem ON cloud_operations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_cloud_operations_sandbox ON cloud_operations(sandbox_id);

CREATE TABLE IF NOT EXISTS cloud_promotions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_sandbox_id TEXT,
  target_environment TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  evidence_bundle_id TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_promotions_workspace ON cloud_promotions(workspace_id);
`;

interface SandboxRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  task_id: string | null;
  run_id: string | null;
  actor_id: string;
  provider: string;
  adapter: string;
  profile: string;
  status: string;
  endpoint_json: string;
  config_json: string;
  created_at: string;
  expires_at: string | null;
  destroyed_at: string | null;
}

interface ResourceRow extends Record<string, unknown> {
  id: string;
  sandbox_id: string;
  provider: string;
  service: string;
  resource_type: string;
  external_id: string | null;
  name: string | null;
  region: string | null;
  state: string | null;
  fidelity: string;
  tags_json: string;
  parent_ids_json: string;
  raw_json: string | null;
  discovered_at: string;
}

interface OperationRow extends Record<string, unknown> {
  id: string;
  sandbox_id: string | null;
  actor_id: string;
  idempotency_key: string | null;
  operation: string;
  risk_level: string;
  policy_decision: string;
  approval_id: string | null;
  input_digest: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  result_json: string | null;
}

interface PromotionRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  source_sandbox_id: string | null;
  target_environment: string;
  plan_digest: string;
  evidence_bundle_id: string;
  status: string;
  approval_id: string | null;
  created_at: string;
  applied_at: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface BeginOperationInput {
  id: string;
  sandboxId?: string | null;
  actorId: string;
  idempotencyKey?: string | null;
  operation: string;
  riskLevel: RiskLevel;
  policyDecision: string;
  approvalId?: string | null;
  inputDigest?: string | null;
  startedAt?: string;
}

export interface BeginOperationResult {
  operation: CloudOperationRecord;
  /** True when an earlier call already claimed this idempotency key. */
  deduplicated: boolean;
}

export class CloudSandboxDbStore {
  private db: Database;
  private readonly dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const dir = join(getConfigDir(), "cloud");
      mkdirSync(dir, { recursive: true });
      this.dbPath = join(dir, "cloud-sandbox.sqlite3");
    }

    this.db = new Database(this.dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    try {
      this.migrate();
    } catch (err) {
      // A refused open must not leave a handle behind: WAL has already created -wal/-shm
      // siblings, and an open handle makes the caller's cleanup fail with EBUSY on Windows.
      this.db.close();
      throw err;
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getSchemaVersion(): number {
    const row = this.db.query("PRAGMA user_version").get() as { user_version: number } | null;
    return row?.user_version ?? 0;
  }

  /**
   * Additive only, matching the central store's rule that a migration never rewrites prior
   * data. A database stamped newer than this build refuses to open rather than being
   * silently half-migrated by an older binary.
   */
  private migrate(): void {
    const current = this.getSchemaVersion();
    if (current > CLOUD_SANDBOX_SCHEMA_VERSION) {
      throw new Error(
        `cloud-sandbox.sqlite3 is at schema v${current} but this build only understands ` +
          `v${CLOUD_SANDBOX_SCHEMA_VERSION}; refusing to open a newer database.`,
      );
    }
    if (current === CLOUD_SANDBOX_SCHEMA_VERSION) return;

    this.db.exec("BEGIN");
    try {
      if (current < 1) this.db.exec(SCHEMA_V1);
      this.db.exec(`PRAGMA user_version = ${CLOUD_SANDBOX_SCHEMA_VERSION}`);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  // ---- sandboxes ----

  insertSandbox(record: CloudSandboxRecord): void {
    this.db
      .query(
        `INSERT INTO cloud_sandboxes (
           id, workspace_id, task_id, run_id, actor_id, provider, adapter, profile,
           status, endpoint_json, config_json, created_at, expires_at, destroyed_at
         ) VALUES (
           $id, $workspace_id, $task_id, $run_id, $actor_id, $provider, $adapter, $profile,
           $status, $endpoint_json, $config_json, $created_at, $expires_at, $destroyed_at
         )`,
      )
      .run({
        $id: record.id,
        $workspace_id: record.workspaceId,
        $task_id: record.taskId,
        $run_id: record.runId,
        $actor_id: record.actorId,
        $provider: record.provider,
        $adapter: record.adapter,
        $profile: record.profile,
        $status: record.status,
        $endpoint_json: JSON.stringify(record.endpoints),
        $config_json: JSON.stringify(record.config),
        $created_at: record.createdAt,
        $expires_at: record.expiresAt,
        $destroyed_at: record.destroyedAt,
      });
  }

  getSandbox(id: string): CloudSandboxRecord | null {
    const row = this.db
      .query("SELECT * FROM cloud_sandboxes WHERE id = ?")
      .get(id) as SandboxRow | null;
    return row ? this.mapSandbox(row) : null;
  }

  listSandboxes(workspaceId?: string, limit = 100): CloudSandboxRecord[] {
    const rows = workspaceId
      ? (this.db
          .query(
            "SELECT * FROM cloud_sandboxes WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(workspaceId, limit) as SandboxRow[])
      : (this.db
          .query("SELECT * FROM cloud_sandboxes ORDER BY created_at DESC LIMIT ?")
          .all(limit) as SandboxRow[]);
    return rows.map((row) => this.mapSandbox(row));
  }

  updateSandboxStatus(id: string, status: SandboxStatus): boolean {
    const res = this.db
      .query("UPDATE cloud_sandboxes SET status = ? WHERE id = ?")
      .run(status, id);
    return res.changes > 0;
  }

  setSandboxEndpoints(id: string, endpoints: CloudEndpointSet): boolean {
    const res = this.db
      .query("UPDATE cloud_sandboxes SET endpoint_json = ? WHERE id = ?")
      .run(JSON.stringify(endpoints), id);
    return res.changes > 0;
  }

  extendSandboxExpiry(id: string, expiresAt: string): boolean {
    const res = this.db
      .query("UPDATE cloud_sandboxes SET expires_at = ? WHERE id = ? AND destroyed_at IS NULL")
      .run(expiresAt, id);
    return res.changes > 0;
  }

  /** Source spec §46: the cleanup controller works from expiry, not from a timer it owns. */
  listExpiredSandboxes(now: string = new Date().toISOString()): CloudSandboxRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM cloud_sandboxes
         WHERE destroyed_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
         ORDER BY expires_at ASC`,
      )
      .all(now) as SandboxRow[];
    return rows.map((row) => this.mapSandbox(row));
  }

  markSandboxDestroyed(id: string, destroyedAt: string = new Date().toISOString()): boolean {
    const res = this.db
      .query("UPDATE cloud_sandboxes SET status = 'destroyed', destroyed_at = ? WHERE id = ?")
      .run(destroyedAt, id);
    return res.changes > 0;
  }

  private mapSandbox(row: SandboxRow): CloudSandboxRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      taskId: row.task_id,
      runId: row.run_id,
      actorId: row.actor_id,
      provider: row.provider as CloudProvider,
      adapter: row.adapter,
      profile: row.profile as SandboxProfile,
      status: row.status as SandboxStatus,
      endpoints: parseJson<CloudEndpointSet>(row.endpoint_json, {
        base: "",
        region: "",
        services: {},
      }),
      config: parseJson<SandboxConfig>(row.config_json, {
        services: [],
        storageMode: "memory",
        ttlMinutes: 0,
      }),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      destroyedAt: row.destroyed_at,
    };
  }

  // ---- resources ----

  upsertResource(resource: CloudResource): void {
    this.db
      .query(
        `INSERT INTO cloud_resources (
           id, sandbox_id, provider, service, resource_type, external_id, name, region,
           state, fidelity, tags_json, parent_ids_json, raw_json, discovered_at
         ) VALUES (
           $id, $sandbox_id, $provider, $service, $resource_type, $external_id, $name, $region,
           $state, $fidelity, $tags_json, $parent_ids_json, $raw_json, $discovered_at
         )
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           fidelity = excluded.fidelity,
           tags_json = excluded.tags_json,
           parent_ids_json = excluded.parent_ids_json,
           raw_json = excluded.raw_json,
           discovered_at = excluded.discovered_at`,
      )
      .run({
        $id: resource.id,
        $sandbox_id: resource.sandboxId,
        $provider: resource.provider,
        $service: resource.service,
        $resource_type: resource.type,
        $external_id: resource.externalId ?? null,
        $name: resource.name ?? null,
        $region: resource.region ?? null,
        $state: resource.state,
        $fidelity: resource.fidelity,
        $tags_json: JSON.stringify(resource.tags),
        $parent_ids_json: JSON.stringify(resource.parentIds),
        $raw_json: resource.raw === undefined ? null : JSON.stringify(resource.raw),
        $discovered_at: resource.discoveredAt,
      });
  }

  listResources(sandboxId: string, service?: string): CloudResource[] {
    const rows = service
      ? (this.db
          .query("SELECT * FROM cloud_resources WHERE sandbox_id = ? AND service = ? ORDER BY service, id")
          .all(sandboxId, service) as ResourceRow[])
      : (this.db
          .query("SELECT * FROM cloud_resources WHERE sandbox_id = ? ORDER BY service, id")
          .all(sandboxId) as ResourceRow[]);
    return rows.map((row) => this.mapResource(row));
  }

  deleteResourcesForSandbox(sandboxId: string): number {
    return this.db
      .query("DELETE FROM cloud_resources WHERE sandbox_id = ?")
      .run(sandboxId).changes;
  }

  private mapResource(row: ResourceRow): CloudResource {
    return {
      id: row.id,
      sandboxId: row.sandbox_id,
      provider: row.provider as CloudProvider,
      service: row.service,
      type: row.resource_type,
      externalId: row.external_id ?? undefined,
      name: row.name ?? undefined,
      region: row.region ?? undefined,
      state: row.state ?? "unknown",
      fidelity: row.fidelity as ServiceFidelity,
      tags: parseJson<Record<string, string>>(row.tags_json, {}),
      parentIds: parseJson<string[]>(row.parent_ids_json, []),
      discoveredAt: row.discovered_at,
      raw: row.raw_json === null ? undefined : parseJson<unknown>(row.raw_json, undefined),
    };
  }

  // ---- operations ----

  /**
   * Source spec §60: idempotency is a database fence, not an application convention.
   *
   * The UNIQUE index on `idempotency_key` is what actually stops an agent retry from
   * provisioning a second environment. A check-then-insert in TypeScript would race, and
   * the failure mode is a leaked sandbox the caller believes is the one it already made.
   */
  beginOperation(input: BeginOperationInput): BeginOperationResult {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const key = input.idempotencyKey ?? null;

    if (key !== null) {
      this.db
        .query(
          `INSERT INTO cloud_operations (
             id, sandbox_id, actor_id, idempotency_key, operation, risk_level,
             policy_decision, approval_id, input_digest, status, started_at
           ) VALUES (
             $id, $sandbox_id, $actor_id, $idempotency_key, $operation, $risk_level,
             $policy_decision, $approval_id, $input_digest, 'running', $started_at
           )
           ON CONFLICT(idempotency_key) DO NOTHING`,
        )
        .run({
          $id: input.id,
          $sandbox_id: input.sandboxId ?? null,
          $actor_id: input.actorId,
          $idempotency_key: key,
          $operation: input.operation,
          $risk_level: input.riskLevel,
          $policy_decision: input.policyDecision,
          $approval_id: input.approvalId ?? null,
          $input_digest: input.inputDigest ?? null,
          $started_at: startedAt,
        });

      const existing = this.findOperationByIdempotencyKey(key);
      if (existing) {
        return { operation: existing, deduplicated: existing.id !== input.id };
      }
    } else {
      this.db
        .query(
          `INSERT INTO cloud_operations (
             id, sandbox_id, actor_id, idempotency_key, operation, risk_level,
             policy_decision, approval_id, input_digest, status, started_at
           ) VALUES (
             $id, $sandbox_id, $actor_id, NULL, $operation, $risk_level,
             $policy_decision, $approval_id, $input_digest, 'running', $started_at
           )`,
        )
        .run({
          $id: input.id,
          $sandbox_id: input.sandboxId ?? null,
          $actor_id: input.actorId,
          $operation: input.operation,
          $risk_level: input.riskLevel,
          $policy_decision: input.policyDecision,
          $approval_id: input.approvalId ?? null,
          $input_digest: input.inputDigest ?? null,
          $started_at: startedAt,
        });
    }

    const created = this.getOperation(input.id);
    if (!created) {
      throw new Error(`beginOperation inserted ${input.id} but it cannot be read back`);
    }
    return { operation: created, deduplicated: false };
  }

  getOperation(id: string): CloudOperationRecord | null {
    const row = this.db
      .query("SELECT * FROM cloud_operations WHERE id = ?")
      .get(id) as OperationRow | null;
    return row ? this.mapOperation(row) : null;
  }

  findOperationByIdempotencyKey(key: string): CloudOperationRecord | null {
    const row = this.db
      .query("SELECT * FROM cloud_operations WHERE idempotency_key = ?")
      .get(key) as OperationRow | null;
    return row ? this.mapOperation(row) : null;
  }

  finishOperation(id: string, status: OperationStatus, result: unknown): boolean {
    const res = this.db
      .query(
        "UPDATE cloud_operations SET status = ?, finished_at = ?, result_json = ? WHERE id = ?",
      )
      .run(status, new Date().toISOString(), JSON.stringify(result ?? null), id);
    return res.changes > 0;
  }

  listOperations(sandboxId: string, limit = 100): CloudOperationRecord[] {
    const rows = this.db
      .query(
        "SELECT * FROM cloud_operations WHERE sandbox_id = ? ORDER BY started_at DESC LIMIT ?",
      )
      .all(sandboxId, limit) as OperationRow[];
    return rows.map((row) => this.mapOperation(row));
  }

  private mapOperation(row: OperationRow): CloudOperationRecord {
    return {
      id: row.id,
      sandboxId: row.sandbox_id,
      actorId: row.actor_id,
      idempotencyKey: row.idempotency_key,
      operation: row.operation,
      riskLevel: row.risk_level as RiskLevel,
      policyDecision: row.policy_decision,
      approvalId: row.approval_id,
      inputDigest: row.input_digest,
      status: row.status as OperationStatus,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      result: parseJson<unknown>(row.result_json, null),
    };
  }

  // ---- promotions ----

  insertPromotion(record: CloudPromotionRecord): void {
    this.db
      .query(
        `INSERT INTO cloud_promotions (
           id, workspace_id, source_sandbox_id, target_environment, plan_digest,
           evidence_bundle_id, status, approval_id, created_at, applied_at
         ) VALUES (
           $id, $workspace_id, $source_sandbox_id, $target_environment, $plan_digest,
           $evidence_bundle_id, $status, $approval_id, $created_at, $applied_at
         )`,
      )
      .run({
        $id: record.id,
        $workspace_id: record.workspaceId,
        $source_sandbox_id: record.sourceSandboxId,
        $target_environment: record.targetEnvironment,
        $plan_digest: record.planDigest,
        $evidence_bundle_id: record.evidenceBundleId,
        $status: record.status,
        $approval_id: record.approvalId,
        $created_at: record.createdAt,
        $applied_at: record.appliedAt,
      });
  }

  getPromotion(id: string): CloudPromotionRecord | null {
    const row = this.db
      .query("SELECT * FROM cloud_promotions WHERE id = ?")
      .get(id) as PromotionRow | null;
    return row ? this.mapPromotion(row) : null;
  }

  listPromotions(workspaceId: string, limit = 50): CloudPromotionRecord[] {
    const rows = this.db
      .query(
        "SELECT * FROM cloud_promotions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as PromotionRow[];
    return rows.map((row) => this.mapPromotion(row));
  }

  updatePromotionStatus(
    id: string,
    status: PromotionStatus,
    extra?: { approvalId?: string; appliedAt?: string },
  ): boolean {
    const res = this.db
      .query(
        `UPDATE cloud_promotions
         SET status = ?,
             approval_id = COALESCE(?, approval_id),
             applied_at = COALESCE(?, applied_at)
         WHERE id = ?`,
      )
      .run(status, extra?.approvalId ?? null, extra?.appliedAt ?? null, id);
    return res.changes > 0;
  }

  private mapPromotion(row: PromotionRow): CloudPromotionRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      sourceSandboxId: row.source_sandbox_id,
      targetEnvironment: row.target_environment as CloudPromotionRecord["targetEnvironment"],
      planDigest: row.plan_digest,
      evidenceBundleId: row.evidence_bundle_id,
      status: row.status as PromotionStatus,
      approvalId: row.approval_id,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
    };
  }
}
