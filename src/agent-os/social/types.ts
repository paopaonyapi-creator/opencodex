// Phase 20.20 — Pao-hubPro Social Intelligence Engine domain types.
//
// Provider-agnostic social research: provider/tool registries, capability taxonomy,
// explainable routing, budget decisions, normalized content items with provenance,
// trend signals, and Adobe Stock opportunity proposals.
//
// Evidence honesty rule (spec section 18): a social trend signal is only ever a
// "Social trend signal". Nothing in this module may present observed social metrics
// as Adobe buyer demand, search volume, or sales probability. Unknown values stay
// null/unknown — never fabricated into zeros or perfect scores.

export type SocialPlatform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "facebook"
  | "x_twitter"
  | "reddit"
  | "linkedin"
  | "pinterest"
  | "bluesky"
  | "telegram"
  | "discord"
  | "spotify"
  | "multi"
  | "unknown";

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  "tiktok", "instagram", "youtube", "facebook", "x_twitter", "reddit",
  "linkedin", "pinterest", "bluesky", "telegram", "discord", "spotify",
  "multi", "unknown",
];

export type SocialCapability =
  | "search_posts"
  | "search_videos"
  | "search_profiles"
  | "get_profile"
  | "get_post"
  | "get_video"
  | "get_comments"
  | "get_replies"
  | "get_hashtag"
  | "search_hashtags"
  | "get_trending"
  | "search_keyword"
  | "search_music"
  | "get_music"
  | "get_channel"
  | "get_channel_videos"
  | "get_transcript"
  | "get_engagement_metrics"
  | "get_public_metadata"
  | "get_search_suggestions"
  | "get_related_topics"
  | "get_public_page"
  | "get_public_group";

export const SOCIAL_CAPABILITIES: readonly SocialCapability[] = [
  "search_posts", "search_videos", "search_profiles", "get_profile", "get_post",
  "get_video", "get_comments", "get_replies", "get_hashtag", "search_hashtags",
  "get_trending", "search_keyword", "search_music", "get_music", "get_channel",
  "get_channel_videos", "get_transcript", "get_engagement_metrics",
  "get_public_metadata", "get_search_suggestions", "get_related_topics",
  "get_public_page", "get_public_group",
];

export type ProviderAuthType = "api_key" | "oauth" | "none" | "custom";
export type ProviderStatus = "healthy" | "degraded" | "offline" | "unknown";

export interface SocialProviderRecord {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  priority: number;
  baseUrl: string | null;
  authType: ProviderAuthType;
  status: ProviderStatus;
  lastHealthCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Pricing is only ever "known" when provider metadata states it. */
export type PricingState = "free" | "paid" | "unknown";

export interface SocialTool {
  id: string;
  providerId: string;
  externalId: string;

  owner: string | null;
  name: string;
  title: string | null;
  description: string | null;
  url: string | null;

  platform: SocialPlatform;
  capabilities: SocialCapability[];

  categories: string[];
  tags: string[];

  enabled: boolean;
  /**
   * Who controls `enabled`: 'auto' means catalog refresh may flip it (stale marking),
   * 'operator' means a human/agent decision that refresh must respect.
   */
  enabledSource: "auto" | "operator";
  verified: boolean;

  pricingState: PricingState;
  pricingModel: string | null;
  estimatedUnitCost: number | null;
  currency: string | null;

  /** Rolling internal run outcome counters (Phase 20.20 spec section 13). */
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  cancelCount: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;

  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastHealthCheckAt: string | null;

