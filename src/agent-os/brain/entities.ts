// Phase 20.5 — Knowledge Entities & Canonical Resolution

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { EntityType, KnowledgeEntity } from "./types";

export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "-");
}

export interface RegisterEntityInput {
  id?: string;
  entityType?: EntityType;
  kind?: string;
  canonicalName: string;
  slug?: string;
  aliases?: string[];
  description?: string;
  summary?: string;
  projectId?: string | null;
  status?: "active" | "archived" | "superseded";
  metadata?: Record<string, unknown>;
}

export function registerEntity(input: RegisterEntityInput): KnowledgeEntity {
  const db = openAgentOsDb();
  const canonicalName = input.canonicalName.trim();
  const entityType = (input.entityType ?? input.kind ?? "CONCEPT") as EntityType;
  const description = input.description ?? input.summary ?? "";
  const slug = input.slug ?? normalizeEntityName(canonicalName);
  const existing = resolveEntity(canonicalName) ?? (input.slug ? resolveEntity(input.slug) : null);

  const id = existing ? existing.id : (input.id ?? `ent_${randomUUID().slice(0, 10)}`);
  const now = new Date().toISOString();
  const aliases = Array.from(new Set([
    canonicalName,
    normalizeEntityName(canonicalName),
    slug,
    normalizeEntityName(slug),
    ...(input.aliases ?? []),
  ]));
  const metadata = { ...(input.metadata ?? existing?.metadata ?? {}), slug };

  db.query(`
    INSERT INTO knowledge_entities (
      id, entity_type, canonical_name, aliases_json, description,
      project_id, status, created_at, updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      aliases_json = excluded.aliases_json,
      description = excluded.description,
      project_id = excluded.project_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      metadata_json = excluded.metadata_json
  `).run(
    id,
    entityType,
    canonicalName,
    JSON.stringify(aliases),
    description || existing?.description || "",
    input.projectId ?? existing?.projectId ?? null,
    input.status ?? existing?.status ?? "active",
    existing ? existing.createdAt : now,
    now,
    JSON.stringify(metadata),
  );

  // Sync alias table
  for (const alias of aliases) {
    const normAlias = normalizeEntityName(alias);
    db.query(`
      INSERT INTO entity_aliases (alias, entity_id)
      VALUES (?, ?)
      ON CONFLICT(alias, entity_id) DO NOTHING
    `).run(normAlias, id);
    db.query(`
      INSERT INTO entity_aliases (alias, entity_id)
      VALUES (?, ?)
      ON CONFLICT(alias, entity_id) DO NOTHING
    `).run(alias.toLowerCase(), id);
  }

  return getEntity(id)!;
}

export function getEntity(idOrNameOrAlias: string): KnowledgeEntity | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_entities WHERE id = ?").get(idOrNameOrAlias) as Record<string, unknown> | undefined;
  if (row) return mapEntityRow(row);
  return resolveEntity(idOrNameOrAlias);
}

export function resolveEntity(nameOrAlias: string): KnowledgeEntity | null {
  const trimmed = nameOrAlias.trim();
  if (!trimmed) return null;

  const db = openAgentOsDb();
  // 1. Direct ID match
  const byId = db.query("SELECT * FROM knowledge_entities WHERE id = ?").get(trimmed) as Record<string, unknown> | undefined;
  if (byId) return mapEntityRow(byId);

  // 2. Direct canonical match (case-insensitive)
  const direct = db
    .query("SELECT * FROM knowledge_entities WHERE LOWER(canonical_name) = LOWER(?) LIMIT 1")
    .get(trimmed) as Record<string, unknown> | undefined;
  if (direct) return mapEntityRow(direct);

  // 3. Metadata slug match
  const bySlug = db
    .query("SELECT * FROM knowledge_entities WHERE json_extract(metadata_json, '$.slug') = ? OR LOWER(json_extract(metadata_json, '$.slug')) = LOWER(?) LIMIT 1")
    .get(trimmed, trimmed) as Record<string, unknown> | undefined;
  if (bySlug) return mapEntityRow(bySlug);

  // 4. Normalized alias match
  const norm = normalizeEntityName(trimmed);
  const aliasMatch = db
    .query(`
      SELECT ke.* FROM knowledge_entities ke
      JOIN entity_aliases ea ON ke.id = ea.entity_id
      WHERE ea.alias = ? OR ea.alias = ? OR ea.alias = ?
      LIMIT 1
    `)
    .get(trimmed.toLowerCase(), norm, trimmed) as Record<string, unknown> | undefined;

  if (aliasMatch) return mapEntityRow(aliasMatch);

  return null;
}

export function listEntities(filters?: {
  entityType?: EntityType;
  projectId?: string | null;
  status?: string;
  limit?: number;
}): KnowledgeEntity[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM knowledge_entities WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.entityType) {
    sql += " AND entity_type = ?";
    bindings.push(filters.entityType);
  }
  if (filters?.projectId !== undefined) {
    if (filters.projectId === null) {
      sql += " AND project_id IS NULL";
    } else {
      sql += " AND project_id = ?";
      bindings.push(filters.projectId);
    }
  }
  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY canonical_name ASC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapEntityRow);
}

function mapEntityRow(row: Record<string, unknown>): KnowledgeEntity {
  const metadata = row.metadata_json ? JSON.parse(String(row.metadata_json)) : {};
  const canonicalName = String(row.canonical_name);
  const entityType = row.entity_type as EntityType;
  const description = String(row.description ?? "");

  return {
    id: String(row.id),
    entityType,
    canonicalName,
    aliases: row.aliases_json ? JSON.parse(String(row.aliases_json)) : [],
    description,
    projectId: row.project_id ? String(row.project_id) : null,
    status: (row.status as KnowledgeEntity["status"]) ?? "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata,
    canonical_name: canonicalName,
    kind: entityType,
    summary: description,
    slug: metadata.slug ?? normalizeEntityName(canonicalName),
  };
}
