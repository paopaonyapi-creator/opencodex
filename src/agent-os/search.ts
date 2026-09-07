// Phase 16-era global search over Agent OS metadata (metadata + exact text).
// Semantic/embedding search is deliberately out until a local model seam lands;
// results are honest about what was searched. Secrets are never stored here, so
// nothing can leak through results.

import { openAgentOsDb } from "./db";

export interface SearchHit {
  kind: "memory" | "skill" | "task" | "review" | "wiki" | "claim" | "entity";
  id: string;
  title: string;
  snippet: string;
}

export function searchAgentOs(query: string, limit = 20): SearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const like = `%${trimmed.replace(/[%_]/g, "!$&")}%`;
  const db = openAgentOsDb();
  const esc = (s: string | null | undefined, n = 120) => (s ?? "").length > n ? `${(s ?? "").slice(0, n)}...` : (s ?? "");
  const hits: SearchHit[] = [];

  // Phase 20.5: Living Wiki Pages
  const wikiPages = db
    .query("SELECT id, slug, title FROM wiki_pages WHERE title LIKE ? ESCAPE '!' OR slug LIKE ? ESCAPE '!' ORDER BY updated_at DESC LIMIT ?")
    .all(like, like, limit) as { id: string; slug: string; title: string }[];
  for (const wp of wikiPages) hits.push({ kind: "wiki", id: wp.slug, title: wp.title, snippet: `Wiki: ${wp.slug}` });

  // Phase 20.5: Knowledge Claims
  const claims = db
    .query(`
      SELECT kc.id, kc.predicate, kc.object_value, ke.canonical_name
      FROM knowledge_claims kc
      JOIN knowledge_entities ke ON kc.subject_entity_id = ke.id
      WHERE kc.predicate LIKE ? ESCAPE '!' OR kc.object_value LIKE ? ESCAPE '!' OR ke.canonical_name LIKE ? ESCAPE '!'
      ORDER BY kc.updated_at DESC LIMIT ?
    `)
    .all(like, like, like, limit) as { id: string; predicate: string; object_value: string; canonical_name: string }[];
  for (const c of claims) hits.push({ kind: "claim", id: c.id, title: `${c.canonical_name} → ${c.predicate}`, snippet: esc(c.object_value) });

  const memories = db
    .query("SELECT id, title, content FROM memories WHERE title LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!' ORDER BY updated_at DESC LIMIT ?")
    .all(like, like, limit) as { id: string; title: string; content: string }[];
  for (const m of memories) hits.push({ kind: "memory", id: m.id, title: m.title, snippet: esc(m.content) });
  const skills = db
    .query("SELECT id, name, description FROM skills WHERE name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' LIMIT ?")
    .all(like, like, limit) as { id: string; name: string; description: string }[];
  for (const s of skills) hits.push({ kind: "skill", id: s.id, title: s.name, snippet: esc(s.description) });
  const tasks = db
    .query("SELECT id, title, status FROM tasks WHERE title LIKE ? ESCAPE '!' ORDER BY updated_ms DESC LIMIT ?")
    .all(like, limit) as { id: string; title: string; status: string }[];
  for (const t of tasks) hits.push({ kind: "task", id: t.id, title: t.title, snippet: `status: ${t.status}` });
  const reviews = db
    .query("SELECT id, reviewer, subject_kind, subject_id, notes FROM reviews WHERE notes LIKE ? ESCAPE '!' OR reviewer LIKE ? ESCAPE '!' LIMIT ?")
    .all(like, like, limit) as { id: string; reviewer: string; subject_kind: string; subject_id: string; notes: string }[];
  for (const r of reviews) hits.push({ kind: "review", id: r.id, title: `${r.reviewer} → ${r.subject_kind}:${r.subject_id}`, snippet: esc(r.notes) });
  return hits.slice(0, limit);
}
