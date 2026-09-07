// Phase 20.5 — Knowledge Relations

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { KnowledgeRelation, RelationType } from "./types";

export interface CreateRelationInput {
  id?: string;
  fromEntityId?: string;
  sourceEntityId?: string;
  relationType: RelationType;
  toEntityId?: string;
  targetEntityId?: string;
  sourceClaimIds?: string[];
  validFrom?: string | null;
  validTo?: string | null;
  status?: "ACTIVE" | "SUPERSEDED" | "HISTORICAL";
  metadata?: Record<string, unknown>;
}

export function createRelation(input: CreateRelationInput): KnowledgeRelation {
  const db = openAgentOsDb();
  const id = input.id ?? `rel_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const status = input.status ?? "ACTIVE";
  const claimIds = input.sourceClaimIds ?? [];
  const fromEntityId = input.fromEntityId ?? input.sourceEntityId;
  const toEntityId = input.toEntityId ?? input.targetEntityId;

  if (!fromEntityId || !toEntityId) {
    throw new Error("createRelation: fromEntityId/sourceEntityId and toEntityId/targetEntityId must be provided");
  }

  db.query(`
    INSERT INTO knowledge_relations (
      id, from_entity_id, relation_type, to_entity_id,
      source_claim_ids_json, valid_from, valid_to, status, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_claim_ids_json = excluded.source_claim_ids_json,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      status = excluded.status,
      metadata_json = excluded.metadata_json
  `).run(
    id,
    fromEntityId,
    input.relationType,
    toEntityId,
    JSON.stringify(claimIds),
    input.validFrom ?? null,
    input.validTo ?? null,
    status,
    now,
    JSON.stringify(input.metadata ?? {}),
  );

  return getRelation(id)!;
}

export function getRelation(id: string): KnowledgeRelation | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_relations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRelationRow(row);
}

export function listRelations(filters?: {
  fromEntityId?: string;
  toEntityId?: string;
  relationType?: RelationType;
  status?: string;
}): KnowledgeRelation[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM knowledge_relations WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.fromEntityId) {
    sql += " AND from_entity_id = ?";
    bindings.push(filters.fromEntityId);
  }
  if (filters?.toEntityId) {
    sql += " AND to_entity_id = ?";
    bindings.push(filters.toEntityId);
  }
  if (filters?.relationType) {
    sql += " AND relation_type = ?";
    bindings.push(filters.relationType);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY created_at DESC";
  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapRelationRow);
}

function mapRelationRow(row: Record<string, unknown>): KnowledgeRelation {
  return {
    id: String(row.id),
    fromEntityId: String(row.from_entity_id),
    relationType: row.relation_type as RelationType,
    toEntityId: String(row.to_entity_id),
    sourceClaimIds: row.source_claim_ids_json ? JSON.parse(String(row.source_claim_ids_json)) : [],
    validFrom: row.valid_from ? String(row.valid_from) : null,
    validTo: row.valid_to ? String(row.valid_to) : null,
    status: (row.status as KnowledgeRelation["status"]) ?? "ACTIVE",
    createdAt: String(row.created_at),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}
