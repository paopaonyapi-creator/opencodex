// Phase 20.26 — Pao-hubPro × Douyin Media Intelligence & Downloader Engine
// Canonical types.
//
// Douyin is a PROVIDER beneath the Phase 20.24 Media Acquisition Core and the
// Phase 20.25 Universal Registry — never a second downloader architecture.
// Raw Douyin schemas never leave this module: everything is normalized into
// the canonical shapes below before persistence or API exposure.

export type DouyinUrlKind =
  | "video"
  | "note"
  | "gallery"
  | "user"
  | "collection"
  | "mix"
  | "music"
  | "live"
  | "short_link"
  | "unknown";

export interface DouyinUrlClassification {
  provider: "douyin";
  kind: DouyinUrlKind;
  canonicalUrl: string;
  sourceId?: string;
  requiresResolution: boolean;
  risk: "normal" | "needs_session" | "live";
}

export interface DouyinRights {
  ownership: "unknown" | "verified_user_owned";
  researchOnly: boolean;
  commercialReuseAllowed: boolean;
}

export const DEFAULT_DOUYIN_RIGHTS: DouyinRights = {
  ownership: "unknown",
  researchOnly: true,
  commercialReuseAllowed: false,
};

/** Canonical, provider-neutral media item (doc §12). */
export interface CanonicalMediaItem {
  id: string;
  provider: "douyin";
  providerItemId: string;
  type: "video" | "image" | "gallery" | "music" | "live";
  canonicalUrl: string;
  creatorProviderId?: string;
  creatorName?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationMs?: number;
  tags: string[];
  statistics: Record<string, number>;
  rawMetadataRef?: string;
  rights: DouyinRights;
  createdAt: string;
}

/** Canonical creator (doc §13) — stable provider id, never display name. */
export interface CanonicalCreator {
  id: string;
  provider: "douyin";
  providerCreatorId: string;
  displayName: string;
  canonicalUrl: string;
  avatarUrl?: string;
  bio?: string;
  statistics: Record<string, number>;
  firstSeenAt: string;
  lastSyncedAt?: string;
  lastSyncCursor?: string;
}

/** Canonical comment (doc §19) — social text is UNTRUSTED DATA. */
export interface CanonicalComment {
  id: string;
  providerCommentId: string;
  mediaItemId: string;
  parentCommentId?: string;
  authorName?: string;
  text: string;
  publishedAt?: string;
  statistics: Record<string, number>;
  rawRef?: string;
  createdAt: string;
}

export interface CanonicalTranscript {
  id: string;
  mediaItemId: string;
  provider: string;
  model?: string;
  language?: string;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  artifactRef?: string;
  createdAt: string;
}

export interface HotBoardEntry {
  rank: number;
  keyword: string;
  score?: number;
}

export interface SearchSnapshot {
  id: string;
  query: string;
  fetchedAt: string;
  itemCount: number;
  itemIds: string[];
  sourceNote?: string;
}

// --- Upstream contract -------------------------------------------------------

/** Operations the douyin-downloader upstream can serve (doc §83). */
export interface UpstreamInspectRaw {
  awemeId?: string;
  url?: string;
  kind?: DouyinUrlKind;
  title?: string;
  description?: string;
  creatorId?: string;
  creatorName?: string;
  publishedAt?: string;
  durationMs?: number;
  tags?: string[];
  statistics?: Record<string, number>;
  mediaType?: "video" | "image" | "gallery" | "music" | "live";
  requiresAuth?: boolean;
  mediaUrls?: string[];
}

export interface UpstreamSearchRaw {
  items: UpstreamInspectRaw[];
}

export interface UpstreamHotBoardRaw {
  entries: Array<{ rank?: number; keyword?: string; score?: number }>;
}

export interface UpstreamCommentsRaw {
  comments: Array<{
    cid?: string;
    awemeId?: string;
    parentId?: string;
    author?: string;
    text?: string;
    publishedAt?: string;
    diggCount?: number;
  }>;
}

export interface UpstreamCreatorRaw {
  secUid?: string;
  displayName?: string;
  url?: string;
  avatarUrl?: string;
  bio?: string;
  statistics?: Record<string, number>;
  items?: UpstreamInspectRaw[];
}

/** Upstream client seam: CLI implementation in production, fixtures in tests. */
export interface DouyinUpstreamClient {
  readonly kind: "cli" | "fixture";
  available(): Promise<boolean>;
  availabilityReason(): Promise<string | undefined>;
  inspect(url: string): Promise<UpstreamInspectRaw>;
  search(query: string, maxItems: number): Promise<UpstreamSearchRaw>;
  hotBoard(limit: number): Promise<UpstreamHotBoardRaw>;
  comments(url: string, maxComments: number, includeReplies: boolean): Promise<UpstreamCommentsRaw>;
  creatorSync(url: string, maxItems: number): Promise<UpstreamCreatorRaw>;
  /**
   * Acquire one public URL; returns the path of the produced media file.
   * Implementations must write into the caller-provided directory.
   */
  downloadTo(url: string, outputDir: string): Promise<string>;
}
