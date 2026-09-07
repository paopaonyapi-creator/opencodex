// Phase 20.5 — Hybrid Search Engine (Lexical + Entity + Freshness + Canonicality)

import { openAgentOsDb } from "../db";
import { assessFreshness } from "./freshness";
import type { SourceTrust } from "./types";

export interface BrainSearchHit {
  id: string;
  type: "wiki_page" | "claim" | "entity" | "source";
  kind?: "wiki" | "claim" | "entity" | "source" | string;
  title: string;
  summary: string;
  score: number;
  freshness: string;
  canonicality: string;
  sourceRefs: string[];
}

export function searchBrain(query: string, limit = 20): BrainSearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = openAgentOsDb();
  const hits: BrainSearchHit[] = [];
  const esc = (s: string | null | undefined, max = 150) => {
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}...` : s;
  };

  const like = `%${trimmed.replace(/[%_]/g, "!$&")}%`;
  const lowerQuery = trimmed.toLowerCase();

  // 1. Search Living Wiki Pages
  const wikiPages = db.query(`
    SELECT id, slug, title, page_type, status, updated_at
    FROM wiki_pages
    WHERE title LIKE ? ESCAPE '!' OR slug LIKE ? ESCAPE '!'
    LIMIT ?
  `).all(like, like, limit) as Array<{
    id: string; slug: string; title: string; page_type: string; status: string; updated_at: string;
  }>;

  for (const wp of wikiPages) {
    let score = 10;
    if (wp.title.toLowerCase().includes(lowerQuery)) score += 15;
    if (wp.slug.toLowerCase().includes(lowerQuery)) score += 10;
    if (wp.status === "CURRENT") score += 5;

    const fresh = assessFreshness(wp.updated_at, wp.page_type);
    hits.push({
      id: wp.id,
      type: "wiki_page",
      kind: "wiki",
      title: wp.title,
      summary: `[${wp.page_type}] Living Wiki page (${wp.slug})`,
      score,
      freshness: fresh.level,
      canonicality: wp.status === "CURRENT" ? "canonical" : "aging",
      sourceRefs: [`wiki:${wp.slug}`],
    });
  }

  // 2. Search Knowledge Claims
  const claims = db.query(`
    SELECT kc.id, kc.predicate, kc.object_value, kc.status, kc.confidence,
           kc.source_priority, kc.updated_at, ke.canonical_name as subject_name
    FROM knowledge_claims kc
    JOIN knowledge_entities ke ON kc.subject_entity_id = ke.id
    WHERE kc.predicate LIKE ? ESCAPE '!' OR kc.object_value LIKE ? ESCAPE '!' OR ke.canonical_name LIKE ? ESCAPE '!'
    ORDER BY kc.source_priority DESC, kc.updated_at DESC
    LIMIT ?
  `).all(like, like, like, limit) as Array<{
    id: string; predicate: string; object_value: string; status: string;
    confidence: number; source_priority: number; updated_at: string; subject_name: string;
  }>;

  for (const clm of claims) {
    let score = 8 + clm.source_priority;
    if (clm.status === "ACTIVE") score += 10;
    if (clm.subject_name.toLowerCase().includes(lowerQuery)) score += 10;
    if (clm.object_value.toLowerCase().includes(lowerQuery)) score += 8;

    const fresh = assessFreshness(clm.updated_at);
    hits.push({
      id: clm.id,
      type: "claim",
      kind: "claim",
      title: `${clm.subject_name} → ${clm.predicate}`,
      summary: esc(clm.object_value),
      score,
      freshness: fresh.level,
      canonicality: clm.status === "ACTIVE" ? "canonical" : "historical",
      sourceRefs: [`claim:${clm.id}`],
    });
  }

  // 3. Search Knowledge Entities
  const entities = db.query(`
    SELECT id, canonical_name, entity_type, aliases_json, description, status, updated_at
    FROM knowledge_entities
    WHERE canonical_name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' OR aliases_json LIKE ? ESCAPE '!'
    LIMIT ?
  `).all(like, like, like, limit) as Array<{
    id: string; canonical_name: string; entity_type: string; aliases_json: string; description: string; status: string; updated_at: string;
  }>;

  for (const ent of entities) {
    let score = 12;
    if (ent.canonical_name.toLowerCase() === lowerQuery) score += 20;
    else if (ent.canonical_name.toLowerCase().includes(lowerQuery)) score += 10;

    const fresh = assessFreshness(ent.updated_at);
    hits.push({
      id: ent.id,
      type: "entity",
      kind: "entity",
      title: ent.canonical_name,
      summary: esc(ent.description || `Entity of type ${ent.entity_type}`),
      score,
      freshness: fresh.level,
      canonicality: ent.status === "active" ? "canonical" : "archived",
      sourceRefs: [`entity:${ent.id}`],
    });
  }

  // 4. Search Knowledge Sources
  const sources = db.query(`
    SELECT id, title, uri_or_path, source_type, canonicality, updated_at
    FROM knowledge_sources
    WHERE title LIKE ? ESCAPE '!' OR uri_or_path LIKE ? ESCAPE '!'
    LIMIT ?
  `).all(like, like, limit) as Array<{
    id: string; title: string; uri_or_path: string; source_type: string; canonicality: string; updated_at: string;
  }>;

  for (const src of sources) {
    let score = 6;
    if (src.title.toLowerCase().includes(lowerQuery)) score += 10;
    if (src.canonicality === "canonical") score += 5;

    const fresh = assessFreshness(src.updated_at);
    hits.push({
      id: src.id,
      type: "source",
      kind: "source",
      title: src.title,
      summary: `${src.source_type} at ${src.uri_or_path}`,
      score,
      freshness: fresh.level,
      canonicality: src.canonicality,
      sourceRefs: [`source:${src.id}`],
    });
  }

  // Sort by final score descending
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
