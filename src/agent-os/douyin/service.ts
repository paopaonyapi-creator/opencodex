// Phase 20.26 — Douyin Media Intelligence service facade.
//
// Pao-hubPro is the control plane (doc §5): permissions, limits, rate policy,
// idempotency, secrets references, audit, and rights boundaries live HERE —
// the upstream adapter only translates platform mechanics. Downloads reuse
// the Phase 20.24 queue + artifact registry; capabilities register into the
// Phase 20.25 Universal Registry.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getMediaAcquisitionService } from "../media-acquisition/service";
import { MediaAuditLogger } from "../media-acquisition/audit";
import { MediaError } from "../media-acquisition/errors";
import type { MediaJob, DownloadPreset, UsageClass } from "../media-acquisition/types";
import { CircuitBreaker } from "../universal-registry/engine";
import { classifyDouyinUrl, isDouyinUrl } from "./url-policy";
import { douyinFlags, type DouyinFlags } from "./flags";
import { DouyinError } from "./errors";
import { normalizeComments, normalizeCreator, normalizeMediaItem } from "./normalize";
import { DouyinCliUpstream } from "./upstream";
import { DouyinStore } from "./store";
import { evaluateDouyinStockExport, type StockExportDecision } from "./rights";
import { redactDouyinSecrets } from "./redact";
import type {
  CanonicalComment,
  CanonicalCreator,
  CanonicalMediaItem,
  CanonicalTranscript,
  DouyinUpstreamClient,
  HotBoardEntry,
  SearchSnapshot,
} from "./types";

export interface DouyinHealthReport {
  provider: { enabled: boolean; upstreamAvailable: boolean; reason?: string };
  search: boolean;
  hotBoard: boolean;
  comments: boolean;
  transcription: boolean;
  browserFallback: boolean;
  authSession: boolean;
  live: boolean;
  publicOnly: boolean;
  circuit: "closed" | "open";
}

interface RateState {
  lastRequestMs: number;
  cooldownUntilMs: number;
  active: number;
}

const MIN_REQUEST_INTERVAL_MS = 1_000;
const MAX_CONCURRENCY = 3;
const COOLDOWN_MS = 30_000;

export class DouyinService {
  readonly store: DouyinStore;
  readonly flags: DouyinFlags;
  private upstream: DouyinUpstreamClient;
  private breaker = new CircuitBreaker();
  private rate: RateState = { lastRequestMs: 0, cooldownUntilMs: 0, active: 0 };
  private audit = new MediaAuditLogger();

  constructor(store?: DouyinStore, upstream?: DouyinUpstreamClient) {
    this.store = store ?? new DouyinStore();
    this.upstream = upstream ?? new DouyinCliUpstream();
    this.flags = douyinFlags();
  }

