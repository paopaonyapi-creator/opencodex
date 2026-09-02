/**
 * Phase 18.1 — GEO Reviewer Council + approval-bound fix planner.
 * Reviewers are deterministic heuristics over the audit result; they record
 * into the existing reviews ledger and aggregate with summarizeCouncil().
 * The fix planner produces a PLAN ONLY — every step is informational, marked
 * requiresHumanApproval, and there is no execution path in this module.
 */
import { recordReview, summarizeCouncil } from "../../reviews";
import type { GeoAuditResult } from "./types";

export interface GeoReviewerInput {
  reviewer: string;
  verdict: "pass" | "warn" | "fail";
  score: number;
  notes: string;
}

export interface GeoFixPlanStep {
  order: number;
  title: string;
  detail: string;
  target: string;                 // human-readable target (e.g. "robots.txt"), never a file path to write
  requiresHumanApproval: true;
}

export interface GeoFixPlan {
  projectId: string;
  runId: string;
  councilFinal: "pass" | "needs_review" | "fail";
  steps: GeoFixPlanStep[];
  executionPath: "none";
  note: string;
}

/** Deterministic council over one finished audit. Records into reviews ledger. */
export function reviewGeoAudit(audit: GeoAuditResult): { final: "pass" | "needs_review" | "fail"; reviewers: GeoReviewerInput[] } {
  const subjectKind = "geo_audit";
  const subjectId = audit.runId;
  const reviewers: GeoReviewerInput[] = [];

  // Reviewer 1 — evidence integrity: verified share + suppressed handling.
  const summary = audit.verificationSummary;
  const totalChecks = summary.verified + summary.unverified + summary.conflict + summary.suppressed;
  const verifiedShare = totalChecks > 0 ? summary.verified / totalChecks : 0;
  reviewers.push({
    reviewer: "evidence_integrity_reviewer",
    verdict: summary.conflict > 0 ? "fail" : verifiedShare >= 0.5 ? "pass" : "warn",
    score: Math.round(verifiedShare * 100),
    notes: `${summary.verified} verified, ${summary.unverified} unverified, ${summary.conflict} conflicts, ${summary.suppressed} suppressed`,
  });

  // Reviewer 2 — risk: critical/high verified findings are failures to act on.
  const risky = audit.findings.filter(finding => finding.verification === "verified" && (finding.impact === "critical" || finding.impact === "high"));
  reviewers.push({
    reviewer: "geo_risk_reviewer",
    verdict: risky.some(finding => finding.impact === "critical") ? "fail" : risky.length > 0 ? "warn" : "pass",
    score: Math.max(0, 100 - risky.length * 25),
    notes: risky.length > 0 ? `high-priority verified findings: ${risky.map(finding => finding.title).join("; ")}` : "no high-priority verified findings",
  });

  // Reviewer 3 — epistemic honesty: heuristic claims must stay labeled heuristic.
  const heuristicLeak = audit.findings.some(finding => finding.basis === "heuristic" && finding.verification === "verified" && !finding.detail.toLowerCase().includes("heuristic"));
  reviewers.push({
    reviewer: "epistemic_honesty_reviewer",
    verdict: heuristicLeak ? "fail" : "pass",
    score: heuristicLeak ? 0 : 100,
    notes: heuristicLeak ? "a heuristic finding is presented as verified fact" : "all heuristic claims remain labeled heuristic",
  });

  for (const review of reviewers) {
    recordReview({ subjectKind, subjectId, reviewer: review.reviewer, verdict: review.verdict, score: review.score, notes: review.notes });
  }
  return { final: summarizeCouncil(subjectKind, subjectId)!.final, reviewers };
}

/**
 * PLAN-ONLY fix planner. Ordered, minimal, approval-bound steps derived from
 * the audit. This module has no write/execute capability by construction.
 */
export function buildGeoFixPlan(audit: GeoAuditResult, councilFinal: "pass" | "needs_review" | "fail"): GeoFixPlan {
  const steps: GeoFixPlanStep[] = [];
  const push = (title: string, detail: string, target: string) => {
    steps.push({ order: steps.length + 1, title, detail, target, requiresHumanApproval: true });
  };

  for (const finding of audit.findings.filter(item => item.verification === "verified" && item.impact !== "low")) {
    if (finding.agent === "ai-crawler-policy") {
      push(`Review AI crawler policy: ${finding.title}`, `${finding.detail} Decide as a business/privacy choice, then apply manually or via an approved patch.`, "robots.txt");
    } else if (finding.agent === "schema-intelligence") {
      push("Add Organization JSON-LD (proposal only)", `${finding.detail} A schema patch must be reviewed and approved before any change.`, "homepage <head> JSON-LD");
    } else if (finding.agent === "geo-technical") {
      push(`Fix technical issue: ${finding.title}`, finding.detail, finding.title.includes("sitemap") ? "sitemap.xml" : "homepage <head>");
    } else if (finding.agent === "citability") {
      push("Improve low-citability passages", `${finding.detail} Rewrite only with verified facts; keep the brand voice.`, "page content");
    } else if (finding.agent === "entity-consistency") {
      push("Align entity naming", `${finding.detail} Make the JSON-LD name match the site title and real brand.`, "Organization JSON-LD + <title>");
    } else if (finding.agent === "eeat") {
      push("Strengthen E-E-A-T signals", `${finding.detail} Add a real named author and visible dates; never fabricate credentials.`, "page content");
    }
  }

  if (audit.llmsTxt.state === "missing" && audit.llmsProposal) {
    push("Deploy the generated llms.txt proposal", "Review the proposal content in the dashboard, then deploy manually through the site's normal release process after human approval.", "llms.txt");
  }

  if (steps.length === 0) {
    push("No action required", "The audit found no verified medium+ impact issues. Re-run the audit after content changes.", "—");
  }

  return {
    projectId: audit.projectId,
    runId: audit.runId,
    councilFinal,
    steps: steps.slice(0, 12),
    executionPath: "none",
    note: "Plan only. Every step requires human approval; this engine cannot and does not execute website changes.",
  };
}
