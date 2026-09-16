// Phase 20.60 — OpenPost adapter error mapping and retry classification.
//
// Raw transport failures are mapped into the stable error classes from the
// phase spec (§29). Classification drives the delivery executor (§17):
// retryable failures get bounded backoff, ambiguous outcomes must never be
// blindly retried, and everything else stops for operator intervention.

import { SocialPublishingHttpError, type SocialPublishingErrorCode } from "../types";

export type ErrorClass = "retryable" | "non_retryable" | "ambiguous";

export interface MappedOpenPostError {
  code: SocialPublishingErrorCode;
  httpStatus: number;
  message: string;
  /** Which upstream status (if any) produced this mapping. */
  remoteStatus: number | null;
}

export class OpenPostRequestError extends Error {
  readonly mapped: MappedOpenPostError;

  constructor(mapped: MappedOpenPostError) {
    super(mapped.message);
    this.name = "OpenPostRequestError";
    this.mapped = mapped;
  }

  toHttpError(): SocialPublishingHttpError {
    return new SocialPublishingHttpError(this.mapped.code, this.mapped.httpStatus, this.mapped.message);
  }
}

/** Map an HTTP status from OpenPost into the stable internal error class. */
export function mapRemoteStatus(status: number, bodyPreview: string): MappedOpenPostError {
  const safeBody = bodyPreview.slice(0, 300);
  if (status === 401) {
    return { code: "OPENPOST_AUTH_FAILED", httpStatus: 502, message: "OpenPost rejected the configured token (401).", remoteStatus: status };
  }
  if (status === 403) {
    return { code: "OPENPOST_PERMISSION_DENIED", httpStatus: 502, message: "OpenPost denied the operation (403): " + safeBody, remoteStatus: status };
  }
  if (status === 404) {
    return { code: "OPENPOST_REMOTE_NOT_FOUND", httpStatus: 404, message: "OpenPost resource not found (404): " + safeBody, remoteStatus: status };
  }
  if (status === 409) {
    return { code: "OPENPOST_REMOTE_CONFLICT", httpStatus: 409, message: "OpenPost reports a conflicting remote state (409): " + safeBody, remoteStatus: status };
  }
  if (status === 422) {
    return { code: "OPENPOST_VALIDATION_ERROR", httpStatus: 422, message: "OpenPost rejected the payload (422): " + safeBody, remoteStatus: status };
  }
  if (status === 429) {
    return { code: "OPENPOST_RATE_LIMITED", httpStatus: 429, message: "OpenPost rate limited the request (429).", remoteStatus: status };
  }
  if (status >= 500) {
    return { code: "OPENPOST_UNAVAILABLE", httpStatus: 502, message: "OpenPost service error (" + status + "): " + safeBody, remoteStatus: status };
  }
  return { code: "OPENPOST_UNAVAILABLE", httpStatus: 502, message: "Unexpected OpenPost response (" + status + "): " + safeBody, remoteStatus: status };
}

export function mapTransportFailure(cause: unknown): MappedOpenPostError {
  const message = cause instanceof Error ? cause.message : String(cause);
  // AbortSignal timeouts are ambiguous for mutations: the request may have
  // been delivered even though we never saw the response (spec §17.3).
  if (cause instanceof Error && cause.name === "AbortError") {
    return { code: "OPENPOST_AMBIGUOUS_RESULT", httpStatus: 504, message: "OpenPost request timed out before a response was observed.", remoteStatus: null };
  }
  return { code: "OPENPOST_UNAVAILABLE", httpStatus: 502, message: "OpenPost unreachable: " + message, remoteStatus: null };
}

/**
 * Classify a mapped error for the delivery executor. Mirrors spec §17:
 * 429/5xx/network → retryable; timeouts after mutation → ambiguous;
 * auth/validation/not-found/conflict → non-retryable without intervention.
 */
export function classifyOpenPostError(error: unknown): { errorClass: ErrorClass; code: string } {
  if (error instanceof OpenPostRequestError) {
    const code = error.mapped.code;
    if (code === "OPENPOST_AMBIGUOUS_RESULT") return { errorClass: "ambiguous", code };
    if (code === "OPENPOST_UNAVAILABLE" || code === "OPENPOST_RATE_LIMITED") return { errorClass: "retryable", code };
    return { errorClass: "non_retryable", code };
  }
  if (error instanceof SocialPublishingHttpError) {
    if (error.code === "SOCIAL_RECONCILIATION_REQUIRED") return { errorClass: "ambiguous", code: error.code };
    return { errorClass: "non_retryable", code: error.code };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { errorClass: "ambiguous", code: "OPENPOST_AMBIGUOUS_RESULT" };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    return { errorClass: "retryable", code: "OPENPOST_UNAVAILABLE" };
  }
  return { errorClass: "non_retryable", code: "OPENPOST_UNAVAILABLE" };
}
