// Phase 20.20 — Social Intelligence error taxonomy (spec section 33).
//
// Provider failures normalize into stable internal codes. Raw provider error
// messages stay server-side: they can embed URLs, account hints, or tokens, so
// they are persisted on the run row but never surfaced through MCP/API responses.

import type { SocialErrorCode } from "./types";

export class SocialError extends Error {
  readonly code: SocialErrorCode;
  readonly retryable: boolean;

  constructor(code: SocialErrorCode, message: string, retryable?: boolean) {
    super(message);
    this.name = "SocialError";
    this.code = code;
    this.retryable = retryable ?? RETRYABLE_ERROR_CODES.has(code);
  }
}

/**
 * Fallback may only chase retryable classes (spec section 14). Budget, approval,
 * policy, auth, and input errors terminate the job instead of burning the next
 * candidate's budget on the same inevitable failure.
 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<SocialErrorCode> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
  "TRANSIENT_NETWORK_ERROR",
  "TOOL_DISABLED",
  "TOOL_UNHEALTHY",
]);

export function isRetryableErrorCode(code: SocialErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

/** Map an arbitrary thrown value onto the taxonomy without inventing detail. */
export function toSocialError(error: unknown, fallbackMessage = "provider run failed"): SocialError {
  if (error instanceof SocialError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout|etimedout|timed out/i.test(message)) {
    return new SocialError("PROVIDER_TIMEOUT", message);
  }
  if (/429|rate.?limit/i.test(message)) {
    return new SocialError("PROVIDER_RATE_LIMITED", message);
  }
  if (/401|403|unauthorized|forbidden|invalid api token|authentication/i.test(message)) {
    return new SocialError("AUTH_INVALID", message, false);
  }
  if (/5\d\d|bad gateway|service unavailable|internal server error/i.test(message)) {
    return new SocialError("PROVIDER_ERROR", message);
  }
  if (/fetch failed|network|econnrefused|enotfound|socket/i.test(message)) {
    return new SocialError("TRANSIENT_NETWORK_ERROR", message);
  }
  return new SocialError("UNKNOWN_ERROR", message || fallbackMessage);
}
