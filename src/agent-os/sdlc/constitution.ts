// Phase 20.2 — Project Constitution & Policy Packs
//
// Governs supreme project rules, version pinning, and policy pack merging.

import { createHash } from "node:crypto";

export interface ConstitutionRule {
  id: string;
  category: "security" | "safety" | "quality" | "governance";
  rule: string;
  mandatory: boolean;
}

export const BASELINE_CONSTITUTION_RULES: ConstitutionRule[] = [
  { id: "CONST-01", category: "security", rule: "Never expose secrets or commit real credentials.", mandatory: true },
  { id: "CONST-02", category: "safety", rule: "Never overwrite uncommitted user work or modify dirty git trees.", mandatory: true },
  { id: "CONST-03", category: "quality", rule: "Every production-impacting change requires verifiable test evidence.", mandatory: true },
  { id: "CONST-04", category: "security", rule: "Every new API validates input schemas and authorization.", mandatory: true },
  { id: "CONST-05", category: "safety", rule: "Every background task must define retry and idempotency behavior.", mandatory: true },
  { id: "CONST-06", category: "safety", rule: "Every database migration must be additive and define recovery strategy.", mandatory: true },
  { id: "CONST-07", category: "governance", rule: "High-risk or critical operations require explicit human approval.", mandatory: true },
  { id: "CONST-08", category: "quality", rule: "Deterministic test suites cannot be replaced by AI opinion alone.", mandatory: true },
  { id: "CONST-09", category: "governance", rule: "Production deployment requires health check and rollback verification.", mandatory: true },
  { id: "CONST-10", category: "quality", rule: "Failed mandatory quality gates strictly block convergence.", mandatory: true },
];

export interface PolicyPack {
  name: string;
  version?: number;
  rules: (ConstitutionRule | string)[];
}

export interface ProjectConstitution {
  version: string;
  rules: string[];
  sha256Hash: string;
}

export class ConstitutionManager {
  static getBaselineConstitution(): { version: number; rules: ConstitutionRule[]; contentHash: string } {
    const text = BASELINE_CONSTITUTION_RULES.map(r => `${r.id}: ${r.rule}`).join("\n");
    const contentHash = createHash("sha256").update(text).digest("hex");
    return {
      version: 1,
      rules: BASELINE_CONSTITUTION_RULES,
      contentHash,
    };
  }

  static mergePolicyPacks(base: ConstitutionRule[], packs: PolicyPack[]): { rules: ConstitutionRule[]; contentHash: string } {
    const map = new Map<string, ConstitutionRule>();
    for (const r of base) {
      map.set(r.id, r);
    }
    for (const p of packs) {
      for (const r of p.rules) {
        if (typeof r === "object") {
          map.set(r.id, r);
        }
      }
    }
    const merged = [...map.values()];
    const text = merged.map(r => `${r.id}: ${r.rule}`).join("\n");
    const contentHash = createHash("sha256").update(text).digest("hex");
    return { rules: merged, contentHash };
  }
}

export function getProjectConstitution(): ProjectConstitution {
  const rules = BASELINE_CONSTITUTION_RULES.map(r => `${r.id}: ${r.rule}`);
  const text = rules.join("\n");
  const sha256Hash = createHash("sha256").update(text).digest("hex");
  return {
    version: "1.0.0",
    rules,
    sha256Hash,
  };
}

export function verifyConstitutionHash(c: { rules: (string | ConstitutionRule)[]; sha256Hash?: string; contentHash?: string }): boolean {
  const text = c.rules.map(r => typeof r === "string" ? r : `${r.id}: ${r.rule}`).join("\n");
  const computed = createHash("sha256").update(text).digest("hex");
  const expected = c.sha256Hash || c.contentHash;
  return computed === expected;
}

export function mergePolicyPacks(
  packs: { name: string; rules: (string | ConstitutionRule)[] } | Array<{ name: string; rules: (string | ConstitutionRule)[] }>,
  base?: ProjectConstitution
): ProjectConstitution {
  const baseRules = base ? [...base.rules] : BASELINE_CONSTITUTION_RULES.map(r => `${r.id}: ${r.rule}`);
  const packList = Array.isArray(packs) ? packs : [packs];

  for (const pack of packList) {
    for (const rule of pack.rules) {
      const ruleStr = typeof rule === "string" ? rule : `${rule.id}: ${rule.rule}`;
      if (!baseRules.includes(ruleStr)) {
        baseRules.push(ruleStr);
      }
    }
  }

  const text = baseRules.join("\n");
  const sha256Hash = createHash("sha256").update(text).digest("hex");
  return {
    version: "1.0.0",
    rules: baseRules,
    sha256Hash,
  };
}

export function evaluateConstitutionCompliance(evidence: {
  hasCleanGitTree?: boolean;
  hasDeterministicTests?: boolean;
  hasCouncilApproval?: boolean;
  hasNoSecretLeak?: boolean;
  [key: string]: unknown;
}): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];

  if (evidence.hasCleanGitTree === false) {
    violations.push("Dirty git working tree violates CONST-02: Never overwrite uncommitted work or modify dirty git trees.");
  }
  if (evidence.hasDeterministicTests === false) {
    violations.push("Missing deterministic test evidence violates CONST-03/CONST-08: Tests cannot be replaced by AI opinion.");
  }
  if (evidence.hasCouncilApproval === false) {
    violations.push("Missing council approval violates CONST-07: High-risk operations require explicit human approval.");
  }
  if (evidence.hasNoSecretLeak === false) {
    violations.push("Secret leak detected violates CONST-01: Never expose secrets or commit real credentials.");
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}