  private async gate(operation: string): Promise<void> {
    if (this.breaker.allow("douyin") === false) {
      throw new DouyinError("DOUYIN_PROVIDER_UNHEALTHY", "circuit breaker open for the douyin provider");
    }
    if (this.rate.active >= MAX_CONCURRENCY) {
      throw new DouyinError("DOUYIN_RATE_LIMITED", "concurrency limit reached; try again shortly");
    }
    const now = Date.now();
    if (now < this.rate.cooldownUntilMs) {
      throw new DouyinError("DOUYIN_RATE_LIMITED", "provider cooling down after rate limiting");
    }
    const sinceLast = now - this.rate.lastRequestMs;
    if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - sinceLast);
    }
    this.rate.lastRequestMs = Date.now();
    this.rate.active += 1;
    void operation;
  }

  private release(ok: boolean, errorCode?: string): void {
    this.rate.active = Math.max(0, this.rate.active - 1);
    if (ok) {
      this.breaker.recordSuccess("douyin");
      return;
    }
    this.breaker.recordFailure("douyin");
    if (errorCode === "DOUYIN_RATE_LIMITED") {
      this.rate.cooldownUntilMs = Date.now() + COOLDOWN_MS;
    }
  }

  private async assertUpstream(): Promise<void> {
    if (!this.flags.provider) {
      throw new DouyinError("DOUYIN_DISABLED", "douyin provider is disabled by flag");
    }
    const ok = await this.upstream.available();
    if (!ok) {
      const reason = await this.upstream.availabilityReason();
      throw new DouyinError("DOUYIN_PROVIDER_UNHEALTHY", reason ?? "upstream runtime unavailable");
    }
  }

  // --- Inspect (doc §103 vertical slice) --------------------------------------

  async inspectUrl(url: string, requestedBy = "agent"): Promise<CanonicalMediaItem> {
    const classification = classifyDouyinUrl(url);
    if (!classification) {
      throw new DouyinError("DOUYIN_UNSUPPORTED_URL", "not a douyin-family URL");
    }
    await this.gate("inspect");
    try {
      await this.assertUpstream();
      const raw = redactDouyinSecrets(await this.upstream.inspect(classification.canonicalUrl));
      const item = normalizeMediaItem(raw, classification.canonicalUrl);
      const { item: stored, isNew } = this.store.upsertMediaItem(item);
      this.audit.log({
        actor: requestedBy,
        tool: "douyin.inspect",
        action: isNew ? "inspect_new" : "inspect_existing",
        domain: "douyin.com",
        permissionDecision: "allowed",
        provider: "douyin",
        details: { providerItemId: stored.providerItemId, kind: classification.kind },
      });
      this.release(true);
      return stored;
    } catch (err) {
      const code = err instanceof DouyinError ? err.code : undefined;
      this.release(false, code);
      this.audit.log({
        actor: requestedBy,
        tool: "douyin.inspect",
        action: "inspect_failed",
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { error: code ?? String(err) },
      });
      throw err;
    }
  }

  // --- Download through the Phase 20.24 queue (doc §32, §33) -------------------

  async enqueueDownload(params: {
    url: string;
    preset?: DownloadPreset;
    usageClass?: UsageClass;
    requestedBy?: string;
    maxItems?: number;
  }): Promise<MediaJob> {
    const classification = classifyDouyinUrl(params.url);
    if (!classification) {
      throw new DouyinError("DOUYIN_UNSUPPORTED_URL", "not a douyin-family URL");
    }
    if (classification.kind === "live" && !this.flags.live) {
      throw new DouyinError("DOUYIN_DISABLED", "live recording is disabled by flag");
    }
    if (classification.kind === "user") {
      throw new DouyinError("DOUYIN_UNSUPPORTED_URL", "use creator sync for profile URLs");
    }
    const maxItems = this.store.assertLimitsBounded(params.maxItems, this.store.limits.maxItemsPerJob, "maxItems");

    const sourceId = classification.sourceId ?? "resolved";
    const idempotencyKey = `douyin:download:${sourceId}:${params.preset ?? "best"}`;
    const reserved = this.store.reserveIdempotencyKey(idempotencyKey, params.url);
    if (!reserved) {
      const existing = this.store.lookupIdempotencyKey(idempotencyKey);
      throw new DouyinError("DOUYIN_UNAVAILABLE", `download already requested (idempotency key ${idempotencyKey})`, { existingJobRef: existing });
    }

    const media = getMediaAcquisitionService();
    try {
      const safeFilename = `douyin_${Date.now().toString(36)}.mp4`;
      const targetOutput = join(media.storage.incomingDir, safeFilename);
      const job = media.queue.createJob({
        sourceUrl: classification.canonicalUrl,
        preset: params.preset,
        usageClass: params.usageClass,
        requestedBy: params.requestedBy,
        provider: "douyin",
        outputPath: targetOutput,
      });
      this.audit.log({
        actor: params.requestedBy || "agent",
        tool: "douyin.download",
        action: "enqueue",
        jobId: job.id,
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { idempotencyKey, maxItems, usageClass: job.usageClass },
      });
      void media;
      return job;
    } catch (err) {
      throw err instanceof MediaError
        ? new DouyinError("DOUYIN_DOWNLOAD_FAILED", err.message)
        : err;
    }
  }

  // --- Keyword search (doc §17) -------------------------------------------------

  async search(params: {
    query: string;
    maxItems?: number;
    requestedBy?: string;
  }): Promise<{ snapshot: SearchSnapshot; items: CanonicalMediaItem[] }> {
    if (!this.flags.search) throw new DouyinError("DOUYIN_DISABLED", "douyin search is disabled by flag");
    const maxItems = this.store.assertLimitsBounded(params.maxItems, this.store.limits.maxItemsPerJob, "maxItems");
    const query = String(params.query ?? "").trim().slice(0, 120);
    if (!query) throw new DouyinError("DOUYIN_INVALID_URL", "search query is required");

    await this.gate("search");
    try {
      await this.assertUpstream();
      const raw = redactDouyinSecrets(await this.upstream.search(query, maxItems));
      const items: CanonicalMediaItem[] = [];
      for (const entry of (raw.items ?? []).slice(0, maxItems)) {
        try {
          const item = normalizeMediaItem(entry, entry.url ?? `https://www.douyin.com/search/${encodeURIComponent(query)}`);
          const { item: stored } = this.store.upsertMediaItem(item);
          items.push(stored);
        } catch {
          // A malformed item must not corrupt the snapshot; drift is reported
          // by the normalizer for the item that triggered it.
        }
      }
      const snapshot: SearchSnapshot = {
        id: `dsearch_${randomUUID().slice(0, 12)}`,
        query,
        fetchedAt: new Date().toISOString(),
        itemCount: items.length,
        itemIds: items.map((i) => i.id),
        sourceNote: "douyin-downloader keyword search; immutable research snapshot",
      };
      this.store.saveSearchSnapshot(snapshot);
      this.audit.log({
        actor: params.requestedBy || "agent",
        tool: "douyin.search",
        action: "search",
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { query, itemCount: items.length, snapshotId: snapshot.id },
      });
      this.release(true);
      return { snapshot, items };
    } catch (err) {
      this.release(false, err instanceof DouyinError ? err.code : undefined);
      throw err;
    }
  }

  // --- Hot board (doc §18, append-only snapshots) --------------------------------

  async hotBoard(params: { limit?: number; requestedBy?: string } = {}): Promise<{ capturedAt: string; entries: HotBoardEntry[]; previous?: HotBoardEntry[] }> {
    if (!this.flags.hotBoard) throw new DouyinError("DOUYIN_DISABLED", "hot board is disabled by flag");
    const limit = this.store.assertLimitsBounded(params.limit, this.store.limits.maxHotBoardEntries, "limit");

    await this.gate("hot_board");
    try {
      await this.assertUpstream();
      const raw = redactDouyinSecrets(await this.upstream.hotBoard(limit));
      const capturedAt = new Date().toISOString();
      const entries: HotBoardEntry[] = [];
      for (const entry of (raw.entries ?? []).slice(0, limit)) {
        if (typeof entry.keyword !== "string" || !entry.keyword) continue;
        entries.push({
          rank: typeof entry.rank === "number" ? entry.rank : entries.length + 1,
          keyword: entry.keyword,
          score: typeof entry.score === "number" ? entry.score : undefined,
        });
      }
      this.store.saveHotBoardSnapshot(capturedAt, entries);
      this.audit.log({
        actor: params.requestedBy || "agent",
        tool: "douyin.hot_board",
        action: "snapshot",
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { capturedAt, entries: entries.length },
      });
      this.release(true);
      const history = this.store.listHotBoardSnapshots(2);
      return { capturedAt, entries, previous: history[1]?.entries };
    } catch (err) {
      this.release(false, err instanceof DouyinError ? err.code : undefined);
      throw err;
    }
  }

  // --- Creator sync (doc §16, incremental) ----------------------------------------

  async syncCreator(params: { url: string; maxItems?: number; requestedBy?: string }): Promise<{ creator: CanonicalCreator; newItems: CanonicalMediaItem[]; items: CanonicalMediaItem[] }> {
    const classification = classifyDouyinUrl(params.url);
    if (!classification || classification.kind !== "user") {
      throw new DouyinError("DOUYIN_UNSUPPORTED_URL", "creator sync requires a douyin user profile URL");
    }
    const maxItems = this.store.assertLimitsBounded(params.maxItems, this.store.limits.maxItemsPerJob, "maxItems");

    await this.gate("creator_sync");
    try {
      await this.assertUpstream();
      const raw = redactDouyinSecrets(await this.upstream.creatorSync(classification.canonicalUrl, maxItems));
      const creator = normalizeCreator({ ...raw, url: raw.url ?? classification.canonicalUrl });
      const storedCreator = this.store.upsertCreator(creator, creator.lastSyncCursor ?? new Date().toISOString());

      const newItems: CanonicalMediaItem[] = [];
      const allItems: CanonicalMediaItem[] = [];
      for (const entry of (raw.items ?? []).slice(0, maxItems)) {
        try {
          const item = normalizeMediaItem({ ...entry, creatorId: creator.providerCreatorId, creatorName: creator.displayName }, entry.url ?? classification.canonicalUrl);
          const { item: stored, isNew } = this.store.upsertMediaItem(item);
          allItems.push(stored);
          if (isNew) newItems.push(stored);
        } catch {
          // drift on one item must not abort the sync
        }
      }
      this.audit.log({
        actor: params.requestedBy || "agent",
        tool: "douyin.sync_creator",
        action: "creator_sync",
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { creator: creator.providerCreatorId, newItems: newItems.length, total: allItems.length },
      });
      this.release(true);
      return { creator: storedCreator, newItems, items: allItems };
    } catch (err) {
      this.release(false, err instanceof DouyinError ? err.code : undefined);
      throw err;
    }
  }

  // --- Comments (doc §19; text is UNTRUSTED DATA) -----------------------------------

  async fetchComments(params: {
    url: string;
    mediaItemId?: string;
    maxComments?: number;
    includeReplies?: boolean;
    requestedBy?: string;
  }): Promise<{ mediaItemId?: string; comments: CanonicalComment[]; saved: number; duplicates: number }> {
    if (!this.flags.comments) throw new DouyinError("DOUYIN_DISABLED", "comment fetching is disabled by flag");
    const classification = classifyDouyinUrl(params.url);
    if (!classification) throw new DouyinError("DOUYIN_UNSUPPORTED_URL", "not a douyin-family URL");
    const maxComments = this.store.assertLimitsBounded(params.maxComments, this.store.limits.maxCommentsPerItem, "maxComments");

    await this.gate("comments");
    try {
      await this.assertUpstream();
      const raw = redactDouyinSecrets(await this.upstream.comments(classification.canonicalUrl, maxComments, params.includeReplies === true));
      let mediaItemId = params.mediaItemId;
      if (!mediaItemId) {
        const existing = this.store.getItemByProviderId(classification.sourceId ?? "");
        mediaItemId = existing?.id;
      }
      const { comments, dropped } = normalizeComments(raw, mediaItemId ?? "unresolved");
      const { saved, duplicates } = this.store.saveComments(comments);
      this.audit.log({
        actor: params.requestedBy || "agent",
        tool: "douyin.get_comments",
        action: "comments_fetch",
        domain: "douyin.com",
        permissionDecision: "allowed",
        details: { fetched: comments.length, saved, duplicates, dropped },
      });
      this.release(true);
      return { mediaItemId, comments: comments.slice(0, maxComments), saved, duplicates };
    } catch (err) {
      this.release(false, err instanceof DouyinError ? err.code : undefined);
      throw err;
    }
  }

  // --- Transcription (doc §20; degrades clearly, provider-neutral row) ---------------

  async saveTranscript(params: {
    mediaItemId: string;
    artifactId?: string;
    language?: string;
  }): Promise<CanonicalTranscript> {
    if (!this.flags.transcription) {
      throw new DouyinError("DOUYIN_DISABLED", "douyin transcription is disabled by flag");
    }
    const media = getMediaAcquisitionService();
    if (!params.artifactId) {
      // No artifact yet: degrade clearly instead of pretending.
      throw new DouyinError("DOUYIN_UNAVAILABLE", "transcription requires a downloaded artifact for the item");
    }
    const result = await media.transcribe(params.artifactId, params.language);
    const transcript: CanonicalTranscript = {
      id: `dtranscript_${randomUUID().slice(0, 12)}`,
      mediaItemId: params.mediaItemId,
      provider: "whisper-local",
      language: result.language,
      text: result.text,
      segments: result.segments,
      artifactRef: result.artifactId,
      createdAt: new Date().toISOString(),
    };
    this.store.saveTranscript(transcript);
    return transcript;
  }

  listTranscripts(mediaItemId: string): CanonicalTranscript[] {
    return this.store.listTranscripts(mediaItemId);
  }

  // --- Rights boundary (doc §67, mandatory) --------------------------------------------

  stockExportDecision(input: { usageClass?: string; rights?: CanonicalMediaItem["rights"] }): StockExportDecision {
    return evaluateDouyinStockExport({ provider: "douyin", usageClass: input.usageClass, rights: input.rights });
  }

  // --- Health (doc §58: separate dimensions) --------------------------------------------

  async health(): Promise<DouyinHealthReport> {
    const upstreamAvailable = await this.upstream.available();
    return {
      provider: {
        enabled: this.flags.provider,
        upstreamAvailable,
        reason: await this.upstream.availabilityReason(),
      },
      search: this.flags.search && upstreamAvailable,
      hotBoard: this.flags.hotBoard && upstreamAvailable,
      comments: this.flags.comments && upstreamAvailable,
      transcription: this.flags.transcription,
      browserFallback: this.flags.browserFallback,
      authSession: this.flags.authSession && !this.flags.publicOnly,
      live: this.flags.live,
      publicOnly: this.flags.publicOnly,
      circuit: this.breaker.allow("douyin") ? "closed" : "open",
    };
  }

  // --- Data access helpers for routes/MCP ------------------------------------------------

  listItems(limit?: number, creatorProviderId?: string): CanonicalMediaItem[] {
    return this.store.listItems(limit ?? 50, creatorProviderId);
  }

  listCreators(limit?: number): CanonicalCreator[] {
    return this.store.listCreators(limit ?? 50);
  }

  listSearchSnapshots(limit?: number, query?: string): SearchSnapshot[] {
    return this.store.listSearchSnapshots(limit ?? 20, query);
  }

  hotBoardHistory(limit = 2): Array<{ capturedAt: string; entries: HotBoardEntry[] }> {
    return this.store.listHotBoardSnapshots(limit);
  }

  isManagedUrl(url: string): boolean {
    return isDouyinUrl(url);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let service: DouyinService | null = null;

export function getDouyinService(): DouyinService {
  if (!service) service = new DouyinService();
  return service;
}

/** Test seam: forget the cached singleton. */
export function resetDouyinServiceForTests(): void {
  service = null;
}
