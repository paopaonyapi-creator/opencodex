// Phase 20.89 — Pao-hubPro × Bubble: Capability Hub domain types.
//
// Registry-first law: no capability is installable, enableable, or executable
// without a Registry Entry + validated Manifest. One-Click means one user
// intent — never uncontrolled execution.
//
// Canonical phase lock (user decision 2026-09-18):
//   20.65 Context Mode · 20.65.1 Litho/deepwiki-rs · 20.83 Apple Design Skill
//   20.84 TypeSafe Jev · 20.85 OmniRoute · 20.86 AI APIs You Can Ship Today
//   20.87 FileSync · 20.88 Remotion · 20.89 Bubble/Capability Hub
//   20.90 Forge/Prompt Engineering Control Plane · 20.91 RESERVED
// No phase collisions are permitted after reconciliation.

export type CapabilityType =
  | "agent"
  | "skill"
  | "mcp-server"
  | "api"
  | "model"
  | "provider"
  | "workflow"
  | "prompt"
  | "cli-tool"
  | "browser-tool"
  | "ui-extension"
  | "comfyui-node"
  | "comfyui-workflow"
  | "data-source"
  | "runtime-adapter"
  | "reviewer"
  | "memory-provider"
  | "router";

/** Policy decisions — the source's native enum (Phase 20.89 §21). */
export type PolicyDecision = "ALLOW" | "ALLOW_WITH_APPROVAL" | "DENY" | "QUARANTINE";

/** Compatibility verdicts. UNKNOWN is never interpreted as COMPATIBLE. */
export type CompatibilityState =
  | "COMPATIBLE"
  | "COMPATIBLE_WITH_WARNINGS"
  | "INCOMPATIBLE"
  | "UNKNOWN";

/** Capability lifecycle — 19 explicit states; a boolean `installed` is forbidden. */
export type CapabilityLifecycleState =
  | "DISCOVERED"
  | "IMPORTED"
  | "NORMALIZED"
  | "SCANNED"
  | "APPROVED"
  | "AVAILABLE"
  | "INSTALLING"
  | "INSTALLED"
  | "HEALTHY"
  | "DEGRADED"
  | "FAILED"
  | "DISABLED"
  | "UPDATE_AVAILABLE"
  | "QUARANTINED"
  | "DEPRECATED"
  | "SUPERSEDED"
  | "UNINSTALLED"
  | "ROLLBACK_REQUIRED";

/** Installer transaction states. INSTALLING is never treated as COMPLETE. */
export type InstallTransactionState =
  | "PLANNED"
  | "APPROVED"
  | "PREPARING"
  | "SNAPSHOTTING"
  | "APPLYING"
  | "VERIFYING"
  | "REGISTERING"
  | "COMMITTED"
  | "FAILED"
  | "ROLLBACK_PENDING"
  | "ROLLING_BACK"
  | "ROLLED_BACK";

export type HealthState = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

export type TrustState =
  | "verified"
  | "known-source"
  | "community"
  | "unverified"
  | "quarantined"
  | "revoked";

/** Blueprint status is separate from runtime status: Phase Complete ≠ Runtime Healthy. */
export type PhaseBlueprintStatus =
  | "DRAFT"
  | "SPEC_COMPLETE"
  | "IMPLEMENTING"
  | "IMPLEMENTED"
  | "VALIDATED";

export type PhaseRuntimeStatus =
  | "NOT_INSTALLED"
  | "INSTALLED"
  | "HEALTHY"
  | "DEGRADED"
  | "DISABLED"
  | "QUARANTINED";

/** Standard permission taxonomy (Phase 20.89 §22), scope-qualified. */
export type MarketplacePermission =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.delete"
  | "shell.execute"
  | "network.outbound"
  | "network.listen"
  | "browser.control"
  | "process.spawn"
  | "clipboard.read"
  | "clipboard.write"
  | "credential.use"
  | "email.read"
  | "email.send"
  | "calendar.read"
  | "calendar.write"
  | "github.read"
  | "github.write"
  | "mcp.call"
  | "model.invoke"
  | "container.run"
  | "gpu.use"
  | "camera.use"
  | "microphone.use";

/** Canonical phase lock (user decision 2026-09-18). Source of truth for the importer. */
export interface CanonicalPhase {
  phaseId: string;
  title: string;
  type: CapabilityType;
  blueprintFile: string;
  supersedesPhase?: string;
  supersededByPhase?: string;
  note?: string;
}

/** 17 machine-checkable error codes with operator-actionable semantics. */
export type MarketplaceErrorCode =
  | "CAPABILITY_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "SOURCE_UNREACHABLE"
  | "SOURCE_UNTRUSTED"
  | "MANIFEST_INVALID"
  | "CHECKSUM_MISMATCH"
  | "DEPENDENCY_MISSING"
  | "DEPENDENCY_CONFLICT"
  | "INCOMPATIBLE_ENVIRONMENT"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "INSTALL_FAILED"
  | "HEALTH_CHECK_FAILED"
  | "ROLLBACK_FAILED"
  | "SECRET_MISSING"
  | "PLAN_INVALID";

export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown>;

  constructor(code: MarketplaceErrorCode, httpStatus: number, message: string, opts?: { retryable?: boolean; detail?: Record<string, unknown> }) {
    super(message);
    this.name = "MarketplaceError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = opts?.retryable ?? false;
    this.detail = opts?.detail ?? {};
  }
}

/** Audit event vocabulary (source §41). */
export type MarketplaceAuditEvent =
  | "CAPABILITY_IMPORTED"
  | "CAPABILITY_UPDATED"
  | "INSTALL_PLANNED"
  | "INSTALL_APPROVED"
  | "INSTALL_STARTED"
  | "INSTALL_COMPLETED"
  | "INSTALL_FAILED"
  | "ROLLBACK_STARTED"
  | "ROLLBACK_COMPLETED"
  | "CAPABILITY_ENABLED"
  | "CAPABILITY_DISABLED"
  | "CAPABILITY_QUARANTINED"
  | "CAPABILITY_UNINSTALLED";

export interface MarketplaceAuditRecord {
  eventType: MarketplaceAuditEvent;
  actor: string;
  capabilitySlug: string | null;
  version: string | null;
  operation: string;
  planId: string | null;
  policyDecision: PolicyDecision | null;
  approvalId: string | null;
  result: string;
  detailsJson: string;
  createdAt: string;
}
