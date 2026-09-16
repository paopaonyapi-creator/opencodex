// Phase 20.26 — Feature flags (doc §79). Risky/less-tested capabilities stay
// off by default until they pass their own tests.

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export interface DouyinFlags {
  provider: boolean;
  search: boolean;
  hotBoard: boolean;
  comments: boolean;
  transcription: boolean;
  browserFallback: boolean;
  authSession: boolean;
  live: boolean;
  /** Public-only mode (doc §26): no logged-in data, no favorites, no session actions. */
  publicOnly: boolean;
}

export function douyinFlags(): DouyinFlags {
  return {
    provider: envFlag("FEATURE_DOUYIN_PROVIDER", true),
    search: envFlag("FEATURE_DOUYIN_SEARCH", true),
    hotBoard: envFlag("FEATURE_DOUYIN_HOT_BOARD", true),
    comments: envFlag("FEATURE_DOUYIN_COMMENTS", true),
    transcription: envFlag("FEATURE_DOUYIN_TRANSCRIPTION", true),
    browserFallback: envFlag("FEATURE_DOUYIN_BROWSER_FALLBACK", false),
    authSession: envFlag("FEATURE_DOUYIN_AUTH_SESSION", false),
    live: envFlag("FEATURE_DOUYIN_LIVE", false),
    // Public-only is the DEFAULT for research workers (doc §26).
    publicOnly: envFlag("DOUYIN_PUBLIC_ONLY", true),
  };
}
