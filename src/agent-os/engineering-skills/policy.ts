// Phase 20.91b — Engineering Skill Runtime: permission + risk policy engine.
//
// Deny-by-default for third-party packs (source §17): skills are instructions,
// not authorities — a skill may REQUEST a capability; only Pao-hubPro grants it.
// Risk classes (source §18) map onto the R0–R4 gate documented in the blueprint
// header; the risk class drives reviewers, permissions, approval, deploy eligibility.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { NormalizedSkill, PermissionClass, PolicyDecision, RiskLevel } from "./types";

export interface PermissionRequest {
  skill: NormalizedSkill;
  capability: PermissionClass;
  requestedTier: PermissionTierInput;
}

/** A request may ask for a tier at or below the skill's granted tier. */
type PermissionTierInput = string;

const TIER_RANK: Record<string, number> = {
  denied: 0,
  read: 1,
  docs_only: 1,
  project: 2,
  selected: 2,
  isolated: 2,
  safe_allowlist: 2,
  allowlist: 2,
  branch_write: 3,
  guarded: 3,
  borrowed_tab: 3,
  scoped_reference: 3,
  commit: 4,
  staging: 4,
  privileged_session: 5,
  push: 5,
  unrestricted: 6,
  injected_runtime_only: 5,
  merge: 6,
  production_with_approval: 6,
};

export interface PermissionEvaluation {
  decision: PolicyDecision;
  granted: boolean;
  reason: string;
  /** True when the request escalates above the skill's declared profile. */
  escalation: boolean;
}

/** Evaluate one capability request against the skill's permission profile. */
export function evaluatePermission(request: PermissionRequest): PermissionEvaluation {
  const grantedTier = request.skill.permissions[request.capability];
  if (grantedTier === undefined || grantedTier === "denied") {
    return { decision: "DENY", granted: false, reason: `${request.capability} is denied for skill ${request.skill.slug} (deny-by-default profile)`, escalation: false };
  }
  const requestedRank = TIER_RANK[request.requestedTier] ?? 99;
  const grantedRank = TIER_RANK[grantedTier] ?? 0;
  if (requestedRank > grantedRank) {
    return { decision: "DENY", granted: false, reason: `requested tier '${request.requestedTier}' exceeds granted tier '${grantedTier}' for ${request.capability} — self-elevation is impossible`, escalation: true };
  }
  if (request.capability === "deployment.execute" && grantedTier === "production_with_approval") {
    return { decision: "REQUIRE_APPROVAL", granted: false, reason: "production deployment requires explicit human approval", escalation: false };
  }
  if (grantedTier === "guarded" || grantedTier === "production_with_approval") {
    return { decision: "REQUIRE_APPROVAL", granted: false, reason: `${request.capability}:${grantedTier} requires approval`, escalation: false };
  }
  return { decision: "ALLOW", granted: true, reason: `${request.capability}:${grantedTier} allowed within policy`, escalation: false };
}

export interface RiskClassification {
  risk: RiskLevel;
  matchedRules: string[];
  /** Highest R-gate the task may touch before approval (blueprint header mapping). */
  gate: "R0" | "R1" | "R2" | "R3" | "R4";
}

const CRITICAL_SURFACE: Array<[RegExp, string]> = [
  [/\bproduction\s+(deploy|release|launch)\b|deploy\s+to\s+production\b/i, "production deploy surface"],
  [/\b(destructive|irreversible)\s+(migration|database|db)\b/i, "destructive migration surface"],
  [/\bcredential\s+rotation\b|\brotate\s+(all\s+)?credentials\b/i, "credential rotation surface"],
  [/\bdelete\s+(all|everything|outside)\b/i, "destructive delete surface"],
];

const HIGH_SURFACE: Array<[RegExp, string]> = [
  [/\b(auth|authentication|authorization|oauth|login|session)\b/i, "authentication surface"],
  [/\b(migration|migrate)\b/i, "schema migration surface"],
  [/\b(secret|credential|api[- ]?key|token)\b/i, "secret-adjacent surface"],
  [/\bshell\b|\bexec\b/i, "shell execution surface"],
  [/\b(database|db)\s+(write|schema)\b/i, "database write surface"],
  [/\b(external|outbound)\s+(network|api|webhook)\b/i, "external network surface"],
  [/\b(authenticated|borrowed)\s+(browser|session|tab)\b/i, "authenticated browser surface"],
];

const MEDIUM_SURFACE: Array<[RegExp, string]> = [
  [/\b(api|endpoint|interface)\b/i, "API surface"],
  [/\b(test|spec|coverage)\b/i, "test surface"],
  [/\b(branch|commit)\b/i, "git branch surface"],
  [/\bimplement\b|\bbuild\b/i, "code change surface"],
];

const LOW_SURFACE: Array<[RegExp, string]> = [
  [/\b(prd|spec|requirements|documentation|readme|docs?)\b/i, "documentation surface"],
  [/\b(summarize|explain)\b/i, "read-only surface"],
];

/** Deterministic task risk classification (source §18 examples). */
export function classifyRisk(taskText: string): RiskClassification {
  const matched: string[] = [];
  for (const [re, label] of CRITICAL_SURFACE) {
    if (re.test(taskText)) { matched.push(label); return { risk: "critical", matchedRules: matched, gate: "R4" }; }
  }
  for (const [re, label] of HIGH_SURFACE) {
    if (re.test(taskText)) matched.push(label);
  }
  if (matched.length > 0) return { risk: "high", matchedRules: matched, gate: "R3" };
  for (const [re, label] of MEDIUM_SURFACE) {
    if (re.test(taskText)) matched.push(label);
  }
  if (matched.length > 0) return { risk: "medium", matchedRules: matched, gate: "R2" };
  for (const [re, label] of LOW_SURFACE) {
    if (re.test(taskText)) matched.push(label);
  }
  return { risk: "low", matchedRules: matched, gate: "R1" };
}

/** Persist a policy decision for audit (input-hashed; secrets never recorded). */
export function recordPolicyDecision(input: {
  workflowId: string | null;
  policyId: string;
  action: string;
  decision: PolicyDecision;
  reason: string;
  inputHash?: string;
}): string {
  const id = `eskd_${randomUUID().slice(0, 16)}`;
  try {
    const db = openAgentOsDb();
    db.run(
      "INSERT INTO esk_policy_decisions (id, workflow_id, policy_id, action, decision, reason, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.workflowId, input.policyId, input.action, input.decision, input.reason, input.inputHash ?? null, new Date().toISOString()],
    );
  } catch {
    // Best-effort: decision is still returned to the caller even if persistence fails.
  }
  return id;
}
