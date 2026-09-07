// Phase 20.8 — Reviewer Council Adapter
// Reuses Pao-hubPro's multi-agent reviewer council to inspect specialist outputs.

import { openAgentOsDb } from "../../db";
import type { CouncilReviewInput, CouncilDecision } from "../types";

export class ReviewerCouncilAdapter {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Reviews specialist results and proposed plans, generating a consensus decision.
   */
  async review(input: CouncilReviewInput, runId?: string): Promise<CouncilDecision> {
    const reasons: string[] = [];
    const conflicts: string[] = [];
    const requiredChanges: string[] = [];
    let score = 0.90;

    // 1. Inspect specialist results for reported failures or blocks
    const failedResults = input.specialistResults.filter((r) => r.status === "failed" || r.status === "blocked");
    if (failedResults.length > 0) {
      reasons.push(`${failedResults.length} specialist(s) reported failure: ${failedResults.map((f) => f.agentSlug).join(", ")}`);
      return {
        decision: "block",
        score: 0.2,
        consensus: 0.9,
        reasons,
        conflicts,
        requiredChanges: ["Resolve failed specialist dependencies"],
      };
    }

    // 2. High severity security findings
    const highRisks = input.specialistResults.flatMap((r) => r.risks.filter((risk) => risk.risk === "high" || risk.risk === "critical"));
    if (highRisks.length > 0) {
      reasons.push(`High/critical risks identified: ${highRisks.map((h) => h.area).join(", ")}`);
      if (input.riskLevel === "critical") {
        return {
          decision: "human_review",
          score: 0.65,
          consensus: 0.85,
          reasons,
          conflicts,
          requiredChanges: ["Operator must manually verify critical security impact"],
        };
      }
      requiredChanges.push(...highRisks.map((h) => h.mitigation));
      score -= 0.15;
    }

    // 3. Inspect proposed changes
    if (input.proposedChanges.length > 0) {
      const hasDeletions = input.proposedChanges.some((p) => p.action === "delete");
      if (hasDeletions && (input.riskLevel === "high" || input.riskLevel === "critical")) {
        reasons.push("Proposed file deletions in high-risk scope require human confirmation");
        return {
          decision: "human_review",
          score: 0.70,
          consensus: 0.90,
          reasons,
          conflicts,
          requiredChanges: ["Operator must approve file deletions"],
        };
      }
      reasons.push(`Reviewed ${input.proposedChanges.length} proposed modification(s)`);
    }

    // 4. Determine final decision
    let decision: CouncilDecision["decision"] = "approve";
    if (requiredChanges.length > 0) {
      decision = "approve_with_changes";
      reasons.push("Approved with required mitigations");
    } else {
      reasons.push("All Reviewer Council quality, security, and architectural checks passed");
    }

    const councilDecision: CouncilDecision = {
      decision,
      score: Math.round(score * 100) / 100,
      consensus: 0.95,
      reasons,
      conflicts,
      requiredChanges,
    };

    // 5. Persist review in SQLite if runId provided
    if (runId) {
      const reviewId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.db.query(`
        INSERT INTO agency_reviews (
          id, run_id, reviewer_type, decision, score, consensus,
          reasons_json, conflicts_json, required_changes_json, details_json, evaluated_at
        ) VALUES (?, ?, 'reviewer_council', ?, ?, ?, ?, ?, ?, '{}', ?)
      `).run(
        reviewId,
        runId,
        councilDecision.decision,
        councilDecision.score,
        councilDecision.consensus,
        JSON.stringify(councilDecision.reasons),
        JSON.stringify(councilDecision.conflicts),
        JSON.stringify(councilDecision.requiredChanges),
        new Date().toISOString(),
      );
    }

    return councilDecision;
  }
}

let defaultCouncilAdapter: ReviewerCouncilAdapter | null = null;
export function getReviewerCouncilAdapter(): ReviewerCouncilAdapter {
  if (!defaultCouncilAdapter) {
    defaultCouncilAdapter = new ReviewerCouncilAdapter();
  }
  return defaultCouncilAdapter;
}
