// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Reviewer Council Trigger: High-Risk Simplification Authorization Bridge

import type { GovernanceDecision, GovernanceRiskLevel, DiffScopeSummary } from "./types";
import { getReviewerCouncilBridge } from "../desktop-runtime/reviewer-council/reviewer-council-bridge";

export interface CouncilReviewRequest {
  taskId: string;
  requirement: string;
  decision: GovernanceDecision;
  diffSummary?: DiffScopeSummary;
  sensitiveAreas: string[];
}

export interface CouncilReviewVerdict {
  approved: boolean;
  verdict: "approve" | "human_review" | "reject";
  reasons: string[];
  recommendedMitigations: string[];
}

export class CouncilTrigger {
  /**
   * Determine whether a task or diff mandates Reviewer Council review.
   */
  shouldTriggerCouncil(params: {
    risk: GovernanceRiskLevel;
    sensitiveAreas: string[];
    diffSummary?: DiffScopeSummary;
    mode?: string;
  }): boolean {
    if (params.risk === "high" || params.risk === "critical") {
      return true;
    }

    if (params.sensitiveAreas.length > 0) {
      return true;
    }

    if (params.diffSummary) {
      if (params.diffSummary.securityGuardsAltered || params.diffSummary.publicContractChanged) {
        return true;
      }
      // Large refactor
      if (params.diffSummary.filesChanged > 15 || params.diffSummary.deletions > 500) {
        return true;
      }
    }

    if (params.mode === "ultra") {
      return true;
    }

    return false;
  }

  /**
   * Delegates evaluation to the Pao-hubPro Reviewer Council.
   */
  async evaluate(request: CouncilReviewRequest): Promise<CouncilReviewVerdict> {
    const councilBridge = getReviewerCouncilBridge();

    // Map to council tool evaluation
    const councilResult = await councilBridge.evaluate({
      runId: request.taskId,
      mission: request.requirement,
      risk: request.decision.risk,
      toolCall: {
        id: `gov_${Date.now()}`,
        runId: request.taskId,
        toolId: `governance__${request.decision.taskType}`,
        namespace: "governance",
        name: request.decision.taskType,
        risk: request.decision.risk,
        arguments: {
          requirement: request.requirement,
          selectedRung: request.decision.selectedRung,
          newDependency: request.decision.newDependencyRequired,
          sensitiveAreas: request.sensitiveAreas,
        },
      },
    });

    const approved = councilResult.decision === "approve";
    const verdict = councilResult.decision;

    const reasons = councilResult.reasons || [];
    if (!approved && reasons.length === 0) {
      reasons.push(`Reviewer Council flagged ${request.decision.risk} risk in: ${request.sensitiveAreas.join(", ") || "core logic"}`);
    }

    return {
      approved,
      verdict,
      reasons,
      recommendedMitigations: [
        "Ensure all verification tests pass before merge",
        "Verify backup and rollback procedures remain intact",
      ],
    };
  }
}

let defaultCouncilTrigger: CouncilTrigger | null = null;
export function getCouncilTrigger(): CouncilTrigger {
  if (!defaultCouncilTrigger) {
    defaultCouncilTrigger = new CouncilTrigger();
  }
  return defaultCouncilTrigger;
}
