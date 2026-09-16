// Phase 20.40 — Centralized redaction (spec §31). Layered on the repo-wide
// scrubbers (20.35 regex + 20.28 key-name) and extended with the patterns
// the spec requires: OpenAI/Anthropic keys, GitHub tokens, bearer/JWT,
// database URLs, private keys, cookies. Originals are never logged.

import { redactSecrets } from "../unified-runtime/security";
import { redactValue } from "../governance-gateway/gateway";

export const REDACTED_SECRET = "[REDACTED_SECRET]";

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /ghp_[A-Za-z0-9]{16,}/g,
  /gho_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s"']+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const SECRET_KEY_PATTERN = /^(password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|set-cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?token|database[_-]?url|connection[_-]?string)$/i;

export function redactText(text: string): string {
  let result = redactSecrets(text);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED_SECRET);
  }
  return result;
}

export function redactStructure(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactStructure(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED_SECRET : redactStructure(item, depth + 1);
    }
    return out;
  }
  return redactValue(value, depth);
}

export function redactJson(value: unknown): string {
  return JSON.stringify(redactStructure(value));
}

/** Content previews are bounded and redacted before any persistence. */
export function buildContentPreview(text: string | null | undefined, maxLength = 240): string | null {
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  const slice = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  return redactText(slice);
}
