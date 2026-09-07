// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Governance Reporter: Non-Confidential Observable Summary Generator

import type { GovernanceDecision, GovernanceReport, DiffScopeSummary } from "./types";

export class GovernanceReporter {
  /**
   * Builds a structured, non-confidential governance report.
   */
  generateReport(params: {
    decision: GovernanceDecision;
    diffSummary?: DiffScopeSummary;
    verificationCommands?: string[];
    councilVerdict?: string;
    status?: "PASS" | "WARN" | "REJECT";
  }): GovernanceReport {
    const { decision, diffSummary, verificationCommands, councilVerdict } = params;

    const filesChanged = diffSummary?.filesChanged ?? decision.expectedChangeScope.files;
    const insertions = diffSummary?.insertions ?? 0;
    const deletions = diffSummary?.deletions ?? 0;
    const commands = verificationCommands ?? ["bun run typecheck", "bun test"];

    let status = params.status ?? "PASS";
    if (councilVerdict === "reject") {
      status = "REJECT";
    } else if (councilVerdict === "human_review" || (diffSummary?.warnings && diffSummary.warnings.length > 0)) {
      status = "WARN";
    }

    const summaryLines = [
      `Governance mode: ${decision.mode}`,
      `Task: ${decision.taskType}`,
      `Risk: ${decision.risk}`,
      `Selected rung: ${decision.selectedRung}`,
      `Reuse candidates: ${decision.existingCandidates.length > 0 ? decision.existingCandidates.join(", ") : "none"}`,
      `New dependencies: ${decision.newDependencyRequired ? "yes" : "none"}`,
      `Files changed: ${filesChanged}`,
      `Diff: +${insertions} / -${deletions}`,
      `Verification: ${commands.join(" + ")}`,
      `Reviewer Council: ${decision.requiresReviewerCouncil ? (councilVerdict ?? "REQUIRED") : "not required"}`,
      `Status: ${status}`,
    ];

    return {
      mode: decision.mode,
      taskType: decision.taskType,
      risk: decision.risk,
      selectedRung: decision.selectedRung,
      reusedComponents: decision.existingCandidates,
      newDependencies: [],
      filesChanged,
      insertions,
      deletions,
      verificationCommands: commands,
      reviewerCouncilRequired: decision.requiresReviewerCouncil,
      reviewerCouncilVerdict: councilVerdict,
      status,
      summaryText: summaryLines.join("\n"),
    };
  }

  /**
   * Returns a clean markdown block for PR descriptions or agent output.
   */
  formatMarkdown(report: GovernanceReport): string {
    return [
      "### 🛡️ Pao-hubPro × Ponytail Governance Report",
      "",
      "```text",
      report.summaryText,
      "```",
    ].join("\n");
  }
}

let defaultGovernanceReporter: GovernanceReporter | null = null;
export function getGovernanceReporter(): GovernanceReporter {
  if (!defaultGovernanceReporter) {
    defaultGovernanceReporter = new GovernanceReporter();
  }
  return defaultGovernanceReporter;
}
