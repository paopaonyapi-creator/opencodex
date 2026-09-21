// Phase 21.00 — Pao-hubPro Unified Agent Operations Control Plane domain types and contracts.
//
// Key principles:
// 1. One coherent operational model binding OpenHermit (20.98), Whip (20.99), and Pao Core.
// 2. Durable by default (agents, hosts, jobs, workflows, approvals, audit).
// 3. Credential references only; zero plaintext secrets in storage or audit.
// 4. Replay safety: mismatch in context or risk triggers needs_review, never silent execution.
// 5. Audit correlation: correlation_id preserved end-to-end across every layer.

export type UapRiskClass =
  | "R0_READ_ONLY"
  | "R1_LOW_RISK"
  | "R2_CONTROLLED_WRITE"
  | "R3_SENSITIVE"
  | "R4_PRIVILEGED";

export type UapAgentStatus =
  | "registered"
  | "starting"
  | "ready"
  | "busy"
  | "paused"
  | "degraded"
  | "offline"
  | "stopping"
  | "stopped"
  | "failed"
  | "quarantined";

export type UapHostStatus =
  | "pending"
  | "pairing"
  | "online"
  | "degraded"
  | "offline"
  | "revoked"
  | "quarantined";

export type UapHostTrustLevel =
  | "TRUSTED_LOCAL"
  | "TRUSTED_PRIVATE"
  | "MANAGED_REMOTE"
  | "EPHEMERAL_CLOUD"
  | "UNTRUSTED"
  | "QUARANTINED";

export type UapJobStatus =
  | "queued"
  | "awaiting_policy"
  | "awaiting_approval"
  | "approved"
  | "dispatching"
  | "running"
  | "paused"
  | "retry_wait"
  | "needs_review"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type UapApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "revoked"
  | "consumed";

export interface UapAgent {
  agentId: string;
  displayName: string;
  runtimeType: "codex" | "opencode" | "openhermit" | "pao-native" | "custom";
  provider: string;
  model: string | null;
  hostId: string;
  sandboxId: string | null;
  status: UapAgentStatus;
  capabilities: string[];
  skillBindings: string[];
  mcpBindings: string[];
  policyProfileId: string;
  credentialScopeId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface UapHost {
  hostId: string;
  displayName: string;
  hostType: "local_pc" | "vps" | "runpod" | "browser" | "remote_linux" | "worker_node";
  osFamily: "linux" | "darwin" | "windows";
  architecture: "x86_64" | "arm64";
  connectionMode: "direct" | "tailscale" | "ssh_jump" | "vpn";
  tailscaleIdentity: string | null;
  sshProfileRef: string | null;
  status: UapHostStatus;
  trustLevel: UapHostTrustLevel;
  capabilities: string[];
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface UapJob {
  jobId: string;
  correlationId: string;
  causationId: string | null;
  jobType: string;
  requestedBy: string;
  agentId: string | null;
  hostId: string;
  status: UapJobStatus;
  priority: number;
  payloadRef: string | null;
  policySnapshotId: string | null;
  approvalId: string | null;
  attempt: number;
  maxAttempts: number;
  checkpointRef: string | null;
  resultRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

export interface UapMcpServer {
  mcpServerId: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  endpointRef: string | null;
  authRef: string | null;
  trustLevel: string;
  environment: string;
  status: "active" | "disabled" | "quarantined";
  toolCount: number;
  policyProfileId: string;
  source: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

export interface UapMcpTool {
  toolId: string;
  mcpServerId: string;
  name: string;
  description: string;
  riskClass: UapRiskClass;
  requiresApproval: boolean;
  allowedAgentClasses: string[];
  allowedHostClasses: string[];
  inputSchemaHash: string;
  outputSchemaHash: string;
  enabled: boolean;
}

export interface UapSkill {
  skillId: string;
  name: string;
  version: string;
  source: string;
  runtime: string;
  entrypoint: string;
  capabilityTags: string[];
  riskClass: UapRiskClass;
  requiredTools: string[];
  requiredCredentials: string[];
  allowedAgents: string[];
  allowedHosts: string[];
  policyProfileId: string;
  status: "discovered" | "pending_review" | "verified" | "enabled" | "disabled" | "deprecated" | "quarantined";
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

export interface UapApproval {
  approvalId: string;
  correlationId: string;
  requestType: string;
  resourceType: string;
  resourceId: string;
  riskClass: UapRiskClass;
  requestedBy: string;
  contextHash: string;
  status: UapApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  policySnapshotId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface UapAuditEvent {
  eventId: string;
  correlationId: string;
  causationId: string | null;
  eventType: string;
  actorType: string;
  actorId: string;
  agentId: string | null;
  hostId: string | null;
  jobId: string | null;
  approvalId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  riskClass: UapRiskClass | null;
  policyId: string | null;
  policyVersion: string | null;
  outcome: "success" | "denied" | "failed" | "cancelled";
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Error Class
// ---------------------------------------------------------------------------

export type UapErrorCode =
  | "DISABLED"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "HOST_OFFLINE"
  | "HOST_QUARANTINED"
  | "AGENT_OFFLINE"
  | "AGENT_QUARANTINED"
  | "CONTEXT_MISMATCH"
  | "CREDENTIAL_UNAVAILABLE"
  | "CREDENTIAL_REVOKED"
  | "DISPATCH_FAILED"
  | "EXECUTION_FAILED"
  | "EXECUTION_TIMEOUT"
  | "CHECKPOINT_FAILED"
  | "REPLAY_BLOCKED"
  | "RESOURCE_CONFLICT"
  | "DEPENDENCY_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class UapError extends Error {
  readonly code: UapErrorCode;
  readonly httpStatus: number;
  readonly detail?: Record<string, unknown>;

  constructor(code: UapErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "UapError";
    this.code = code;
    this.detail = detail;

    switch (code) {
      case "DISABLED":
      case "POLICY_DENIED":
      case "APPROVAL_REQUIRED":
      case "HOST_QUARANTINED":
      case "AGENT_QUARANTINED":
      case "REPLAY_BLOCKED":
      case "CREDENTIAL_REVOKED":
        this.httpStatus = 403;
        break;
      case "NOT_FOUND":
        this.httpStatus = 404;
        break;
      case "CONTEXT_MISMATCH":
      case "APPROVAL_REJECTED":
      case "APPROVAL_EXPIRED":
      case "IDEMPOTENCY_CONFLICT":
      case "RESOURCE_CONFLICT":
      case "INVALID_INPUT":
        this.httpStatus = 409;
        break;
      case "HOST_OFFLINE":
      case "AGENT_OFFLINE":
      case "DISPATCH_FAILED":
      case "CREDENTIAL_UNAVAILABLE":
      case "DEPENDENCY_UNAVAILABLE":
        this.httpStatus = 503;
        break;
      default:
        this.httpStatus = 500;
    }
  }
}
