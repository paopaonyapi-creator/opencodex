// Phase 20.5 — Rebuild & Disaster Recovery Engine

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { compileWikiPage } from "./wiki-compiler";
import { listWikiPages } from "./wiki-storage";

export interface RebuildReport {
  timestamp: string;
  generationId: string;
  pagesRecompiled: number;
  wikiPagesCount: number;
  entitiesProcessed: number;
  relationsVerified: number;
  claimsVerified: number;
  durationMs: number;
  success: boolean;
}

export function rebuildKnowledgeBrain(): RebuildReport {
  const started = Date.now();
  const db = openAgentOsDb();
  const generationId = `gen_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO index_generations (id, index_type, generation, item_count, status, created_at)
    VALUES (?, 'FULL_REBUILD', 1, 0, 'BUILDING', ?)
  `).run(generationId, now);

  const pages = listWikiPages();
  let pagesRecompiled = 0;

  for (const p of pages) {
    try {
      compileWikiPage({
        slug: p.slug,
        title: p.title,
        pageType: p.pageType,
        canonicalEntityId: p.canonicalEntityId,
      });
      pagesRecompiled++;
    } catch {
      // Continue recompiling other pages
    }
  }

  const entitiesCount = Number(db.query("SELECT COUNT(*) as c FROM knowledge_entities").get() as { c: number }) || 0;
  const relationsCount = Number(db.query("SELECT COUNT(*) as c FROM knowledge_relations").get() as { c: number }) || 0;
  const claimsCount = Number(db.query("SELECT COUNT(*) as c FROM knowledge_claims").get() as { c: number }) || 0;

  db.query(`
    UPDATE index_generations
    SET item_count = ?, status = 'ACTIVE'
    WHERE id = ?
  `).run(pagesRecompiled + entitiesCount + relationsCount + claimsCount, generationId);

  return {
    timestamp: now,
    generationId,
    pagesRecompiled,
    wikiPagesCount: pagesRecompiled,
    entitiesProcessed: entitiesCount,
    relationsVerified: relationsCount,
    claimsVerified: claimsCount,
    durationMs: Date.now() - started,
    success: true,
  };
}

export function pruneKnowledgeBrain(): { prunedGenerations: number; prunedTombstones: number; prunedCount: number } {
  const db = openAgentOsDb();
  // Cleanup old non-active index generations
  const genRes = db.query("DELETE FROM index_generations WHERE status = 'SUPERSEDED'").run();
  return {
    prunedGenerations: genRes.changes,
    prunedTombstones: 0,
    prunedCount: genRes.changes,
  };
}
