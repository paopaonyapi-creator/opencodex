// GOLD vertical slice #1 — Deterministic code review runtime foundation.
//
// Contract per the Phase 20.81 blueprint (OpenCodeReview integration):
// the deterministic layer owns diff capture, file selection, rule
// resolution, review units, line anchoring, and the quality gate. LLM
// reviewers attach later as bounded reasoning inside review units; the
// CodeReviewEngine seam keeps an OpenCodeReview CLI adapter possible
// without binding this module to it.

export type ReviewMode = "workspace" | "commit" | "range";

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type GateDecision = "PASS" | "WARN" | "REQUIRE_FIX" | "HUMAN_APPROVAL" | "BLOCK";

export type FindingStatus = "open" | "verified" | "rejected" | "duplicate" | "accepted";

export interface ReviewRequest {
  /** Absolute or workspace-relative path to the git repository to review. */
  repositoryPath: string;
  mode: ReviewMode;
  /** Range mode: base ref (e.g. "main"). */
  from?: string;
  /** Range mode: head ref (e.g. "feature/x"). */
  to?: string;
  /** Commit mode: the commit sha to review. */
  commit?: string;
  requestedBy: string;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** Unified-diff text for this file (headers + hunks). */
  diff: string;
  addedLines: number;
  removedLines: number;
  isBinary: boolean;
  /** Matches the protected-path policy — gate-relevant, never auto-allowed. */
  protectedPath: boolean;
  /** Matches an exclusion pattern (generated, lockfile, vendored) — excluded from units. */
  excludable: boolean;
}

export interface ReviewPreview {
  mode: ReviewMode;
  headSha: string | null;
  diffHash: string;
  filesChanged: number;
  filesSelected: number;
  filesExcluded: number;
  reviewUnits: number;
  risk: "low" | "medium" | "high";
  requiredReviewers: string[];
  protectedPathChanged: boolean;
  estimatedTokenBudget: number;
}

export interface ReviewUnit {
  unitId: string;
  label: string;
  files: string[];
  risk: "low" | "medium" | "high";
  rules: string[];
}

export interface ReviewFinding {
  findingId: string;
  sessionId: string;
  unitId: string;
  source: "deterministic";
  location: { path: string; startLine: number; endLine: number };
  category: string;
  subcategory?: string;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  evidence: string;
  suggestion?: string;
  status: FindingStatus;
}

export interface GateResult {
  gate: GateDecision;
  counts: { critical: number; high: number; medium: number; low: number; info: number };
  reasons: string[];
}

export interface ReviewSessionRecord {
  sessionId: string;
  repositoryPath: string;
  mode: ReviewMode;
  fromRef: string | null;
  toRef: string | null;
  commitSha: string | null;
  headSha: string | null;
  diffHash: string;
  status: "completed" | "failed";
  gate: GateDecision | null;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  protectedPathChanged: boolean;
  policyVersion: string;
  ruleHash: string;
  errorCode: string | null;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
}

export class ReviewError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
