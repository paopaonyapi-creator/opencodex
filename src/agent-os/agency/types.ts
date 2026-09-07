// Phase 20.8 — Pao-hubPro × Agency Agents Dynamic Specialist Router
// Domain types and contracts for the Agency Intelligence Layer

export type AgentDivision =
  | "engineering"
  | "design"
  | "product"
  | "project-management"
  | "testing"
  | "security"
  | "research"
  | "specialized"
  | "marketing"
  | "support"
  | "finance"
  | "sales"
  | string;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type PromptSafetyStatus = "clean" | "warning" | "blocked";

export type AgencyRunStatus =
  | "CREATED"
  | "ROUTING"
  | "TEAM_SELECTED"
  | "PLANNING"
  | "DELEGATING"
  | "AGGREGATING"
  | "COUNCIL_REVIEW"
  | "REALITY_CHECK"
  | "SECURITY_CHECK"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

export interface AgencyAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  division: AgentDivision;
  sourceId?: string;
  sourcePath: string;
  sourceCommit?: string;

  capabilities: string[];
  keywords: string[];
  deliverables: string[];
  criticalRules: string[];
  successMetrics: string[];

  bodyLoaded: boolean;
  body?: string;
  parsedSections?: any;

  hashes: {
    metadata: string;
    body?: string;
    metadataHash?: string;
    bodyHash?: string;
  };

  trust: {
    source: "upstream" | "local" | "cached" | "custom" | "bundled";
    verified: boolean;
  };

  safety: {
    status: PromptSafetyStatus;
    findings: string[];
  };

  enabled: boolean;
  isCustom?: boolean;
  extendsSlug?: string;
  color?: string;
  emoji?: string;
  vibe?: string;

  performance?: {
    runs: number;
    successRate: number;
    avgLatencyMs: number;
  };
}

export interface AgentSearchQuery {
  query: string;
  division?: string;
  capabilities?: string[];
  limit?: number;
  exclude?: string[];
  requiredTags?: string[];
}

export interface RoutingScoreBreakdown {
  capability: number;
  semantic: number;
  keyword: number;
  division: number;
  deliverable: number;
  reliability: number;
}

export interface AgentSearchResult {
  agent: AgencyAgent;
  score: number;
  reasons: string[];
  breakdown: RoutingScoreBreakdown;
}

export interface SelectedAgent {
  slug: string;
  name: string;
  role: "lead" | "planner" | "builder" | "reviewer" | "validator";
  division: string;
  score: number;
  reasons: string[];
  color?: string;
  emoji?: string;
}

export interface DynamicTeam {
  id: string;
  name?: string;
  mission: string;
  riskLevel: RiskLevel;

  lead: SelectedAgent;
  planners: SelectedAgent[];
  builders: SelectedAgent[];
  reviewers: SelectedAgent[];
  validators: SelectedAgent[];

  executionMode: "sequential" | "parallel" | "hybrid";
  rationale: string[];
  createdAt?: string;
}

export interface RolePreference {
  preferred?: string[];
  capabilities?: string[];
}

export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  lead: RolePreference;
  planners?: RolePreference;
  builders: RolePreference;
  reviewers: RolePreference;
  validators: RolePreference;
  maxAgents: number;
  defaultMode: "sequential" | "parallel" | "hybrid";
}

export interface AgentSubtask {
  id: string;
  title: string;
  objective: string;
  dependencies: string[];
  assignedAgent: string;
  risk: RiskLevel;
  expectedArtifacts: string[];
  doneCriteria: string[];
  status?: "pending" | "running" | "completed" | "failed" | "blocked";
  attemptCount?: number;
}

export interface ProjectContextSummary {
  stack?: string;
  changedFiles?: string[];
  phase?: string;
  availableTools?: string[];
}

export interface DelegationRequest {
  runId: string;
  taskId: string;
  agentSlug: string;

  mission: string;
  subtask: AgentSubtask;

  projectContext?: ProjectContextSummary;
  allowedTools: string[];
  forbiddenActions: string[];

  expectedOutputSchema?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface Finding {
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  detail: string;
}

export interface Recommendation {
  action: string;
  rationale: string;
  priority: number;
}

export interface ProposedChange {
  path: string;
  action: "create" | "modify" | "delete";
  diff?: string;
  description: string;
}

export interface RiskFinding {
  area: string;
  risk: RiskLevel;
  mitigation: string;
}

export interface EvidenceItem {
  id?: string;
  type:
    | "file"
    | "test"
    | "command"
    | "log"
    | "url"
    | "diff"
    | "runtime"
    | "artifact";
  reference: string;
  summary: string;
  verified: boolean;
  verificationDetails?: string;
}

export interface AgentResult {
  runId: string;
  taskId: string;
  agentSlug: string;

  status: "success" | "partial" | "failed" | "blocked";

  summary: string;
  findings: Finding[];
  recommendations: Recommendation[];
  proposedChanges: ProposedChange[];
  evidence: EvidenceItem[];

  risks: RiskFinding[];
  unresolved: string[];

  confidence: number;

  startedAt: string;
  finishedAt: string;
  latencyMs: number;
}

export interface CouncilReviewInput {
  mission: string;
  plan: AgentSubtask[];
  specialistResults: AgentResult[];
  proposedChanges: ProposedChange[];
  riskLevel: RiskLevel;
}

export interface CouncilDecision {
  decision:
    | "approve"
    | "approve_with_changes"
    | "request_revision"
    | "block"
    | "human_review";
  score: number;
  consensus: number;
  reasons: string[];
  conflicts: string[];
  requiredChanges: string[];
  details?: Record<string, unknown>;
}

export interface RealityGateResult {
  passed: boolean;
  verifiedClaims: string[];
  failedClaims: string[];
  missingEvidence: string[];
  score: number;
}

export interface SecurityGateResult {
  passed: boolean;
  blockedActions: string[];
  riskTier: RiskLevel;
  requiresHumanApproval: boolean;
  findings: string[];
}

export interface ApprovedExecutionPlan {
  runId: string;
  mission: string;
  team: DynamicTeam;
  plan: AgentSubtask[];
  proposedChanges: ProposedChange[];
  approvedBy: string;
  approvedAt: string;
}

export interface ExecutionResult {
  success: boolean;
  executor: string;
  artifacts: string[];
  logs: string[];
  durationMs: number;
  error?: string;
}

export interface AgencySyncResult {
  source: string;
  sourceType: "remote-git" | "local-clone" | "cached-snapshot" | "bundled-fallback";
  syncedCount: number;
  skippedCount: number;
  blockedCount: number;
  commitHash?: string;
  durationMs: number;
  errors: string[];
}
