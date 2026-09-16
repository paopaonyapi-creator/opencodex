// Phase 20.60 — Pao-hubPro × OpenPost: Social Publishing Control Plane.
//
// Domain types for the governed publication pipeline. Pao-hubPro owns intent,
// policy, approval, idempotency and reconciliation; OpenPost (an external,
// separately deployed AGPL-3.0-only service) owns provider credentials and
// provider-facing publishing execution. This module never imports OpenPost
// source; it speaks HTTP to `POST_BASE_URL + /api/v1` (see openpost/client.ts).

export const SOCIAL_PUBLISHING_POLICY_VERSION = "sp-1";

// ---------------------------------------------------------------------------
// Errors

export type SocialPublishingErrorCode =
  | "OPENPOST_UNAVAILABLE"
  | "OPENPOST_AUTH_FAILED"
  | "OPENPOST_PERMISSION_DENIED"
  | "OPENPOST_RATE_LIMITED"
  | "OPENPOST_VALIDATION_ERROR"
  | "OPENPOST_CAPABILITY_MISMATCH"
  | "OPENPOST_ACCOUNT_NOT_READY"
  | "OPENPOST_REMOTE_NOT_FOUND"
  | "OPENPOST_REMOTE_CONFLICT"
  | "OPENPOST_AMBIGUOUS_RESULT"
  | "SOCIAL_POLICY_DENIED"
  | "SOCIAL_APPROVAL_REQUIRED"
  | "SOCIAL_APPROVAL_STALE"
  | "SOCIAL_ASSET_INVALID"
  | "SOCIAL_DUPLICATE_OPERATION"
  | "SOCIAL_RECONCILIATION_REQUIRED"
  | "SOCIAL_DISABLED"
  | "SOCIAL_NOT_FOUND"
  | "SOCIAL_INVALID_INPUT";

