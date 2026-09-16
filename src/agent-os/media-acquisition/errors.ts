// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Standard Error Codes and Exception Classes

export type MediaErrorCode =
  | "MEDIA_UNSUPPORTED_URL"
  | "MEDIA_PROVIDER_OFFLINE"
  | "MEDIA_PROVIDER_ERROR"
  | "MEDIA_AUTH_REQUIRED"
  | "MEDIA_PERMISSION_DENIED"
  | "MEDIA_POLICY_BLOCKED"
  | "MEDIA_RATE_LIMITED"
  | "MEDIA_TIMEOUT"
  | "MEDIA_DOWNLOAD_FAILED"
  | "MEDIA_PROCESSING_FAILED"
  | "MEDIA_STORAGE_FAILED"
  | "MEDIA_CANCELLED"
  | "MEDIA_INVALID_ARGUMENT"
  | "MEDIA_NOT_FOUND";

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: MediaErrorCode, message: string, retryable = false, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "MediaError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  static isRetryableCode(code: MediaErrorCode): boolean {
    switch (code) {
      case "MEDIA_RATE_LIMITED":
      case "MEDIA_TIMEOUT":
      case "MEDIA_PROVIDER_OFFLINE":
        return true;
      case "MEDIA_UNSUPPORTED_URL":
      case "MEDIA_PERMISSION_DENIED":
      case "MEDIA_POLICY_BLOCKED":
      case "MEDIA_AUTH_REQUIRED":
      case "MEDIA_CANCELLED":
      case "MEDIA_INVALID_ARGUMENT":
        return false;
      default:
        return false;
    }
  }
}
