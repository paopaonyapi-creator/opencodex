// Phase 20.63 — SSRF/egress guard + redaction (spec §27, §53).
//
// Mandatory centralized gate for every outbound URL: protocol allowlist
// (https only by default), loopback/private/link-local/metadata IPv4+IPv6
// rejection including decimal/hex/octal encoded forms and userinfo tricks,
// and redirect-target revalidation. Nothing here trusts a URL because it
// came from a popular repository.

import { ExternalApiError } from "./types";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "metadata.google.internal", "metadata.goog",
  "instance-data", "169.254.169.254",
]);

/** Parse a numeric IPv4 from decimal/hex/octal encoded forms. */
function decodeIpv4Host(host: string): string | null {
  if (/^\d+$/.test(host)) {
    // Pure decimal integer form, e.g. 2130706433 == 127.0.0.1
    const n = Number(host);
    if (n <= 0xffffffff) return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => p !== "")) {
    const decoded = parts.map((p) => {
      if (/^0x[0-9a-f]+$/i.test(p)) return Number.parseInt(p, 16);
      if (/^0[0-7]+$/.test(p)) return Number.parseInt(p, 8);
      const v = Number(p);
      return Number.isFinite(v) ? v : -1;
    });
    if (decoded.every((v) => v >= 0 && v <= 255)) return decoded.join(".");
  }
  return null;
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::" || h === "::ffff:127.0.0.1") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local + ULA
  if (h.startsWith("::ffff:")) {
    const embedded = h.slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(embedded)) return isPrivateIpv4(embedded);
  }
  if (h.startsWith("ff0")) return true; // multicast
  return false;
}

export interface UrlPolicyResult {
  url: string;
  hostname: string;
  protocol: string;
}

/**
 * Validate an outbound URL. Throws EXTERNAL_API_SSRF_BLOCKED on any
 * disallowed scheme, host, or address form. `requireHttps` enforces the
 * https-only default; DNS-independent checks only — callers with DNS access
 * should additionally validate resolved IPs via `isBlockedIp`.
 */
export function validateOutboundUrl(rawUrl: string, options?: { requireHttps?: boolean }): UrlPolicyResult {
  const requireHttps = options?.requireHttps !== false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "malformed URL rejected");
  }
  const protocol = parsed.protocol.replace(/:$/, "");
  if (protocol !== "https" && (requireHttps || (protocol !== "http"))) {
    throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, `protocol ${protocol} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "userinfo in URL is not allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "blocked host");
  }
  const ipv4 = decodeIpv4Host(host);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "private or metadata network target");
  } else if (host.includes(":")) {
    if (isPrivateIpv6(host)) throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "private IPv6 target");
  }
  return { url: parsed.toString(), hostname: host, protocol };
}

/** Validate a resolved/redirect IP directly (DNS + redirect revalidation). */
export function isBlockedIp(ip: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return isPrivateIpv4(ip);
  return isPrivateIpv6(ip);
}

/** Redirect chain validation: bounded length + every hop revalidated. */
export function validateRedirectChain(chain: string[], maxRedirects: number, requireHttps: boolean): void {
  if (chain.length > maxRedirects + 1) {
    throw new ExternalApiError("EXTERNAL_API_SSRF_BLOCKED", 403, "redirect limit exceeded");
  }
  for (const hop of chain) validateOutboundUrl(hop, { requireHttps });
}

const REDACTION_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api_?key|access_token|refresh_token|client_secret|password|secret|token)$/i;

/** Structural redaction of headers/objects before any serialization (spec §53). */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTION_KEYS.test(key) ? "***" : redactSensitive(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***").replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "***");
  }
  return value;
}
