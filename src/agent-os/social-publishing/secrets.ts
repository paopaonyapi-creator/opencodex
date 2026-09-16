// Phase 20.60 — Social Publishing secret resolution.
//
// The repo has no central secrets vault (admin/service tokens live in files
// under $OPENCODEX_HOME). This module follows the same reference pattern: DB
// rows store a *reference* (`secret_ref`), and the token is resolved at call
// time from an env override or a file under $OPENCODEX_HOME. Tokens are never
// persisted in SQLite, never returned to agents/browsers, and never logged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";

/**
 * Resolve an OpenPost API token from a secret reference.
 *
 * Reference forms:
 * - `env:VARIABLE_NAME` — read from the process environment.
 * - `file:<relative-path>` — read from a file under the config dir
 *   ($OPENCODEX_HOME); the file content is trimmed.
 * - bare name `openpost/main/api-token` — shorthand for
 *   `<configDir>/social-publishing/secrets/<name>` with `env:` overrides first
 *   (`PAO_OPENPOST_TOKEN` wins for the "main" instance to keep local dev simple).
 *
 * Returns "" when unresolvable — callers treat that as OPENPOST_AUTH_FAILED
 * territory, and no error message ever embeds the attempted path or value.
 */
export function resolveOpenPostToken(secretRef: string): string {
  const direct = process.env.PAO_OPENPOST_API_TOKEN?.trim();
  if (direct) return direct;
  const ref = secretRef?.trim();
  if (!ref) return "";
  if (ref.startsWith("env:")) {
    const name = ref.slice("env:".length).trim();
    return name ? (process.env[name]?.trim() ?? "") : "";
  }
  let relative = ref;
  if (ref.startsWith("file:")) relative = ref.slice("file:".length).trim();
  if (!relative || relative.includes("..") || relative.startsWith("/")) return "";
  try {
    const path = join(getConfigDir(), "social-publishing", "secrets", relative);
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

const REDACTED = "***";

/** Redact anything that looks like a credential from operator-facing text. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer " + REDACTED)
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, REDACTED);
}

/** Strip security-sensitive headers before any log/audit use. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /^authorization$/i.test(key) || /^x-api-key$/i.test(key) || /token|secret|cookie/i.test(key)
      ? REDACTED
      : value;
  }
  return out;
}
