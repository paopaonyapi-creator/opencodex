// Policy Engine for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { openAgentOsDb } from "../db";
import type { MobileDevice, PolicyDecision, PolicyDecisionRecord, RiskLevel } from "./types";
import { getMobileRiskClassifier } from "./risk-classifier";

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  riskLevel: RiskLevel;
  ruleId: string;
  reason: string;
  requiresProProfile: boolean;
  requiresApproval: boolean;
  sanitizedGoal: string;
}

export class MobilePolicyEngine {
  private classifier = getMobileRiskClassifier();

  public evaluate(
    taskId: string,
    goal: string,
    device: MobileDevice,
    actionPayload?: Record<string, unknown>,
  ): PolicyEvaluationResult {
    const classification = this.classifier.classify(goal, actionPayload);
    const risk = classification.riskLevel;
    const sanitizedGoal = this.redactSecrets(goal);

    // Rule 1: Blocked devices
    if (device.trustLevel === "blocked") {
      const res: PolicyEvaluationResult = {
        decision: "DENY",
        riskLevel: risk,
        ruleId: "POL-DEV-BLOCKED",
        reason: `Device ${device.alias} is in blocked state.`,
        requiresProProfile: false,
        requiresApproval: false,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 2: Agent access disabled
    if (!device.allowAgent) {
      const res: PolicyEvaluationResult = {
        decision: "DENY",
        riskLevel: risk,
        ruleId: "POL-DEV-NO-AGENT",
        reason: `Agent automation access is disabled for device ${device.alias}.`,
        requiresProProfile: false,
        requiresApproval: false,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 3: R4 Forbidden Actions (Deny unconditionally before calling ARTEMIS)
    if (risk === "R4") {
      const res: PolicyEvaluationResult = {
        decision: "DENY",
        riskLevel: "R4",
        ruleId: "POL-FORBIDDEN-R4",
        reason: `Forbidden safety violation: ${classification.reasons.join("; ")}`,
        requiresProProfile: false,
        requiresApproval: false,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 4: Personal device protection
    if (device.deviceType === "physical_personal" || device.requiresApproval) {
      const res: PolicyEvaluationResult = {
        decision: "WAITING_APPROVAL",
        riskLevel: risk,
        ruleId: "POL-DEV-PERSONAL-APPROVAL",
        reason: `Device ${device.alias} requires operator approval for all operations.`,
        requiresProProfile: risk === "R3",
        requiresApproval: true,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 5: R3 High Risk Actions require Approval & Pro Profile
    if (risk === "R3") {
      const res: PolicyEvaluationResult = {
        decision: "WAITING_APPROVAL",
        riskLevel: "R3",
        ruleId: "POL-HIGH-RISK-APPROVAL",
        reason: `High risk action requires explicit human supervisor approval: ${classification.reasons.join("; ")}`,
        requiresProProfile: true,
        requiresApproval: true,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 6: R2 Medium Risk
    if (risk === "R2") {
      const res: PolicyEvaluationResult = {
        decision: "ALLOW",
        riskLevel: "R2",
        ruleId: "POL-MEDIUM-RISK-AUDIT",
        reason: "Medium risk action permitted on test device with audit trail.",
        requiresProProfile: false,
        requiresApproval: false,
        sanitizedGoal,
      };
      this.recordDecision(taskId, res);
      return res;
    }

    // Rule 7: R0 and R1 Auto Allow
    const res: PolicyEvaluationResult = {
      decision: "ALLOW",
      riskLevel: risk,
      ruleId: risk === "R0" ? "POL-OBSERVE-ALLOW" : "POL-LOW-RISK-ALLOW",
      reason: "Standard automation task allowed on test device.",
      requiresProProfile: false,
      requiresApproval: false,
      sanitizedGoal,
    };
    this.recordDecision(taskId, res);
    return res;
  }

  public redactSecrets(input: string): string {
    return input
      .replace(/(?:password|passwd|pwd)[\s:=]+([^\s,;]+)/gi, "password: [REDACTED]")
      .replace(/(?:api[_-]?key|bearer|token)[\s:=]+([^\s,;]+)/gi, "token: [REDACTED]")
      .replace(/(?:secret)[\s:=]+([^\s,;]+)/gi, "secret: [REDACTED]");
  }

  private recordDecision(taskId: string, evalResult: PolicyEvaluationResult): void {
    const db = openAgentOsDb();
    const id = `pdec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.query(`
      INSERT INTO mobile_policy_decisions (
        id, task_id, risk_level, decision, rule_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      evalResult.riskLevel,
      evalResult.decision,
      evalResult.ruleId,
      evalResult.reason,
      Date.now(),
    );
  }

  public getPolicyDecisions(taskId: string): PolicyDecisionRecord[] {
    const db = openAgentOsDb();
    const rows = db.query(`
      SELECT * FROM mobile_policy_decisions WHERE task_id = ? ORDER BY created_at ASC
    `).all(taskId) as any[];

    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      riskLevel: r.risk_level,
      decision: r.decision,
      ruleId: r.rule_id,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }
}

let policyEngineInstance: MobilePolicyEngine | null = null;
export function getMobilePolicyEngine(): MobilePolicyEngine {
  if (!policyEngineInstance) {
    policyEngineInstance = new MobilePolicyEngine();
  }
  return policyEngineInstance;
}
