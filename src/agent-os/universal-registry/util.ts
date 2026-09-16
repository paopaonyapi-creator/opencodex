// Phase 20.25 — Small shared helpers for the Universal Registry.

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unnamed";
}

/** Truncate a payload summary for audit rows; never includes secret values. */
export function summarizePayload(input: unknown, max = 200): string {
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    text = String(input);
  }
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Defense-in-depth for persisted summaries: strip control characters and
 * SQL/protocol-significant punctuation from untrusted payload text before it
 * is written to audit or step rows. Summaries are for human review only.
 */
export function sanitizeForAudit(text: string, max = 200): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/['"`;]|--|\/\*|\*\//g, " ");
  const trimmed = cleaned.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** summarize + sanitize in one step for untrusted payloads. */
export function auditSummary(input: unknown, max = 200): string {
  return sanitizeForAudit(summarizePayload(input, max * 2), max);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
