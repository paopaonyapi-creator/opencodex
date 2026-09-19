// Phase 20.96 — Pao-hubPro × AnythingMCP: capability control plane contracts.
// AnythingMCP is a replaceable connector engine. Pao-hubPro owns policy, secrets, privacy, approval, versioning, audit.

export const PHASE_ID = "20.96";

export type ConnectorKind =
  | "openapi"
  | "swagger"
  | "postman"
  | "curl"
  | "soap"
  | "wsdl"
  | "graphql"
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "mongodb"
  | "sqlite"
  | "mcp"
  | "anythingmcp";

export type ConnectorLifecycle =
  | "DISCOVERED"
  | "IMPORTED"
  | "NORMALIZED"
  | "SECURITY_SCANNED"
  | "TESTED"
  | "POLICY_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "MONITORED"
  | "DISABLED"
  | "DEGRADED"
  | "FROZEN";

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";
export type SideEffect = "read" | "idempotent_write" | "create" | "update" | "delete" | "destructive" | "financial" | "security";
export type DataClass =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "PII"
  | "FINANCIAL"
  | "CREDENTIAL"
  | "SECURITY"
  | "HEALTH"
  | "LEGAL"
  | "CUSTOMER_SECRET"
  | "EMPLOYEE_PRIVATE";
export type PrivacyAction = "allow" | "mask" | "drop" | "hash" | "placeholder" | "aggregate" | "deny";
export type PublicationProfile = "paohub-readonly" | "paohub-development" | "paohub-stock-workflow" | "paohub-research" | "paohub-admin";
export type CouncilDecision = "PASS" | "PASS_WITH_CHANGES" | "BLOCK" | "HUMAN_DECISION_REQUIRED";

export type McpFabricErrorCode =
  | "DISABLED"
  | "NOT_FOUND"
  | "SECRET_IN_REQUEST"
  | "SECRET_IN_RESPONSE"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "INVALID_SOURCE"
  | "SSRF"
  | "SQL_DENIED"
  | "PRIVACY_FAIL_CLOSED"
  | "ADAPTER_UNAVAILABLE"
  | "UNPUBLISHED"
  | "FROZEN"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "SCHEMA_INVALID"
  | "DRIFT_BREAKING"
  | "WRITE_DISABLED"
  | "DESTRUCTIVE_DISABLED"
  | "AUDIT_UNAVAILABLE"
  | "CREDENTIAL_DENIED";

export class McpFabricError extends Error {
  readonly code: McpFabricErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;
  constructor(code: McpFabricErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "McpFabricError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}

export interface NormalizedTool {
  canonicalName: string;
  upstreamName: string;
  description: string;
  method?: string;
  path?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  risk: RiskLevel;
  sideEffect: SideEffect;
  dataClasses: DataClass[];
  destructiveHint: boolean;
  credentialRef?: string;
}

export interface ConnectorRecord {
  id: string;
  name: string;
  kind: ConnectorKind;
  environment: string;
  lifecycle: ConnectorLifecycle;
  health: string;
  sourceHash: string;
  toolCount: number;
  riskMax: RiskLevel;
  credentialRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRecord {
  id: string;
  connectorId: string;
  canonicalName: string;
  upstreamName: string;
  description: string;
  risk: RiskLevel;
  sideEffect: SideEffect;
  dataClasses: DataClass[];
  enabled: boolean;
  published: boolean;
  version: number;
  schemaHash: string;
  health: string;
  credentialRef: string | null;
  frozen: boolean;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/(password|token|secret|api[_-]?key|authorization)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]")
    .replace(/Cookie:\s*[^\r\n]+/gi, "Cookie: [REDACTED]");
}

export function looksLikeSecretPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return ["password", "apiKey", "api_key", "accessToken", "refreshToken", "clientSecret", "privateKey", "ENCRYPTION_KEY", "cookie", "cookies"].some((k) => k in rec && rec[k] != null);
}

export const PUBLICATION_PROFILES: Record<PublicationProfile, { maxRisk: RiskLevel; writes: boolean; destructive: boolean }> = {
  "paohub-readonly": { maxRisk: "R1", writes: false, destructive: false },
  "paohub-research": { maxRisk: "R2", writes: false, destructive: false },
  "paohub-development": { maxRisk: "R3", writes: true, destructive: false },
  "paohub-stock-workflow": { maxRisk: "R3", writes: true, destructive: false },
  "paohub-admin": { maxRisk: "R4", writes: true, destructive: true },
};
