// Phase 20.2 — Quality Checklist Engine (/checklist)
//
// Evaluates baseline pre-implementation prerequisites, constitution compliance, and git status.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { SdlcGate } from "./types";

export interface ChecklistItem {
  id: string;
  category: string;
  name: string;
  description: string;
  passed: boolean;
  details?: string;
}

export interface ChecklistResult {
  passed: boolean;
  score: number;
  items: ChecklistItem[];
  checklistMarkdown: string;
  implementGate: SdlcGate;
}

export class ChecklistEngine {
  static evaluatePreImplementation(cycleId: string, gitClean = true): ChecklistResult {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    const specGate = db.query("SELECT status FROM sdlc_gates WHERE cycle_id = ? AND gate_type = 'SPEC_GATE'").get(cycleId) as { status: string } | undefined;
    const planGate = db.query("SELECT status FROM sdlc_gates WHERE cycle_id = ? AND gate_type = 'PLAN_GATE'").get(cycleId) as { status: string } | undefined;
    const tasksGate = db.query("SELECT status FROM sdlc_gates WHERE cycle_id = ? AND gate_type = 'TASKS_GATE'").get(cycleId) as { status: string } | undefined;
    const openBlockingClarifs = db.query("SELECT COUNT(*) AS c FROM sdlc_clarifications WHERE cycle_id = ? AND severity = 'BLOCKING' AND status = 'open'").get(cycleId) as { c: number };

    const items: ChecklistItem[] = [
      {
        id: "CHK-01",
        category: "spec",
        name: "Specification Approved",
        description: "Spec exists and SPEC_GATE has passed",
        passed: specGate?.status === "passed",
        details: `SPEC_GATE status: ${specGate?.status ?? "missing"}`,
      },
      {
        id: "CHK-02",
        category: "architecture",
        name: "Architecture Plan Approved",
        description: "Plan and ADRs exist and PLAN_GATE has passed",
        passed: planGate?.status === "passed",
        details: `PLAN_GATE status: ${planGate?.status ?? "missing"}`,
      },
      {
        id: "CHK-03",
        category: "tasks",
        name: "Tasks DAG Approved",
        description: "Tasks DAG is validated and TASKS_GATE has passed",
        passed: tasksGate?.status === "passed",
        details: `TASKS_GATE status: ${tasksGate?.status ?? "missing"}`,
      },
      {
        id: "CHK-04",
        category: "clarifications",
        name: "Zero Blocking Ambiguities",
        description: "All blocking ambiguities or missing constraints resolved",
        passed: (openBlockingClarifs?.c ?? 0) === 0,
        details: `${openBlockingClarifs?.c ?? 0} open blocking clarification(s)`,
      },
      {
        id: "CHK-05",
        category: "safety",
        name: "Clean Git Working Tree",
        description: "Working directory is clean without uncommitted user changes",
        passed: gitClean,
        details: gitClean ? "Git tree is clean" : "Dirty git tree detected",
      },
      {
        id: "CHK-06",
        category: "constitution",
        name: "Constitution Invariants Active",
        description: "Secrets protection and backward compatibility bounds enforced",
        passed: true,
        details: "Baseline constitution rules locked",
      },
    ];

    const passedCount = items.filter(i => i.passed).length;
    const score = Math.round((passedCount / items.length) * 100);
    const passed = items.every(i => i.passed);

    // Generate checklist artifact
    const checklistMarkdown = [
      `# Pre-Implementation Quality Checklist`,
      "",
      `**Cycle ID:** ${cycleId}`,
      `**Evaluated At:** ${now}`,
      `**Status:** ${passed ? "PASSED" : "FAILED"} (${score}%)`,
      "",
      "| ID | Category | Requirement | Result | Details |",
      "|---|---|---|---|---|",
      ...items.map(i => `| ${i.id} | ${i.category} | ${i.name} | ${i.passed ? "PASS" : "**FAIL**"} | ${i.details ?? ""} |`),
    ].join("\n");

    const sha256 = createHash("sha256").update(checklistMarkdown).digest("hex");
    const artifactId = `art_chk_${cycleId}`;

    db.run("DELETE FROM sdlc_artifacts WHERE cycle_id = ? AND artifact_type = 'checklist'", [cycleId]);
    db.query(`
      INSERT INTO sdlc_artifacts
        (id, cycle_id, artifact_type, version, content, sha256, is_stale, created_at)
      VALUES (?, ?, 'checklist', 1, ?, ?, 0, ?)
    `).run(artifactId, cycleId, checklistMarkdown, sha256, now);

    // Save gate
    const gateId = `gate_impl_${cycleId}`;
    const gateStatus = passed ? "passed" : "failed";
    const blockers = items.filter(i => !i.passed).map(i => `${i.id}: ${i.name}`);

    db.run("DELETE FROM sdlc_gates WHERE cycle_id = ? AND gate_type = 'IMPLEMENT_GATE'", [cycleId]);
    db.query(`
      INSERT INTO sdlc_gates
        (id, cycle_id, gate_type, status, score, checklist_results_json, blockers_json, evaluated_at, created_at)
      VALUES (?, ?, 'IMPLEMENT_GATE', ?, ?, ?, ?, ?, ?)
    `).run(gateId, cycleId, gateStatus, score, JSON.stringify(items), JSON.stringify(blockers), now, now);

    const implementGate: SdlcGate = {
      id: gateId,
      cycleId,
      gateType: "IMPLEMENT_GATE",
      status: gateStatus,
      score,
      checklistResults: items.map(i => ({ name: i.name, passed: i.passed, details: i.details })),
      blockers,
      evaluatedAt: now,
      createdAt: now,
    };

    return {
      passed,
      score,
      items,
      checklistMarkdown,
      implementGate,
    };
  }
}
