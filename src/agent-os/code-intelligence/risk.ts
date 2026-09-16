// Phase 20.62 — Impact risk model + policy (spec §15-§18, §27).
//
// Deterministic scoring 0-100 from graph evidence, protected areas, path
// classes, freshness and diff size. Thresholds configurable. Risk is an input
// to policy, never the sole decision.

import type { ImpactReport, RiskFactor, RiskLevel, RiskThresholds } from "./types";

export function classifyRisk(score: number, thresholds: RiskThresholds): RiskLevel {
  if (score >= thresholds.critical) return "critical";
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}

/** Path-class signals for protected/high-value modules (spec §15, §18). */
export function protectedAreaMatches(relativePath: string, protectedPaths: string[]): string[] {
  const normalized = relativePath.replace(/\\/g, "/");
  return protectedPaths.filter((pattern) => {
    if (pattern.endsWith("/**")) return normalized.startsWith(pattern.slice(0, -3) + "/");
    if (pattern.endsWith("*")) return normalized.startsWith(pattern.slice(0, -1));
    return normalized === pattern || normalized.startsWith(pattern + "/");
  });
}

interface RiskInput {
  targetPath: string;
  directDependents: number;
  transitiveDependents: number;
  crossRepoEdges: number;
  protectedMatches: string[];
  affectedTests: number;
  freshnessState: "fresh" | "stale" | "missing";
  diffFileCount?: number;
  publicApiPath?: boolean;
}

/**
 * Spec §16 factor model. Points are additive and clamped to 100. Every factor
 * is recorded so the policy decision is explainable.
 */
export function scoreImpact(input: RiskInput, thresholds: RiskThresholds): { score: number; level: RiskLevel; factors: RiskFactor[] } {
  const factors: RiskFactor[] = [];
  const add = (factor: string, points: number) => {
    if (points !== 0) factors.push({ factor, points });
  };

  add("direct_dependents", Math.min(20, input.directDependents * 3));
  add("transitive_dependents", Math.min(15, Math.max(0, input.transitiveDependents - input.directDependents) * 2));
  add("cross_repo_edges", Math.min(10, input.crossRepoEdges * 5));
  add("protected_module", Math.min(30, input.protectedMatches.length * 15));
  add("public_api_change", input.publicApiPath ? 10 : 0);
  add("test_uncertainty", input.affectedTests === 0 ? 15 : Math.max(0, 5 - input.affectedTests) * 2);
  add("freshness_penalty", input.freshnessState === "fresh" ? 0 : input.freshnessState === "stale" ? 10 : 20);
  add("large_diff_penalty", Math.min(10, Math.max(0, (input.diffFileCount ?? 0) - 5)));

  const schemaHit = /(^|\/)(migrations|schema|db)(\/|$)/i.test(input.targetPath);
  const authHit = /(^|\/)(auth|security|vault|policy)(\/|$)/i.test(input.targetPath);
  const deployHit = /(^|\/)(deploy|infra|\.github\/workflows)(\/|$)/i.test(input.targetPath);
  add("schema_or_db_change", schemaHit ? 15 : 0);
  add("auth_security_relevance", authHit ? 15 : 0);
  add("deployment_relevance", deployHit ? 10 : 0);

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: classifyRisk(score, thresholds), factors };
}

export interface RiskPolicyOutcome {
  decision: ImpactReport["policyDecision"];
  requiresFreshGraph: boolean;
  reason: string;
}

/**
 * Spec §17 risk policy. CRITICAL blocks autonomous mutation by default;
 * HIGH requires independent review + affected tests + human approval;
 * MEDIUM attaches the impact report and requires a reviewer before merge;
 * LOW proceeds with normal tests.
 */
export function decideRiskPolicy(level: RiskLevel, input: { freshnessState: "fresh" | "stale" | "missing"; requireFreshForHighRisk: boolean }): RiskPolicyOutcome {
  switch (level) {
    case "low":
      return { decision: "allow", requiresFreshGraph: false, reason: "low risk: worker may proceed with normal tests" };
    case "medium":
      return { decision: "reviewer_required", requiresFreshGraph: false, reason: "medium risk: reviewer required before merge; impact report attached" };
    case "high":
      if (input.requireFreshForHighRisk && input.freshnessState !== "fresh") {
        return { decision: "blocked_operator_approval", requiresFreshGraph: true, reason: "high risk on non-fresh graph: refresh required before proceeding" };
      }
      return { decision: "independent_review_and_approval", requiresFreshGraph: input.requireFreshForHighRisk, reason: "high risk: independent reviewer, affected tests, and human approval required" };
    case "critical":
      return { decision: "blocked_operator_approval", requiresFreshGraph: true, reason: "critical risk: autonomous mutation blocked; explicit operator approval, fresh graph, and complete evidence required" };
  }
}

/** Spec §28: escalation when the blast radius grew after an edit. */
export function escalationRequired(riskBefore: RiskLevel, riskAfter: RiskLevel, addedDependencies: number): boolean {
  const order: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  return order[riskAfter] > order[riskBefore] || addedDependencies > 0;
}
