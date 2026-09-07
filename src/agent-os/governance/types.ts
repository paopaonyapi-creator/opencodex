// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Domain Contracts & Governance Type Definitions

export type GovernanceMode = "off" | "lite" | "full" | "ultra";

export type GovernanceRung =
  | "rung_1_skip"          // Skip / YAGNI
  | "rung_2_reuse"         // Reuse existing code
  | "rung_3_stdlib"        // Standard library
  | "rung_4_native"        // Native platform capability
  | "rung_5_dependency"    // Existing installed dependency
  | "rung_6_local_patch"   // Small local patch / implementation
  | "rung_7_new_subsystem"; // Minimum new subsystem required

export type TaskType =
  | "research"
  | "planning"
  | "bugfix"
  | "feature"
  | "refactor"
  | "migration"
  | "security"
  | "infrastructure"
  | "mcp-tool"
  | "agent-definition"
  | "documentation"
  | "test-only";

export type GovernanceRiskLevel = "low" | "medium" | "high" | "critical";

export interface GovernanceConfig {
  enabled: boolean;
  mode: GovernanceMode;
  diffGuard: boolean;
  dependencyGuard: boolean;
  reuseScan: boolean;
  reviewerCouncil: boolean;
  logDecisions: boolean;
  subagentMatcher: string;
}

export interface GovernanceDecision {
  mode: GovernanceMode;
  taskType: TaskType;
  risk: GovernanceRiskLevel;
  selectedRung: GovernanceRung;
  existingCandidates: string[];
  newDependencyRequired: boolean;
  expectedChangeScope: {
    files: number;
    kind: "patch" | "incremental" | "refactor" | "rewrite";
  };
  requiresReviewerCouncil: boolean;
  reasoningSummary: string;
  evaluatedAt: string;
}

export interface DependencyDecision {
  packageName: string;
  allowed: boolean;
  reason: string;
  stdlibAvailable: boolean;
  nativeAvailable: boolean;
  existingDependencyAvailable: boolean;
  existingEquivalent?: string;
  securityReviewNeeded: boolean;
}

export interface DiffScopeSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  newFiles: string[];
  deletedFiles: string[];
  modifiedFiles: string[];
  publicContractChanged: boolean;
  securityGuardsAltered: boolean;
  passed: boolean;
  warnings: string[];
}

export interface TechnicalDebtItem {
  id: string;
  date: string;
  area: string;
  shortcut: string;
  reason: string;
  risk: string;
  triggerToRevisit: string;
  relatedFiles: string[];
  owner: string;
  status: "open" | "resolved" | "wontfix";
}

export interface GovernanceReport {
  mode: GovernanceMode;
  taskType: TaskType;
  risk: GovernanceRiskLevel;
  selectedRung: GovernanceRung;
  reusedComponents: string[];
  newDependencies: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  verificationCommands: string[];
  reviewerCouncilRequired: boolean;
  reviewerCouncilVerdict?: string;
  status: "PASS" | "WARN" | "REJECT";
  summaryText: string;
}
