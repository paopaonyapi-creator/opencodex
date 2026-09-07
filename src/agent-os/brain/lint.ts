// Phase 20.5 — Knowledge Base Linter & Health Monitor

import { openAgentOsDb } from "../db";
import { assessFreshness } from "./freshness";
import type { BrainHealth } from "./types";
import { getWikiPage, listWikiPages } from "./wiki-storage";

export interface LintIssue {
  rule: string;
  severity: "ERROR" | "WARN" | "INFO";
  targetId: string;
  targetType: "WIKI_PAGE" | "CLAIM" | "ENTITY" | "SOURCE";
  message: string;
}

export interface LintReport {
  timestamp: string;
  passed: boolean;
  score: number;
  healthScore: number;
  totalIssues: number;
  errorsCount: number;
  warningsCount: number;
  issues: LintIssue[];
}

export function runKnowledgeLint(): LintReport {
  const db = openAgentOsDb();
  const issues: LintIssue[] = [];

  // 1. Check for Active Claims without Provenance
  const claimsWithoutProv = db.query(`
    SELECT kc.id, kc.predicate, ke.canonical_name
    FROM knowledge_claims kc
    JOIN knowledge_entities ke ON kc.subject_entity_id = ke.id
    LEFT JOIN claim_provenance cp ON kc.id = cp.claim_id
    WHERE kc.status = 'ACTIVE' AND cp.id IS NULL
  `).all() as Array<{ id: string; predicate: string; canonical_name: string }>;

  for (const c of claimsWithoutProv) {
    issues.push({
      rule: "CLAIM_PROVENANCE_MISSING",
      severity: "ERROR",
      targetId: c.id,
      targetType: "CLAIM",
      message: `Active claim '${c.canonical_name} → ${c.predicate}' has no recorded provenance source link.`,
    });
  }

  // 2. Check for Open Contradictions
  const openContradictions = db.query(`
    SELECT id, subject, predicate FROM contradiction_cases
    WHERE status = 'OPEN' OR status = 'NEEDS_REVIEW'
  `).all() as Array<{ id: string; subject: string; predicate: string }>;

  for (const c of openContradictions) {
    issues.push({
      rule: "UNRESOLVED_CONTRADICTION",
      severity: "WARN",
      targetId: c.id,
      targetType: "CLAIM",
      message: `Open contradiction on '${c.subject}' predicate '${c.predicate}' requires resolution.`,
    });
  }

  // 3. Check for Broken Wiki Links
  const pages = listWikiPages();
  const pageSlugs = new Set(pages.map((p) => p.slug.toLowerCase()));
  const entityNames = new Set(
    (db.query("SELECT canonical_name FROM knowledge_entities").all() as Array<{ canonical_name: string }>)
      .map((e) => e.canonical_name.toLowerCase()),
  );

  for (const page of pages) {
    const revRow = page.currentRevisionId
      ? (db.query("SELECT markdown FROM wiki_revisions WHERE id = ?").get(page.currentRevisionId) as { markdown: string } | undefined)
      : undefined;

    if (revRow?.markdown) {
      const linkMatches = revRow.markdown.matchAll(/\[\[([a-zA-Z0-9_\s-]+)\]\]/g);
      for (const match of linkMatches) {
        const linkTarget = match[1]!.trim().toLowerCase();
        if (!pageSlugs.has(linkTarget) && !entityNames.has(linkTarget)) {
          issues.push({
            rule: "BROKEN_WIKI_LINK",
            severity: "WARN",
            targetId: page.id,
            targetType: "WIKI_PAGE",
            message: `Wiki page '${page.title}' links to non-existent target '[[${match[1]}]]'.`,
          });
        }
      }
    }

    // 4. Stale Wiki Page check
    if (page.status === "STALE") {
      issues.push({
        rule: "STALE_WIKI_PAGE",
        severity: "WARN",
        targetId: page.id,
        targetType: "WIKI_PAGE",
        message: `Wiki page '${page.title}' (${page.slug}) is marked STALE due to upstream source updates.`,
      });
    }
  }

  const errorsCount = issues.filter((i) => i.severity === "ERROR").length;
  const warningsCount = issues.filter((i) => i.severity === "WARN").length;

  let score = 100 - (errorsCount * 15) - (warningsCount * 5);
  score = Math.max(0, Math.min(100, score));

  return {
    timestamp: new Date().toISOString(),
    passed: errorsCount === 0,
    score,
    healthScore: score,
    totalIssues: issues.length,
    errorsCount,
    warningsCount,
    issues,
  };
}

