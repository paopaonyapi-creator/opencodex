// Phase 20.5 — Hybrid Query Planner (Wiki-First Retrieval + Provenance Backfill)

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { listClaims } from "./claims";
import { resolveEntity } from "./entities";
import { assessFreshness } from "./freshness";
import { searchBrain } from "./search";
import type { QueryEvidence, SourceChunk } from "./types";
import { getWikiPage, getWikiRevision, readWikiMarkdown } from "./wiki-storage";

export interface KnowledgeCitation {
  sourceTitle: string;
  uriOrPath?: string;
  chunkHeading?: string;
  confidence?: number;
}

export interface KnowledgeAnswer {
  question: string;
  intent: string;
  answer: string;
  confidence: number;
  freshness: string;
  sources: string[];
  citations: KnowledgeCitation[];
  evidence: {
    wikiPages: Array<{ slug: string; title: string; excerpt?: string }>;
    claims: Array<{ id: string; predicate: string; objectValue: string; status: string }>;
    sourceVersions: Array<{ sourceId: string; versionId: string; uriOrPath: string }>;
    contradictions: Array<{ caseId: string; subject: string; resolution?: string | null }>;
  };
}

export interface QueryKnowledgeBrainOptions {
  query: string;
  mode?: "CANONICAL" | "HISTORICAL";
}

