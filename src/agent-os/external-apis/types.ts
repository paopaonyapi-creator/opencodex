// Phase 20.63 — Pao-hubPro × Public APIs: External Capability Registry.
//
// Public APIs discovers; Pao-hubPro evaluates and governs. Upstream list
// membership is discovery evidence only — never a trust grant. amux/Graft
// style boundary: upstream Markdown shapes stop at the source adapter.

export const EXTERNAL_API_POLICY_VERSION = "eap-1";

export type ExternalApiErrorCode =
  | "EXTERNAL_API_DISABLED"
  | "EXTERNAL_API_NOT_FOUND"
  | "EXTERNAL_API_INVALID_INPUT"
  | "EXTERNAL_API_SOURCE_SYNC_FAILED"
  | "EXTERNAL_API_PARSER_DRIFT"
  | "EXTERNAL_API_LIFECYCLE_DENIED"
  | "EXTERNAL_API_POLICY_BLOCKED"
  | "EXTERNAL_API_APPROVAL_REQUIRED"
  | "EXTERNAL_API_TOOL_NOT_ENABLED"
  | "EXTERNAL_API_SSRF_BLOCKED"
  | "EXTERNAL_API_RATE_LIMITED"
  | "EXTERNAL_API_CIRCUIT_OPEN"
  | "EXTERNAL_API_REVOKED"
  | "EXTERNAL_API_CREDENTIAL_MISSING"
  | "EXTERNAL_API_EXECUTION_FAILED";

export class ExternalApiError extends Error {
  readonly code: ExternalApiErrorCode;
  readonly httpStatus: number;

