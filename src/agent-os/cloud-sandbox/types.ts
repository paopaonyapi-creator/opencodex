// Phase 20.15 — Pao-hubPro × Floci Cloud Sandbox Plane: shared contracts.
//
// Provider-neutral on purpose. Nothing in this file may name Floci, Docker, or AWS
// specifics: source spec §56 requires cloud-core to stay independent of any emulator,
// and §5.5 requires the adapter abstraction to exist from the first commit rather than
// being retrofitted once a second provider lands.

export type CloudProvider = "aws" | "azure" | "gcp" | "oci";

export type CloudEnvironment = "local" | "staging" | "production";

/** Source spec §11.3. The storage mode each profile maps to is fixed by §1.4. */
export type SandboxProfile = "ephemeral" | "resumable" | "durable" | "forensic";

export type StorageMode = "memory" | "hybrid" | "persistent" | "wal";

/** Source spec §12 lifecycle state machine. */
export type SandboxStatus =
  | "requested"
  | "policy_check"
  | "approval_pending"
  | "provisioning"
  | "ready"
  | "running"
  | "testing"
  | "snapshotting"
  | "failed"
  | "expired"
  | "destroying"
  | "destroyed";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalMode = "none" | "conditional" | "required";

/**
 * Source spec §42. `UNAVAILABLE` is a real answer, not a failure: on a host with no
 * Docker daemon a Docker-backed service must report UNAVAILABLE rather than let an
 * adapter fake success, because §42 forbids treating a local pass as production proof.
 */
export type ServiceFidelity =
  | "IN_PROCESS"
  | "DOCKER_BACKED"
  | "STUB"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "UNKNOWN";

/** Source spec §16.1 credential classes. */
export type CredentialClass =
  | "LOCAL_FAKE"
  | "STAGING_LIMITED"
  | "PRODUCTION_APPROVAL_ONLY";

export const PROFILE_STORAGE_MODE: Readonly<Record<SandboxProfile, StorageMode>> = {
  ephemeral: "memory",
  resumable: "hybrid",
  durable: "persistent",
  forensic: "wal",
};

/** Source spec §5.3 / §26: TTL is bounded so an agent cannot pin a sandbox open forever. */
export const SANDBOX_TTL_LIMITS = {
  minMinutes: 5,
  maxMinutes: 480,
  defaultMinutes: 60,
} as const;

export interface CloudEndpointSet {
  base: string;
  region: string;
  services: Record<string, string>;
}

export interface SandboxConfig {
  services: string[];
  storageMode: StorageMode;
  ttlMinutes: number;
  quotas?: Record<string, number>;
}

export interface StartSandboxInput {
  id: string;
  workspaceId: string;
  taskId?: string | null;
  runId?: string | null;
  actorId: string;
  profile: SandboxProfile;
  services: string[];
  storageMode: StorageMode;
  ttlMinutes: number;
}

export interface SandboxRuntime {
  id: string;
  adapter: string;
  endpoints: CloudEndpointSet;
  startedAt: string;
  fidelity: Record<string, ServiceFidelity>;
}

export type SandboxHealthState = "healthy" | "degraded" | "unhealthy" | "unreachable";

export interface HealthReport {
  sandboxId: string;
  state: SandboxHealthState;
  endpointReachable: boolean;
  readyServices: string[];
  unavailableServices: string[];
  dockerRequired: boolean;
  checkedAt: string;
  detail?: string;
}

export interface AdapterAvailability {
  adapter: string;
  available: boolean;
  reason?: string;
  dockerRequired: boolean;
  dockerReachable: boolean;
  checkedAt: string;
}

export interface CloudActionRequest {
  service: string;
  operation: string;
  payload?: Record<string, unknown>;
}

export interface CloudActionResult {
  ok: boolean;
  service: string;
  operation: string;
  data?: unknown;
  errorCode?: string;
  message?: string;
}

