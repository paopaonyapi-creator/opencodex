// Phase 20.32 — normalized error taxonomy (doc §33).
// Messages are safe for the frontend: callers redact credentials upstream and
// the sanitizer strips anything that looks like an Authorization header.

export type SpeechErrorCode =
  | "SPEECH_RUNTIME_UNAVAILABLE"
  | "SPEECH_RUNTIME_VERSION_MISMATCH"
  | "SPEECH_MODEL_NOT_READY"
  | "SPEECH_UNSUPPORTED_LANGUAGE"
  | "SPEECH_GENERATION_TIMEOUT"
  | "SPEECH_TRANSCRIPTION_FAILED"
  | "SPEECH_OUTPUT_INVALID"
  | "SPEECH_PATH_OUTSIDE_WORKSPACE"
  | "SPEECH_DISABLED_BY_FLAG"
  | "SPEECH_POLICY_BLOCKED"
  | "SPEECH_INVALID_ARGUMENT"
  | "SPEECH_JOB_NOT_FOUND"
  | "SPEECH_VOICE_NOT_FOUND"
  | "VOICE_CONSENT_REQUIRED"
  | "VOICE_CONSENT_REVOKED"
  | "VOICE_CLONE_NOT_ALLOWED"
  | "MODEL_LICENSE_UNVERIFIED"
  | "MODEL_COMMERCIAL_USE_BLOCKED"
  | "MODEL_STOCK_USE_BLOCKED"
  | "REMOTE_AUTH_FAILED"
  | "REMOTE_TLS_REQUIRED";

/** Only runtime/transport failures may be retried (doc §14.1). Policy,
 *  consent, license, path and input failures are terminal. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "SPEECH_RUNTIME_UNAVAILABLE",
  "SPEECH_GENERATION_TIMEOUT",
]);

export class SpeechError extends Error {
  readonly code: SpeechErrorCode;
  readonly retryable: boolean;

  constructor(code: SpeechErrorCode, message: string) {
    super(`[${code}] ${sanitizeSpeechMessage(message)}`);
    this.name = "SpeechError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

/** Strips credential material and bearer tokens from anything that could
 *  reach a client or log (doc §26). */
export function sanitizeSpeechMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api_key|apikey|token|key)=)[^&\s]+/gi, "$1[REDACTED]");
}
