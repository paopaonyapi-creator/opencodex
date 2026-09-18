// Phase 20.89 — Marketplace policy gate.
//
// Decisions: ALLOW | ALLOW_WITH_APPROVAL | DENY | QUARANTINE (source §21).
// Most restrictive applicable rule wins (mission §18 / Phase 20.88 fabric
// pattern). The gate is the ONLY authority for install/enable decisions;
// manifest text and UI intent are never policy.

import type { PolicyDecision } from "./types";
import type { PaoCapabilityManifest } from "./manifest";

export interface MarketplacePolicyRule {
  id: string;
  match: {
    capabilityType?: string;
    permission?: string;
    permissionsAny?: string[];
    path?: string;
    provenance?: string;
    artifactType?: string;
  };
  effect: PolicyDecision;
  reason: string;
}

/** Default rules from source §21, plus fail-closed baseline. */
export const DEFAULT_POLICY_RULES: readonly MarketplacePolicyRule[] = [
  {
    id: "deny-ssh-secret-read",
    match: { permission: "filesystem.read", path: "~/.ssh/**" },
    effect: "DENY",
    reason: "filesystem.read on credential paths is prohibited",
  },
  {
    id: "deny-secrets-read",
    match: { permission: "credential.use" },
    effect: "DENY",
    reason: "credential.use is prohibited by default (secret broker only)",
  },
  {
    id: "approve-shell-write",
    match: { permissionsAny: ["shell.execute", "filesystem.write", "process.spawn", "container.run"] },
    effect: "ALLOW_WITH_APPROVAL",
    reason: "write/execute capability requires operator approval",
  },
  {
    id: "quarantine-unverified-binary",
    match: { artifactType: "binary", provenance: "unverified" },
    effect: "QUARANTINE",
    reason: "unverified binary artifacts are quarantined",
  },
  {
    id: "deny-unverified-high-risk",
    match: { provenance: "unverified" },
    effect: "ALLOW_WITH_APPROVAL",
    reason: "unverified provenance requires review for any install",
  },
];

export interface PolicyInput {
  manifest: PaoCapabilityManifest;
  trustState: string;
  resolvedSourceRef: string | null;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reasons: string[];
  matchedRules: string[];
  approvalRequired: boolean;
}

function manifestPermissionList(manifest: PaoCapabilityManifest): string[] {
  const list: string[] = [];
  for (const scope of manifest.spec.permissions.filesystem.read) list.push("filesystem.read");
  for (const scope of manifest.spec.permissions.filesystem.write) list.push("filesystem.write");
  if (manifest.spec.permissions.shell.allowed) list.push("shell.execute");
  for (const _o of manifest.spec.permissions.network.outbound) list.push("network.outbound");
  if (manifest.spec.permissions.secrets.length > 0) list.push("credential.use");
  return list;
}

function scopeMatches(rulePath: string, scopes: string[]): boolean {
  if (rulePath.endsWith("/**")) {
    const prefix = rulePath.slice(0, -3);
    return scopes.some((s) => s.startsWith(prefix));
  }
  return scopes.includes(rulePath);
}

/**
 * Evaluates the effective decision for a capability manifest. The most
 * restrictive applicable rule wins; evaluation order is DENY > QUARANTINE >
 * ALLOW_WITH_APPROVAL > ALLOW.
 */
export function evaluatePolicy(input: PolicyInput, rules: readonly MarketplacePolicyRule[] = DEFAULT_POLICY_RULES): PolicyEvaluation {
  const reasons: string[] = [];
  const matched: string[] = [];
  let decision: PolicyDecision = "ALLOW";

  const rank: Record<PolicyDecision, number> = { DENY: 3, QUARANTINE: 2, ALLOW_WITH_APPROVAL: 1, ALLOW: 0 };
  const promote = (next: PolicyDecision, reason: string, ruleId: string) => {
    if (rank[next] > rank[decision]) decision = next;
    reasons.push(reason);
    matched.push(ruleId);
  };

  const permissions = manifestPermissionList(input.manifest);
  const unverified = input.trustState === "unverified" || input.trustState === "quarantined" || input.trustState === "revoked";

  for (const rule of rules) {
    let applies = false;
    if (rule.match.capabilityType && rule.match.capabilityType === input.manifest.spec.type) applies = true;
    if (rule.match.permission) {
      const scopeKey = rule.match.permission;
      const family = scopeKey.split(".")[0];
      if (family === "filesystem") {
        if (scopeKey === "filesystem.read" && scopeMatches(rule.match.path ?? "**", input.manifest.spec.permissions.filesystem.read)) applies = true;
        if (scopeKey === "filesystem.write" && scopeMatches(rule.match.path ?? "**", input.manifest.spec.permissions.filesystem.write)) applies = true;
      } else if (permissions.includes(scopeKey)) {
        applies = true;
      }
    }
    if (rule.match.permissionsAny && rule.match.permissionsAny.some((p) => permissions.includes(p))) applies = true;
    if (rule.match.provenance && rule.match.provenance === input.trustState && !rule.match.artifactType) applies = true;
    if (rule.match.provenance === "unverified" && unverified && !rule.match.artifactType) applies = true;

    if (applies) promote(rule.effect, rule.reason, rule.id);
  }

  // Mission hard law: unverified provenance can never be a plain ALLOW.
  if (unverified && decision === "ALLOW") {
    decision = "ALLOW_WITH_APPROVAL";
    reasons.push("unverified provenance requires review (fail-closed)");
    matched.push("baseline-unverified");
  }
  // Mission hard law: production installs must resolve an immutable source ref.
  if (!input.resolvedSourceRef && decision === "ALLOW") {
    decision = "ALLOW_WITH_APPROVAL";
    reasons.push("source ref not resolved to an immutable commit/semver (fail-closed)");
    matched.push("baseline-immutable-ref");
  }

  return {
    decision,
    reasons,
    matchedRules: matched,
    approvalRequired: decision === "ALLOW_WITH_APPROVAL",
  };
}
