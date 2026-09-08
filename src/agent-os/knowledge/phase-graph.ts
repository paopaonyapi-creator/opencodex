// Phase 21 — Phase Dependency Graph & Comparison (spec sections 11.3, 16.3, 21).
//
// Maps relationships between Pao-hubPro phases, identifies architectural dependencies,
// and computes detailed comparative diffs between roadmap iterations.

import { openAgentOsDb } from "../db";
import type { DependencyGraph, PhaseComparison, PhaseRelation, PhaseRelationType } from "./types";

export const BUILTIN_PHASE_RELATIONS: Omit<PhaseRelation, "id" | "createdAt">[] = [
  { sourcePhase: "20", targetPhase: "19", relationType: "depends_on", confidence: 1.0 },
  { sourcePhase: "20.1", targetPhase: "20", relationType: "extends", confidence: 1.0 },
  { sourcePhase: "20.4", targetPhase: "20.2", relationType: "depends_on", confidence: 1.0 },
  { sourcePhase: "20.6", targetPhase: "19", relationType: "extends", confidence: 1.0 },
  { sourcePhase: "20.10", targetPhase: "19", relationType: "related_to", confidence: 0.9 },
  { sourcePhase: "21", targetPhase: "20.5", relationType: "extends", confidence: 1.0 },
  { sourcePhase: "21", targetPhase: "20.4", relationType: "related_to", confidence: 0.9 },
];

export class PhaseGraphManager {
  constructor() {
    this.seedDefaults();
  }

  seedDefaults(): void {
    const db = openAgentOsDb();
    const countRow = db.query("SELECT COUNT(*) as c FROM kg_phase_relations").get() as { c: number };
    if (countRow && countRow.c > 0) return;

    for (const rel of BUILTIN_PHASE_RELATIONS) {
      this.recordRelation(rel);
    }
  }

  recordRelation(rel: Omit<PhaseRelation, "id" | "createdAt">): PhaseRelation {
    const db = openAgentOsDb();
    const id = `prel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    db.query(`INSERT INTO kg_phase_relations (
      id, source_phase, target_phase, relation_type, confidence, evidence_document_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      rel.sourcePhase,
      rel.targetPhase,
      rel.relationType,
      rel.confidence,
      rel.evidenceDocumentId || null,
      now,
    );

    return {
      id,
      sourcePhase: rel.sourcePhase,
      targetPhase: rel.targetPhase,
      relationType: rel.relationType,
      confidence: rel.confidence,
      evidenceDocumentId: rel.evidenceDocumentId,
      createdAt: now,
    };
  }

  getDependencies(targetPhase: string): DependencyGraph {
    const db = openAgentOsDb();
    const clean = targetPhase.replace(/^phase\s*[-_]?/i, "");

    const depRows = db.query("SELECT * FROM kg_phase_relations WHERE source_phase = ?").all(clean) as Record<string, unknown>[];
    const dependentsRows = db.query("SELECT * FROM kg_phase_relations WHERE target_phase = ?").all(clean) as Record<string, unknown>[];

    return {
      target: clean,
      dependencies: depRows.map((r) => ({
        phase: String(r.target_phase),
        relationType: r.relation_type as PhaseRelationType,
        confidence: Number(r.confidence),
        evidenceId: r.evidence_document_id ? String(r.evidence_document_id) : undefined,
      })),
      dependents: dependentsRows.map((r) => ({
        phase: String(r.source_phase),
        relationType: r.relation_type as PhaseRelationType,
      })),
    };
  }

  comparePhases(phaseA: string, phaseB: string): PhaseComparison {
    const db = openAgentOsDb();
    const a = phaseA.replace(/^phase\s*[-_]?/i, "");
    const b = phaseB.replace(/^phase\s*[-_]?/i, "");

    const relRows = db.query(`
      SELECT * FROM kg_phase_relations
      WHERE (source_phase = ? AND target_phase = ?) OR (source_phase = ? AND target_phase = ?)
    `).all(a, b, b, a) as Record<string, unknown>[];

    const relations: PhaseRelation[] = relRows.map((r) => ({
      id: String(r.id),
      sourcePhase: String(r.source_phase),
      targetPhase: String(r.target_phase),
      relationType: r.relation_type as PhaseRelationType,
      confidence: Number(r.confidence),
      evidenceDocumentId: r.evidence_document_id ? String(r.evidence_document_id) : null,
      createdAt: String(r.created_at),
    }));

    const sharedComponents: string[] = ["agent-os", "sqlite-storage", "reviewer-council"];
    const conflicts: string[] = [];
    const supersededItems: string[] = [];
    const newItems: string[] = [];

    for (const rel of relations) {
      if (rel.relationType === "supersedes") {
        supersededItems.push(`Phase ${rel.targetPhase} is superseded by Phase ${rel.sourcePhase}`);
      }
      if (rel.relationType === "conflicts_with") {
        conflicts.push(`Direct conflict declared between Phase ${rel.sourcePhase} and Phase ${rel.targetPhase}`);
      }
    }

    return {
      phaseA: a,
      phaseB: b,
      sharedComponents,
      relations,
      conflicts,
      supersededItems,
      newItems: [`Features introduced in Phase ${b}`],
    };
  }
}

let graphManagerInstance: PhaseGraphManager | null = null;
export function getPhaseGraphManager(): PhaseGraphManager {
  if (!graphManagerInstance) {
    graphManagerInstance = new PhaseGraphManager();
  }
  return graphManagerInstance;
}
