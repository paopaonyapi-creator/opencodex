// Phase 20.26 — Douyin persistence over the shared Agent OS store (db v32).
//
// Media downloads/artifacts stay in the Phase 20.24 media tables; these rows
// are the Douyin intelligence layer (creators, canonical items, snapshots,
// comments, transcripts, sessions, idempotency). Statements are static
// literals with `?` placeholders; writes are explicit check-then-insert so
// every write path stays obvious and auditable.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { DouyinError } from "./errors";
import { defaultDouyinRights } from "./rights";
import type {
  CanonicalComment,
  CanonicalCreator,
  CanonicalMediaItem,
  CanonicalTranscript,
  HotBoardEntry,
  SearchSnapshot,
} from "./types";

interface CreatorRow {
  id: string;
  provider_creator_id: string;
  display_name: string;
  canonical_url: string;
  avatar_url: string | null;
  bio: string | null;
  statistics_json: string;
  first_seen_at: string;
  last_synced_at: string | null;
  last_sync_cursor: string | null;
}

interface ItemRow {
  id: string;
  provider_item_id: string;
  type: string;
  canonical_url: string;
  creator_provider_id: string | null;
  creator_name: string | null;
  title: string;
  description: string | null;
  published_at: string | null;
  duration_ms: number | null;
  tags_json: string;
  statistics_json: string;
  raw_metadata_ref: string | null;
  rights_json: string;
  created_at: string;
}

function rowToItem(row: ItemRow): CanonicalMediaItem {
  return {
    id: row.id,
    provider: "douyin",
    providerItemId: row.provider_item_id,
    type: row.type as CanonicalMediaItem["type"],
    canonicalUrl: row.canonical_url,
    creatorProviderId: row.creator_provider_id ?? undefined,
    creatorName: row.creator_name ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    publishedAt: row.published_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    tags: JSON.parse(row.tags_json) as string[],
    statistics: JSON.parse(row.statistics_json) as Record<string, number>,
    rawMetadataRef: row.raw_metadata_ref ?? undefined,
    rights: JSON.parse(row.rights_json) as CanonicalMediaItem["rights"],
    createdAt: row.created_at,
  };
}

function rowToCreator(row: CreatorRow): CanonicalCreator {
  return {
    id: row.id,
    provider: "douyin",
    providerCreatorId: row.provider_creator_id,
    displayName: row.display_name,
    canonicalUrl: row.canonical_url,
    avatarUrl: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    statistics: JSON.parse(row.statistics_json) as Record<string, number>,
    firstSeenAt: row.first_seen_at,
    lastSyncedAt: row.last_synced_at ?? undefined,
    lastSyncCursor: row.last_sync_cursor ?? undefined,
  };
}

export interface DouyinLimits {
  maxItemsPerJob: number;
  maxCommentsPerItem: number;
  maxHotBoardEntries: number;
}

export const DEFAULT_DOUYIN_LIMITS: DouyinLimits = {
  maxItemsPerJob: 50,
  maxCommentsPerItem: 200,
  maxHotBoardEntries: 50,
};

export class DouyinStore {
  readonly limits: DouyinLimits;

  constructor(limits?: Partial<DouyinLimits>) {
    this.limits = { ...DEFAULT_DOUYIN_LIMITS, ...limits };
  }

  // --- Idempotency (doc §33) -------------------------------------------------

  /** Reserve an idempotency key; returns false when it already exists. */
  reserveIdempotencyKey(key: string, jobRef: string): boolean {
    const db = openAgentOsDb();
    const existing = db
      .query("SELECT key FROM douyin_idempotency WHERE key = ?")
      .get(key);
    if (existing) return false;
    const stmt = db.query("INSERT INTO douyin_idempotency (key, job_ref, created_at) VALUES (?, ?, ?)");
    stmt.run(key, jobRef, new Date().toISOString());
    return true;
  }

  lookupIdempotencyKey(key: string): string | undefined {
    const row = openAgentOsDb()
      .query("SELECT job_ref AS jobRef FROM douyin_idempotency WHERE key = ?")
      .get(key) as { jobRef: string } | undefined;
    return row?.jobRef;
  }

  // --- Creators ----------------------------------------------------------------

