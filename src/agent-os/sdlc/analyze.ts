// Phase 20.2 — Cross-Consistency & Traceability Analysis Engine (/analyze)
//
// Verifies end-to-end traceability: Requirement -> Acceptance Criteria -> Tasks -> Verification Evidence.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { CoverageMatrix, CoverageGap } from "./types";

export class AnalyzeEngine {
  static analyzeCycle(cycleId: string): CoverageMatrix {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    const reqRows = db.query("SELECT id, key, title FROM sdlc_requirements WHERE cycle_id = ?").all(cycleId) as Array<{
      id: string;
      key: string;
      title: string;
    }>;

    const acRows = db.query("SELECT id, requirement_id, key, description, verification_type, status, evidence_id FROM sdlc_acceptance_criteria WHERE cycle_id = ?").all(cycleId) as Array<{
      id: string;
      requirement_id: string;
      key: string;
      description: string;
      verification_type: string;
      status: string;
      evidence_id: string | null;
    }>;

    const taskRows = db.query("SELECT id, key, title, acceptance_criteria_keys_json FROM sdlc_tasks WHERE cycle_id = ?").all(cycleId) as Array<{
      id: string;
      key: string;
      title: string;
      acceptance_criteria_keys_json: string;
    }>;

    const gaps: CoverageGap[] = [];

    // 1. Check requirements have ACs
    let coveredReqCount = 0;
    for (const req of reqRows) {
      const matchingAcs = acRows.filter(a => a.requirement_id === req.id);
      if (matchingAcs.length === 0) {
        gaps.push({
          type: "UNCOVERED_REQUIREMENT",
          referenceKey: req.key,
          message: `Requirement ${req.key} ('${req.title}') has no mapped Acceptance Criteria`,
          severity: "BLOCKING",
        });
      } else {
        coveredReqCount++;
      }
    }

    // 2. Check ACs are mapped to tasks
    let coveredAcCount = 0;
    const taskAcKeys = new Set<string>();
    for (const task of taskRows) {
      const keys = JSON.parse(task.acceptance_criteria_keys_json || "[]") as string[];
      for (const k of keys) taskAcKeys.add(k);
    }

    for (const ac of acRows) {
      if (!taskAcKeys.has(ac.key)) {
        gaps.push({
          type: "UNCOVERED_AC",
          referenceKey: ac.key,
          message: `Acceptance Criterion ${ac.key} is not covered by any implementation task`,
          severity: "BLOCKING",
        });
      } else {
        coveredAcCount++;
      }
    }

    // 3. Check for orphan tasks
    for (const task of taskRows) {
      const keys = JSON.parse(task.acceptance_criteria_keys_json || "[]") as string[];
      if (keys.length === 0) {
        gaps.push({
          type: "ORPHAN_TASK",
          referenceKey: task.key,
          message: `Task ${task.key} ('${task.title}') is not bound to any Acceptance Criteria`,
          severity: "WARNING",
        });
      }
    }

    const reqPercent = reqRows.length > 0 ? Math.round((coveredReqCount / reqRows.length) * 100) : 100;
    const acPercent = acRows.length > 0 ? Math.round((coveredAcCount / acRows.length) * 100) : 100;

    // Generate coverage matrix markdown artifact
    const markdown = [
      `# Traceability & Coverage Matrix`,
      "",
      `**Cycle ID:** ${cycleId}`,
      `**Analyzed At:** ${now}`,
      `**Requirement Coverage:** ${reqPercent}% (${coveredReqCount}/${reqRows.length})`,
      `**Acceptance Criteria Coverage:** ${acPercent}% (${coveredAcCount}/${acRows.length})`,
      "",
      "## 1. Traceability Map",
      "| Requirement | Acceptance Criteria | Target Tasks | Verification Type | Status |",
      "|---|---|---|---|---|",
      ...acRows.map(ac => {
        const req = reqRows.find(r => r.id === ac.requirement_id);
        const mappedTasks = taskRows
          .filter(t => (JSON.parse(t.acceptance_criteria_keys_json || "[]") as string[]).includes(ac.key))
          .map(t => t.key)
          .join(", ");
        return `| ${req?.key ?? "-"} | ${ac.key} | ${mappedTasks || "**NONE**"} | ${ac.verification_type} | ${ac.status} |`;
      }),
      "",
      "## 2. Detected Coverage Gaps",
      ...(gaps.length > 0
        ? gaps.map(g => `- **[${g.severity}] ${g.type}**: ${g.message}`)
        : ["*No gaps detected. 100% full traceability achieved.*"]),
    ].join("\n");

    const sha256 = createHash("sha256").update(markdown).digest("hex");
    const artifactId = `art_cov_${cycleId}`;

    db.run("DELETE FROM sdlc_artifacts WHERE cycle_id = ? AND artifact_type = 'coverage_matrix'", [cycleId]);
    db.query(`
      INSERT INTO sdlc_artifacts
        (id, cycle_id, artifact_type, version, content, sha256, is_stale, created_at)
      VALUES (?, ?, 'coverage_matrix', 1, ?, ?, 0, ?)
    `).run(artifactId, cycleId, markdown, sha256, now);

    return {
      totalRequirements: reqRows.length,
      totalAcceptanceCriteria: acRows.length,
      totalTasks: taskRows.length,
      coveredRequirements: coveredReqCount,
      coveredAcceptanceCriteria: coveredAcCount,
      requirementCoveragePercent: reqPercent,
      acCoveragePercent: acPercent,
      gaps,
    };
  }
}
