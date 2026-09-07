// Phase 20.2 — Convergence Engine (/converge)
//
// Verifies Definition of Done (DoD), evaluates CONVERGE_GATE, generates changelogs,
// and completes the SDLC cycle.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import { QualityGateEngine } from "./gates";
import type { SdlcGate } from "./types";

export interface ConvergenceResult {
  cycleId: string;
  converged: boolean;
  score: number;
  dodChecklist: Array<{ name: string; passed: boolean; details?: string }>;
  blockers: string[];
  convergeGate: SdlcGate;
  convergenceMarkdown: string;
}

export class ConvergenceEngine {
  static evaluateConvergence(cycleId: string): ConvergenceResult {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    // 1. Fetch all relevant cycle data
    const cycle = db.query("SELECT * FROM sdlc_cycles WHERE id = ?").get(cycleId) as Record<string, unknown> | undefined;
    if (!cycle) {
      throw new Error(`Cycle ${cycleId} not found`);
    }

    const tasks = db.query("SELECT id, key, title, status FROM sdlc_tasks WHERE cycle_id = ?").all(cycleId) as Array<{
      id: string;
      key: string;
      title: string;
      status: string;
    }>;

    const acs = db.query("SELECT id, key, description, status, evidence_id FROM sdlc_acceptance_criteria WHERE cycle_id = ?").all(cycleId) as Array<{
      id: string;
      key: string;
      description: string;
      status: string;
      evidence_id: string | null;
    }>;

    const reviewGate = QualityGateEngine.getGate(cycleId, "REVIEW_GATE");
    const specGate = QualityGateEngine.getGate(cycleId, "SPEC_GATE");
    const planGate = QualityGateEngine.getGate(cycleId, "PLAN_GATE");
    const tasksGate = QualityGateEngine.getGate(cycleId, "TASKS_GATE");

    // 2. Evaluate Definition of Done (DoD)
    const allTasksCompleted = tasks.length > 0 && tasks.every(t => t.status === "completed");
    const allAcsVerified = acs.length > 0 && acs.every(a => a.status === "passed" && a.evidence_id !== null);
    const reviewPassed = reviewGate?.status === "passed";
    const priorGatesPassed = specGate?.status === "passed" && planGate?.status === "passed" && tasksGate?.status === "passed";

    const dodChecklist = [
      {
        name: "Prior Stage Gates Passed",
        passed: priorGatesPassed,
        details: `SPEC: ${specGate?.status}, PLAN: ${planGate?.status}, TASKS: ${tasksGate?.status}`,
      },
      {
        name: "All Implementation Tasks Completed",
        passed: allTasksCompleted,
        details: `${tasks.filter(t => t.status === "completed").length}/${tasks.length} tasks completed`,
      },
      {
        name: "All Acceptance Criteria Verified with Passing Evidence",
        passed: allAcsVerified,
        details: `${acs.filter(a => a.status === "passed").length}/${acs.length} criteria verified`,
      },
      {
        name: "Software Reviewer Council Consensus Cleared",
        passed: reviewPassed,
        details: `REVIEW_GATE: ${reviewGate?.status ?? "missing"} (score: ${reviewGate?.score ?? 0}%)`,
      },
    ];

    const passedCount = dodChecklist.filter(c => c.passed).length;
    const score = Math.round((passedCount / dodChecklist.length) * 100);
    const converged = dodChecklist.every(c => c.passed);
    const blockers = dodChecklist.filter(c => !c.passed).map(c => `${c.name}: ${c.details}`);

    // 3. Record CONVERGE_GATE
    const gateStatus = converged ? "passed" : "failed";
    const convergeGate = QualityGateEngine.recordGate({
      cycleId,
      gateType: "CONVERGE_GATE",
      status: gateStatus,
      score,
      checklistResults: dodChecklist,
      blockers,
      evaluatedAt: now,
    });

    // 4. Generate Convergence Report Artifact
    const convergenceMarkdown = [
      `# Convergence Report — ${cycle.title}`,
      "",
      `**Cycle ID:** ${cycleId}`,
      `**Status:** ${converged ? "CONVERGED (READY FOR STAGING)" : "CONVERGENCE BLOCKED"}`,
      `**Score:** ${score}%`,
      `**Evaluated At:** ${now}`,
      "",
      "## 1. Definition of Done (DoD) Verification",
      "| Item | Result | Details |",
      "|---|---|---|",
      ...dodChecklist.map(c => `| ${c.name} | ${c.passed ? "PASS" : "**FAIL**"} | ${c.details ?? ""} |`),
      "",
      "## 2. Completed Tasks",
      ...tasks.map(t => `- [${t.status === "completed" ? "x" : " "}] **[${t.key}]** ${t.title}`),
      "",
      "## 3. Verified Acceptance Criteria",
      ...acs.map(a => `- [${a.status === "passed" ? "x" : " "}] **[${a.key}]** ${a.description} (Evidence: \`${a.evidence_id ?? "NONE"}\`)`),
      "",
      "## 4. Gate Summary",
      `- **SPEC_GATE:** ${specGate?.status ?? "N/A"}`,
      `- **PLAN_GATE:** ${planGate?.status ?? "N/A"}`,
      `- **TASKS_GATE:** ${tasksGate?.status ?? "N/A"}`,
      `- **REVIEW_GATE:** ${reviewGate?.status ?? "N/A"}`,
      `- **CONVERGE_GATE:** ${gateStatus}`,
    ].join("\n");

    const sha256 = createHash("sha256").update(convergenceMarkdown).digest("hex");
    const artifactId = `art_conv_${cycleId}`;

    db.run("DELETE FROM sdlc_artifacts WHERE cycle_id = ? AND artifact_type = 'convergence_report'", [cycleId]);
    db.query(`
      INSERT INTO sdlc_artifacts
        (id, cycle_id, artifact_type, version, content, sha256, is_stale, created_at)
      VALUES (?, ?, 'convergence_report', 1, ?, ?, 0, ?)
    `).run(artifactId, cycleId, convergenceMarkdown, sha256, now);

    return {
      cycleId,
      converged,
      score,
      dodChecklist,
      blockers,
      convergeGate,
      convergenceMarkdown,
    };
  }
}
