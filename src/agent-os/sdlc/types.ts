// Phase 20.2 — Pao Spec-Driven AI SDLC Orchestrator Types
//
// Canonical type definitions for the Spec-Driven AI Software Engineering Operating Layer.

export type CycleState =
  | "DRAFT"
  | "IDEA"
  | "SPECIFYING"
  | "SPECIFIED"
  | "CLARIFYING"
  | "CLARIFIED"
  | "PLANNING"
  | "PLANNED"
  | "TASKING"
  | "TASKED"
  | "ANALYZING"
  | "ANALYZED"
  | "READY_FOR_DEV"
  | "READY_FOR_IMPLEMENTATION"
  | "IMPLEMENTING"
  | "IMPLEMENTED"
  | "VERIFYING"
  | "VERIFIED"
  | "REVIEWING"
  | "REVIEWED"
  | "CONVERGING"
  | "CONVERGED"
  | "READY_FOR_STAGING"
  | "STAGING"
  | "READY_FOR_DEPLOYMENT"
  | "DEPLOYED"
  | "OPERATING"
  | "CLOSED"
  // Control / Failure states
  | "BLOCKED"
  | "PAUSED"
  | "CANCELLED"
  | "FAILED"
  | "REWORK_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "ROLLBACK_REQUIRED"
  | "ROLLED_BACK";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AutoRunMode = "MANUAL" | "GUIDED" | "AUTO_UNTIL_APPROVAL" | "FULL_AUTO_SAFE_ONLY";

export type RequirementType =
  | "FUNCTIONAL"
  | "NON_FUNCTIONAL"
  | "SECURITY"
  | "PERFORMANCE"
  | "RELIABILITY"
  | "OPERABILITY"
  | "COMPATIBILITY"
  | "DATA"
  | "UX";

export type RequirementStatus = "proposed" | "approved" | "implemented" | "verified" | "rejected";

export type VerificationType =
  | "UNIT_TEST"
  | "INTEGRATION_TEST"
  | "E2E_TEST"
  | "SECURITY_CHECK"
  | "STATIC_ANALYSIS"
  | "MANUAL_REVIEW"
  | "OBSERVABILITY_CHECK"
  | "MIGRATION_TEST"
  | "BUILD_CHECK";

export type AcceptanceCriteriaStatus = "pending" | "passed" | "failed" | "blocked";

export type ClarificationSeverity = "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";

export type ClarificationStatus = "open" | "auto_resolved" | "answered" | "dismissed";

export type AdrStatus = "proposed" | "accepted" | "rejected" | "superseded";

export type TaskType = "setup" | "code" | "test" | "doc" | "migration" | "config";

export type TaskStatus = "pending" | "ready" | "in_progress" | "completed" | "failed" | "blocked";

export type GateType =
  | "SPEC_GATE"
  | "PLAN_GATE"
  | "TASKS_GATE"
  | "IMPLEMENT_GATE"
  | "REVIEW_GATE"
  | "CONVERGE_GATE";

export type GateStatus = "pending" | "evaluating" | "passed" | "failed" | "bypassed";

export type ReviewerRole =
  | "Architect"
  | "Security"
  | "QA"
  | "CodeQuality"
  | "Performance"
  | "SRE";

export type ReviewVerdict = "PASS" | "CONDITIONAL_PASS" | "FAIL" | "ABSTAIN";

export type EvidenceType =
  | "test_run"
  | "lint_check"
  | "build_output"
  | "security_scan"
  | "review_verdict";

export type ApprovalActionType =
  | "high_risk_implementation"
  | "production_deploy"
  | "destructive_migration"
  | "security_boundary_change"
  | "manual_override";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ArtifactType =
  | "spec"
  | "plan"
  | "tasks_dag"
  | "coverage_matrix"
  | "checklist"
  | "changelog"
  | "convergence_report";

