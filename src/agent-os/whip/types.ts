// Phase 20.99 — Pao-hubPro × Whip Mobile Agent Operations Plane domain models and types.
//
// Key principles:
// 1. Mobile is a presentation and approval surface; truth stays in the host runtime.
// 2. Chat and Terminal point to the exact same live agent session.
// 3. Strict host-key verification; no silent host-key acceptance.
// 4. Offline queued intents MUST be policy-rechecked upon reconnect.
// 5. Approvals are bound to exact payload hash and context.

export type WhipRiskClass = "R0" | "R1" | "R2" | "R3" | "R4";

export type HostStatus = "online" | "offline" | "connecting" | "degraded" | "error";

export type KeyTrustStatus = "known_good" | "unknown" | "changed" | "revoked";

export interface WhipHost {
  id: string;
  displayName: string;
  host: string;
  port: number;
  username: string;
  credentialRef: string | null;
  jumpRoute: string[]; // ProxyJump host IDs
  tailscaleIp: string | null;
  status: HostStatus;
  runtimeGeneration: number;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedHostKey {
  id: string;
  hostId: string;
  hopIndex: number;
  algorithm: string;
  fingerprintSha256: string;
  trustStatus: KeyTrustStatus;
  approvedAt: string;
  approvedBy: string;
}

export interface WhipDevice {
  id: string;
  label: string;
  publicKey: string;
  platform: "ios" | "android" | "web" | "other";
  deviceModelHint: string | null;
  biometricEnabled: boolean;
  status: "active" | "revoked" | "pending";
  policyScope: string[];
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface PairingSession {
  id: string;
  pairingCode: string;
  verificationPhrase: string;
  hostHint: string;
  port: number;
  ephemeralPublicKey: string;
  nonce: string;
  state: "pending" | "paired" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
}

export interface QrPairingPayload {
  v: 1;
  pairing_id: string;
  host_hint: string;
  port: number;
  ephemeral_public_key: string;
  nonce: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Fleet & Transcript Models (spec §8, §10)
// ---------------------------------------------------------------------------

export type WhipAgentStatus =
  | "blocked"
  | "waiting_approval"
  | "working"
  | "done"
  | "idle"
  | "error"
  | "offline"
  | "unknown";

export interface WhipAgentSummary {
  agentId: string;
  hostId: string;
  provider: string;
  runtime: "codex" | "opencode" | "pao-native" | "openhermit" | "other";
  displayName: string;
  status: WhipAgentStatus;
  task?: string;
  sessionId?: string;
  terminalId?: string;
  riskPending?: WhipRiskClass;
  lastActivityAt?: string;
  unreadCount?: number;
}

export type TranscriptItemKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool_activity"
  | "file_diff"
  | "approval_request"
  | "notice";

export interface TranscriptTurn {
  id: string;
  turnNumber: number;
  kind: TranscriptItemKind;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface WhipTranscript {
  id: string;
  agentId: string;
  sessionId: string;
  runtime: string;
  revision: number;
  sourceState: "live" | "stale" | "reconnecting" | "closed" | "error";
  turns: TranscriptTurn[];
  checkpoint: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Terminal Plane (spec §11)
// ---------------------------------------------------------------------------

export interface WhipTerminalSession {
  id: string;
  hostId: string;
  agentId?: string | null;
  sessionId?: string | null;
  paneId?: string | null;
  cwd?: string | null;
  status: "active" | "disconnected" | "closed";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SFTP & Remote Workspace (spec §12)
// ---------------------------------------------------------------------------

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  permissions?: string;
}

export interface RemoteGitStatus {
  branch: string;
  clean: boolean;
  modified: string[];
  untracked: string[];
  staged: string[];
}

// ---------------------------------------------------------------------------
// Offline-Safe Command Queue (spec §13)
// ---------------------------------------------------------------------------

export type QueuedIntentState =
  | "draft"
  | "queued_local"
  | "policy_recheck"
  | "sending"
  | "sent"
  | "needs_review"
  | "rejected"
  | "failed_policy";

export interface QueuedIntent {
  id: string;
  hostId: string;
  deviceId: string;
  targetRefJson: string;
  semanticAction: string;
  payloadHash: string;
  encryptedPayloadRef: string;
  contextRevision: number;
  riskClass: WhipRiskClass;
  state: QueuedIntentState;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Human Approval Control Plane (spec §14)
// ---------------------------------------------------------------------------

export type WhipApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface WhipApprovalRequest {
  id: string;
  hostId: string;
  deviceId: string;
  agentId?: string | null;
  sessionId?: string | null;
  action: string;
  target: string;
  humanSummary: string;
  exactPayloadHash: string;
  risk: WhipRiskClass;
  status: WhipApprovalStatus;
  biometricVerified: boolean;
  policyVersion: string;
  expiresAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  reason?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit Model (spec §28)
// ---------------------------------------------------------------------------

export interface WhipAuditEvent {
  id: string;
  eventType: string;
  hostId: string;
  deviceId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  action: string;
  risk: WhipRiskClass;
  approvalId?: string | null;
  policyVersion?: string | null;
  payloadHash?: string | null;
  result: "success" | "denied" | "failed" | "cancelled";
  correlationId: string;
  sanitizedPayload: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Error Class
// ---------------------------------------------------------------------------

export type WhipErrorCode =
  | "DISABLED"
  | "HOST_UNAVAILABLE"
  | "HOST_KEY_CHANGED"
  | "HOST_KEY_UNKNOWN"
  | "HOST_NOT_FOUND"
  | "DEVICE_REVOKED"
  | "DEVICE_NOT_FOUND"
  | "PAIRING_EXPIRED"
  | "PAIRING_INVALID"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_HASH_MISMATCH"
  | "QUEUE_CONTEXT_CHANGED"
  | "QUEUE_REPLAY_PROHIBITED"
  | "SFTP_TRAVERSAL_DENIED"
  | "FILE_NOT_FOUND"
  | "TERMINAL_NOT_FOUND"
  | "TRANSCRIPT_NOT_FOUND"
  | "STALE_GENERATION"
  | "INVALID_INPUT"
  | "INTERNAL";

export class WhipError extends Error {
  readonly code: WhipErrorCode;
  readonly httpStatus: number;
  readonly detail?: Record<string, unknown>;

  constructor(code: WhipErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "WhipError";
    this.code = code;
    this.detail = detail;

    switch (code) {
      case "DISABLED":
      case "POLICY_DENIED":
      case "APPROVAL_REQUIRED":
      case "DEVICE_REVOKED":
      case "SFTP_TRAVERSAL_DENIED":
      case "QUEUE_REPLAY_PROHIBITED":
        this.httpStatus = 403;
        break;
      case "HOST_NOT_FOUND":
      case "DEVICE_NOT_FOUND":
      case "APPROVAL_NOT_FOUND":
      case "FILE_NOT_FOUND":
      case "TERMINAL_NOT_FOUND":
      case "TRANSCRIPT_NOT_FOUND":
        this.httpStatus = 404;
        break;
      case "HOST_KEY_CHANGED":
      case "HOST_KEY_UNKNOWN":
      case "APPROVAL_HASH_MISMATCH":
      case "QUEUE_CONTEXT_CHANGED":
      case "PAIRING_EXPIRED":
      case "PAIRING_INVALID":
      case "STALE_GENERATION":
      case "INVALID_INPUT":
        this.httpStatus = 409;
        break;
      case "HOST_UNAVAILABLE":
        this.httpStatus = 503;
        break;
      default:
        this.httpStatus = 500;
    }
  }
}
