// Phase 20.15 — Cloud Sandbox Plane: error taxonomy and retry policy.
//
// Source spec §58 defines the codes and §59 defines which operations may be retried.
// The retry verdict lives next to the code rather than at each call site, because an
// agent that decides retryability itself will retry `destroy` after a timeout, and §59
// forbids exactly that.

export type CloudSandboxErrorCode =
  | "FEATURE_DISABLED"
  | "CLOUD_POLICY_DENIED"
  | "CLOUD_APPROVAL_REQUIRED"
  | "PRODUCTION_GATE_DENIED"
  | "SANDBOX_START_FAILED"
  | "SANDBOX_NOT_FOUND"
  | "SANDBOX_NOT_READY"
  | "SANDBOX_EXPIRED"
  | "ADAPTER_UNAVAILABLE"
  | "DOCKER_UNAVAILABLE"
  | "SERVICE_UNSUPPORTED"
  | "IAC_TOOLCHAIN_MISSING"
  | "IAC_VALIDATE_FAILED"
  | "IAC_PLAN_FAILED"
  | "IAC_APPLY_FAILED"
  | "RESOURCE_DISCOVERY_FAILED"
  | "TEST_FAILED"
  | "CLEANUP_FAILED"
  | "LEAK_DETECTED"
  | "PROMOTION_DIGEST_MISMATCH"
  | "CREDENTIAL_LEASE_FAILED"
  | "IDEMPOTENCY_CONFLICT"
  | "IMAGE_NOT_PINNED";

/**
 * Retryable means "the same call may be repeated safely".
 *
 * Everything destructive or trust-crossing is deliberately absent: §59 forbids blind
 * retry of production apply, destroy, permission change, and destructive migration.
 * A retry of those would either double-apply or mask the reason the first attempt
 * stopped, so the caller must surface the failure to a human instead.
 */
const RETRYABLE: ReadonlySet<CloudSandboxErrorCode> = new Set([
  "SANDBOX_START_FAILED",
  "SANDBOX_NOT_READY",
  "ADAPTER_UNAVAILABLE",
  "DOCKER_UNAVAILABLE",
  "RESOURCE_DISCOVERY_FAILED",
  "TEST_FAILED",
]);

export function isRetryableCode(code: CloudSandboxErrorCode): boolean {
  return RETRYABLE.has(code);
}

export interface CloudSandboxErrorOptions {
  sandboxId?: string;
  operation?: string;
  cause?: unknown;
}

export class CloudSandboxError extends Error {
  readonly code: CloudSandboxErrorCode;
  readonly retryable: boolean;
  readonly sandboxId: string | null;
  readonly operation: string | null;

  constructor(code: CloudSandboxErrorCode, message: string, options: CloudSandboxErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CloudSandboxError";
    this.code = code;
    this.retryable = isRetryableCode(code);
    this.sandboxId = options.sandboxId ?? null;
    this.operation = options.operation ?? null;
  }

  /** Safe to log and to return over HTTP: carries no credential or payload content. */
  toJSON(): {
    code: CloudSandboxErrorCode;
    message: string;
    retryable: boolean;
    sandboxId: string | null;
    operation: string | null;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      sandboxId: this.sandboxId,
      operation: this.operation,
    };
  }
}

export function isCloudSandboxError(value: unknown): value is CloudSandboxError {
  return value instanceof CloudSandboxError;
}