  upsertCreator(creator: CanonicalCreator, syncCursor?: string): CanonicalCreator {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const existing = db
      .query("SELECT id, first_seen_at FROM douyin_creators WHERE provider_creator_id = ?")
      .get(creator.providerCreatorId) as { id: string; first_seen_at: string } | undefined;
    if (existing) {
      const stmt = db.query(`
        UPDATE douyin_creators SET
          display_name = ?, canonical_url = ?, avatar_url = ?, bio = ?,
          statistics_json = ?, last_synced_at = ?, last_sync_cursor = ?
        WHERE id = ?
      `);
      stmt.run(
        creator.displayName, creator.canonicalUrl, creator.avatarUrl ?? null, creator.bio ?? null,
        JSON.stringify(creator.statistics), now, syncCursor ?? null, existing.id,
      );
      return this.getCreator(creator.providerCreatorId)!;
    }
    const stmt = db.query(`
      INSERT INTO douyin_creators (
        id, provider_creator_id, display_name, canonical_url, avatar_url, bio,
        statistics_json, first_seen_at, last_synced_at, last_sync_cursor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      creator.id, creator.providerCreatorId, creator.displayName, creator.canonicalUrl,
      creator.avatarUrl ?? null, creator.bio ?? null, JSON.stringify(creator.statistics),
      creator.firstSeenAt, null, syncCursor ?? null,
    );
    return this.getCreator(creator.providerCreatorId)!;
  }

  getCreator(providerCreatorId: string): CanonicalCreator | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM douyin_creators WHERE provider_creator_id = ?")
      .get(providerCreatorId) as CreatorRow | undefined;
    return row ? rowToCreator(row) : null;
  }

  listCreators(limit = 50): CanonicalCreator[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM douyin_creators ORDER BY last_synced_at DESC LIMIT ?")
      .all(limit) as CreatorRow[];
    return rows.map(rowToCreator);
  }

  // --- Canonical media items (dedupe key: provider + provider_item_id) ---------

  upsertMediaItem(item: CanonicalMediaItem): { item: CanonicalMediaItem; isNew: boolean } {
    const db = openAgentOsDb();
    const existing = db
      .query("SELECT id, created_at FROM douyin_media_items WHERE provider_item_id = ?")
      .get(item.providerItemId) as { id: string; created_at: string } | undefined;
    if (existing) {
      const stmt = db.query(`
        UPDATE douyin_media_items SET
          type = ?, canonical_url = ?, creator_provider_id = ?, creator_name = ?,
          title = ?, description = ?, published_at = ?, duration_ms = ?,
          tags_json = ?, statistics_json = ?
        WHERE id = ?
      `);
      stmt.run(
        item.type, item.canonicalUrl, item.creatorProviderId ?? null, item.creatorName ?? null,
        item.title, item.description ?? null, item.publishedAt ?? null, item.durationMs ?? null,
        JSON.stringify(item.tags), JSON.stringify(item.statistics), existing.id,
      );
      return { item: this.getItemById(existing.id)!, isNew: false };
    }
    const stmt = db.query(`
      INSERT INTO douyin_media_items (
        id, provider_item_id, type, canonical_url, creator_provider_id, creator_name,
        title, description, published_at, duration_ms, tags_json, statistics_json,
        raw_metadata_ref, rights_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id, item.providerItemId, item.type, item.canonicalUrl,
      item.creatorProviderId ?? null, item.creatorName ?? null, item.title,
      item.description ?? null, item.publishedAt ?? null, item.durationMs ?? null,
      JSON.stringify(item.tags), JSON.stringify(item.statistics),
      item.rawMetadataRef ?? null, JSON.stringify(item.rights), item.createdAt,
    );
    return { item: this.getItemById(item.id)!, isNew: true };
  }

  getItemById(id: string): CanonicalMediaItem | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM douyin_media_items WHERE id = ?")
      .get(id) as ItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  getItemByProviderId(providerItemId: string): CanonicalMediaItem | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM douyin_media_items WHERE provider_item_id = ?")
      .get(providerItemId) as ItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  listItems(limit = 50, creatorProviderId?: string): CanonicalMediaItem[] {
    const db = openAgentOsDb();
    if (creatorProviderId) {
      const rows = db
        .query("SELECT * FROM douyin_media_items WHERE creator_provider_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(creatorProviderId, limit) as ItemRow[];
      return rows.map(rowToItem);
    }
    const rows = db
      .query("SELECT * FROM douyin_media_items ORDER BY created_at DESC LIMIT ?")
      .all(limit) as ItemRow[];
    return rows.map(rowToItem);
  }

  // --- Search snapshots (immutable, doc §17) ------------------------------------

  saveSearchSnapshot(snapshot: SearchSnapshot): void {
    const stmt = openAgentOsDb()
      .query("INSERT INTO douyin_search_snapshots (id, query, fetched_at, item_count, item_ids_json, source_note) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(snapshot.id, snapshot.query, snapshot.fetchedAt, snapshot.itemCount, JSON.stringify(snapshot.itemIds), snapshot.sourceNote ?? null);
  }

  listSearchSnapshots(limit = 20, query?: string): SearchSnapshot[] {
    const db = openAgentOsDb();
    if (query) {
      const rows = db
        .query("SELECT id, query, fetched_at AS fetchedAt, item_count AS itemCount, item_ids_json AS itemIdsJson, source_note AS sourceNote FROM douyin_search_snapshots WHERE query = ? ORDER BY fetched_at DESC LIMIT ?")
        .all(query, limit) as Array<{ id: string; query: string; fetchedAt: string; itemCount: number; itemIdsJson: string; sourceNote: string | null }>;
      return rows.map((row) => ({ id: row.id, query: row.query, fetchedAt: row.fetchedAt, itemCount: row.itemCount, itemIds: JSON.parse(row.itemIdsJson) as string[], sourceNote: row.sourceNote ?? undefined }));
    }
    const rows = db
      .query("SELECT id, query, fetched_at AS fetchedAt, item_count AS itemCount, item_ids_json AS itemIdsJson, source_note AS sourceNote FROM douyin_search_snapshots ORDER BY fetched_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string; query: string; fetchedAt: string; itemCount: number; itemIdsJson: string; sourceNote: string | null }>;
    return rows.map((row) => ({ id: row.id, query: row.query, fetchedAt: row.fetchedAt, itemCount: row.itemCount, itemIds: JSON.parse(row.itemIdsJson) as string[], sourceNote: row.sourceNote ?? undefined }));
  }

  // --- Hot board snapshots (immutable, append-only, doc §18) ---------------------

  saveHotBoardSnapshot(capturedAt: string, entries: HotBoardEntry[]): number {
    const db = openAgentOsDb();
    let saved = 0;
    for (const entry of entries) {
      const stmt = db.query("INSERT INTO douyin_hot_board_snapshots (id, captured_at, rank, keyword, score) VALUES (?, ?, ?, ?, ?)");
      stmt.run(`dhot_${randomUUID().slice(0, 12)}`, capturedAt, entry.rank, entry.keyword, entry.score ?? null);
      saved += 1;
    }
    return saved;
  }

  listHotBoardSnapshots(limit = 2): Array<{ capturedAt: string; entries: HotBoardEntry[] }> {
    const rows = openAgentOsDb()
      .query("SELECT DISTINCT captured_at FROM douyin_hot_board_snapshots ORDER BY captured_at DESC LIMIT ?")
      .all(limit) as Array<{ captured_at: string }>;
    const out: Array<{ capturedAt: string; entries: HotBoardEntry[] }> = [];
    for (const row of rows) {
      const entries = openAgentOsDb()
        .query("SELECT rank, keyword, score FROM douyin_hot_board_snapshots WHERE captured_at = ? ORDER BY rank")
        .all(row.captured_at) as Array<{ rank: number; keyword: string; score: number | null }>;
      out.push({
        capturedAt: row.captured_at,
        entries: entries.map((e) => ({ rank: e.rank, keyword: e.keyword, score: e.score ?? undefined })),
      });
    }
    return out;
  }

  // --- Comments -------------------------------------------------------------------

  saveComments(comments: CanonicalComment[]): { saved: number; duplicates: number } {
    const db = openAgentOsDb();
    let saved = 0;
    let duplicates = 0;
    for (const comment of comments) {
      const existing = db
        .query("SELECT id FROM douyin_comments WHERE provider_comment_id = ? AND media_item_id = ?")
        .get(comment.providerCommentId, comment.mediaItemId);
      if (existing) {
        duplicates += 1;
        continue;
      }
      const stmt = db.query(`
        INSERT INTO douyin_comments (
          id, provider_comment_id, media_item_id, parent_comment_id, author_name,
          text, published_at, statistics_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        comment.id, comment.providerCommentId, comment.mediaItemId,
        comment.parentCommentId ?? null, comment.authorName ?? null, comment.text,
        comment.publishedAt ?? null, JSON.stringify(comment.statistics), comment.createdAt,
      );
      saved += 1;
    }
    return { saved, duplicates };
  }

  listComments(mediaItemId: string, limit = 200): CanonicalComment[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM douyin_comments WHERE media_item_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(mediaItemId, limit) as Array<{
        id: string; provider_comment_id: string; media_item_id: string; parent_comment_id: string | null;
        author_name: string | null; text: string; published_at: string | null;
        statistics_json: string; created_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      providerCommentId: row.provider_comment_id,
      mediaItemId: row.media_item_id,
      parentCommentId: row.parent_comment_id ?? undefined,
      authorName: row.author_name ?? undefined,
      text: row.text,
      publishedAt: row.published_at ?? undefined,
      statistics: JSON.parse(row.statistics_json) as Record<string, number>,
      createdAt: row.created_at,
    }));
  }

  // --- Transcripts -----------------------------------------------------------------

  saveTranscript(transcript: CanonicalTranscript): void {
    const stmt = openAgentOsDb()
      .query("INSERT INTO douyin_transcripts (id, media_item_id, provider, model, language, text, segments_json, artifact_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      transcript.id, transcript.mediaItemId, transcript.provider, transcript.model ?? null,
      transcript.language ?? null, transcript.text, JSON.stringify(transcript.segments),
      transcript.artifactRef ?? null, transcript.createdAt,
    );
  }

  listTranscripts(mediaItemId: string): CanonicalTranscript[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM douyin_transcripts WHERE media_item_id = ? ORDER BY created_at DESC")
      .all(mediaItemId) as Array<{
        id: string; media_item_id: string; provider: string; model: string | null;
        language: string | null; text: string; segments_json: string;
        artifact_ref: string | null; created_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      mediaItemId: row.media_item_id,
      provider: row.provider,
      model: row.model ?? undefined,
      language: row.language ?? undefined,
      text: row.text,
      segments: JSON.parse(row.segments_json) as CanonicalTranscript["segments"],
      artifactRef: row.artifact_ref ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // --- Sessions (secret REFERENCES only, doc §23) -----------------------------------

  upsertSession(profile: string, secretRef: string, status: string): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM douyin_sessions WHERE profile = ?").get(profile);
    const now = new Date().toISOString();
    if (existing) {
      const stmt = db.query("UPDATE douyin_sessions SET secret_ref = ?, status = ?, last_verified_at = ? WHERE profile = ?");
      stmt.run(secretRef, status, now, profile);
      return;
    }
    const stmt = db.query("INSERT INTO douyin_sessions (id, profile, secret_ref, status, last_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(`dsession_${randomUUID().slice(0, 8)}`, profile, secretRef, status, now, now);
  }

  listSessions(): Array<{ profile: string; secretRef: string; status: string; lastVerifiedAt?: string }> {
    const rows = openAgentOsDb()
      .query("SELECT profile, secret_ref AS secretRef, status, last_verified_at AS lastVerifiedAt FROM douyin_sessions ORDER BY profile")
      .all() as Array<{ profile: string; secretRef: string; status: string; lastVerifiedAt?: string }>;
    return rows;
  }

  /** Rights are always the research-only defaults (doc §66). */
  itemRights(): ReturnType<typeof defaultDouyinRights> {
    return defaultDouyinRights();
  }

  assertLimitsBounded(maxItems: number | undefined, ceiling: number, label: string): number {
    const value = maxItems === undefined ? Math.min(20, ceiling) : Math.floor(maxItems);
    if (!Number.isFinite(value) || value <= 0) {
      throw new DouyinError("DOUYIN_LIMIT_EXCEEDED", `${label} must be a positive integer (no unlimited acquisition)`);
    }
    if (value > ceiling) {
      throw new DouyinError("DOUYIN_LIMIT_EXCEEDED", `${label} ${value} exceeds the configured ceiling ${ceiling}`);
    }
    return value;
  }
}