  constructor(code: ExternalApiErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "ExternalApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// --- provider lifecycle (spec §8): DISCOVERED != APPROVED ---

export type ProviderLifecycle =
  | "discovered" | "ingested" | "enriching" | "observed" | "review_required"
  | "approved" | "active" | "degraded" | "suspended" | "revoked" | "rejected" | "invalid";

export const LIFECYCLE_TRANSITIONS: Record<ProviderLifecycle, readonly ProviderLifecycle[]> = {
  discovered: ["ingested", "rejected", "revoked"],
  ingested: ["enriching", "invalid", "rejected", "revoked"],
  enriching: ["observed", "rejected", "revoked"],
  observed: ["review_required", "approved", "suspended", "revoked"],
  review_required: ["approved", "rejected", "suspended", "revoked"],
  approved: ["active", "suspended", "revoked"],
  active: ["degraded", "suspended", "revoked"],
  degraded: ["active", "suspended", "revoked"],
  suspended: ["review_required", "revoked"],
  revoked: ["review_required"],
  rejected: [],
  invalid: [],
};

export function assertProviderTransition(from: ProviderLifecycle, to: ProviderLifecycle): void {
  if (from === to) return;
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new ExternalApiError("EXTERNAL_API_LIFECYCLE_DENIED", 409, `provider lifecycle ${from} -> ${to} is not permitted`);
  }
}

// --- operation lifecycle (spec §9) ---

export type OperationLifecycle =
  | "discovered" | "schema_parsed" | "classified" | "policy_reviewed"
  | "generated" | "tested" | "approved" | "enabled" | "disabled";

export const OPERATION_TRANSITIONS: Record<OperationLifecycle, readonly OperationLifecycle[]> = {
  discovered: ["schema_parsed", "disabled"],
  schema_parsed: ["classified", "disabled"],
  classified: ["policy_reviewed", "disabled"],
  policy_reviewed: ["generated", "disabled"],
  generated: ["tested", "disabled"],
  tested: ["approved", "disabled"],
  approved: ["enabled", "disabled"],
  enabled: ["disabled"],
  disabled: [],
};

export function assertOperationTransition(from: OperationLifecycle, to: OperationLifecycle): void {
  if (from === to) return;
  if (!OPERATION_TRANSITIONS[from].includes(to)) {
    throw new ExternalApiError("EXTERNAL_API_LIFECYCLE_DENIED", 409, `operation lifecycle ${from} -> ${to} is not permitted`);
  }
}

// --- normalized provider (spec §13) with raw evidence preserved (§42) ---

export type AuthType = "none" | "api_key" | "bearer" | "oauth2" | "custom" | "unknown";
export type HealthStatus = "unknown" | "healthy" | "degraded" | "unreachable" | "rate_limited" | "auth_required" | "misconfigured" | "suspended";

export interface DiscoveredApiRecord {
  category: string;
  name: string;
  url: string;
  description: string;
  authLabel: string;
  https: boolean | null;
  cors: "yes" | "no" | "unknown" | null;
  rowHash: string;
}

export interface ExternalApiProvider {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  homepageUrl: string | null;
  docsUrl: string | null;
  hostname: string;
  sourceCategory: string | null;
  normalizedCategories: string[];
  upstreamAuthLabel: string | null;
  authType: AuthType;
  upstreamHttps: boolean | null;
  upstreamCors: "yes" | "no" | "unknown" | null;
  lifecycle: ProviderLifecycle;
  health: HealthStatus;
  trustScore: number | null;
  riskScore: number | null;
  trustConfidence: number | null;
  sourcePresence: "active" | "removed";
  sourceSnapshotId: string | null;
  rawEvidence: Record<string, unknown>;
  aliases: string[];
  circuit: "closed" | "open" | "half_open";
  lastObservedAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- capabilities + operations (spec §14-§15, §30-§33) ---

export interface CapabilityClassification {
  capability: string;
  classifier: string;
  confidence: number;
  evidence: string;
  humanReviewed: boolean;
  version: string;
}

export interface ExternalApiOperation {
  id: string;
  providerId: string;
  operationKey: string;
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  pathTemplate: string;
  serverUrl: string | null;
  summary: string | null;
  mutating: boolean;
  authRequired: boolean;
  dataClasses: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  lifecycle: OperationLifecycle;
  capabilityIds: string[];
  specSnapshotId: string | null;
  requestSchema: Record<string, unknown> | null;
  responseSchema: Record<string, unknown> | null;
  cacheable: boolean;
  cacheTtlSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialProfile {
  id: string;
  providerId: string;
  authType: "none" | "api_key" | "bearer" | "basic" | "oauth2" | "custom";
  /** Opaque reference into the Pao secret store — never the secret itself. */
  secretRef: string | null;
  scopes: string[];
  environment: "dev" | "test" | "prod";
  ownerType: "user" | "workspace" | "service";
  ownerId: string;
  status: "active" | "disabled" | "expired" | "revoked";
  headerName: string;
}

// --- generated tools (spec §31-§33): GENERATED != ENABLED ---

export interface GeneratedApiTool {
  id: string;
  operationId: string;
  toolName: string;
  displayName: string;
  inputSchema: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  mutating: boolean;
  approvalMode: "none" | "conditional" | "always";
  enabled: boolean;
  specSnapshotId: string | null;
  policyVersion: string;
  contractTested: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- runtime calls (spec §34-§37) ---

export interface RuntimeCallResult {
  callId: string;
  outcome: "allowed" | "denied" | "completed" | "failed";
  policyDecision: string;
  httpStatus: number | null;
  latencyMs: number | null;
  reason: string | null;
  /** Sanitized response body (secrets redacted, size-capped). */
  body: unknown;
  denialCode: ExternalApiErrorCode | null;
}

// --- source adapter contract (spec §10) ---

export interface SourceFetchContext {
  /** Injectable fetcher: (url) => body text. Tests inject fixtures. */
  fetcher: (url: string) => Promise<string>;
  pinnedSha?: string | null;
}

export interface SourceSnapshot {
  sourceKey: string;
  upstreamRevision: string;
  contentSha256: string;
  fetchedAt: string;
  content: string;
}

export interface SourceValidationReport {
  ok: boolean;
  rowCount: number;
  categoryCount: number;
  warnings: string[];
  errors: string[];
  skippedSections: string[];
  rowDropRatio: number | null;
}

export interface ApiCatalogSource {
  readonly id: string;
  fetchSnapshot(ctx: SourceFetchContext): Promise<SourceSnapshot>;
  parse(snapshot: SourceSnapshot): Promise<DiscoveredApiRecord[]>;
  validate(records: DiscoveredApiRecord[], previous: DiscoveredApiRecord[] | null): Promise<SourceValidationReport>;
}

// --- audit event names (spec §52) ---

export type ExternalApiAuditEvent =
  | "external_api.source.sync_started"
  | "external_api.source.sync_completed"
  | "external_api.source.sync_failed"
  | "external_api.provider.discovered"
  | "external_api.provider.changed"
  | "external_api.provider.approved"
  | "external_api.provider.suspended"
  | "external_api.provider.revoked"
  | "external_api.spec.fetched"
  | "external_api.health.checked"
  | "external_api.tool.generated"
  | "external_api.tool.enabled"
  | "external_api.tool.disabled"
  | "external_api.call.allowed"
  | "external_api.call.denied"
  | "external_api.call.completed"
  | "external_api.call.failed"
  | "external_api.egress.blocked"
  | "external_api.credential.used";