export function queryKnowledgeBrain(
  input: string | QueryKnowledgeBrainOptions,
): KnowledgeAnswer {
  const question = typeof input === "string" ? input : input.query;
  const mode = typeof input === "object" ? input.mode : undefined;

  const trimmed = question.trim();
  const lower = trimmed.toLowerCase();
  const db = openAgentOsDb();

  const selectedPages: Array<{ id: string; slug: string; title: string; excerpt?: string }> = [];
  const selectedClaims: Array<{ id: string; predicate: string; objectValue: string; status: string }> = [];
  const sourceVersions: Array<{ sourceId: string; versionId: string; uriOrPath: string }> = [];
  const contradictions: Array<{ caseId: string; subject: string; resolution?: string | null }> = [];
  const citations: KnowledgeCitation[] = [];

  // Detect temporal intent (historical vs current)
  const isHistorical = mode === "HISTORICAL" || /เคย|ก่อนหน้า|เดิม|historical|formerly|originally|past|previous/.test(lower);

  // 1. Entity Extraction & Resolution
  let matchedEntity = resolveEntity(trimmed);
  if (!matchedEntity) {
    // Try matching sub-phrases like "phase 20.1", "phase 20.3", "smart queue", "comfyui", "council"
    const phaseMatch = lower.match(/phase\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (phaseMatch) {
      matchedEntity = resolveEntity(`Phase ${phaseMatch[1]}`) ?? resolveEntity(`phase-${phaseMatch[1]}`);
    }
    if (!matchedEntity && (lower.includes("smart queue") || lower.includes("smartqueue"))) {
      matchedEntity = resolveEntity("Smart Queue") ?? resolveEntity("Phase 20.1");
    }
    if (!matchedEntity && (lower.includes("desktop vision") || lower.includes("desktop-agent"))) {
      matchedEntity = resolveEntity("Desktop Vision") ?? resolveEntity("Phase 20.3");
    }
    if (!matchedEntity && (lower.includes("council") || lower.includes("engineering council"))) {
      matchedEntity = resolveEntity("Autonomous Engineering Council") ?? resolveEntity("Phase 20.4");
    }
  }

  // 2. Query Claims for Matched Entity
  let claimsList = matchedEntity
    ? listClaims({
        subjectEntityId: matchedEntity.id,
        status: isHistorical ? "SUPERSEDED" : "ACTIVE",
      })
    : [];

  // If historical query and no superseded claims found, fall back to any claims
  if (isHistorical && claimsList.length === 0 && matchedEntity) {
    claimsList = listClaims({ subjectEntityId: matchedEntity.id });
  }

  for (const c of claimsList) {
    selectedClaims.push({
      id: c.id,
      predicate: c.predicate,
      objectValue: c.objectValue,
      status: c.status,
    });
    if (c.provenance) {
      for (const prv of c.provenance) {
        const srcRow = db.query(`
          SELECT ks.id as source_id, ks.title, ks.uri_or_path
          FROM source_versions sv
          JOIN knowledge_sources ks ON sv.source_id = ks.id
          WHERE sv.id = ?
        `).get(prv.sourceVersionId) as { source_id: string; title: string; uri_or_path: string } | undefined;

        if (srcRow && !sourceVersions.some((s) => s.versionId === prv.sourceVersionId)) {
          sourceVersions.push({
            sourceId: srcRow.source_id,
            versionId: prv.sourceVersionId,
            uriOrPath: srcRow.uri_or_path,
          });
        }
      }
    }

    // Collect citations for this claim
    const provRows = db.query(`
      SELECT ks.title as source_title, ks.uri_or_path, sc.section_path
      FROM claim_provenance cp
      JOIN source_versions sv ON cp.source_version_id = sv.id
      JOIN knowledge_sources ks ON sv.source_id = ks.id
      LEFT JOIN source_chunks sc ON cp.chunk_id = sc.id
      WHERE cp.claim_id = ?
    `).all(c.id) as Array<{ source_title: string; uri_or_path: string; section_path: string | null }>;

    for (const pr of provRows) {
      if (!citations.some((ci) => ci.sourceTitle === pr.source_title)) {
        citations.push({
          sourceTitle: pr.source_title,
          uriOrPath: pr.uri_or_path,
          chunkHeading: pr.section_path ?? undefined,
          confidence: c.confidence,
        });
      }
    }
  }

  for (const s of sourceVersions) {
    if (!citations.some((ci) => ci.sourceTitle === s.uriOrPath)) {
      citations.push({
        sourceTitle: s.uriOrPath,
        uriOrPath: s.uriOrPath,
      });
    }
  }

  // 3. Search Wiki Pages
  const searchHits = searchBrain(question, 5);
  for (const hit of searchHits) {
    if (hit.type === "wiki_page") {
      const page = getWikiPage(hit.id);
      if (page) {
        selectedPages.push({
          id: page.id,
          slug: page.slug,
          title: page.title,
          excerpt: hit.summary,
        });
      }
    }
  }

  // 4. Check for Contradictions
  if (matchedEntity) {
    const cCases = db.query(`
      SELECT id, subject, resolution FROM contradiction_cases
      WHERE subject = ?
    `).all(matchedEntity.canonicalName) as Array<{ id: string; subject: string; resolution?: string | null }>;
    for (const cc of cCases) {
      contradictions.push({
        caseId: cc.id,
        subject: cc.subject,
        resolution: cc.resolution,
      });
    }
  }

  // 5. Compose Answer
  let answer = "";
  let confidence = 0.95;
  let freshness = "FRESH";

  if (selectedClaims.length > 0 && matchedEntity) {
    const activeClaim = selectedClaims[0]!;
    if (isHistorical) {
      answer = `[Historical Record] ${matchedEntity.canonicalName}: ${selectedClaims.map((c) => `${c.predicate}: ${c.objectValue}`).join("; ")}.`;
    } else {
      answer = `${matchedEntity.canonicalName}: ${activeClaim.predicate} is "${activeClaim.objectValue}".`;
      if (selectedClaims.length > 1) {
        answer += ` Related info: ${selectedClaims.slice(1).map((c) => `${c.predicate}: ${c.objectValue}`).join(", ")}.`;
      }
    }

    if (contradictions.length > 0 && contradictions[0]?.resolution) {
      answer += ` (Resolution note: ${contradictions[0].resolution})`;
    }
  } else if (selectedPages.length > 0) {
    const topPage = selectedPages[0]!;
    answer = `Living Wiki: "${topPage.title}" (${topPage.slug}).`;
    confidence = 0.85;
  } else if (searchHits.length > 0) {
    const topHit = searchHits[0]!;
    answer = `Relevant information: ${topHit.title} (${topHit.summary}).`;
    confidence = 0.75;
  } else {
    answer = `No matching information found for "${question}" in Living Knowledge Brain.`;
    confidence = 0.2;
    freshness = "UNKNOWN";
  }

  // Build source citations list
  const sources: string[] = [];
  for (const p of selectedPages) sources.push(`wiki:${p.slug}`);
  for (const c of selectedClaims) sources.push(`claim:${c.id}`);
  for (const s of sourceVersions) sources.push(`source:${s.uriOrPath}@${s.versionId}`);
  if (sources.length === 0 && searchHits.length > 0) {
    sources.push(...searchHits.map((h) => `${h.type}:${h.id}`));
  }

  // Save query evidence record
  const evidenceId = `qev_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO query_evidence (
      id, query, selected_pages_json, selected_claims_json,
      source_versions_json, confidence, contradictions_json, queried_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidenceId,
    question,
    JSON.stringify(selectedPages),
    JSON.stringify(selectedClaims),
    JSON.stringify(sourceVersions),
    confidence,
    JSON.stringify(contradictions),
    now,
  );

  return {
    question,
    intent: isHistorical ? "historical_query" : "canonical_query",
    answer,
    confidence,
    freshness,
    sources,
    citations,
    evidence: {
      wikiPages: selectedPages,
      claims: selectedClaims,
      sourceVersions,
      contradictions,
    },
  };
}
