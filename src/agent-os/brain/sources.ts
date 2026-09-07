// Phase 20.5 — Knowledge Sources Registry & Fingerprinting

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { openAgentOsDb } from "../db";
import type { IngestionState, KnowledgeSource, SourceType, SourceVersion } from "./types";

export const SECRET_PATTERNS = [
  /^.env$/i,
  /\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /^credentials\.json$/i,
  /^secrets?\./i,
  /id_rsa/i,
  /id_ed25519/i,
  /bearer_token/i,
  /admin-api-token/i,
];

export function isSecretPath(filePath?: string | null): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return SECRET_PATTERNS.some((pattern) => pattern.test(fileName));
}

export function computeContentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeSourceFingerprint(params: {
  uriOrPath: string;
  contentHash: string;
  sizeBytes?: number;
  commitSha?: string;
  eTag?: string;
}): string {
  const parts = [
    params.uriOrPath,
    params.contentHash,
    String(params.sizeBytes ?? 0),
    params.commitSha ?? "",
    params.eTag ?? "",
  ];
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

export interface RegisterSourceInput {
  id?: string;
  sourceType?: SourceType;
  domain?: string;
  tier?: string;
  title?: string;
  uriOrPath?: string;
  sourcePath?: string;
  content?: string | Buffer;
  projectId?: string | null;
  owner?: string;
  accessScope?: "public" | "internal" | "restricted" | "secret";
  canonicality?: "canonical" | "derived" | "unverified";
  metadata?: Record<string, unknown>;
}

export interface RegisterSourceResponse extends KnowledgeSource {
  status: "NEW" | "UNCHANGED" | "UPDATED" | "EXCLUDED" | IngestionState;
  source: KnowledgeSource & { current_fingerprint?: string; current_version?: number };
  version?: SourceVersion;
}

export function registerSource(input: RegisterSourceInput): RegisterSourceResponse {
  const uriOrPath = input.uriOrPath ?? input.sourcePath ?? "";
  const title = input.title ?? input.sourcePath ?? uriOrPath;
  const sourceType = (input.sourceType ?? input.domain ?? "PROJECT") as SourceType;
  const canonicality = (input.canonicality ?? (input.tier?.toLowerCase() === "canonical" ? "canonical" : "derived")) as KnowledgeSource["canonicality"];

  if (isSecretPath(uriOrPath)) {
    const dummyExcluded: KnowledgeSource = {
      id: `src_excluded_${randomUUID().slice(0, 8)}`,
      sourceType,
      title,
      uriOrPath,
      projectId: null,
      owner: "local",
      accessScope: "secret",
      enabled: false,
      canonicality: "unverified",
      fingerprint: "",
      status: "EXCLUDED" as any,
      lastIngestedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };
    return Object.assign(dummyExcluded, {
      status: "EXCLUDED" as const,
      source: {
        ...dummyExcluded,
        current_fingerprint: "",
        current_version: 0,
      },
    });
  }

  const db = openAgentOsDb();
  const existingByUri = getSourceByUri(uriOrPath);
  const id = existingByUri?.id ?? input.id ?? `src_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const owner = input.owner ?? existingByUri?.owner ?? "local";
  const accessScope = input.accessScope ?? existingByUri?.accessScope ?? "internal";
  const metadata = input.metadata ?? existingByUri?.metadata ?? {};

  db.query(`
    INSERT INTO knowledge_sources (
      id, source_type, title, uri_or_path, project_id, owner, access_scope,
      enabled, canonicality, fingerprint, status, created_at, updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '', 'DISCOVERED', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      uri_or_path = excluded.uri_or_path,
      project_id = excluded.project_id,
      access_scope = excluded.access_scope,
      canonicality = excluded.canonicality,
      updated_at = excluded.updated_at,
      metadata_json = excluded.metadata_json
  `).run(
    id,
    sourceType,
    title,
    uriOrPath,
    input.projectId ?? existingByUri?.projectId ?? null,
    owner,
    accessScope,
    canonicality,
    existingByUri?.createdAt ?? now,
    now,
    JSON.stringify(metadata),
  );

  let source = getSource(id)!;
  let status: "NEW" | "UNCHANGED" | "UPDATED" = existingByUri ? "UNCHANGED" : "NEW";
  let version: SourceVersion | undefined;

  if (input.content !== undefined) {
    const prevVersion = getLatestSourceVersion(source.id);
    const versionRes = createSourceVersion({
      sourceId: source.id,
      content: input.content,
    });
    version = versionRes.version;
    if (prevVersion === null) {
      status = "NEW";
    } else if (versionRes.isNew) {
      status = "UPDATED";
    } else {
      status = "UNCHANGED";
    }
    source = getSource(id)!;
  }

  const latestVersion = version ?? getLatestSourceVersion(source.id);
  const enrichedSource = {
    ...source,
    current_fingerprint: source.fingerprint,
    current_version: latestVersion?.versionNumber ?? 1,
  };

  return Object.assign(source, {
    status,
    source: enrichedSource,
    version: latestVersion ?? undefined,
  });
}

export function getSource(id: string): KnowledgeSource | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapSourceRow(row);
}

export function getSourceByUri(uriOrPath: string): KnowledgeSource | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_sources WHERE uri_or_path = ?").get(uriOrPath) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapSourceRow(row);
}

export function listSources(filters?: {
  projectId?: string | null;
  sourceType?: SourceType;
  status?: IngestionState;
  limit?: number;
}): KnowledgeSource[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM knowledge_sources WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.projectId !== undefined) {
    if (filters.projectId === null) {
      sql += " AND project_id IS NULL";
    } else {
      sql += " AND project_id = ?";
      bindings.push(filters.projectId);
    }
  }
  if (filters?.sourceType) {
    sql += " AND source_type = ?";
    bindings.push(filters.sourceType);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY updated_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapSourceRow);
}

export function createSourceVersion(params: {
  sourceId: string;
  content: string | Buffer;
  modifiedAt?: string | null;
  parserVersion?: string;
  metadata?: Record<string, unknown>;
}): { version: SourceVersion; isNew: boolean } {
  const db = openAgentOsDb();
  const source = getSource(params.sourceId);
  if (!source) throw new Error(`Source ${params.sourceId} not found`);

  const contentHash = computeContentHash(params.content);
  const sizeBytes = typeof params.content === "string" ? Buffer.byteLength(params.content, "utf8") : params.content.length;
  const fingerprint = computeSourceFingerprint({
    uriOrPath: source.uriOrPath,
    contentHash,
    sizeBytes,
  });

  const latestVersion = getLatestSourceVersion(source.id);
  if (latestVersion && latestVersion.contentHash === contentHash && source.fingerprint === fingerprint) {
    return { version: latestVersion, isNew: false };
  }

  const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const versionId = `ver_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO source_versions (
      id, source_id, version_number, content_hash, size_bytes, parser_version,
      status, modified_at, ingested_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'INDEXED', ?, ?, ?)
  `).run(
    versionId,
    source.id,
    versionNumber,
    contentHash,
    sizeBytes,
    params.parserVersion ?? "1.0.0",
    params.modifiedAt ?? now,
    now,
    JSON.stringify(params.metadata ?? {}),
  );

  db.query(`
    UPDATE knowledge_sources
    SET fingerprint = ?, status = 'INDEXED', last_ingested_at = ?, updated_at = ?
    WHERE id = ?
  `).run(fingerprint, now, now, source.id);

  const row = db.query("SELECT * FROM source_versions WHERE id = ?").get(versionId) as Record<string, unknown>;
  return { version: mapSourceVersionRow(row), isNew: true };
}

export function getLatestSourceVersion(sourceId: string): SourceVersion | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM source_versions WHERE source_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(sourceId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapSourceVersionRow(row);
}

export function listSourceVersions(sourceId: string): SourceVersion[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM source_versions WHERE source_id = ? ORDER BY version_number DESC")
    .all(sourceId) as Record<string, unknown>[];
  return rows.map(mapSourceVersionRow);
}

export function tombstoneSource(sourceId: string, reason = "source deleted"): boolean {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const res = db.query(`
    UPDATE knowledge_sources
    SET status = 'TOMBSTONED', enabled = 0, updated_at = ?,
        metadata_json = json_set(metadata_json, '$.deletedReason', ?, '$.deletedAt', ?)
    WHERE id = ?
  `).run(now, reason, now, sourceId);

  if (res.changes > 0) {
    db.query(`
      UPDATE knowledge_claims
      SET status = 'STALE', updated_at = ?
      WHERE id IN (
        SELECT claim_id FROM claim_provenance cp
        JOIN source_versions sv ON cp.source_version_id = sv.id
        WHERE sv.source_id = ?
      )
    `).run(now, sourceId);
    return true;
  }
  return false;
}

function mapSourceRow(row: Record<string, unknown>): KnowledgeSource {
  return {
    id: String(row.id),
    sourceType: row.source_type as SourceType,
    title: String(row.title),
    uriOrPath: String(row.uri_or_path),
    projectId: row.project_id ? String(row.project_id) : null,
    owner: String(row.owner ?? "local"),
    accessScope: (row.access_scope as KnowledgeSource["accessScope"]) ?? "internal",
    enabled: Number(row.enabled) === 1,
    canonicality: (row.canonicality as KnowledgeSource["canonicality"]) ?? "canonical",
    fingerprint: String(row.fingerprint ?? ""),
    status: (row.status as IngestionState) ?? "DISCOVERED",
    lastIngestedAt: row.last_ingested_at ? String(row.last_ingested_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}

function mapSourceVersionRow(row: Record<string, unknown>): SourceVersion {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    versionNumber: Number(row.version_number),
    contentHash: String(row.content_hash),
    sizeBytes: Number(row.size_bytes),
    parserVersion: String(row.parser_version ?? "1.0.0"),
    status: String(row.status ?? "INDEXED"),
    modifiedAt: row.modified_at ? String(row.modified_at) : null,
    ingestedAt: String(row.ingested_at),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}
