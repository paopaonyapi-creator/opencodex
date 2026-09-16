// Phase 20.20 — URL policy (spec section 28, URL safety).
//
// Provider tools may return or accept arbitrary URLs. This module is the single
// validation point for anything that leaves the process (run inputs) or enters the
// evidence store (source URLs): http/https only, no credentials in the URL, and no
// loopback/private/link-local targets — the classic SSRF surface.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false; // malformed — reject rather than guess
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  const [a, b] = octets as [number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("::ffff:")) return isPrivateIpv4(h.slice(7));
  return false;
}

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
}

export function validatePublicHttpUrl(raw: string | null | undefined): UrlValidationResult {
  if (!raw) return { ok: false, reason: "empty" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in URL not allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "missing host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "blocked host" };
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "internal hostname not allowed" };
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { ok: false, reason: "private network target not allowed" };
  }
  return { ok: true };
}

/** Canonical form for dedupe: lowercase host, no fragment, no tracking params, no trailing slash. */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "igshid", "si", "feature", "app", "referrer", "ref_src",
]);

export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    let out = url.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}
