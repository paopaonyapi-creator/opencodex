// Phase 20.4 — Pao Autonomous Engineering Council Types
//
// Canonical domain objects for multi-agent parallel worktree execution.
// Phase 20.2 remains the owner of Cycle / Spec / Plan / Requirement /
// AcceptanceCriteria / Task DAG / Gates / Approval / Convergence. This layer
// only adds parallelization, worktree lifecycle, leases, changesets, review
// scheduling, conflict analysis, merge queue and integration.

import type { RiskLevel, SdlcTask } from "../sdlc/types";

/** Spec section 9. */
export type CouncilRunState =
  | "CREATED"
  | "PLANNING"
  | "SCHEDULING"
  | "EXECUTING"
  | "REVIEWING"
  | "VERIFYING"
  | "INTEGRATING"
  | "FULL_VERIFY"
  | "WAITING_APPROVAL"
  | "MERGE_READY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RECOVERY_REQUIRED";

/** Spec section 160. */
export type CouncilExecutionMode =
  | "PLAN_ONLY"
  | "MANUAL_ASSIGN"
  | "PARALLEL_ASSISTED"
  | "AUTONOMOUS_SAFE";

/** Spec section 43. */
export type BudgetMode = "ECONOMY" | "BALANCED" | "FAST" | "CUSTOM";

/** Spec section 11. */
export type CouncilTaskClass =
  | "BACKEND"
  | "FRONTEND"
  | "DATABASE"
  | "MIGRATION"
  | "TEST"
  | "SECURITY"
  | "MCP"
  | "DESKTOP"
  | "DOCS"
  | "INFRA"
  | "CONFIG"
  | "REFACTOR"
  | "RESEARCH"
  | "INVESTIGATION";

/** Spec section 14. */
export type ConflictRisk = "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";

export interface CouncilRun {
  id: string;
  cycleId: string;
  status: CouncilRunState;
  currentStage: string;
  baseBranch: string;
  baseCommitSha: string;
  parallelismLimit: number;
  maxParallelHighRisk: number;
  policyProfile: string;
  budgetProfile: BudgetMode;
  executionMode: CouncilExecutionMode;
  integrationMode: IntegrationStrategy;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
}

/** Spec section 10. */
export interface ParallelizationPlan {
  id: string;
  councilRunId: string;
  cycleId: string;
  taskKeys: string[];
  /** Waves of task keys that may run concurrently. */
  parallelGroups: string[][];
  /** Task keys that must run alone, in listed order. */
  serializedGroups: string[][];
  conflictRisks: ConflictForecast[];
  resourceEstimate: ResourceEstimate;
  generator: string;
  version: number;
  planHash: string;
  generatedAt: string;
}

export interface ResourceEstimate {
  taskCount: number;
  maxConcurrency: number;
  estimatedWallClockMinutes: number;
  estimatedWorktrees: number;
  estimatedAgentRuns: number;
}

/** Spec section 14 / 61. */
export interface ConflictForecast {
  taskA: string;
  taskB: string;
  risk: ConflictRisk;
  overlappingPaths: string[];
  reasons: string[];
}

/** Spec section 15. */
export interface FileIntentManifest {
  taskKey: string;
  expectedReadPaths: string[];
  expectedWritePaths: string[];
  possibleGeneratedPaths: string[];
  forbiddenPaths: string[];
}

/** Spec section 16. */
export type LeaseStatus = "active" | "expired" | "released" | "orphan_inspection";

export interface TaskLease {
  id: string;
  councilRunId: string;
  taskKey: string;
  agentRunId: string | null;
  worktreeId: string | null;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
  heartbeatAt: number;
  status: LeaseStatus;
}

/** Spec section 18 / 20. */
export type AgentProfileId =
  | "backend_implementer"
  | "frontend_implementer"
  | "database_engineer"
  | "test_engineer"
  | "docs_engineer"
  | "infra_engineer"
  | "security_reviewer"
  | "architecture_reviewer"
  | "api_reviewer"
  | "mcp_reviewer"
  | "integration_reviewer"
  | "code_quality_reviewer";

export interface AgentProfile {
  profileId: AgentProfileId;
  providerId: string;
  model: string | null;
  roles: string[];
  handles: CouncilTaskClass[];
  languages: string[];
  maxContext: number;
  supportsTools: boolean;
  supportsPatch: boolean;
  supportsShell: boolean;
  supportsTests: boolean;
  costClass: "low" | "medium" | "high";
  speedClass: "slow" | "medium" | "fast";
  isReviewer: boolean;
  enabled: boolean;
}

export type AgentRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "BLOCKED_PROVIDER";

