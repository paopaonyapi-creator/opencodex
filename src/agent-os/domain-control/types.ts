// Phase 20.15 — Pao-hubPro Domain Control Plane: Shared Types & Error Model.
//
// Scope note (read before extending): this subsystem orchestrates EXTERNAL DNS
// providers. It never becomes an authoritative DNS server itself, and it never
// vendors upstream provider source. DigitalPlat Domain-OSS is AGPL-3.0; it is
// reached over HTTP as an independent service through a provider adapter.
//
// The safety pipeline every mutation walks is
//   Observe -> Plan -> Diff -> Policy -> Approval -> Execute -> Verify -> Audit
// and service.ts is the only place that may run steps Execute..Audit.

/**
 * Record types the provider abstraction understands.
 *
 * UNSUPPORTED is a real member, not a placeholder: a provider can hold record
 * types this control plane does not model. Coercing those into a known type would
 * make the diff describe a record that does not exist upstream, so they are
 * carried verbatim and are never autonomously mutable.
 */
export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "CAA"
  | "SRV"
  | "NS"
  | "UNSUPPORTED";

/**
 * The first-release autonomously mutable set (Phase 20.15 section 26).
 * Everything outside this list is classified elevated and therefore cannot be
 * applied by an agent flow even WITH an approval in this release.
 */
export const FIRST_RELEASE_RECORD_TYPES: readonly DnsRecordType[] = ["A", "AAAA", "CNAME", "TXT"];

export const ALL_RECORD_TYPES: readonly DnsRecordType[] = [
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "CAA",
  "SRV",
  "NS",
];

/** Blast-radius classes. Ordering matters: index is the severity rank. */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/** Highest of two risk levels. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

/**
 * Approval posture for an operation. AUTO_READ covers reads only; every
 * mutating mode requires a persisted, unexpired approval record.
 */
export type ApprovalMode =
  | "AUTO_READ"
  | "APPROVE_LOW_RISK"
  | "MANUAL_MUTATION"
  | "MANUAL_CRITICAL"
  | "DENY";

export type DomainEnvironment = "production" | "staging" | "development" | "internal";

/** A registrable zone the provider has given this installation access to. */
export interface DomainZone {
  /** Provider-side zone identifier. Domain-OSS uses integer domain ids. */
  readonly id: string;
  readonly fqdn: string;
  /** Provider-side display label (Domain-OSS label field), when present. */
  readonly label?: string;
  readonly status: string;
  readonly zone?: string;
  readonly createdAt?: string;
}

export interface DnsRecord {
  readonly id: string;
  /** Owner name relative to the zone: "@", "www", "_dmarc", "*.dev", ... */
  readonly name: string;
  readonly type: DnsRecordType;
  readonly content: string;
  readonly ttl: number;
  readonly priority?: number;
}

/** An intended record. id is present only when addressing an existing record. */
export interface DnsRecordIntent {
  readonly id?: string;
  readonly name: string;
  readonly type: DnsRecordType;
  readonly content: string;
  readonly ttl?: number;
  readonly priority?: number;
}

export type DnsChangeKind = "create" | "update" | "delete" | "noop";

export interface DnsDiffEntry {
  readonly kind: DnsChangeKind;
  /** Absolute hostname the change attaches to, for display and audit. */
  readonly hostname: string;
  readonly name: string;
  readonly type: DnsRecordType;
  readonly before: DnsRecordIntent | null;
  readonly after: DnsRecordIntent | null;
  /** Field-level changes, e.g. "ttl: 300 -> 600". */
  readonly fields: readonly string[];
}

export interface DnsDiff {
  readonly zone: string;
  readonly entries: readonly DnsDiffEntry[];
  /** True when nothing would change; Execute must short-circuit. */
  readonly empty: boolean;
  readonly counts: Readonly<Record<DnsChangeKind, number>>;
}

export interface RiskAssessment {
  readonly level: RiskLevel;
  readonly approvalMode: ApprovalMode;
  readonly requiresApproval: boolean;
  /** Human-readable justifications, one per matched rule. */
  readonly reasons: readonly string[];
  /** Stable rule ids so a test can assert WHICH rule fired, not just the level. */
  readonly matchedRules: readonly string[];
}

export type ApprovalStatus = "pending" | "granted" | "denied" | "expired";

export type ApprovalDecision = "grant" | "deny";

