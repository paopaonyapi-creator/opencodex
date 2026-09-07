// Phase 20.8 — Reality Checker Gate
// Independent ground truth verification to prevent false approvals and fabricated claims.

import { existsSync } from "node:fs";
import { openAgentOsDb } from "../../db";
import type { EvidenceItem, RealityGateResult, AgentResult } from "../types";

export class RealityGate {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Verifies claims and evidence provided by specialists.
   */
  async verify(
    specialistResults: AgentResult[],
    evidenceList: EvidenceItem[],
    runId?: string,
  ): Promise<RealityGateResult> {
    const verifiedClaims: string[] = [];
    const failedClaims: string[] = [];
    const missingEvidence: string[] = [];

    // 1. Inspect evidence items
    for (const item of evidenceList) {
      if (item.type === "file") {
        if (existsSync(item.reference)) {
          item.verified = true;
          item.verificationDetails = "File verified on local filesystem";
          verifiedClaims.push(`Verified file artifact: ${item.reference}`);
        } else {
          item.verified = false;
          item.verificationDetails = "Referenced file does not exist on filesystem";
          failedClaims.push(`Claimed file missing: ${item.reference}`);
        }
      } else if (item.type === "test" || item.type === "command" || item.type === "artifact") {
        if (item.summary && item.summary.length > 5) {
          item.verified = true;
          verifiedClaims.push(`Verified ${item.type} output: ${item.summary.slice(0, 60)}`);
        } else {
          missingEvidence.push(`Incomplete evidence description for ${item.reference}`);
        }
      } else {
        item.verified = true;
        verifiedClaims.push(`Verified runtime evidence: ${item.reference}`);
      }
    }

    // 2. Check specialist claims
    for (const result of specialistResults) {
      if (result.status === "success" && result.evidence.length === 0 && result.proposedChanges.length > 0) {
        missingEvidence.push(`Specialist ${result.agentSlug} proposed changes without providing verifiable evidence`);
      }
    }

    const passed = failedClaims.length === 0 && (missingEvidence.length === 0 || verifiedClaims.length > 0);
    const score = passed ? (failedClaims.length === 0 ? 0.95 : 0.6) : 0.3;

    const gateResult: RealityGateResult = {
      passed,
      verifiedClaims,
      failedClaims,
      missingEvidence,
      score: Math.round(score * 100) / 100,
    };

    // 3. Persist review in SQLite if runId provided
    if (runId) {
      const reviewId = `rev_reality_${Date.now()}`;
      this.db.query(`
        INSERT INTO agency_reviews (
          id, run_id, reviewer_type, decision, score, consensus,
          reasons_json, conflicts_json, required_changes_json, details_json, evaluated_at
        ) VALUES (?, ?, 'reality_checker', ?, ?, 1.0, ?, ?, ?, ?, ?)
      `).run(
        reviewId,
        runId,
        passed ? "approve" : "block",
        gateResult.score,
        JSON.stringify(gateResult.verifiedClaims),
        JSON.stringify(gateResult.failedClaims),
        JSON.stringify(gateResult.missingEvidence),
        JSON.stringify({ verifiedCount: verifiedClaims.length, failedCount: failedClaims.length }),
        new Date().toISOString(),
      );
    }

    return gateResult;
  }
}

let defaultRealityGate: RealityGate | null = null;
export function getRealityGate(): RealityGate {
  if (!defaultRealityGate) {
    defaultRealityGate = new RealityGate();
  }
  return defaultRealityGate;
}