export class SocialPublishingHttpError extends Error {
  readonly code: SocialPublishingErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: SocialPublishingErrorCode, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SocialPublishingHttpError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Instance registry (`sp_openpost_instances`)

export type OpenPostAuthMode = "bearer_token";
export type OpenPostTransportMode = "http" | "mcp" | "hybrid";
export type InstanceStatus = "unknown" | "healthy" | "degraded" | "unavailable";

export interface OpenPostInstanceConfig {
  id: string;
  name: string;
  baseUrl: string;
  authMode: OpenPostAuthMode;
  /** Secret *reference* — the token itself is resolved at use time (secrets.ts). */
  secretRef: string;
  mcpEndpoint: string | null;
  mcpScope: "mcp:read" | "mcp:full" | null;
  transport: OpenPostTransportMode;
  status: InstanceStatus;
  version: string | null;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterInstanceInput {
  name: string;
  baseUrl: string;
  secretRef?: string;
  mcpEndpoint?: string | null;
  mcpScope?: "mcp:read" | "mcp:full" | null;
  transport?: OpenPostTransportMode;
}

// ---------------------------------------------------------------------------
// Accounts (`sp_accounts`)

export type ReadinessState =
  | "ready"
  | "degraded"
  | "requires_reauth"
  | "requires_scope"
  | "requires_review"
  | "unsupported_format"
  | "rate_limited"
  | "unknown"
  | "disabled";

export interface AccountCapabilities {
  /** Capability profile reported by OpenPost (`GET /capabilities`), keyed by provider profile. */
  textLimit: number | null;
  titleRequired: boolean | null;
  descriptionRequired: boolean | null;
  intents: string[];
  mediaShapes: Record<string, unknown>;
  nativeScheduling: boolean | null;
  openpostQueued: boolean | null;
  requiresAppReview: boolean | null;
  requiresPublicMedia: boolean | null;
  unavailableReason: string | null;
  caveats: string[];
  /** Unknown stays unknown: missing capability data is never treated as supported. */
  known: boolean;
  raw: Record<string, unknown>;
}

export interface SocialAccount {
  id: string;
  instanceId: string;
  openpostWorkspaceRef: string;
  openpostAccountRef: string;
  platform: string;
  displayName: string | null;
  username: string | null;
  readinessState: ReadinessState;
  readinessReason: string | null;
  enabled: boolean;
  capabilities: AccountCapabilities;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Publications (`sp_publications`)

export type PublicationSourceType = "image" | "video" | "text" | "mixed" | "external";
export type PublicationStatus =
  | "draft"
  | "preparing"
  | "ready_for_review"
  | "approval_required"
  | "rejected"
  | "approved"
  | "scheduled"
  | "dispatching"
  | "partial_success"
  | "published"
  | "failed"
  | "cancelled";
export type RiskLevel = "normal" | "elevated" | "high";
export type ApprovalMode = "human_required";
export type ActorType = "human" | "agent" | "system";

export interface Publication {
  id: string;
  sourceType: PublicationSourceType;
  assetIds: string[];
  masterTitle: string | null;
  masterCaption: string | null;
  masterDescription: string | null;
  masterTags: string[];
  metadataJson: Record<string, unknown>;
  status: PublicationStatus;
  riskLevel: RiskLevel;
  approvalMode: ApprovalMode;
  scheduledAt: string | null;
  timezone: string;
  createdByType: ActorType;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePublicationInput {
  sourceType: PublicationSourceType;
  assetIds?: string[];
  masterTitle?: string | null;
  masterCaption?: string | null;
  masterDescription?: string | null;
  masterTags?: string[];
  metadata?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  scheduledAt?: string | null;
  timezone?: string;
  actorType?: ActorType;
  actorId?: string;
}

// ---------------------------------------------------------------------------
// Publication assets (`sp_publication_assets`)

export interface PublicationAsset {
  id: string;
  publicationId: string;
  localAssetId: string;
  openpostMediaRef: string | null;
  sha256: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  provenance: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Renditions (`sp_renditions`)

export type RenditionFormat = "post" | "thread" | "story" | "short_video" | "video";
export type ValidationStatus = "unvalidated" | "valid" | "invalid";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected" | "stale";
export type DeliveryStatus =
  | "draft"
  | "validating"
  | "approval_required"
  | "approved"
  | "scheduled"
  | "queued"
  | "publishing"
  | "published"
  | "failed_retryable"
  | "failed_final"
  | "cancelled"
  | "reconciliation_required"
  | "unknown";

export interface Rendition {
  id: string;
  publicationId: string;
  accountId: string;
  platform: string;
  format: RenditionFormat;
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  assetRefs: string[];
  providerSettings: Record<string, unknown>;
  scheduledAt: string | null;
  capabilitySnapshot: AccountCapabilities;
  capabilitySnapshotAt: string;
  validationStatus: ValidationStatus;
  validationIssues: ValidationIssue[];
  approvalStatus: ApprovalStatus;
  contentHash: string;
  deliveryStatus: DeliveryStatus;
  openpostPublicationRef: string | null;
  openpostRenditionRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string;
  /** OpenPost-side issue passthrough when the remote validator reported it. */
  remote?: boolean;
}

// ---------------------------------------------------------------------------
// Policy evaluations (`sp_policy_evaluations`)

export type PolicyEffect = "allow" | "deny" | "require_approval";

export interface PolicyRuleResult {
  ruleId: string;
  effect: PolicyEffect;
  reason: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ruleResults: PolicyRuleResult[];
}

// ---------------------------------------------------------------------------
// Approvals (`sp_approvals`)

export type ApprovalScope =
  | "publication_all_destinations"
  | "rendition_only"
  | "schedule_only"
  | "publish_now_only";
export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalRecord {
  id: string;
  publicationId: string;
  renditionId: string | null;
  decision: ApprovalDecision;
  approverType: ActorType;
  approverId: string;
  approvalScope: ApprovalScope;
  /** Approval binds to this deterministic hash; any material edit invalidates it. */
  contentHash: string;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Delivery jobs (`sp_delivery_jobs`)

export type DeliveryJobType = "schedule_dispatch" | "publish_dispatch" | "reconcile";
export type DeliveryJobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed_retryable"
  | "failed_final"
  | "reconciliation_required";

export interface DeliveryJob {
  id: string;
  publicationId: string;
  renditionId: string | null;
  idempotencyKey: string;
  jobType: DeliveryJobType;
  status: DeliveryJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  lastErrorClass: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  remoteOperationRef: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analytics (`sp_analytics_snapshots`)

export interface AnalyticsSnapshot {
  id: string;
  publicationId: string | null;
  renditionId: string | null;
  accountId: string;
  capturedAt: string;
  views: number | null;
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followersDelta: number | null;
  rawMetrics: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Audit (`sp_audit`)

export interface SocialAuditInput {
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  policyEffect?: PolicyEffect | null;
  approvalRef?: string | null;
  instanceId?: string | null;
  remoteRef?: string | null;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared input shapes

export interface GenerateRenditionsInput {
  accounts: string[];
  format?: RenditionFormat;
  overrides?: Record<string, Partial<Pick<Rendition, "title" | "caption" | "description" | "hashtags">>>;
  actorType?: ActorType;
  actorId?: string;
}

export interface ApproveInput {
  decision: ApprovalDecision;
  approverType?: ActorType;
  approverId: string;
  scope?: ApprovalScope;
  renditionId?: string | null;
  note?: string | null;
}

export interface ScheduleInput {
  scheduledAt: string;
  actorType?: ActorType;
  actorId?: string;
}
