/**
 * Phase 22 — Pao Autonomous Change Control (ACC) Types
 */

export type RiskTier = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

export type ProposalStatus =
  | "proposed"
  | "analyzing"
  | "sandboxing"
  | "testing"
  | "auditing"
  | "awaiting_approval"
  | "merging"
  | "completed"
  | "rolled_back"
  | "rejected"
  | "failed";

export type IntentCategory =
  | "feature"
  | "fix"
  | "refactor"
  | "docs"
  | "config"
  | "security"
  | "dependency";

export interface BlastRadiusReport {
  score: number; // 0.0 - 1.0
  touchedFiles: string[];
  directDependents: string[];
  transitiveDependents: string[];
  criticalPathsTouched: string[];
  riskTier: RiskTier;
  explanation: string[];
}

export interface GateCheckResult {
  passed: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

export interface TestCheckReceipt {
  typecheck: GateCheckResult;
  lint: GateCheckResult;
  unitTests: GateCheckResult & {
    total: number;
    passedCount: number;
    failedCount: number;
  };
  boundaryTests: GateCheckResult;
  privacyScan: GateCheckResult;
  allPassed: boolean;
}

export interface SandboxExecutionResult {
  worktreePath: string;
  branch: string;
  receipt: TestCheckReceipt;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface CouncilReview {
  reviewerId: string;
  role: string;
  providerFamily: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "BLOCK";
  score: number;
  comments: string;
}

export interface CouncilAuditVerdict {
  councilSessionId: string;
  consensus: "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED" | "HUMAN_CONFIRMATION_REQUIRED";
  unanimous: boolean;
  quorumReached: boolean;
  reviews: CouncilReview[];
  signedToken?: string;
  evaluatedAt: string;
}

export interface ChangeProposal {
  id: string;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  intentCategory: IntentCategory;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  diffSummary?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  blastRadius?: BlastRadiusReport;
  sandboxResult?: SandboxExecutionResult;
  councilVerdict?: CouncilAuditVerdict;
  mergeCommitSha?: string;
  rollbackCommitSha?: string;
  rejectionReason?: string;
}

export interface WatchdogMetrics {
  errorRate: number;
  latencyP95Ms: number;
  healthzOk: boolean;
  crashesDetected: number;
  stabilizationRemainingSeconds: number;
}

export interface ChangeControlConfig {
  autoMergeAllowedTiers: RiskTier[];
  minCouncilScoreForAutoMerge: number;
  stabilizationWindowSeconds: number;
  maxBlastRadiusForAutoMerge: number;
  criticalPathPatterns: string[];
}