export function getBrainHealthStatus(): BrainHealth & {
  healthy: boolean;
  unresolvedContradictions: number;
} {
  const db = openAgentOsDb();
  const lint = runKnowledgeLint();

  const sourcesTotal = Number(db.query("SELECT COUNT(*) as c FROM knowledge_sources").get() as { c: number }) || 0;
  const sourcesStale = Number(db.query("SELECT COUNT(*) as c FROM knowledge_sources WHERE status = 'DELETED' OR status = 'FAILED'").get() as { c: number }) || 0;
  const wikiPagesTotal = Number(db.query("SELECT COUNT(*) as c FROM wiki_pages").get() as { c: number }) || 0;
  const wikiPagesCurrent = Number(db.query("SELECT COUNT(*) as c FROM wiki_pages WHERE status = 'CURRENT'").get() as { c: number }) || 0;
  const wikiPagesStale = Number(db.query("SELECT COUNT(*) as c FROM wiki_pages WHERE status = 'STALE'").get() as { c: number }) || 0;
  const claimsTotal = Number(db.query("SELECT COUNT(*) as c FROM knowledge_claims").get() as { c: number }) || 0;
  const claimsActive = Number(db.query("SELECT COUNT(*) as c FROM knowledge_claims WHERE status = 'ACTIVE'").get() as { c: number }) || 0;
  const entitiesTotal = Number(db.query("SELECT COUNT(*) as c FROM knowledge_entities").get() as { c: number }) || 0;
  const relationsTotal = Number(db.query("SELECT COUNT(*) as c FROM knowledge_relations").get() as { c: number }) || 0;
  const openContradictions = Number(db.query("SELECT COUNT(*) as c FROM contradiction_cases WHERE status = 'OPEN' OR status = 'NEEDS_REVIEW'").get() as { c: number }) || 0;
  const resolvedContradictions = Number(db.query("SELECT COUNT(*) as c FROM contradiction_cases WHERE status = 'RESOLVED' OR status = 'AUTO_RESOLVED'").get() as { c: number }) || 0;

  const localOnly = process.env.PAO_BRAIN_LOCAL_ONLY === "true";

  let status: BrainHealth["status"] = "HEALTHY";
  if (lint.errorsCount > 0 || openContradictions > 0) {
    status = "DEGRADED";
  }

  return {
    status,
    healthy: status === "HEALTHY",
    healthScore: lint.score,
    unresolvedContradictions: openContradictions,
    sourcesTotal,
    sourcesFresh: Math.max(0, sourcesTotal - sourcesStale),
    sourcesStale,
    wikiPagesTotal,
    wikiPagesCurrent,
    wikiPagesStale,
    claimsTotal,
    claimsActive,
    entitiesTotal,
    relationsTotal,
    openContradictions,
    resolvedContradictions,
    brokenWikiLinks: lint.issues.filter((i) => i.rule === "BROKEN_WIKI_LINK").length,
    activeClaimsWithoutSource: lint.issues.filter((i) => i.rule === "CLAIM_PROVENANCE_MISSING").length,
    localOnly,
    components: {
      sourceRegistry: "HEALTHY",
      ingest: "HEALTHY",
      compiler: "HEALTHY",
      wiki: wikiPagesStale > 0 ? "DEGRADED" : "HEALTHY",
      search: "HEALTHY",
      graph: "HEALTHY",
      query: "HEALTHY",
    },
  };
}
