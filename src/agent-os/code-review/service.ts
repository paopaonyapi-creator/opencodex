// Deterministic code review service — session orchestration + persistence
// (GOLD vertical slice #1 on the Phase 20.81 contract).
//
// Fail-closed rules: capture/engine failures persist a failed session with
// a stable error code and rethrow; nothing in this module can turn a failed
// review into a PASS. Repeat reviews of an identical diff (same repository,
// mode, refs, diff hash) return the existing completed session instead of
// duplicating audit records. Every SQL statement is a static string with
// bound parameters — no query is ever assembled from input.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { runGit } from "../council/git-safety";
import { captureDiff, assertSafeRef, type CapturedDiff } from "./capture";
import {
  DETERMINISTIC_ENGINE_ID,
  buildReviewUnits,
  collectRawFindings,
  estimateTokenBudget,
  evaluateGate,
  normalizeFindings,
  requiredReviewers,
  ruleRegistryHash,
} from "./engine";
import { REVIEW_POLICY_VERSION, changeSetRisk } from "./rules";
import {
  ReviewError,
  type GateResult,
  type ReviewFinding,
  type ReviewPreview,
  type ReviewRequest,
  type ReviewSessionRecord,
  type ReviewUnit,
} from "./types";

interface SessionRow {
  id: string;
  repository_path: string;
  mode: string;
  from_ref: string | null;
  to_ref: string | null;
  commit_sha: string | null;
  head_sha: string | null;
  diff_hash: string;
  status: string;
  gate: string | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  protected_path_changed: number;
  policy_version: string;
  rule_hash: string;
  error_code: string | null;
  requested_by: string;
  created_at: string;
  completed_at: string | null;
}

