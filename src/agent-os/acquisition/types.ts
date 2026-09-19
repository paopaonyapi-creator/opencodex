// Phase 20.95 — Content Acquisition Gateway contracts.
// OmniGet is a replaceable worker. Pao-hubPro owns policy, jobs, secrets, artifacts, audit.

export const PHASE_ID = "20.95";

export type AcquisitionIntent =
  | "download"
  | "inspect"
  | "audio_extract"
  | "transcribe"
  | "research"
  | "archive"
  | "gallery"
  | "document_extract"
  | "batch";

export type JobState =
  | "CREATED"
  | "PLANNING"
  | "POLICY_CHECK"
  | "BLOCKED"
  | "WAITING_APPROVAL"
  | "QUEUED"
  | "ACQUIRING"
  | "PAUSED"
  | "RETRY_WAIT"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "VERIFYING"
  | "PROCESSING"
  | "INGESTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AuthClass = "PUBLIC" | "SESSION_OPTIONAL" | "SESSION_REQUIRED" | "ACCOUNT_WRITE_CAPABLE" | "BLOCKED_OR_DRM";
export type AdapterId = "omniget_mcp" | "omniget_cli" | "native" | "legacy_20_24" | "mock" | "unsupported";
export type PolicyDecisionKind = "allow" | "allow_with_limits" | "require_approval" | "deny";
export type ErrorClass =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMIT"
  | "EXPIRED_SESSION"
  | "UNSUPPORTED_SOURCE"
  | "DRM_OR_PROTECTED"
  | "OUTPUT_IO"
  | "TOOL_CRASH"
  | "POLICY_DENIED"
  | "USER_CANCELLED"
  | "UNKNOWN";

export type AcquisitionErrorCode =
  | "DISABLED"
  | "JOB_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "INVALID_SOURCE"
  | "PATH_ESCAPE"
  | "SECRET_IN_REQUEST"
  | "ADAPTER_UNAVAILABLE"
  | "UNSUPPORTED"
  | "SCHEMA_INVALID";

export class AcquisitionError extends Error {
  readonly code: AcquisitionErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;
  constructor(code: AcquisitionErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "AcquisitionError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}

export interface AcquisitionRequest {
  requestId?: string;
  actor: { type: "user" | "agent" | "system"; id: string; agentId?: string };
  source: { kind: "url" | "file" | "manifest" | "batch"; value: string | string[] };
  intent: AcquisitionIntent;
  options?: {
    quality?: string;
    audioOnly?: boolean;
    subtitleLanguages?: string[];
    outputFormat?: string;
    maxItems?: number;
    transcribe?: boolean;
    summarize?: boolean;
    ingestKnowledge?: boolean;
    preserveOriginal?: boolean;
  };
  authContext?: { requestedProfileId?: string; browserSessionRef?: string };
  policyContext: { workspaceId: string; projectId?: string; purpose?: "research" | "personal_archive" | "work" | "stock_research" | "other" };
}

export interface AcquisitionPlan {
  requestId: string;
  sourceHost?: string;
  sourceClass: string;
  authRequirement: "none" | "optional" | "required" | "unknown";
  authClass: AuthClass;
  selectedAdapter: AdapterId;
  selectedCapability?: string;
  riskClass: "low" | "medium" | "high" | "blocked";
  approvalsRequired: string[];
  estimatedOutputs: string[];
  postProcessors: string[];
  knowledgePipeline?: string;
  preferSubtitles: boolean;
  commercialRightsDefault: "unknown";
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  reasonCodes: string[];
  constraints?: {
    maxItems?: number;
    maxBytes?: number;
    allowedDomains?: string[];
    allowedOutputRoot?: string;
    allowAuthentication?: boolean;
    allowKnowledgeIngest?: boolean;
  };
}

export interface AdapterHealth {
  id: AdapterId;
  status: "healthy" | "degraded" | "offline" | "unconfigured";
  latencyMs?: number;
  version?: string;
  binary?: string;
  capabilityCount?: number;
  detail: string;
}

export interface CapabilityDescriptor {
  id: string;
  aliases: string[];
  risk: "low" | "medium" | "high";
  enabled: boolean;
  transport: "mcp" | "cli" | "native" | "mock";
}

export interface AdapterJob {
  jobId: string;
  plan: AcquisitionPlan;
  request: AcquisitionRequest;
  outputRoot: string;
  sessionRef?: string;
}

export interface AdapterJobRef { adapter: AdapterId; externalId: string }

export interface AdapterJobStatus {
  state: "running" | "completed" | "failed" | "cancelled" | "paused";
  progressPercent: number;
  files: string[];
  errorClass?: ErrorClass;
  errorMessage?: string;
}

export interface AcquisitionAdapter {
  id: AdapterId;
  probe(): Promise<AdapterHealth>;
  capabilities(): Promise<CapabilityDescriptor[]>;
  submit(job: AdapterJob): Promise<AdapterJobRef>;
  status(ref: AdapterJobRef): Promise<AdapterJobStatus>;
  cancel(ref: AdapterJobRef): Promise<void>;
}

export interface SessionRef {
  id: string;
  provider: string;
  domainScope: string[];
  ownerActorId: string;
  secretRef: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function redactAcquisitionText(text: string): string {
  return text
    .replace(/Cookie:\s*[^\r\n]+/gi, "Cookie: [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/(password|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]");
}

export function looksLikeSecretPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return ["cookie", "cookies", "rawCookies", "setCookie", "authorization", "password", "apiKey"].some((k) => k in rec && rec[k] != null);
}
