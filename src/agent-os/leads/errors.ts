// Phase 20.34 — lead error taxonomy (spec §38) + flags (§49).
// Codes are machine-readable and safe to return to clients; messages are
// sanitized (no credentials, no bearer tokens).

export type LeadErrorCode =
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_SCHEMA_CHANGED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_QUOTA_EXHAUSTED"
  | "PROVIDER_DISABLED"
  | "PROVIDER_INVALID_URL"
  | "BUDGET_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "POLICY_BLOCKED"
  | "VALIDATION_ERROR"
  | "DUPLICATE_CANDIDATE"
  | "EXPORT_BLOCKED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const RETRYABLE: ReadonlySet<string> = new Set(["PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMIT"]);

export class LeadError extends Error {
  readonly code: LeadErrorCode;
  readonly retryable: boolean;

  constructor(code: LeadErrorCode, message: string) {
    super(`[${code}] ${sanitize(message)}`);
    this.name = "LeadError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

function sanitize(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|api_key|apikey|token|key)=)[^&\s]+/gi, "$1[REDACTED]");
}
