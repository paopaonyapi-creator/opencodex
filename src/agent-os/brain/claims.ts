// Phase 20.5 — Knowledge Claims & Provenance

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { getEntity, registerEntity } from "./entities";
import type { ClaimProvenance, ClaimStatus, ClaimType, KnowledgeClaim } from "./types";

export interface CreateClaimInput {
  id?: string;
  subjectEntityId?: string;
  subjectEntity?: string;
  predicate: string;
  objectValue: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  confidence?: number;
  sourcePriority?: number;
  validFrom?: string | null;
  validTo?: string | null;
  metadata?: Record<string, unknown>;
  provenanceChunkId?: string;
  provenance?: {
    sourceVersionId: string;
    chunkId?: string | null;
    anchor?: string;
    extractor?: string;
  };
}

export function createClaim(input: CreateClaimInput): KnowledgeClaim {
  const db = openAgentOsDb();
  const id = input.id ?? `clm_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const claimType = input.claimType ?? "FACT";
  const status = input.status ?? "ACTIVE";
  const confidence = input.confidence ?? 1.0;
  const sourcePriority = input.sourcePriority ?? 5;

  // Resolve subject entity
  let subjectEntityId = input.subjectEntityId;
  if (!subjectEntityId && input.subjectEntity) {
    const existing = getEntity(input.subjectEntity);
    if (existing) {
      subjectEntityId = existing.id;
    } else {
      const created = registerEntity({
        canonicalName: input.subjectEntity,
        entityType: "CONCEPT",
      });
      subjectEntityId = created.id;
    }
  }
  if (!subjectEntityId) {
    throw new Error("createClaim: subjectEntityId or subjectEntity must be provided");
  }

  // Resolve provenance
  let sourceVersionId = input.provenance?.sourceVersionId;
  let chunkId = input.provenance?.chunkId ?? input.provenanceChunkId ?? null;
  let anchor = input.provenance?.anchor ?? "";
  let extractor = input.provenance?.extractor ?? "deterministic";

  if (input.provenanceChunkId && !sourceVersionId) {
    const chunkRow = db.query("SELECT * FROM source_chunks WHERE id = ?").get(input.provenanceChunkId) as Record<string, unknown> | undefined;
    if (chunkRow) {
      sourceVersionId = String(chunkRow.source_version_id);
      chunkId = String(chunkRow.id);
      if (!anchor) anchor = String(chunkRow.section_path ?? "");
    }
  }

  // Ensure source version exists in DB if foreign key needed
  if (!sourceVersionId) {
    const defaultVer = db.query("SELECT id FROM source_versions ORDER BY ingested_at DESC LIMIT 1").get() as { id: string } | undefined;
    if (defaultVer) {
      sourceVersionId = defaultVer.id;
    } else {
      // Create a fallback source & version
      const fallbackSrcId = `src_default_${randomUUID().slice(0, 8)}`;
      sourceVersionId = `ver_default_${randomUUID().slice(0, 8)}`;
      db.query(`
        INSERT INTO knowledge_sources (id, source_type, title, uri_or_path, owner, access_scope, enabled, canonicality, fingerprint, status, created_at, updated_at, metadata_json)
        VALUES (?, 'PROJECT', 'Default Knowledge Source', 'internal://default', 'local', 'internal', 1, 'canonical', '', 'INDEXED', ?, ?, '{}')
      `).run(fallbackSrcId, now, now);
      db.query(`
        INSERT INTO source_versions (id, source_id, version_number, content_hash, size_bytes, parser_version, status, ingested_at, metadata_json)
        VALUES (?, ?, 1, '', 0, '1.0.0', 'INDEXED', ?, '{}')
      `).run(sourceVersionId, fallbackSrcId, now);
    }
  } else {
    // Check if sourceVersionId actually exists in source_versions
    const verCheck = db.query("SELECT id FROM source_versions WHERE id = ?").get(sourceVersionId) as { id: string } | undefined;
    if (!verCheck) {
      // Register stub source and version
      const fallbackSrcId = `src_${sourceVersionId}`;
      db.query(`
        INSERT INTO knowledge_sources (id, source_type, title, uri_or_path, owner, access_scope, enabled, canonicality, fingerprint, status, created_at, updated_at, metadata_json)
        VALUES (?, 'PROJECT', ?, ?, 'local', 'internal', 1, 'canonical', '', 'INDEXED', ?, ?, '{}')
        ON CONFLICT(id) DO NOTHING
      `).run(fallbackSrcId, sourceVersionId, `internal://${sourceVersionId}`, now, now);
      db.query(`
        INSERT INTO source_versions (id, source_id, version_number, content_hash, size_bytes, parser_version, status, ingested_at, metadata_json)
        VALUES (?, ?, 1, '', 0, '1.0.0', 'INDEXED', ?, '{}')
        ON CONFLICT(id) DO NOTHING
      `).run(sourceVersionId, fallbackSrcId, now);
    }
  }

  db.exec("BEGIN");
  try {
    db.query(`
      INSERT INTO knowledge_claims (
        id, subject_entity_id, predicate, object_value, claim_type,
        status, confidence, source_priority, valid_from, valid_to,
        created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        object_value = excluded.object_value,
        claim_type = excluded.claim_type,
        status = excluded.status,
        confidence = excluded.confidence,
        source_priority = excluded.source_priority,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      id,
      subjectEntityId,
      input.predicate,
      input.objectValue,
      claimType,
      status,
      confidence,
      sourcePriority,
      input.validFrom ?? null,
      input.validTo ?? null,
      now,
      now,
      JSON.stringify(input.metadata ?? {}),
    );

    // Provenance link
    const provId = `prv_${randomUUID().slice(0, 10)}`;
    db.query(`
      INSERT INTO claim_provenance (
        id, claim_id, source_version_id, chunk_id, anchor, extractor, extracted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      provId,
      id,
      sourceVersionId,
      chunkId,
      anchor,
      extractor,
      now,
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getClaim(id)!;
}

export function getClaim(id: string): KnowledgeClaim | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_claims WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const claim = mapClaimRow(row);
  const provRows = db.query(`
    SELECT cp.*,
           ks.title as source_title,
           sc.section_path as chunk_heading
    FROM claim_provenance cp
    LEFT JOIN source_versions sv ON cp.source_version_id = sv.id
    LEFT JOIN knowledge_sources ks ON sv.source_id = ks.id
    LEFT JOIN source_chunks sc ON cp.chunk_id = sc.id
    WHERE cp.claim_id = ?
  `).all(id) as Record<string, unknown>[];

  const provList = provRows.map(mapProvenanceRow);
  if (provRows.length > 0) {
    const first = provRows[0]!;
    Object.assign(provList, {
      source_title: String(first.source_title ?? ""),
      chunk_heading: String(first.chunk_heading ?? ""),
    });
  }
  claim.provenance = provList as any;
  return claim;
}

export function listClaims(filters?: {
  subjectEntityId?: string;
  predicate?: string;
  status?: ClaimStatus;
  claimType?: ClaimType;
  limit?: number;
}): KnowledgeClaim[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM knowledge_claims WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.subjectEntityId) {
    sql += " AND subject_entity_id = ?";
    bindings.push(filters.subjectEntityId);
  }
  if (filters?.predicate) {
    sql += " AND predicate = ?";
    bindings.push(filters.predicate);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }
  if (filters?.claimType) {
    sql += " AND claim_type = ?";
    bindings.push(filters.claimType);
  }

  sql += " ORDER BY updated_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map((r) => {
    const clm = mapClaimRow(r);
    const provRows = db.query("SELECT * FROM claim_provenance WHERE claim_id = ?").all(clm.id) as Record<string, unknown>[];
    clm.provenance = provRows.map(mapProvenanceRow);
    return clm;
  });
}