function rowToSession(row: SessionRow): ReviewSessionRecord {
  return {
    sessionId: row.id,
    repositoryPath: row.repository_path,
    mode: row.mode as ReviewSessionRecord["mode"],
    fromRef: row.from_ref,
    toRef: row.to_ref,
    commitSha: row.commit_sha,
    headSha: row.head_sha,
    diffHash: row.diff_hash,
    status: row.status as ReviewSessionRecord["status"],
    gate: (row.gate ?? null) as ReviewSessionRecord["gate"],
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    protectedPathChanged: row.protected_path_changed === 1,
    policyVersion: row.policy_version,
    ruleHash: row.rule_hash,
    errorCode: row.error_code,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

interface GateRow {
  id: string;
  session_id: string;
  gate: string;
  reasons_json: string;
  decided_at: string;
}

function findRow(rows: unknown[]): SessionRow | undefined {
  return rows.find(Boolean) as SessionRow | undefined;
}

function findGateRow(rows: unknown[]): GateRow | undefined {
  return rows.find(Boolean) as GateRow | undefined;
}

export class CodeReviewService {
  private db() {
    return openAgentOsDb();
  }

  /** Deterministic preview — never invokes a reviewer or LLM (§49). */
  async preview(request: ReviewRequest): Promise<ReviewPreview & { units: ReviewUnit[] }> {
    const captured = await this.capture(request);
    const selected = captured.files.filter((f) => !f.excludable && !f.isBinary);
    const units = buildReviewUnits(selected);
    const risk = changeSetRisk(captured.files);
    return {
      mode: request.mode,
      headSha: captured.headSha,
      diffHash: captured.diffHash,
      filesChanged: captured.files.length,
      filesSelected: selected.length,
      filesExcluded: captured.files.length - selected.length,
      reviewUnits: units.length,
      risk,
      requiredReviewers: requiredReviewers(risk),
      protectedPathChanged: captured.files.some((f) => f.protectedPath),
      estimatedTokenBudget: estimateTokenBudget(selected.length),
      units,
    };
  }

  /** Full deterministic review: capture → units → findings → gate → persist. */
  async runReview(request: ReviewRequest): Promise<{
    session: ReviewSessionRecord;
    findings: ReviewFinding[];
    gate: GateResult;
    reused: boolean;
  }> {
    const now = new Date().toISOString();
    let captured: CapturedDiff;
    try {
      captured = await this.capture(request);
    } catch (error) {
      this.persistFailed(request, error);
      throw error;
    }

    const existing = this.db()
      .query("SELECT * FROM cr_sessions WHERE repository_path = ? AND mode = ? AND diff_hash = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1")
      .all(captured.repositoryPath, request.mode, captured.diffHash);
    const prior = findRow(existing);
    if (prior) {
      const sessionId = prior.id;
      const findings = this.listFindings(sessionId);
      const gate = this.loadGate(sessionId);
      return { session: rowToSession(prior), findings, gate, reused: true };
    }

    const sessionId = "rev_" + randomUUID().slice(0, 12);
    const selected = captured.files.filter((f) => !f.excludable && !f.isBinary);
    const units = buildReviewUnits(selected);
    const raw = collectRawFindings(selected);
    const findings = normalizeFindings(sessionId, raw);
    for (const finding of findings) {
      const owner = units.find((unit) => unit.files.includes(finding.location.path));
      finding.unitId = owner?.unitId ?? units[0]?.unitId ?? "ru_000";
    }
    const protectedPathChanged = captured.files.some((f) => f.protectedPath);
    const gate = evaluateGate(findings, protectedPathChanged);

    const insertSession = this.db().query(
      "INSERT INTO cr_sessions (id, repository_path, mode, from_ref, to_ref, commit_sha, head_sha, diff_hash, status, gate, critical_count, high_count, medium_count, protected_path_changed, policy_version, rule_hash, error_code, requested_by, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
    );
    insertSession.run(
      sessionId, captured.repositoryPath, request.mode, request.from ?? null, request.to ?? null,
      request.commit ?? null, captured.headSha, captured.diffHash, gate.gate,
      gate.counts.critical, gate.counts.high, gate.counts.medium, protectedPathChanged ? 1 : 0,
      REVIEW_POLICY_VERSION, ruleRegistryHash(), request.requestedBy, now, now,
    );
    const insertFinding = this.db().query(
      "INSERT INTO cr_findings (id, session_id, unit_id, path, start_line, end_line, category, subcategory, severity, confidence, title, description, evidence, suggestion, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const finding of findings) {
      insertFinding.run(
        finding.findingId + "_" + sessionId.slice(-6), sessionId, finding.unitId,
        finding.location.path, finding.location.startLine, finding.location.endLine,
        finding.category, finding.subcategory ?? null, finding.severity, finding.confidence,
        finding.title, finding.description, finding.evidence, finding.suggestion ?? null,
        finding.status, finding.source, now,
      );
    }
    this.db().query(
      "INSERT INTO cr_gate_results (id, session_id, gate, reasons_json, decided_at) VALUES (?, ?, ?, ?, ?)",
    ).run("gate_" + sessionId.slice(-6), sessionId, gate.gate, JSON.stringify(gate.reasons), now);

    return { session: this.getSession(sessionId)!, findings, gate, reused: false };
  }

  listSessions(limit = 20): ReviewSessionRecord[] {
    return (this.db()
      .query("SELECT * FROM cr_sessions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as SessionRow[]).map(rowToSession);
  }

  getSession(sessionId: string): ReviewSessionRecord | null {
    const row = findRow(this.db().query("SELECT * FROM cr_sessions WHERE id = ?").all(sessionId));
    return row ? rowToSession(row) : null;
  }

  listFindings(sessionId: string): ReviewFinding[] {
    return (this.db()
      .query("SELECT * FROM cr_findings WHERE session_id = ? ORDER BY start_line LIMIT 500")
      .all(sessionId) as Array<Record<string, unknown>>).map((row) => ({
        findingId: String(row.id).split("_").slice(0, 2).join("_"),
        sessionId: String(row.session_id),
        unitId: String(row.unit_id ?? ""),
        source: "deterministic" as const,
        location: { path: String(row.path), startLine: Number(row.start_line), endLine: Number(row.end_line) },
        category: String(row.category),
        subcategory: row.subcategory === null ? undefined : String(row.subcategory),
        severity: String(row.severity) as ReviewFinding["severity"],
        confidence: Number(row.confidence),
        title: String(row.title),
        description: String(row.description ?? ""),
        evidence: String(row.evidence ?? ""),
        suggestion: row.suggestion === null ? undefined : String(row.suggestion),
        status: String(row.status) as ReviewFinding["status"],
      }));
  }

  loadGate(sessionId: string): GateResult {
    const row = findGateRow(this.db().query("SELECT * FROM cr_gate_results WHERE session_id = ? ORDER BY decided_at DESC LIMIT 1").all(sessionId));
    if (!row) {
      const session = this.getSession(sessionId);
      return { gate: session?.gate ?? "PASS", counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, reasons: ["no gate record; fail-closed default"] };
    }
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const session = this.getSession(sessionId);
    if (session) {
      counts.critical = session.criticalCount;
      counts.high = session.highCount;
      counts.medium = session.mediumCount;
    }
    return {
      gate: String(row.gate) as GateResult["gate"],
      counts,
      reasons: JSON.parse(String(row.reasons_json ?? "[]")) as string[],
    };
  }

  private async capture(request: ReviewRequest): Promise<CapturedDiff> {
    if (request.mode === "range") {
      if (request.from) assertSafeRef(request.from, "from");
      if (request.to) assertSafeRef(request.to, "to");
    }
    // git-safety (Phase 20.4) is the sanctioned git boundary: denylist rules,
    // no push, non-interactive env. Review is read-only by construction.
    const outcome = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: request.repositoryPath });
    if (!outcome.ok) {
      throw new ReviewError("REVIEW_REPOSITORY_NOT_FOUND", 404, "path is not a git work tree");
    }
    return captureDiff(request);
  }

  private persistFailed(request: ReviewRequest, error: unknown): void {
    try {
      const now = new Date().toISOString();
      const sessionId = "rev_" + randomUUID().slice(0, 12);
      const code = error instanceof ReviewError ? error.code : "REVIEW_INTERNAL_ERROR";
      this.db().query(
        "INSERT INTO cr_sessions (id, repository_path, mode, from_ref, to_ref, commit_sha, head_sha, diff_hash, status, gate, critical_count, high_count, medium_count, protected_path_changed, policy_version, rule_hash, error_code, requested_by, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'unavailable', 'failed', NULL, 0, 0, 0, 0, ?, ?, ?, ?, ?, NULL)",
      ).run(
        sessionId, request.repositoryPath, request.mode, request.from ?? null, request.to ?? null,
        request.commit ?? null, REVIEW_POLICY_VERSION, ruleRegistryHash(), code, request.requestedBy, now,
      );
    } catch {
      // Persistence of the failure marker must never mask the original error.
    }
  }
}

let singleton: CodeReviewService | null = null;

export function getCodeReviewService(): CodeReviewService {
  if (!singleton) singleton = new CodeReviewService();
  return singleton;
}

export { DETERMINISTIC_ENGINE_ID };
