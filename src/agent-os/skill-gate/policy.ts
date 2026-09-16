// Phase 20.57 — skill-gate policy decisions (spec §24, §61). Pure functions,
// deterministic, rule-id carrying, fail closed. LLM/semantic output never
// reaches these functions as an authorizer; deterministic scanner risk does.

import type { ApprovalStatus, PolicyDecision, RiskLevel, SkillScope, SkillStatus, TrustLevel } from "./types";

function decision(effect: PolicyDecision["effect"], ruleId: string, reason: string): PolicyDecision {
  return { effect, ruleId, reason };
}

/** Newly imported content from an untrusted source starts quarantined (spec §24). */
export function decideInitialStatus(trustLevel: TrustLevel, riskLevel: RiskLevel): { status: SkillStatus; decision: PolicyDecision } {
  if (trustLevel === "unknown") {
    return { status: "quarantined", decision: decision("constrain", "quarantine-unknown-source", "source trust level is unknown; skill imported as quarantined") };
  }
  if (riskLevel === "critical" || riskLevel === "high") {
    return { status: "review_required", decision: decision("require_approval", "review-high-risk-import", "high/critical risk skill requires human review before publish") };
  }
  return { status: "imported", decision: decision("allow", "allow-trusted-low-risk-import", "trusted source with low/medium risk imported without quarantine") };
}

/** Publishing makes a version immutable; high/critical risk needs a bound approval. */
export function decidePublish(input: {
  riskLevel: RiskLevel;
  status: SkillStatus;
  approvalStatus: ApprovalStatus;
  autonomous: boolean;
}): PolicyDecision {
  if (input.status === "revoked") {
    return decision("deny", "deny-revoked-publish", "revoked skills cannot be published");
  }
  if (input.status === "quarantined") {
    return decision("deny", "deny-quarantined-publish", "quarantined skills require review before publish");
  }
  if (input.riskLevel === "critical") {
    if (input.autonomous) {
      return decision("deny", "deny-critical-autopublish", "critical skills cannot be published autonomously; explicit human review is required");
    }
    if (input.approvalStatus !== "approved") {
      return decision("require_approval", "approval-critical-publish", "critical skills require an approval bound to this exact version");
    }
  }
  if (input.riskLevel === "high" && input.approvalStatus !== "approved") {
    return decision("require_approval", "approval-high-publish", "high-risk skills require an approval bound to this exact version");
  }
  if (input.riskLevel === "medium" && input.approvalStatus === "pending") {
    return decision("require_approval", "approval-medium-pending", "a medium-risk skill has a pending review");
  }
  return decision("allow", "allow-publish", "policy allows publishing this version");
}

/**
 * Deployment gate. An approval only counts when it was recorded for the exact
 * version/content hash (binding is checked by the service before this runs).
 */
export function decideDeploy(input: {
  status: SkillStatus;
  riskLevel: RiskLevel;
  approvalStatus: ApprovalStatus;
  scope: SkillScope;
  environment?: string | null;
  constraints?: { environments?: string[]; agents?: string[]; scopes?: SkillScope[] } | null;
  agent?: string;
}): PolicyDecision {
  if (input.status !== "published") {
    return decision("deny", "deny-unpublished-deploy", `skill status is ${input.status}; only published skills can deploy`);
  }
  if (input.riskLevel === "critical" && input.approvalStatus !== "approved") {
    return decision("deny", "deny-critical-autodeploy", "critical skills require explicit human review and cannot auto-deploy");
  }
  if (input.riskLevel === "high" && input.approvalStatus !== "approved") {
    return decision("require_approval", "approval-high-deploy", "high-risk skills require an approval bound to this exact version");
  }
  if (input.riskLevel === "medium" && input.approvalStatus !== "approved" && input.approvalStatus !== "not_required") {
    return decision("require_approval", "approval-medium-deploy", "medium-risk skill has a pending or rejected review");
  }
  if (input.approvalStatus === "rejected") {
    return decision("deny", "deny-rejected-deploy", "the bound review rejected this version");
  }
  if (input.environment && input.constraints?.environments && input.constraints.environments.length > 0) {
    if (!input.constraints.environments.includes(input.environment)) {
      return decision("deny", "deny-environment-constraint", `approval constrains deployment to environments: ${input.constraints.environments.join(", ")}`);
    }
  }
  if (input.agent && input.constraints?.agents && input.constraints.agents.length > 0) {
    if (!input.constraints.agents.includes(input.agent)) {
      return decision("deny", "deny-agent-constraint", `approval constrains deployment to agents: ${input.constraints.agents.join(", ")}`);
    }
  }
  if (input.constraints?.scopes && input.constraints.scopes.length > 0) {
    if (!input.constraints.scopes.includes(input.scope)) {
      return decision("deny", "deny-scope-constraint", `approval constrains deployment to scopes: ${input.constraints.scopes.join(", ")}`);
    }
  }
  return decision("allow", "allow-deploy", "policy allows deploying this version to the requested target");
}

/** Review decisions themselves are checked for separation of duties. */
export function decideReviewDecision(input: { requestedBy: string; reviewer: string; status: string }): PolicyDecision {
  if (input.status !== "pending") {
    return decision("deny", "deny-non-pending-review", "only pending reviews can be decided");
  }
  if (input.requestedBy === input.reviewer) {
    return decision("deny", "deny-self-approval", "the actor that requested a review cannot decide it (separation of duties)");
  }
  return decision("allow", "allow-review-decision", "review decision accepted");
}
