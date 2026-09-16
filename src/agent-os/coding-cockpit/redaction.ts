// Phase 20.39 — Centralized redaction (spec §36). Combines the 20.35 regex
// scrubber and the 20.28 structured-key scrubber; known secret-bearing keys
// are sanitized by name in addition to pattern matching. Applied before any
// audit/log/event persistence.

import { redactValue } from "../governance-gateway/gateway";
import { redactSecrets } from "../unified-runtime/security";

const SECRET_KEY_PATTERN = /^(password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|set-cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?token)$/i;

/** Redact a free-text blob (tool output, command stdout, error strings). */
export function redactText(text: string): string {
  return redactSecrets(text);
}

/** Redact an arbitrary JSON-able structure by key name and by value pattern. */
export function redactStructure(value: unknown): unknown {
  return redactValue(value);
}

/** Serialize + redact for audit metadata columns. */
export function redactJsonForAudit(value: unknown): string {
  const redacted = redactValue(value);
  return redactSecrets(JSON.stringify(redacted));
}

/** True when a key name looks secret-bearing (used by event sanitizers). */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Sanitize a single tool-input/output record for persistence and UI. */
export function sanitizeToolRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(value);
  }
  return redactValue(out) as Record<string, unknown>;
}
