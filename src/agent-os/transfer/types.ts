/**
 * Phase 20.87 — Pao-hubPro × FileSync P2P Artifact Transfer Fabric
 * Data Movement Plane, Manifests, State Machine, and Policy Types.
 */

export type ArtifactClassification =
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "source_code"
  | "build_artifact"
  | "model"
  | "lora"
  | "dataset"
  | "document"
  | "executable"
  | "script"
  | "secret_like"
  | "unknown";

export type TransferTrustZone =
  | "LOCAL_PRIVATE"
  | "MANAGED_VPS"
  | "CLOUD_GPU"
  | "TRUSTED_PEER"
  | "EXTERNAL_UNTRUSTED"
  | "QUARANTINED";

export type TransferState =
  | "INITIALIZING"
  | "PREPARING"
  | "AWAITING_APPROVAL"
  | "NEGOTIATING"
  | "TRANSFERRING"
  | "PAUSED"
  | "VERIFYING"
  | "QUARANTINED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED_PARTIAL";

export type DistributionMode =
  | "best_effort_all"
  | "require_all"
  | "require_quorum"
  | "selected_targets";

export type DestinationConflictPolicy =
  | "fail_if_exists"
  | "rename_with_suffix"
  | "overwrite"
  | "content_addressed"
  | "versioned";

export interface ArtifactChunk {
  index: number;
  offset: number;
  length: number;
  sha256: string;
}

export interface ArtifactManifest {
  manifestId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  classification: ArtifactClassification;
  chunkSizeBytes: number;
  chunkCount: number;
  chunks: ArtifactChunk[];
  createdAt: string;
}

export interface TransferTarget {
  targetId: string;
  peerId: string;
  nodeId: string;
  zone: TransferTrustZone;
  state: "pending" | "transferring" | "verified" | "failed";
  routeType: "direct" | "turn_udp" | "turn_tcp";
  bytesTransferred: number;
  resumedBytes: number;
  error?: string;
}

export interface TransferSession {
  sessionId: string;
  sourceNodeId: string;
  sourceZone: TransferTrustZone;
  manifest: ArtifactManifest;
  targets: TransferTarget[];
  distributionMode: DistributionMode;
  state: TransferState;
  destinationConflictPolicy: DestinationConflictPolicy;
  policyDecision: {
    decision: "allow" | "require_approval" | "deny";
    riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
    reason: string;
    approvalId?: string;
  };
  totalBytesTransferred: number;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransferInput {
  sourceNodeId: string;
  sourceZone: TransferTrustZone;
  filename: string;
  data: Uint8Array | string;
  classification?: ArtifactClassification;
  targets: Array<{ targetId: string; peerId: string; nodeId: string; zone: TransferTrustZone }>;
  distributionMode?: DistributionMode;
  destinationConflictPolicy?: DestinationConflictPolicy;
  ttlSeconds?: number;
}