export interface ApprovalRequest {
  readonly id: string;
  readonly requestId: string;
  readonly operation: string;
  readonly resource: string;
  readonly riskLevel: RiskLevel;
  readonly approvalMode: ApprovalMode;
  readonly reasons: readonly string[];
  readonly diff: DnsDiff | null;
  readonly requestedBy: string;
  readonly reason: string;
  readonly status: ApprovalStatus;
  readonly expiresAt: number;
  readonly createdAt: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

export type AuditActor = "chatgpt" | "codex" | "user" | "system" | "agent";
export type AuditResult = "success" | "failure" | "denied" | "dry_run" | "approval_required";

export interface AuditEvent {
  readonly id: string;
  readonly requestId: string;
  readonly actor: AuditActor;
  readonly operation: string;
  readonly resource: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly approvalId: string | null;
  readonly provider: string;
  readonly result: AuditResult;
  readonly errorCode: string | null;
  readonly verification: unknown;
  readonly createdAt: string;
}

/** Standardized error codes (Phase 20.15 section 20). */
export type StandardErrorCode =
  | "PROVIDER_AUTH_FAILED"
  | "DOMAIN_NOT_ALLOWED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "RECORD_CONFLICT"
  | "PROVIDER_TIMEOUT"
  | "AMBIGUOUS_MUTATION"
  | "DNS_VERIFY_TIMEOUT"
  | "TLS_PROVISION_FAILED"
  | "PROXY_CONFIG_FAILED"
  | "HEALTH_CHECK_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "IDEMPOTENCY_CONFLICT"
  | "UNSUPPORTED_RECORD_TYPE"
  | "NOT_IMPLEMENTED";

/**
 * Every refusal carries a code, whether it is safe to retry, and what the caller
 * should do next. retryable: false on an ambiguous mutation is the whole point:
 * re-sending a write whose response was lost is how duplicate records appear.
 */
export class DomainControlError extends Error {
  readonly code: StandardErrorCode;
  readonly retryable: boolean;
  readonly nextAction: string;
  readonly detail?: unknown;

  constructor(
    code: StandardErrorCode,
    message: string,
    options: { retryable?: boolean; nextAction?: string; detail?: unknown } = {},
  ) {
    super(message);
    this.name = "DomainControlError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.nextAction = options.nextAction ?? "re-read authoritative state";
    this.detail = options.detail;
  }

  toJSON(): {
    code: StandardErrorCode;
    message: string;
    retryable: boolean;
    next_action: string;
    detail?: unknown;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      next_action: this.nextAction,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/** Common envelope every mutating entry point accepts. */
export interface MutationEnvelope {
  /**
   * Dry-run default is enforced by the SERVICE, not the caller: when the actor is
   * an agent and no valid approval id is supplied, the write is downgraded to a
   * dry run even if the caller asked for dry_run false.
   */
  dry_run?: boolean;
  approval_id?: string | null;
  request_id?: string;
  idempotency_key?: string;
  reason?: string;
  actor?: AuditActor;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  /** external = real network calls; fake = deterministic in-memory test double. */
  readonly kind: "external" | "fake";
  readonly capabilities: {
    readonly read: boolean;
    readonly write: boolean;
    /** ACME DNS-01 challenge publication support. */
    readonly acme: boolean;
    /** True when a successful write returns a job rather than a settled record. */
    readonly asyncWrites: boolean;
  };
}

export interface ProviderHealth {
  readonly provider: string;
  readonly reachable: boolean;
  readonly authenticated: boolean | null;
  readonly latencyMs: number | null;
  readonly detail: string;
}

export interface DnsVerification {
  readonly status: "verified" | "timeout" | "mismatch";
  readonly expected: string;
  /** Resolver address -> observed values. */
  readonly results: Readonly<Record<string, string>>;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly authoritative?: Readonly<Record<string, string>>;
}

export interface TlsVerification {
  readonly hostname: string;
  readonly ok: boolean;
  readonly issuer?: string;
  readonly validTo?: string;
  readonly daysRemaining?: number;
  readonly error?: string;
}

export interface HttpHealthVerification {
  readonly url: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly error?: string;
}

/** A domain pinned to a deployment target behind the reverse proxy. */
export interface DeploymentBinding {
  readonly id: string;
  readonly deploymentId: string;
  readonly hostname: string;
  readonly targetIp: string;
  readonly targetPort: number;
  readonly proxyType: "caddy" | "nginx" | "none";
  readonly tlsMode: "auto" | "manual" | "off";
  readonly healthcheckUrl?: string;
  readonly zone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DomainControlConfig {
  readonly enabled: boolean;
  readonly defaultProvider: string;
  /** Registrable zones this installation may mutate. Empty = deny everything. */
  readonly allowlist: readonly string[];
  /** Explicit denials evaluated before the allowlist. */
  readonly denylist: readonly string[];
  readonly requireApproval: boolean;
  /** Zones treated as production even when the domain record says otherwise. */
  readonly productionZones: readonly string[];
  readonly approvalTtlMs: number;
  readonly resolvers: readonly string[];
  readonly verificationTimeoutMs: number;
  readonly verificationIntervalMs: number;
  readonly caddyAdminUrl: string | null;
}
