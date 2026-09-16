// Phase 20.28 — Deny-first, fail-closed policy engine (doc §11).
//
// Order: deny → require_approval → allow → default DENY. Missing policy
// denies; a malformed condition evaluates as non-matching for ALLOW (never
// grants) and as matching for DENY (fails closed). Conditions are structured
// objects — there is no eval and no string-expression parser.

import type {
  ActionEffect,
  ActionRequest,
  GovernanceCondition,
  GovernancePolicy,
  RiskLevel,
} from "./types";

interface PolicyContext {
  risk: RiskLevel;
  effect: ActionEffect;
  provider: string;
  tool: string;
  resourceKind: string;
  resourcePath?: string;
  resourceHost?: string;
}

function fieldValues(ctx: PolicyContext): Record<string, string | undefined> {
  return {
    "risk": ctx.risk,
    "effect": ctx.effect,
    "provider": ctx.provider,
    "tool": ctx.tool,
    "resource.kind": ctx.resourceKind,
    "resource.path": ctx.resourcePath,
    "resource.host": ctx.resourceHost,
  };
}

function matches(ctx: PolicyContext, condition: GovernanceCondition): boolean {
  if ("all" in condition) {
    return condition.all.every((c) => matches(ctx, c));
  }
  if ("any" in condition) {
    return condition.any.some((c) => matches(ctx, c));
  }
  if ("not" in condition) {
    return !matches(ctx, condition.not);
  }
  const values = fieldValues(ctx);
  const actual = values[condition.field];
  if (condition.op === "matches") {
    // Path/host pattern: bounded regex against the actual value only.
    if (typeof actual !== "string" || typeof condition.value !== "string") return false;
    try {
      return new RegExp(condition.value, "i").test(actual);
    } catch {
      return false;
    }
  }
  if (Array.isArray(condition.value)) {
    return actual !== undefined && condition.value.includes(actual);
  }
  return actual !== undefined && actual === condition.value;
}

export interface PolicyEvaluation {
  decision: "allow" | "deny" | "require_approval";
  matchedPolicyIds: string[];
  matchedRuleIds: string[];
  reasonCode: string;
  reason: string;
}

/**
 * Evaluate DENY before REQUIRE_APPROVAL before ALLOW; default deny. A broken
 * deny condition still denies (compiled patterns that throw do not match, but
 * a policy whose deny list is unreadable/malformed is reported by the caller
 * as GOVERNANCE_POLICY_INVALID and denied there).
 */
export function evaluatePolicies(policies: GovernancePolicy[], ctx: PolicyContext): PolicyEvaluation {
  const matchedPolicies: string[] = [];
  const matchedRules: string[] = [];

  for (const policy of policies) {
    if (!policy.enabled) continue;
    matchedPolicies.push(policy.id);

    for (const rule of policy.deny) {
      try {
        if (matches(ctx, rule.when)) {
          return {
            decision: "deny",
            matchedPolicyIds: matchedPolicies,
            matchedRuleIds: [...matchedRules, policy.id + ":" + rule.id],
            reasonCode: rule.reasonCode || "GOVERNANCE_POLICY_DENIED",
            reason: "denied by rule " + rule.id + " in policy " + policy.name,
          };
        }
      } catch {
        return {
          decision: "deny",
          matchedPolicyIds: matchedPolicies,
          matchedRuleIds: [...matchedRules, policy.id + ":" + rule.id],
          reasonCode: "GOVERNANCE_POLICY_INVALID",
          reason: "malformed deny rule fails closed",
        };
      }
    }
  }

  for (const policy of policies) {
    if (!policy.enabled) continue;
    for (const rule of policy.requireApproval) {
      try {
        if (matches(ctx, rule.when)) {
          return {
            decision: "require_approval",
            matchedPolicyIds: matchedPolicies,
            matchedRuleIds: [...matchedRules, policy.id + ":" + rule.id],
            reasonCode: rule.reasonCode || "GOVERNANCE_APPROVAL_REQUIRED",
            reason: "approval required by rule " + rule.id + " in policy " + policy.name,
          };
        }
      } catch {
        // A broken approval rule must not grant access; skip it.
      }
    }
  }

  for (const policy of policies) {
    if (!policy.enabled) continue;
    for (const rule of policy.allow) {
      try {
        if (matches(ctx, rule.when)) {
          return {
            decision: "allow",
            matchedPolicyIds: matchedPolicies,
            matchedRuleIds: [...matchedRules, policy.id + ":" + rule.id],
            reasonCode: rule.reasonCode || "policy.allow",
            reason: "allowed by rule " + rule.id + " in policy " + policy.name,
          };
        }
      } catch {
        // A broken allow rule never grants access.
      }
    }
  }

  return {
    decision: "deny",
    matchedPolicyIds: matchedPolicies,
    matchedRuleIds: matchedRules,
    reasonCode: "GOVERNANCE_POLICY_DENIED",
    reason: "no allow rule matched; policy engine fails closed",
  };
}

export const BASELINE_POLICY: GovernancePolicy = {
  id: "policy_default_agent",
  version: 1,
  name: "default-agent-policy",
  enabled: true,
  deny: [
    {
      id: "deny-sensitive-paths",
      when: { field: "resource.path", op: "matches", value: "(^|/)(\\.ssh|\\.gnupg|\\.aws|\\.kube)(/|$)|\\.env(\\.|$)|credentials|secrets|private.*key|id_rsa" },
      reasonCode: "GOVERNANCE_CREDENTIAL_DENIED",
    },
    {
      id: "deny-cloud-metadata",
      when: { field: "resource.host", op: "matches", value: "169\\.254\\.169\\.254|metadata\\.google\\.internal|metadata\\.goob" },
      reasonCode: "GOVERNANCE_RESOURCE_OUT_OF_SCOPE",
    },
  ],
  requireApproval: [
    { id: "approve-high-risk", when: { field: "risk", op: "in", value: ["high", "critical"] }, reasonCode: "GOVERNANCE_APPROVAL_REQUIRED" },
    { id: "approve-side-effect", when: { field: "effect", op: "in", value: ["execute", "external_write", "destructive", "credential", "admin", "unknown"] }, reasonCode: "GOVERNANCE_APPROVAL_REQUIRED" },
  ],
  allow: [
    { id: "allow-read", when: { field: "effect", op: "eq", value: "read" }, reasonCode: "policy.allow.read" },
    { id: "allow-workspace-write", when: { field: "effect", op: "eq", value: "write" }, reasonCode: "policy.allow.write" },
  ],
};