export interface SdlcCycle {
  id: string;
  projectId: string | null;
  featureKey: string;
  slug: string;
  title: string;
  summary: string | null;
  sourceIdea: string;
  status: CycleState;
  currentStage: string;
  currentGate: GateType | null;
  riskLevel: RiskLevel;
  priority: number;
  autoRunMode: AutoRunMode;
  branchName: string | null;
  baseBranch: string;
  worktreePath: string | null;
  repoHeadAtStart: string | null;
  latestCommitSha: string | null;
  constitutionVersion: number;
  policyVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface SdlcRequirement {
  id: string;
  cycleId: string;
  key: string; // e.g. FR-001, NFR-001, SEC-001
  type: RequirementType;
  priority: number;
  title: string;
  description: string;
  source: string | null;
  status: RequirementStatus;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface SdlcAcceptanceCriteria {
  id: string;
  requirementId: string;
  cycleId: string;
  key: string; // e.g. AC-001
  description: string;
  verificationType: VerificationType;
  status: AcceptanceCriteriaStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  evidenceId: string | null;
}

export interface SdlcClarification {
  id: string;
  cycleId: string;
  requirementId: string | null;
  category: string;
  severity: ClarificationSeverity;
  question: string;
  proposedResolution: string | null;
  finalResolution: string | null;
  status: ClarificationStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SdlcAdr {
  id: string;
  cycleId: string;
  title: string;
  status: AdrStatus;
  context: string;
  decision: string;
  consequences: string;
  createdAt: string;
}

export interface SdlcTask {
  id: string;
  cycleId: string;
  key: string; // e.g. TASK-001
  taskKey?: string; // alias e.g. TASK-001
  title: string;
  description: string;
  taskType: TaskType | string;
  status: TaskStatus | string;
  priority?: number;
  assignedTo?: string | null;
  assignedWorker?: string | null;
  lockExpiresAt?: string | number | null;
  dependencies: string[]; // task keys that must complete first
  targetFiles?: string[];
  acceptanceCriteriaKeys: string[];
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SdlcGate {
  id: string;
  cycleId: string;
  gateType: GateType;
  status: GateStatus;
  score: number; // 0 to 100
  checklistResults: Array<{ name: string; passed: boolean; details?: string }>;
  blockers: string[];
  evaluatedAt: string | null;
  createdAt: string;
}

export interface SdlcReviewFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SUGGESTION";
  category: string;
  file?: string;
  line?: number;
  issue: string;
  recommendation: string;
}

export interface SdlcReview {
  id: string;
  cycleId: string;
  reviewerRole: ReviewerRole;
  reviewerId: string;
  verdict: ReviewVerdict;
  summary: string;
  findings: SdlcReviewFinding[];
  createdAt: string;
}

export interface SdlcEvidence {
  id: string;
  cycleId: string;
  acceptanceId: string | null;
  evidenceType: EvidenceType;
  command: string | null;
  exitCode: number | null;
  summary: string;
  outputText: string | null;
  sha256: string | null;
  verifiedAt: string;
}

export interface SdlcApproval {
  id: string;
  cycleId: string;
  actionType: ApprovalActionType;
  reason: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  token: string;
  requestedBy: string;
  decidedBy: string | null;
  expiresAt: number;
  createdAt: string;
  decidedAt: string | null;
}

export interface SdlcArtifact {
  id: string;
  cycleId: string;
  artifactType: ArtifactType;
  version: number;
  content: string;
  sha256: string;
  isStale: boolean;
  createdAt: string;
}

export interface SdlcLock {
  id: string;
  resourceId: string;
  ownerId: string;
  cycleId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface CoverageGap {
  type: "UNCOVERED_REQUIREMENT" | "UNCOVERED_AC" | "ORPHAN_TASK" | "MISSING_EVIDENCE";
  referenceKey: string;
  message: string;
  severity: "BLOCKING" | "WARNING";
}

export interface CoverageMatrix {
  totalRequirements: number;
  totalAcceptanceCriteria: number;
  totalTasks: number;
  coveredRequirements: number;
  coveredAcceptanceCriteria: number;
  requirementCoveragePercent: number;
  acCoveragePercent: number;
  gaps: CoverageGap[];
}

export interface SdlcConfig {
  enabled: boolean;
  defaultMode: AutoRunMode;
  autoReview: boolean;
  strictGates: boolean;
  allowDirtyTree: boolean;
  defaultBranchPrefix: string;
  maxConcurrentTasks: number;
  commandTimeoutMs: number;
  approvalExpiryMinutes: number;
}
