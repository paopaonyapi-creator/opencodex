// Phase 20.5 — Architecture & Roadmap Decision Records

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { DecisionStatus, KnowledgeDecision } from "./types";

export interface RecordDecisionInput {
  id?: string;
  decisionId?: string;
  title: string;
  domain?: string;
  status?: DecisionStatus;
  decision?: string;
  rationale?: string;
  rationaleSummary?: string;
  alternatives?: string[];
  effectiveAt?: string;
  supersedesId?: string | null;
  supersedesDecisionId?: string | null;
  sourceRefs?: string[];
}

export function recordDecision(input: RecordDecisionInput): KnowledgeDecision {
  const db = openAgentOsDb();
  const id = input.id ?? input.decisionId ?? `dec_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const status = input.status ?? "ACCEPTED";
  const effectiveAt = input.effectiveAt ?? now;
  const decisionText = input.decision ?? input.title;
  const rationale = input.rationaleSummary ?? input.rationale ?? "";
  const supersedes = input.supersedesId ?? input.supersedesDecisionId ?? null;

  db.exec("BEGIN");
  try {
    // If this decision supersedes another, update the superseded decision's status
    if (supersedes) {
      db.query("UPDATE knowledge_decisions SET status = 'SUPERSEDED' WHERE id = ?").run(supersedes);
    }

    db.query(`
      INSERT INTO knowledge_decisions (
        id, title, status, decision, rationale_summary, alternatives_json,
        effective_at, supersedes_id, source_refs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        decision = excluded.decision,
        rationale_summary = excluded.rationale_summary,
        alternatives_json = excluded.alternatives_json,
        effective_at = excluded.effective_at,
        supersedes_id = excluded.supersedes_id,
        source_refs_json = excluded.source_refs_json
    `).run(
      id,
      input.title,
      status,
      decisionText,
      rationale,
      JSON.stringify(input.alternatives ?? []),
      effectiveAt,
      supersedes,
      JSON.stringify(input.sourceRefs ?? []),
      now,
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getDecision(id)!;
}

export function getDecision(id: string): KnowledgeDecision | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM knowledge_decisions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapDecisionRow(row);
}

export function listDecisions(filters?: {
  status?: DecisionStatus;
  limit?: number;
}): KnowledgeDecision[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM knowledge_decisions WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY effective_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapDecisionRow);
}

function mapDecisionRow(row: Record<string, unknown>): KnowledgeDecision {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as DecisionStatus,
    decision: String(row.decision),
    rationaleSummary: String(row.rationale_summary ?? ""),
    alternatives: row.alternatives_json ? JSON.parse(String(row.alternatives_json)) : [],
    effectiveAt: String(row.effective_at),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    sourceRefs: row.source_refs_json ? JSON.parse(String(row.source_refs_json)) : [],
    createdAt: String(row.created_at),
  };
}
