// Phase 20.25 — URL safety for registry-driven fetches (doc §62).
//
// Every URL the execution runtime is asked to fetch passes through here.
// Loopback, private ranges, link-local, cloud metadata, and non-HTTP schemes
// are blocked unless the host is on an explicit admin allowlist.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
]);

const BLOCKED_IP_PATTERNS: Array<{ test: (host: string) => boolean; why: string }> = [
  { test: (h) => h === "127.0.0.1" || h.startsWith("127."), why: "loopback address" },
  { test: (h) => h === "0.0.0.0" || h === "::" || h === "::1", why: "unspecified/loopback address" },
  { test: (h) => /^10\./.test(h), why: "private range (10/8)" },
  { test: (h) => /^192\.168\./.test(h), why: "private range (192.168/16)" },
  { test: (h) => /^172\.(1[6-9]|2\d|3[01])\./.test(h), why: "private range (172.16/12)" },
  { test: (h) => /^169\.254\./.test(h), why: "link-local address (includes cloud metadata)" },
  { test: (h) => /^fc00:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h), why: "IPv6 unique-local address" },
  { test: (h) => /^fe80:/i.test(h), why: "IPv6 link-local address" },
];

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export interface UrlSafetyResult {
  ok: boolean;
  url?: URL;
  reason?: string;
}

export function checkUrlSafety(rawUrl: string, allowlist: Set<string> = new Set()): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `forbidden protocol ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowlist.has(host)) {
    return { ok: true, url: parsed };
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `SSRF blocked: ${host} is a blocked hostname` };
  }
  for (const rule of BLOCKED_IP_PATTERNS) {
    if (rule.test(host)) {
      return { ok: false, reason: `SSRF blocked: ${rule.why}` };
    }
  }
  return { ok: true, url: parsed };
}

export interface SafeUrlPolicy {
  valid: boolean;
  /** Only meaningful when `valid` is true — the SSRF-checked absolute URL. */
  normalizedUrl: string;
  reason?: string;
}

/**
 * Validate + normalize a fetch target in the same shape the media-acquisition
 * URL policy uses, so every runtime fetch in the codebase reads the same way:
 * validate first, then fetch the validated `normalizedUrl` — never the raw
 * caller-supplied string.
 */
export function validateAndNormalizeUrl(rawUrl: string, allowlist: Set<string> = new Set()): SafeUrlPolicy {
  const guard = checkUrlSafety(rawUrl, allowlist);
  if (!guard.ok || !guard.url) {
    return { valid: false, normalizedUrl: "", reason: guard.reason ?? "blocked URL" };
  }
  return { valid: true, normalizedUrl: guard.url.toString() };
}

/** Parse a newline/comma-separated admin allowlist from config or env. */
export function parseAllowlist(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}