export interface AgentRun {
  id: string;
  councilRunId: string;
  taskKey: string;
  profileId: string;
  providerId: string;
  role: "implementer" | "reviewer" | "resolver";
  worktreeId: string | null;
  status: AgentRunStatus;
  attempt: number;
  startedAt: string | null;
  endedAt: string | null;
  heartbeatAt: number | null;
  currentStage: string | null;
  tokensUsed: number | null;
  estimatedCostUsd: number | null;
  failureReason: string | null;
}

/** Spec section 24. */
export interface AgentOutputReport {
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  testsRun: string[];
  testResults: string;
  knownLimitations: string[];
  assumptions: string[];
  risks: string[];
  requestedFollowUps: string[];
  commitSha: string | null;
}

/** Spec section 30. */
export type WorktreeState =
  | "CREATING"
  | "READY"
  | "ACTIVE"
  | "DIRTY"
  | "COMMITTED"
  | "REVIEWING"
  | "INTEGRATED"
  | "FAILED"
  | "ORPHANED"
  | "CLEANUP_PENDING"
  | "CLEANED";

export interface WorktreeRecord {
  id: string;
  councilRunId: string;
  cycleId: string;
  taskKey: string | null;
  path: string;
  branch: string;
  baseSha: string;
  headSha: string | null;
  status: WorktreeState;
  isIntegration: boolean;
  createdAt: string;
  lastSeenAt: string;
  cleanupStatus: string | null;
}

/** Spec section 35. */
export interface ChangeSet {
  id: string;
  councilRunId: string;
  taskKey: string;
  worktreeId: string;
  agentRunId: string | null;
  baseSha: string;
  headSha: string;
  diffHash: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  generatedFiles: string[];
  migrationFiles: string[];
  risk: RiskLevel;
  scopeDrift: boolean;
  scopeDriftPaths: string[];
  revision: number;
  createdAt: string;
}

/** Spec section 36. */
export interface DiffSafetyReport {
  passed: boolean;
  secretFindings: string[];
  unexpectedPaths: string[];
  binaryFiles: string[];
  largeFiles: string[];
  forbiddenFiles: string[];
}

/** Spec section 52. */
export type ReviewDecision =
  | "PASS"
  | "PASS_WITH_NOTES"
  | "CHANGES_REQUIRED"
  | "BLOCK"
  | "UNAVAILABLE";

export type ReviewAssignmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "stale"
  | "unavailable";

export interface ReviewAssignment {
  id: string;
  councilRunId: string;
  changesetId: string;
  reviewerProfile: AgentProfileId;
  reviewerAgentRunId: string | null;
  required: boolean;
  status: ReviewAssignmentStatus;
  round: number;
  createdAt: string;
}

/** Spec section 120. */
export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type FindingResolution =
  | "OPEN"
  | "ACCEPTED"
  | "FIXED"
  | "WONT_FIX_APPROVED"
  | "FALSE_POSITIVE"
  | "SUPERSEDED";

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: string;
  file: string | null;
  line: number | null;
  title: string;
  description: string;
  evidence: string | null;
  suggestedFix: string | null;
  blocking: boolean;
  fingerprint: string;
  resolution: FindingResolution;
  reviewerSources: string[];
}

export interface ReviewResult {
  id: string;
  assignmentId: string;
  changesetId: string;
  reviewerProfile: AgentProfileId;
  decision: ReviewDecision;
  severityCounts: Record<FindingSeverity, number>;
  findings: ReviewFinding[];
  requiredFixes: string[];
  suggestions: string[];
  evidence: string | null;
  reviewedDiffHash: string;
  reviewedHeadSha: string;
  createdAt: string;
}

/** Spec section 55. */
export type VerificationScope = "TASK_LOCAL" | "CHANGESET" | "INTEGRATION";

/** Spec section 60. */
export type CheckOutcome = "PASS" | "FAIL" | "FLAKY_SUSPECTED" | "NOT_RUN" | "BLOCKED";

/** Spec section 115. */
export type FailureOrigin = "PRE_EXISTING" | "INTRODUCED" | "UNKNOWN";

export interface VerificationCheck {
  name: string;
  command: string;
  outcome: CheckOutcome;
  exitCode: number | null;
  outputSummary: string;
  logRef: string | null;
  durationMs: number;
  origin: FailureOrigin;
  timestamp: string;
}

export interface VerificationBundle {
  id: string;
  councilRunId: string;
  scope: VerificationScope;
  changesetId: string | null;
  integrationRunId: string | null;
  commitSha: string;
  checks: VerificationCheck[];
  passed: boolean;
  bundleHash: string;
  createdAt: string;
}

/** Spec section 73. */
export type ConflictType = "TEXTUAL" | "SEMANTIC" | "MIGRATION_ORDER" | "LOCKFILE";

export type ConflictCaseStatus = "open" | "resolving" | "resolved" | "abandoned";