  externalCreatedAt: string | null;
  externalModifiedAt: string | null;
  discoveredAt: string;
  updatedAt: string;
}

export type SocialResearchFreshness = "live" | "recent" | "cached_ok";

export interface SocialResearchRequest {
  platform?: SocialPlatform | "any";
  capabilities: SocialCapability[];
  query?: string;
  maxItems?: number;
  maxCostUsd?: number;
  freshness?: SocialResearchFreshness;
  preferredProviders?: string[];
  excludedTools?: string[];
}

export type SocialJobState =
  | "draft"
  | "routed"
  | "approval_required"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "budget_blocked"
  | "policy_blocked";

export interface RouteCandidate {
  toolId: string;
  score: number;
  reasons: string[];
  risks: string[];
  estimatedCostUsd: number | null;
}

export interface RouteDecision {
  selectedToolId: string | null;
  candidates: RouteCandidate[];
  estimatedCostUsd: number | null;
  requiresApproval: boolean;
  /** Set when no candidate survives the hard filters, with the reason why. */
  blockedReason: string | null;
}

export type SocialBudgetDecisionState =
  | "allow"
  | "allow_with_warning"
  | "require_approval"
  | "block_budget_exceeded"
  | "block_unknown_cost";

export interface SocialBudgetDecision {
  state: SocialBudgetDecisionState;
  reason: string;
  estimatedCostUsd: number | null;
}

export type SocialErrorCode =
  | "INVALID_INPUT"
  | "AUTH_INVALID"
  | "AUTH_MISSING"
  | "TOOL_NOT_FOUND"
  | "TOOL_DISABLED"
  | "TOOL_UNHEALTHY"
  | "UNSUPPORTED_CAPABILITY"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "TRANSIENT_NETWORK_ERROR"
  | "BUDGET_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "UNKNOWN_COST_BLOCKED"
  | "POLICY_BLOCKED"
  | "NORMALIZATION_FAILED"
  | "RESULT_LIMIT_EXCEEDED"
  | "CANCELLED"
  | "UNKNOWN_ERROR";

export type SocialRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export type NormalizedContentType =
  | "post" | "video" | "reel" | "short" | "comment" | "reply" | "profile" | "other";

export interface NormalizedMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  followers: number | null;
}

export interface NormalizedProvenance {
  provider: string;
  toolId: string;
  runId: string;
  fetchedAt: string;
}

export interface NormalizedContentItem {
  id: string;
  platform: SocialPlatform;
  sourceToolId: string;
  sourceUrl: string | null;
  contentType: NormalizedContentType;
  externalId: string | null;
  authorExternalId: string | null;
  authorDisplayName: string | null;
  text: string | null;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  observedAt: string;
  metrics: NormalizedMetrics;
  hashtags: string[];
  mentions: string[];
  language: string | null;
  /** Set by the dedupe pass when this item duplicates an earlier evidence row. */
  duplicateOf: string | null;
  provenance: NormalizedProvenance;
}

export type TrendSignalKind =
  | "keyword_frequency"
  | "hashtag_frequency"
  | "cross_platform_recurrence"
  | "content_format_recurrence";

export interface SocialTrendSignal {
  id: string;
  researchJobId: string;
  kind: TrendSignalKind;
  key: string;
  platforms: SocialPlatform[];
  occurrences: number;
  /** Normalized item ids backing this signal; every claim stays traceable. */
  evidenceRefs: string[];
  stats: Record<string, number>;
  observedAt: string;
}

export interface SocialStockOpportunity {
  id: string;
  researchJobId: string;
  title: string;
  buyerProblem: string;
  commercialUseCases: string[];
  observedThemes: string[];
  evidenceRefs: string[];
  /**
   * Confidence that the observed social evidence supports the themes above.
   * Derived only from evidence volume/spread/recency — never from market claims.
   */
  evidenceConfidence: number;
  /**
   * Heuristic ordering score derived ONLY from observed social signal metrics.
   * Null when evidence is too thin. It is explicitly NOT a demand, sales, or
   * acceptance probability.
   */
  opportunityScore: number | null;
  scoreBasis: string;
  risks: string[];
  suggestedOriginalDirections: string[];
  createdAt: string;
}

export interface UsageSummary {
  daily: { estimatedUsd: number; actualUsd: number | null; runs: number };
  monthly: { estimatedUsd: number; actualUsd: number | null; runs: number };
  budgets: {
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    dailyRemainingUsd: number;
    monthlyRemainingUsd: number;
  };
}
