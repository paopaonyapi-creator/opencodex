/**
 * Phase 20.56 — default-deny capability policy. LLM output is never an authority.
 */

import type { CapabilityRecord, PolicyEffect, RiskLevel } from "./types";
import { CapError } from "./types";

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason: string;
  readonly ruleId: string;
}

export function decidePublish(risk: RiskLevel, autonomous: boolean): PolicyDecision {
  if (risk === "critical" || risk === "high") {
    return { effect: autonomous ? "deny" : "require_approval", reason: "high/critical capabilities require human review", ruleId: "deny-critical-autopublish" };
  }
  if (risk === "medium") {
    return { effect: "require_approval", reason: "medium capabilities require review before publish", ruleId: "medium-capability-review" };
  }
  return { effect: "allow", reason: "low-risk publish allowed after tests", ruleId: "low-allow" };
}

export function decideInvoke(record: CapabilityRecord, caller: string): PolicyDecision {
  if (record.status !== "PUBLISHED") {
    return { effect: "deny", reason: "only published capabilities may be invoked", ruleId: "invoke-published-only" };
  }
  if (record.manifest.permissions.includes("process.shell") || record.manifest.permissions.includes("filesystem.host.write")) {
    return { effect: "deny", reason: "host-destructive permissions are not invocable", ruleId: "deny-host-destructive" };
  }
  if (record.manifest.runtime.networkMode !== "none" && record.manifest.permissions.includes("network.outbound")) {
    return { effect: "constrain", reason: "network requires an allowlist; default is none", ruleId: "network-domain-allowlist" };
  }
  if (!record.manifest.policy.allowedCallers.includes(caller) && !record.manifest.policy.allowedCallers.includes("agent")) {
    return { effect: "deny", reason: "caller is not allowed", ruleId: "caller-allowlist" };
  }
  return { effect: "allow", reason: "published and policy-allowed", ruleId: "invoke-allow" };
}

export function assertAllowed(decision: PolicyDecision, action: string): void {
  if (decision.effect === "deny") {
    throw new CapError("POLICY_DENIED", `POLICY_DENIED:${action}`, 403, { ruleId: decision.ruleId, reason: decision.reason });
  }
}