export interface ConflictCase {
  id: string;
  councilRunId: string;
  candidateIds: string[];
  changesetIds: string[];
  files: string[];
  baseSha: string;
  conflictType: ConflictType;
  status: ConflictCaseStatus;
  resolver: string | null;
  resolutionChangesetId: string | null;
  detail: string;
  createdAt: string;
}

/** Spec section 64 / 67. */
export type MergeQueueState =
  | "PENDING"
  | "READY"
  | "INTEGRATING"
  | "VERIFYING"
  | "WAITING_APPROVAL"
  | "MERGE_READY"
  | "FAILED"
  | "SUPERSEDED";

export interface MergeCandidate {
  id: string;
  councilRunId: string;
  changesetIds: string[];
  targetBaseSha: string;
  status: MergeQueueState;
  conflictStatus: ConflictRisk | "NONE" | "CONFLICTED";
  verificationStatus: CheckOutcome;
  reviewStatus: ReviewDecision | "PENDING";
  approvalStatus: "not_required" | "pending" | "approved" | "rejected" | "stale";
  score: number;
  position: number;
  createdAt: string;
}

/** Spec section 69. */
export type IntegrationStrategy = "MERGE_COMMIT" | "CHERRY_PICK" | "SEQUENTIAL_APPLY";

export type IntegrationRunStatus =
  | "PENDING"
  | "RUNNING"
  | "CONFLICTED"
  | "VERIFYING"
  | "PASSED"
  | "FAILED"
  | "CANCELLED";

export interface IntegrationRun {
  id: string;
  councilRunId: string;
  worktreeId: string | null;
  strategy: IntegrationStrategy;
  baseSha: string;
  headSha: string | null;
  candidateIds: string[];
  appliedChangesetIds: string[];
  status: IntegrationRunStatus;
  verificationBundleId: string | null;
  failureReason: string | null;
  createdAt: string;
  endedAt: string | null;
}

/** Spec section 79. */
export type CouncilDecisionType =
  | "APPROVE_MERGE_READY"
  | "REQUEST_CHANGES"
  | "BLOCK_SECURITY"
  | "BLOCK_TEST"
  | "BLOCK_CONFLICT"
  | "WAIT_HUMAN"
  | "CANCEL";

export interface CouncilDecision {
  id: string;
  councilRunId: string;
  decision: CouncilDecisionType;
  rationale: string;
  evidenceRefs: string[];
  options: string[];
  dissent: string[];
  decidedBy: string;
  createdAt: string;
}

/** Spec section 65 — rule-based, evidence-backed. */
export interface MergeReadinessReport {
  councilRunId: string;
  ready: boolean;
  baseSha: string;
  integrationSha: string | null;
  score: number;
  blockingReasons: string[];
  taskKeys: string[];
  changesetIds: string[];
  verificationBundleIds: string[];
  reviewSummary: {
    total: number;
    passed: number;
    changesRequired: number;
    blocked: number;
    stale: number;
  };
  openBlockingFindings: number;
  unresolvedConflicts: number;
  approvalRequired: boolean;
  approvalStatus: string;
  knownLimitations: string[];
  generatedAt: string;
}

/** Spec section 42. */
export interface ResourceBudget {
  maxParallelAgents: number;
  maxParallelHighRisk: number;
  maxWorktrees: number;
  maxProcesses: number;
  maxWallClockMinutes: number;
  maxProviderCostUsd: number | null;
  minFreeDiskBytes: number;
}

/** Spec section 158. */
export interface CouncilConfig {
  enabled: boolean;
  maxParallelAgents: number;
  maxParallelHighRisk: number;
  defaultBudgetMode: BudgetMode;
  defaultExecutionMode: CouncilExecutionMode;
  maxReviewRounds: number;
  agentIdleTimeoutSeconds: number;
  agentStartupTimeoutSeconds: number;
  taskTimeoutSeconds: number;
  commandTimeoutMs: number;
  reviewTimeoutSeconds: number;
  keepFailedWorktrees: boolean;
  keepSuccessfulWorktrees: number;
  cleanupAfterDays: number;
  remotePushEnabled: boolean;
  autoMergeProtectedBranch: boolean;
  worktreeRoot: string;
  branchPrefix: string;
  protectedBranches: string[];
  leaseTtlSeconds: number;
  minFreeDiskBytes: number;
  desktopLaneEnabled: boolean;
}

/** Convenience: a Phase 20.2 task enriched with Phase 20.4 classification. */
export interface ClassifiedTask {
  task: SdlcTask;
  taskKey: string;
  taskClass: CouncilTaskClass;
  risk: RiskLevel;
  targetPaths: string[];
  requiresSerialization: boolean;
  serializationReasons: string[];
}
