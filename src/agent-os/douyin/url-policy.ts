// Phase 20.26 — Douyin URL classification & network policy (doc §11, §27, §28).
//
// Every URL entering the Douyin provider is validated by the shared Phase
// 20.24 SSRF policy FIRST (blocks loopback/private/link-local/metadata), then
// matched against the Douyin domain family allowlist, then classified.
// Fail closed: anything unclassifiable is rejected, not guessed.

import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import { DouyinError } from "./errors";
import type { DouyinUrlClassification, DouyinUrlKind } from "./types";

/** Douyin domain family allowlist (doc §27) — extend only from observed upstream behavior. */
const DOUYIN_HOST_SUFFIXES = [
  "douyin.com",
  "iesdouyin.com",
  "douyinpic.com",
  "douyinvod.com",
  "snssdk.com",
];

const PATH_KINDS: Array<{ pattern: RegExp; kind: DouyinUrlKind }> = [
  { pattern: /^\/video\/([\w-]+)/, kind: "video" },
  { pattern: /^\/note\/([\w-]+)/, kind: "note" },
  { pattern: /^\/gallery\/([\w-]+)/, kind: "gallery" },
  { pattern: /^\/user\/([\w-]+)/, kind: "user" },
  { pattern: /^\/collection\/([\w-]+)/, kind: "collection" },
  { pattern: /^\/mix\/([\w-]+)/, kind: "mix" },
  { pattern: /^\/music\/([\w-]+)/, kind: "music" },
];

function isDouyinHost(hostname: string): boolean {
  return DOUYIN_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith("." + suffix));
}

/**
 * Validate + classify a Douyin URL. Returns null when the URL is not a
 * Douyin-family URL (callers may route it to other providers). Throws a
 * typed DouyinError for Douyin URLs that are malformed or unsupported.
 */
export function classifyDouyinUrl(rawUrl: string): DouyinUrlClassification | null {
  let policy;
  try {
    policy = validateAndNormalizeUrl(rawUrl);
  } catch (err) {
    if (err instanceof DouyinError) throw err;
    // The shared Phase 20.24 policy rejected this URL (malformed, unsupported
    // scheme, or SSRF block). Fail closed with a typed error — a policy-blocked
    // URL must never silently fall through to another provider.
    throw new DouyinError("DOUYIN_INVALID_URL", err instanceof Error ? err.message : "invalid URL");
  }

  const hostname = policy.domain;
  if (!isDouyinHost(hostname)) return null;

  const parsed = new URL(policy.normalizedUrl);

  // Short links require resolution (doc §28: every redirect hop is
  // re-validated by the upstream client before use).
  if (hostname === "v.douyin.com") {
    return {
      provider: "douyin",
      kind: "short_link",
      canonicalUrl: policy.normalizedUrl,
      requiresResolution: true,
      risk: "normal",
    };
  }

  const path = parsed.pathname.replace(/\/+$/, "");

  if (hostname.startsWith("live.")) {
    const id = path.split("/").pop() || undefined;
    return {
      provider: "douyin",
      kind: "live",
      canonicalUrl: policy.normalizedUrl,
      sourceId: id,
      requiresResolution: false,
      risk: "live",
    };
  }

  for (const rule of PATH_KINDS) {
    const match = path.match(rule.pattern);
    if (match) {
      return {
        provider: "douyin",
        kind: rule.kind,
        canonicalUrl: policy.normalizedUrl,
        sourceId: match[1],
        requiresResolution: false,
        risk: "normal",
      };
    }
  }

  throw new DouyinError("DOUYIN_UNSUPPORTED_URL", `Unsupported Douyin URL path: ${path || "/"}`);
}

/** Boolean helper for provider routing (no throw for non-Douyin URLs). */
export function isDouyinUrl(rawUrl: string): boolean {
  try {
    return classifyDouyinUrl(rawUrl) !== null;
  } catch {
    return false;
  }
}

/**
 * Validate a short-link redirect target (doc §28). Every hop must be a valid
 * HTTPS URL on the Douyin family, never a private/loopback/metadata host.
 */
export function validateRedirectHop(hopUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(hopUrl);
  } catch {
    throw new DouyinError("DOUYIN_INVALID_URL", "Invalid redirect hop");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DouyinError("DOUYIN_INVALID_URL", `Forbidden redirect scheme ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!isDouyinHost(host)) {
    // Redirect leaving the Douyin family (incl. private/metadata hosts) is rejected.
    throw new DouyinError("DOUYIN_INVALID_URL", `Redirect hop leaves the Douyin domain family: ${host}`);
  }
  return parsed;
}
