// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Core Types, Contracts, Interfaces, and State Models

export type ToolRiskClass = "A" | "B" | "C" | "D" | "E";

export interface ToolPolicyDecision {
  allowed: boolean;
  riskClass: ToolRiskClass;
  requiresApproval: boolean;
  reason: string;
  sanitizedArgs?: Record<string, unknown>;
  blockedPattern?: string;
}

export type SkillSource = "pao" | "ecc" | "project" | "user" | "plugin";
export type SkillRisk = "low" | "medium" | "high";
export type SkillLoadMode = "on_demand" | "eager";

export interface SkillDescriptor {
  id: string;
  name: string;
  source: SkillSource;
  version?: string;
  description: string;
  tags: string[];
  risk: SkillRisk;
  requiredTools: string[];
  supportedHarnesses: string[];
  enabled: boolean;
  trusted: boolean;
  loadMode: SkillLoadMode;
  contentHash?: string;
  sourcePath?: string;
}

export interface AgentDescriptor {
  id: string;
  role: string;
  name: string;
  source: "pao" | "ecc" | "custom";
  description: string;
  readOnly: boolean;
  allowedRiskClasses: ToolRiskClass[];
  allowedTools: string[];
  requiredSkills: string[];
  isSecurityCritical?: boolean;
}

export type ECCMode = "codex-native-plugin" | "project-local" | "legacy-sync" | "native-only" | "degraded";

export interface CodexPluginStatus {
  supported: boolean;
  marketplaceRegistered: boolean;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  version?: string;
  pluginId?: string;
  sourcePath?: string;
}

export interface ECCStatus {
  installed: boolean;
  available: boolean;
  mode: ECCMode;
  version?: string;
  plugin: CodexPluginStatus;
  duplicateInstallDetected: boolean;
  skillsIndexed: number;
  agentsIndexed: number;
  warnings: string[];
  lastCheckedAt: string;
}

export interface ECCDetectionResult {
  codexAvailable: boolean;
  codexVersion?: string;
  pluginSupport: boolean;
  nativePluginInstalled: boolean;
  nativePluginEnabled: boolean;
  nativePluginVersion?: string;
  localCheckoutPresent: boolean;
  localCheckoutPath?: string;
  legacySyncPresent: boolean;
  legacySyncPath?: string;
  duplicateInstall: boolean;
  duplicateDetails?: string;
  agentshieldInstalled: boolean;
  agentshieldVersion?: string;
}

export type VerificationState =
  | "PENDING"
  | "RUNNING"
  | "PASS"
  | "PASS_WITH_WARNINGS"
  | "BLOCKED"
  | "NEEDS_HUMAN_REVIEW"
  | "FAILED";

export interface VerificationCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message?: string;
  durationMs?: number;
}

export interface VerificationResult {
  state: VerificationState;
  checks: VerificationCheck[];
  summary: string;
  timestamp: string;
}

export type CouncilDecisionVerdict = "approve" | "approve_with_warnings" | "revise" | "block";

export interface CouncilScores {
  correctness: number;
  security: number;
  maintainability: number;
  tests: number;
}

export interface CouncilEvidencePacket {
  taskId: string;
  runId: string;
  task: {
    title: string;
    description?: string;
    risk: SkillRisk;
    category?: string;
  };
  plan: {
    summary: string;
    steps: string[];
  };
  diff?: string;
  filesModified?: string[];
  testResults?: {
    passed: number;
    failed: number;
    total: number;
    outputSummary?: string;
  };
  securityFindings?: Array<{
    severity: "low" | "medium" | "high" | "critical";
    rule: string;
    description: string;
    file?: string;
    line?: number;
  }>;
  context?: Record<string, unknown>;
}

export interface CouncilDecisionResult {
  decision: CouncilDecisionVerdict;
  scores: CouncilScores;
  blockingFindings: string[];
  warnings: string[];
  recommendations: string[];
  reviewedAt: string;
}

export type MemoryCategory =
  | "project_facts"
  | "architecture_decisions"
  | "user_preferences"
  | "successful_patterns"
  | "known_failures"
  | "resolved_incidents"
  | "tool_capabilities"
  | "repository_conventions";

export interface MemoryRecord {
  id: string;
  type: MemoryCategory;
  project: string;
  summary: string;
  detail?: string;
  confidence: number;
  source: string;
  createdAt: string;
  sensitive: boolean;
  tags: string[];
}

export interface InstinctRecord {
  id: string;
  trigger: string;
  pattern: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  promotable: boolean;
  candidateSkillId?: string;
  promotedToSkill?: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  runId: string;
  parentId?: string;
  harness: string;
  model?: string;
  agentRole: string;
  selectedSkills: string[];
  requestedTool: string;
  riskClass: ToolRiskClass;
  policyDecision: "allowed" | "denied" | "approval_required";
  approvalState: "none" | "pending" | "granted" | "rejected";
  actionSummary: string;
  filesChanged: string[];
  testResult?: string;
  reviewResult?: string;
  secretRedacted: boolean;
  timestamp: string;
  finalState: VerificationState;
}

export interface HarnessFeatureFlags {
  enabled: boolean;
  skillsEnabled: boolean;
  multiAgentEnabled: boolean;
  learningEnabled: boolean;
}
