// Phase 20.5 — Contradiction Detection & Resolution Engine

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { getClaim, listClaims, updateClaimStatus } from "./claims";
import { getEntity } from "./entities";
import type { ContradictionCase, ContradictionStatus, KnowledgeClaim } from "./types";

export function detectContradictions(): ContradictionCase[] {
  const db = openAgentOsDb();
  // Find (subject_entity_id, predicate) groups with multiple ACTIVE claims having differing object_value
  const groups = db
    .query(`
      SELECT subject_entity_id, predicate, COUNT(*) as cnt
      FROM knowledge_claims
      WHERE status = 'ACTIVE'
      GROUP BY subject_entity_id, predicate
      HAVING cnt > 1
    `)
    .all() as Array<{ subject_entity_id: string; predicate: string; cnt: number }>;

  const detectedCases: ContradictionCase[] = [];

  for (const group of groups) {
    const claims = listClaims({
      subjectEntityId: group.subject_entity_id,
      predicate: group.predicate,
      status: "ACTIVE",
    });

    // Check if values actually differ
    const distinctValues = new Set(claims.map((c) => c.objectValue.trim()));
    if (distinctValues.size <= 1) continue;

    const entity = getEntity(group.subject_entity_id);
    const subjectName = entity ? entity.canonicalName : group.subject_entity_id;

    // Check if case already exists for this subject + predicate
    const existing = db
      .query(`
        SELECT * FROM contradiction_cases
        WHERE subject = ? AND predicate = ? AND status IN ('OPEN', 'NEEDS_REVIEW')
        LIMIT 1
      `)
      .get(subjectName, group.predicate) as Record<string, unknown> | undefined;

    const claimIds = claims.map((c) => c.id);
    const caseId = existing ? String(existing.id) : `case_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();

    // Determine auto-resolution:
    // Check if an accepted architecture decision (ADR) exists for this subject
    const adr = db.query(`
      SELECT * FROM knowledge_decisions
      WHERE (title LIKE ? OR decision LIKE ? OR rationale_summary LIKE ?)
        AND status IN ('ACCEPTED', 'RATIFIED')
      LIMIT 1
    `).get(`%${subjectName}%`, `%${subjectName}%`, `%${subjectName}%`) as Record<string, unknown> | undefined;

    // Sort claims by source_priority (higher = stronger), then confidence, then created_at
    const sorted = [...claims].sort((a, b) => {
      if (b.sourcePriority !== a.sourcePriority) {
        return b.sourcePriority - a.sourcePriority;
      }
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const topClaim = sorted[0]!;
    const runnerUp = sorted[1]!;

    let autoResolved = false;
    let resolutionText: string | null = null;
    let canonicalClaimId: string | null = null;
    let status: ContradictionStatus = "OPEN";

    // Auto-resolve if explicit ADR exists or source priority dominates
    if (adr) {
      autoResolved = true;
      canonicalClaimId = topClaim.id;
      resolutionText = `Auto-resolved via ${adr.title}: '${topClaim.objectValue}'.`;
      status = "AUTO_RESOLVED";
    } else if (topClaim.sourcePriority >= 10 && runnerUp.sourcePriority < 5) {
      autoResolved = true;
      canonicalClaimId = topClaim.id;
      resolutionText = `Auto-resolved by source priority (${topClaim.sourcePriority} > ${runnerUp.sourcePriority}). Canonical: '${topClaim.objectValue}'.`;
      status = "AUTO_RESOLVED";
    } else {
      status = "OPEN";
    }

    if (autoResolved && canonicalClaimId) {
      // Mark losing claims as SUPERSEDED, keep winner ACTIVE, never delete historical claims!
      for (const clm of claims) {
        if (clm.id !== canonicalClaimId) {
          updateClaimStatus(clm.id, "SUPERSEDED", `Superseded by claim ${canonicalClaimId} in contradiction ${caseId}`);
        }
      }
    }

    db.query(`
      INSERT INTO contradiction_cases (
        id, subject, predicate, claim_ids_json, status, severity,
        detected_at, resolved_at, resolution, canonical_claim_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'HIGH', ?, ?, ?, ?, '{}')
      ON CONFLICT(id) DO UPDATE SET
        claim_ids_json = excluded.claim_ids_json,
        status = excluded.status,
        resolved_at = excluded.resolved_at,
        resolution = excluded.resolution,
        canonical_claim_id = excluded.canonical_claim_id
    `).run(
      caseId,
      subjectName,
      group.predicate,
      JSON.stringify(claimIds),
      status,
      existing ? String(existing.detected_at) : now,
      autoResolved ? now : null,
      resolutionText,
      canonicalClaimId,
    );

    detectedCases.push(getContradictionCase(caseId)!);
  }

  return detectedCases;
}

export function resolveContradiction(
  caseIdOrParams: string | {
    caseId: string;
    chosenClaimId: string;
    resolution: string;
    decidedBy?: string;
  },
  resolutionTypeOrChosenId?: string,
  resolutionNotes?: string,
): any {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  if (typeof caseIdOrParams === "string") {
    const caseId = caseIdOrParams;
    const cCase = getContradictionCase(caseId);
    if (!cCase) throw new Error(`Contradiction case ${caseId} not found`);

    const claims = cCase.claimIds.map((id) => getClaim(id)).filter(Boolean) as KnowledgeClaim[];
    const sorted = claims.sort((a, b) => b.confidence - a.confidence);
    const chosen = sorted[0];
    const notes = resolutionNotes ?? resolutionTypeOrChosenId ?? "Resolved by operator";

    for (const clm of claims) {
      if (chosen && clm.id === chosen.id) {
        updateClaimStatus(clm.id, "ACTIVE", "Confirmed canonical by operator");
      } else {
        updateClaimStatus(clm.id, "SUPERSEDED", notes);
      }
    }

    db.query(`
      UPDATE contradiction_cases
      SET status = 'RESOLVED',
          resolved_at = ?,
          resolution = ?,
          canonical_claim_id = ?,
          metadata_json = json_set(metadata_json, '$.resolutionType', ?)
      WHERE id = ?
    `).run(
      now,
      notes,
      chosen?.id ?? null,
      resolutionTypeOrChosenId ?? "MANUAL",
      caseId,
    );

    return true;
  }

  const params = caseIdOrParams;
  const cCase = getContradictionCase(params.caseId);
  if (!cCase) throw new Error(`Contradiction case ${params.caseId} not found`);

  const chosen = getClaim(params.chosenClaimId);
  if (!chosen) throw new Error(`Claim ${params.chosenClaimId} not found`);

  // Supersede other claims in the case
  for (const cid of cCase.claimIds) {
    if (cid !== params.chosenClaimId) {
      updateClaimStatus(cid, "SUPERSEDED", `Manual resolution by ${params.decidedBy ?? "operator"}: ${params.resolution}`);
    } else {
      updateClaimStatus(cid, "ACTIVE", "Confirmed canonical by operator");
    }
  }

  db.query(`
    UPDATE contradiction_cases
    SET status = 'RESOLVED',
        resolved_at = ?,
        resolution = ?,
        canonical_claim_id = ?,
        metadata_json = json_set(metadata_json, '$.resolvedBy', ?)
    WHERE id = ?
  `).run(
    now,
    params.resolution,
    params.chosenClaimId,
    params.decidedBy ?? "operator",
    params.caseId,
  );

  return getContradictionCase(params.caseId)!;
}

export function getContradictionCase(id: string): ContradictionCase | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM contradiction_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapContradictionRow(row);
}

export function listContradictions(filters?: {
  status?: ContradictionStatus;
  limit?: number;
}): ContradictionCase[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM contradiction_cases WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY detected_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapContradictionRow);
}

function mapContradictionRow(row: Record<string, unknown>): ContradictionCase {
  const subject = String(row.subject);
  const predicate = String(row.predicate);
  return {
    id: String(row.id),
    subject,
    topic: subject,
    predicate,
    claimIds: row.claim_ids_json ? JSON.parse(String(row.claim_ids_json)) : [],
    status: row.status as ContradictionStatus,
    severity: (row.severity as ContradictionCase["severity"]) ?? "MEDIUM",
    detectedAt: String(row.detected_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    resolution: row.resolution ? String(row.resolution) : null,
    canonicalClaimId: row.canonical_claim_id ? String(row.canonical_claim_id) : null,
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}
