// Phase 20.57 — Pao-hubPro × SkillsGate: Universal Agent Skill Control Plane.
// Domain types for the skill registry, scanner, policy, deployment, and drift
// engines. Imported skill content is untrusted data: nothing here executes it.

export type SkillSourceType =
  | "local"
  | "git"
  | "github"
  | "marketplace"
  | "generated"
  | "bundled"
  | "unknown";

export type TrustLevel = "unknown" | "organization" | "verified" | "untrusted";

export type SkillStatus =
  | "discovered"
  | "imported"
  | "quarantined"
  | "review_required"
  | "approved"
  | "published"
  | "deprecated"
  | "revoked"
  | "rejected";

export type ScanStatus = "pending" | "scanned" | "failed";

export type Severity = "low" | "medium" | "high" | "critical";

export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected" | "expired" | "revoked";

export type SkillScope = "user" | "project";

export type DeploymentStatus =
  | "planned"
  | "deployed"
  | "verified"
  | "failed"
  | "removed"
  | "rolled_back"
  | "drifted"
  | "conflict";

export type DriftType =
  | "modified"
  | "missing"
  | "extra_files"
  | "hash_mismatch"
  | "target_moved";

export type DriftState = "IN_SYNC" | "MODIFIED" | "MISSING" | "EXTRA_FILES" | "CONFLICT" | "UNKNOWN";

export type PolicyEffect = "allow" | "deny" | "require_approval" | "constrain";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface SkillGateError extends Error {
  readonly code: string;
  readonly httpStatus: number;
}

export class SkillGateHttpError extends Error implements SkillGateError {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus: number, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SkillGateHttpError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface SkillSource {
  id: string;
  sourceType: SkillSourceType;
  displayName: string;
  repositoryUrl: string | null;
  defaultRef: string | null;
  trustLevel: TrustLevel;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SkillFileEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ScanFinding {
  ruleId: string;
  severity: Severity;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  evidenceHash: string;
  message: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  sourceRef: string | null;
  sourceCommit: string | null;
  sourcePath: string | null;
  manifest: SkillManifest;
  contentSha256: string;
  snapshotDir: string;
  scannerVersion: string | null;
  scanStatus: ScanStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  approvalStatus: ApprovalStatus;
  immutable: boolean;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface SkillManifest {
  apiVersion: "pao.dev/v1";
  kind: "AgentSkill";
  metadata: {
    id: string;
    namespace: string;
    slug: string;
    name: string;
    version: string;
    description: string;
    tags: string[];
  };
  source: {
    type: SkillSourceType;
    repository: string | null;
    ref: string | null;
    commit: string | null;
    path: string | null;
    importedAt: string;
    licenseSpdx: string | null;
  };
  entryFile: string;
  files: string[];
  risk: {
    level: RiskLevel;
    score: number;
    scannerVersion: string;
  };
}

export interface SkillRecord {
  id: string;
  namespace: string;
  slug: string;
  displayName: string;
  description: string | null;
  sourceId: string | null;
  status: SkillStatus;
  currentVersion: string | null;
  publisher: string | null;
  licenseSpdx: string | null;
  trustLevel: TrustLevel;
  riskLevel: RiskLevel | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillAgentRecord {
  agentType: string;
  displayName: string;
  adapterVersion: string;
  enabled: boolean;
  detected: boolean;
  capabilities: Record<string, unknown>;
  updatedAt: string;
}

export interface SkillNode {
  id: string;
  name: string;
  kind: string;
  hostname: string | null;
  port: number | null;
  username: string | null;
  authRef: string | null;
  hostKeyFingerprint: string | null;
  environment: string | null;
  status: "unknown" | "online" | "offline" | "degraded" | "blocked";
  allowedRoots: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentTargetRequest {
  agent: string;
  scope: SkillScope;
  projectPath?: string;
  nodeId?: string;
}

export interface ResolvedSkillTarget {
  node: string;
  agent: string;
  scope: SkillScope;
  projectPath: string | null;
  targetDir: string;
  skillDir: string;
}

export interface PlannedFileChange {
  action: "create" | "replace" | "remove";
  relativePath: string;
  targetPath: string;
  expectedSha256: string;
  existingSha256: string | null;
  managed: boolean;
}

export interface DeploymentConflict {
  kind: "unmanaged_file" | "hash_mismatch" | "unsupported_agent" | "target_unresolvable";
  detail: string;
  path?: string;
}

export interface DeploymentPlan {
  deploymentId: string | null;
  skillId: string;
  skillVersionId: string;
  version: string;
  contentSha256: string;
  targets: Array<{
    node: string;
    agent: string;
    scope: SkillScope;
    projectPath: string | null;
    targetDir: string;
    skillDir: string;
    changes: PlannedFileChange[];
    conflicts: DeploymentConflict[];
  }>;
  policyDecision: PolicyDecision;
  approvalRequired: boolean;
  dryRun: boolean;
}

export interface DeploymentRecord {
  id: string;
  skillVersionId: string;
  nodeId: string | null;
  agentType: string;
  scope: SkillScope;
  projectPath: string | null;
  targetPath: string;
  desiredSha256: string;
  actualSha256: string | null;
  status: DeploymentStatus;
  managed: boolean;
  deployedBy: string | null;
  deployedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface SnapshotRecord {
  id: string;
  deploymentId: string;
  reason: string;
  fileIndex: Array<{ relativePath: string; sha256: string; backupPath: string }>;
  snapshotDir: string;
  createdBy: string | null;
  createdAt: string;
}

export interface DriftEventRecord {
  id: string;
  deploymentId: string;
  driftType: DriftType;
  expectedSha256: string | null;
  actualSha256: string | null;
  details: Record<string, unknown>;
  status: "open" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
}

export interface SkillReviewRecord {
  id: string;
  skillVersionId: string;
  requestedAction: string;
  requestedTargets: DeploymentTargetRequest[];
  riskSnapshot: { riskScore: number; riskLevel: RiskLevel; contentSha256: string; findings: number };
  status: "pending" | "approved" | "rejected" | "expired" | "revoked";
  requestedBy: string;
  reviewedBy: string | null;
  decisionReason: string | null;
  constraints: { environments?: string[]; agents?: string[]; scopes?: SkillScope[]; expiresAt?: string };
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  ruleId: string;
}

export interface MarketplaceQuery {
  text: string;
  limit?: number;
}

export interface MarketplaceSkillResult {
  ref: string;
  name: string;
  description: string;
  repositoryUrl: string | null;
  publisher: string | null;
  source: "marketplace";
}

export interface SkillImportResult {
  skill: SkillRecord;
  version: SkillVersion;
  findings: ScanFinding[];
  files: SkillFileEntry[];
  quarantined: boolean;
}

export interface DriftCheckResult {
  deploymentId: string;
  agentType: string;
  targetPath: string;
  state: DriftState;
  drifts: DriftEventRecord[];
}
