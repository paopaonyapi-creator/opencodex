// Phase 20.13 — Reviewer Council Web Agent
//
// Specialized agent persona that audits proposed web mutations against safety policy,
// evaluates QA audit findings, and prepares structured approval proposals for human supervisors.

import { getBrowserPolicyEngine } from "../../security/policy-engine";
import { getBrowserRiskClassifier } from "../../security/risk-classifier";
import { getBrowserApprovalManager } from "../../security/approval-manager";
import type { ApprovalProposal, QAEvaluation } from "../types";

export class ReviewerWebAgent {
  /**
   * Evaluates proposed browser actions and prepares an approval proposal.
   */
  public evaluateAction(
    action: string,
    url: string,
    affectedData: Record<string, unknown>,
    qaEvaluation?: QAEvaluation,
  ): ApprovalProposal {
    const policy = getBrowserPolicyEngine().evaluateAction(action, url);
    const risk = getBrowserRiskClassifier().classify({
      tool: action,
      url,
      agent: "reviewer-agent",
    });

    let recommendation: ApprovalProposal["recommendation"] = "approve";
    let reason = `Action '${action}' evaluated by Reviewer Council on ${url}.`;

    if (policy.status === "deny") {
      recommendation = "reject";
      reason = `POLICY_VIOLATION: ${policy.reason}`;
    } else if (qaEvaluation && qaEvaluation.verdict === "fail") {
      recommendation = "modify";
      reason = `QA_FAILED: Form issues detected: ${qaEvaluation.issues.join(", ")}`;
    } else if (risk === "CONFIRM_REQUIRED") {
      recommendation = "approve";
      reason = `HIGH_RISK_ACTION: '${action}' requires explicit human supervisor consent before execution.`;
    }

    return {
      action,
      website: url,
      reason,
      riskLevel: risk === "CONFIRM_REQUIRED" ? "CONFIRM_REQUIRED" : "CONTROLLED",
      affectedData: { ...affectedData },
      recommendation,
    };
  }

  /**
   * Submits a formal human approval gate request.
   */
  public async submitForHumanApproval(
    proposal: ApprovalProposal,
    agent = "multi-agent-squad",
    waitForDecision = true,
  ): Promise<{ approvalId: string; status: string }> {
    const approvalMgr = getBrowserApprovalManager();

    if (!waitForDecision) {
      const req = approvalMgr.createPendingApproval(
        agent,
        proposal.action,
        proposal.website,
        proposal.reason,
        proposal.affectedData,
      );
      return {
        approvalId: req.id,
        status: req.status,
      };
    }

    const req = await approvalMgr.requestApproval(
      agent,
      proposal.action,
      proposal.website,
      proposal.reason,
      proposal.affectedData,
    );

    return {
      approvalId: req.request.id,
      status: req.status,
    };
  }
}

let reviewerWebAgentInstance: ReviewerWebAgent | null = null;
export function getReviewerWebAgent(): ReviewerWebAgent {
  if (!reviewerWebAgentInstance) {
    reviewerWebAgentInstance = new ReviewerWebAgent();
  }
  return reviewerWebAgentInstance;
}
