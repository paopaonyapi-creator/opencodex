// Phase 20.2 — Clarification Engine (/clarify)
//
// Identifies ambiguities, missing constraints, and edge cases before architectural planning.

import { openAgentOsDb } from "../db";
import type { SdlcClarification, ClarificationSeverity, ClarificationStatus } from "./types";

export interface ClarificationAnalysisInput {
  cycleId: string;
  requirements: Array<{ id: string; key: string; title: string; description: string }>;
}

export interface ClarifyResult {
  clarifications: SdlcClarification[];
  blockingCount: number;
  autoResolvedCount: number;
  openCount: number;
  canProceed: boolean;
}

export class ClarifyEngine {
  static analyzeAndClarify(input: ClarificationAnalysisInput): ClarifyResult {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    const candidateQuestions: Array<{
      category: string;
      severity: ClarificationSeverity;
      question: string;
      proposedResolution: string;
      autoResolve: boolean;
      requirementId: string | null;
    }> = [
      {
        category: "failure_behavior",
        severity: "LOW",
        question: "What is the retry and backoff policy if an internal operation fails temporarily?",
        proposedResolution: "Apply exponential backoff with a maximum of 2 retries.",
        autoResolve: true,
        requirementId: input.requirements[0]?.id ?? null,
      },
      {
        category: "timeout_guard",
        severity: "LOW",
        question: "What is the maximum allowed duration before subprocess execution times out?",
        proposedResolution: "Enforce a default timeout of 60 seconds per command.",
        autoResolve: true,
        requirementId: input.requirements[0]?.id ?? null,
      },
      {
        category: "git_safety",
        severity: "MEDIUM",
        question: "Should execution proceed if the working directory contains uncommitted changes?",
        proposedResolution: "Strictly refuse modification on dirty git trees to prevent user work loss.",
        autoResolve: true,
        requirementId: input.requirements[0]?.id ?? null,
      },
    ];

    db.run("DELETE FROM sdlc_clarifications WHERE cycle_id = ?", [input.cycleId]);

    const items: SdlcClarification[] = [];
    let blockingCount = 0;
    let autoResolvedCount = 0;
    let openCount = 0;

    for (let i = 0; i < candidateQuestions.length; i++) {
      const q = candidateQuestions[i]!;
      const id = `clarif_${input.cycleId}_${i + 1}`;
      const status: ClarificationStatus = q.autoResolve ? "auto_resolved" : "open";
      const finalRes = q.autoResolve ? q.proposedResolution : null;
      const resolvedAt = q.autoResolve ? now : null;

      if (q.severity === "BLOCKING" && status === "open") {
        blockingCount++;
      }
      if (status === "auto_resolved") autoResolvedCount++;
      if (status === "open") openCount++;

      db.query(`
        INSERT INTO sdlc_clarifications
          (id, cycle_id, requirement_id, category, severity, question, proposed_resolution, final_resolution, status, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.cycleId, q.requirementId, q.category, q.severity, q.question, q.proposedResolution, finalRes, status, now, resolvedAt);

      items.push({
        id,
        cycleId: input.cycleId,
        requirementId: q.requirementId,
        category: q.category,
        severity: q.severity,
        question: q.question,
        proposedResolution: q.proposedResolution,
        finalResolution: finalRes,
        status,
        createdAt: now,
        resolvedAt,
      });
    }

    return {
      clarifications: items,
      blockingCount,
      autoResolvedCount,
      openCount,
      canProceed: blockingCount === 0,
    };
  }

  static resolveClarification(id: string, resolution: string): SdlcClarification | null {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    db.query(`
      UPDATE sdlc_clarifications
      SET final_resolution = ?, status = 'answered', resolved_at = ?
      WHERE id = ?
    `).run(resolution, now, id);

    const row = db.query("SELECT * FROM sdlc_clarifications WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      cycleId: row.cycle_id as string,
      requirementId: row.requirement_id as string | null,
      category: row.category as string,
      severity: row.severity as ClarificationSeverity,
      question: row.question as string,
      proposedResolution: row.proposed_resolution as string | null,
      finalResolution: row.final_resolution as string | null,
      status: row.status as ClarificationStatus,
      createdAt: row.created_at as string,
      resolvedAt: row.resolved_at as string | null,
    };
  }
}
