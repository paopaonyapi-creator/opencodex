// Phase 20.91b — Engineering Skill Runtime: independent Reviewer Council.
//
// Four specialist lanes (source §15): code reviewer, test engineer, security
// auditor, web performance auditor. Independence rules are structural: each
// lane records its verdict from its own snapshot; findings are aggregated
// deterministically; personas never see another lane's verdict before their
// own first pass (no anchoring), and never deploy.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { getEvidenceCollector } from "./evidence";
import type { ReviewVerdict, ReviewerType, RiskLevel } from "./types";

export interface ReviewFinding {
  id: string;
  workflowId: string;
  reviewerType: ReviewerType;
  reviewerIdentity: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  blocking: boolean;
  title: string;
  detail: string | null;
  location: { file?: string; line?: number } | null;
  status: string;
  createdAt: string;
}

export interface SubmitReviewInput {
  workflowId: string;
  reviewerType: ReviewerType;
  reviewerIdentity: string;
  verdict: ReviewVerdict;
  findings?: Array<{
    severity: "low" | "medium" | "high" | "critical";
    category: string;
    title: string;
    detail?: string;
    file?: string;
    line?: number;
    blocking?: boolean;
  }>;
}

/** Severity → blocking policy (source §16): critical always, high by default, medium configurable, low note. */
function severityToBlocking(severity: string, declaredBlocking?: boolean): boolean {
  if (severity === "critical") return true;
  if (severity === "high") return declaredBlocking !== false;
  if (severity === "medium") return declaredBlocking === true;
  return false;
}

/** Lane trigger rules (source §15.2). */
export function requiredReviewLanes(risk: RiskLevel, surfaces: string[], opts?: { webperfRequested?: boolean }): ReviewerType[] {
  const lanes: ReviewerType[] = ["code_reviewer"];
  if (risk !== "low" || surfaces.some((s) => /behavior|feature|bug|fix/i.test(s))) lanes.push("test_engineer");
  const sensitive = ["auth", "authentication", "authorization", "secrets", "user input", "network", "database", "filesystem", "shell", "mcp", "permissions", "credential", "token", "login", "oauth"];
  if (risk === "high" || risk === "critical" || surfaces.some((s) => sensitive.some((k) => s.toLowerCase().includes(k)))) lanes.push("security_auditor");
  if (opts?.webperfRequested || surfaces.some((s) => /bundle|rendering|image|media|performance/i.test(s))) lanes.push("webperf_auditor");
  return lanes;
}

export class ReviewerCouncil {
  submitReview(input: SubmitReviewInput): { findings: ReviewFinding[]; blockingCount: number } {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const findings: ReviewFinding[] = [];
    for (const f of input.findings ?? []) {
      const id = `eskf_${randomUUID().slice(0, 16)}`;
      const blocking = severityToBlocking(f.severity, f.blocking);
      db.run(
        "INSERT INTO esk_review_findings (id, workflow_id, reviewer_type, reviewer_identity, severity, category, blocking, title, detail, location_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, input.workflowId, input.reviewerType, input.reviewerIdentity, f.severity, f.category, blocking ? 1 : 0, f.title, f.detail ?? null, JSON.stringify({ file: f.file, line: f.line }), "open", now],
      );
      findings.push({ id, workflowId: input.workflowId, reviewerType: input.reviewerType, reviewerIdentity: input.reviewerIdentity, severity: f.severity, category: f.category, blocking, title: f.title, detail: f.detail ?? null, location: { file: f.file, line: f.line }, status: "open", createdAt: now });
    }

    // Every review submission is also evidence — but ONLY the verdict identity
    // is evidenced; findings remain the raw record (separate from model prose).
    getEvidenceCollector().record({
      workflowId: input.workflowId,
      type: "review_verdict",
      producer: `reviewer:${input.reviewerType}`,
      command: `council.submitReview(${input.reviewerType})`,
      exitCode: input.verdict === "blocked" || input.verdict === "changes_required" ? 1 : 0,
      metadata: { verdict: input.verdict, findingsCount: findings.length, reviewerIdentity: input.reviewerIdentity },
    });

    const blockingCount = findings.filter((f) => f.blocking).length;
    return { findings, blockingCount };
  }

  listFindings(workflowId: string): ReviewFinding[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM esk_review_findings WHERE workflow_id = ? ORDER BY created_at").all(workflowId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      workflowId: String(r.workflow_id),
      reviewerType: String(r.reviewer_type) as ReviewerType,
      reviewerIdentity: String(r.reviewer_identity),
      severity: String(r.severity) as ReviewFinding["severity"],
      category: String(r.category),
      blocking: Number(r.blocking) === 1,
      title: String(r.title),
      detail: r.detail === null ? null : String(r.detail),
      location: JSON.parse(String(r.location_json ?? "null")) as ReviewFinding["location"],
      status: String(r.status),
      createdAt: String(r.created_at),
    }));
  }

  /** Deterministic aggregation: an unresolved blocking finding gates READY_TO_SHIP. */
  hasUnresolvedBlocking(workflowId: string): boolean {
    return this.listFindings(workflowId).some((f) => f.blocking && f.status === "open");
  }

  resolveFinding(findingId: string, actor = "operator"): void {
    const db = openAgentOsDb();
    db.run("UPDATE esk_review_findings SET status = 'resolved', resolved_at = ? WHERE id = ?", [new Date().toISOString(), findingId]);
    void actor;
  }
}

let singleton: ReviewerCouncil | null = null;

export function getReviewerCouncil(): ReviewerCouncil {
  if (!singleton) singleton = new ReviewerCouncil();
  return singleton;
}
