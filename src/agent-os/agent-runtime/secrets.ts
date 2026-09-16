// Phase 20.61 — Agent Runtime secret resolution and redaction.
//
// Same reference pattern as the other modules: DB rows store a reference,
// tokens resolve at call time from an env override or a file under
// $OPENCODEX_HOME. amux tokens never reach the browser, agents, logs, or
// evidence rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";

export function resolveRuntimeToken(secretRef: string): string {
  const direct = process.env.PAO_AMUX_TOKEN?.trim() || process.env.AMUX_TOKEN?.trim();
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
    return readFileSync(join(getConfigDir(), "agent-runtime", "secrets", relative), "utf8").trim();
  } catch {
    return "";
  }
}

const REDACTED = "***";

export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer " + REDACTED)
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|amux_[A-Za-z0-9_-]{16,})\b/g, REDACTED);
}

/** Check whether sensitive material leaked into persisted text (spec §18 test hook). */
export function containsSecretLikeMaterial(text: string): boolean {
  if (!text) return false;
  return /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)
    || /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|amux_[A-Za-z0-9_-]{16,})\b/.test(text);
}