export interface LogStream {
  name: string;
  content: string;
  truncated: boolean;
}

export interface LogBundle {
  sandboxId: string;
  collectedAt: string;
  streams: LogStream[];
}

/** Source spec §47 leak-detection surfaces. */
export type LeakKind =
  | "container"
  | "network"
  | "volume"
  | "port"
  | "workspace"
  | "registry";

export interface LeakFinding {
  kind: LeakKind;
  identifier: string;
  sandboxId: string;
}

export interface DestroyReport {
  sandboxId: string;
  destroyedAt: string;
  resourcesRemoved: number;
  leaked: LeakFinding[];
  ok: boolean;
}

export interface SnapshotRef {
  snapshotId: string;
  sandboxId: string;
  adapter: string;
  storageMode: StorageMode;
  createdAt: string;
  sourceDigest: string;
}

export interface CloudResource {
  id: string;
  sandboxId: string;
  provider: CloudProvider;
  service: string;
  type: string;
  externalId?: string;
  name?: string;
  region?: string;
  state: string;
  fidelity: ServiceFidelity;
  tags: Record<string, string>;
  parentIds: string[];
  discoveredAt: string;
  raw?: unknown;
}

/** Source spec §8.2, extended with the fidelity and Docker facts §42/§10 need. */
export interface CloudCapability {
  id: string;
  provider: CloudProvider;
  service: string;
  operations: string[];
  environments: CloudEnvironment[];
  risk: RiskLevel;
  approvalMode: ApprovalMode;
  fidelity: ServiceFidelity;
  requiresDocker: boolean;
  networkPolicy: string;
  credentialProfile: CredentialClass;
  maxRuntimeSeconds?: number;
  quotas?: Record<string, number>;
}

export interface CloudSandboxRecord {
  id: string;
  workspaceId: string;
  taskId: string | null;
  runId: string | null;
  actorId: string;
  provider: CloudProvider;
  adapter: string;
  profile: SandboxProfile;
  status: SandboxStatus;
  endpoints: CloudEndpointSet;
  config: SandboxConfig;
  createdAt: string;
  expiresAt: string | null;
  destroyedAt: string | null;
}

export type OperationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export interface CloudOperationRecord {
  id: string;
  sandboxId: string | null;
  actorId: string;
  idempotencyKey: string | null;
  operation: string;
  riskLevel: RiskLevel;
  policyDecision: string;
  approvalId: string | null;
  inputDigest: string | null;
  status: OperationStatus;
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
}

export type PromotionStatus =
  | "prepared"
  | "awaiting_review"
  | "awaiting_approval"
  | "approved"
  | "applied"
  | "rejected"
  | "blocked";

/** Source spec §18 + §17.1: what the policy engine may say about one request. */
export type CloudPolicyVerdict =
  | { allowed: true; decision: "allow" | "allow_with_constraints"; reason: string; constraints?: Record<string, number> }
  | { allowed: false; decision: "deny" | "approval_required"; code: "CLOUD_POLICY_DENIED" | "CLOUD_APPROVAL_REQUIRED"; reason: string };

/** Input to SandboxManager.request(); one entry per source spec §33 create call. */
export interface CreateSandboxRequest {
  id: string;
  workspaceId: string;
  actorId: string;
  taskId?: string | null;
  runId?: string | null;
  provider?: CloudProvider;
  adapter?: string;
  profile: SandboxProfile;
  services: string[];
  ttlMinutes?: number;
  idempotencyKey?: string | null;
}

export interface DestroyOutcome {
  sandboxId: string;
  report: DestroyReport;
  resourcesRemoved: number;
}

export interface CloudPromotionRecord {
  id: string;
  workspaceId: string;
  sourceSandboxId: string | null;
  targetEnvironment: CloudEnvironment;
  planDigest: string;
  evidenceBundleId: string;
  status: PromotionStatus;
  approvalId: string | null;
  createdAt: string;
  appliedAt: string | null;
}
