// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// URL Policy Guard & SSRF Protection

import { MediaError } from "./errors";

export interface UrlPolicyResult {
  valid: boolean;
  normalizedUrl: string;
  domain: string;
  platform: string;
  reason?: string;
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // Link-local & cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d+\.\d+$/,
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /\.corp$/i,
  /\.lan$/i,
];

export function validateAndNormalizeUrl(rawUrl: string): UrlPolicyResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new MediaError("MEDIA_INVALID_ARGUMENT", "URL is required and must be a string");
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new MediaError("MEDIA_INVALID_ARGUMENT", "URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MediaError("MEDIA_UNSUPPORTED_URL", `Malformed URL: ${rawUrl}`);
  }

  // Enforce HTTP / HTTPS schemes only
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaError(
      "MEDIA_POLICY_BLOCKED",
      `Protocol '${parsed.protocol}' is forbidden. Only HTTP and HTTPS are permitted.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // SSRF Check: detect blocked private and loopback addresses
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new MediaError(
        "MEDIA_POLICY_BLOCKED",
        `Target host '${hostname}' is blocked by SSRF security policy (private/local network destination).`,
      );
    }
  }

  // Determine platform tag
  let platform = "web";
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
    platform = "youtube";
  } else if (hostname.includes("tiktok.com")) {
    platform = "tiktok";
  } else if (hostname.includes("instagram.com")) {
    platform = "instagram";
  } else if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
    platform = "x";
  } else if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) {
    platform = "facebook";
  } else if (hostname.includes("bilibili.com")) {
    platform = "bilibili";
  } else if (hostname.includes("vimeo.com")) {
    platform = "vimeo";
  } else if (hostname.includes("reddit.com")) {
    platform = "reddit";
  } else {
    // Strip common prefixes to extract platform tag
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      platform = parts[parts.length - 2];
    }
  }

  // Clean and normalize URL
  parsed.hash = ""; // remove client-side hash fragments
  const normalizedUrl = parsed.toString();

  return {
    valid: true,
    normalizedUrl,
    domain: hostname,
    platform,
  };
}
