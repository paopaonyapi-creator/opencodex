// Phase 20.26 — Douyin canonical error taxonomy (doc §59).

export type DouyinErrorCode =
  | "DOUYIN_INVALID_URL"
  | "DOUYIN_UNSUPPORTED_URL"
  | "DOUYIN_NOT_FOUND"
  | "DOUYIN_UNAVAILABLE"
  | "DOUYIN_AUTH_REQUIRED"
  | "DOUYIN_SESSION_EXPIRED"
  | "DOUYIN_RATE_LIMITED"
  | "DOUYIN_BROWSER_REQUIRED"
  | "DOUYIN_HUMAN_ACTION_REQUIRED"
  | "DOUYIN_DOWNLOAD_FAILED"
  | "DOUYIN_STORAGE_FULL"
  | "DOUYIN_CANCELLED"
  | "DOUYIN_UPSTREAM_CHANGED"
  | "DOUYIN_PROVIDER_UNHEALTHY"
  | "DOUYIN_LIMIT_EXCEEDED"
  | "DOUYIN_DISABLED"
  | "DOUYIN_RIGHTS_BLOCKED";

/** Conditions where a bounded retry is legitimate (doc §30). */
const RETRYABLE = new Set<DouyinErrorCode>([
  "DOUYIN_UNAVAILABLE",
  "DOUYIN_RATE_LIMITED",
  "DOUYIN_PROVIDER_UNHEALTHY",
]);

export class DouyinError extends Error {
  readonly code: DouyinErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: DouyinErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "DouyinError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.details = details;
  }
}