export function updateClaimStatus(claimId: string, newStatus: ClaimStatus, reason?: string): boolean {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const res = db.query(`
    UPDATE knowledge_claims
    SET status = ?, updated_at = ?,
        metadata_json = json_set(metadata_json, '$.statusReason', ?, '$.statusUpdatedAt', ?)
    WHERE id = ?
  `).run(newStatus, now, reason ?? "", now, claimId);
  return res.changes > 0;
}

function mapClaimRow(row: Record<string, unknown>): KnowledgeClaim {
  return {
    id: String(row.id),
    subjectEntityId: String(row.subject_entity_id),
    predicate: String(row.predicate),
    objectValue: String(row.object_value),
    claimType: row.claim_type as ClaimType,
    status: row.status as ClaimStatus,
    confidence: Number(row.confidence),
    sourcePriority: Number(row.source_priority),
    validFrom: row.valid_from ? String(row.valid_from) : null,
    validTo: row.valid_to ? String(row.valid_to) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}

function mapProvenanceRow(row: Record<string, unknown>): ClaimProvenance {
  return {
    id: String(row.id),
    claimId: String(row.claim_id),
    sourceVersionId: String(row.source_version_id),
    chunkId: row.chunk_id ? String(row.chunk_id) : null,
    anchor: String(row.anchor ?? ""),
    extractor: String(row.extractor ?? "deterministic"),
    extractedAt: String(row.extracted_at),
  };
}
