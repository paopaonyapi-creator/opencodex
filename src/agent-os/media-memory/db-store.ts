// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: SQLite Persistence Ledger

import { Database } from "bun:sqlite";
import { mkdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import type {
  MediaMemoryItem,
  MediaVector,
  MediaMemoryStats,
  VectorType,
  MediaType,
} from "./types";

export class MediaMemoryDbStore {
  private db: Database;
  private dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const dir = join(getConfigDir(), "media");
      mkdirSync(dir, { recursive: true });
      this.dbPath = join(dir, "media-memory.sqlite3");
    }

    this.db = new Database(this.dbPath, { create: true });
    this.initSchema();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private initSchema(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_memory_items (
        id TEXT PRIMARY KEY,
        media_type TEXT NOT NULL,
        source_url TEXT,
        local_path TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        concepts_json TEXT NOT NULL DEFAULT '[]',
        entities_json TEXT NOT NULL DEFAULT '[]',
        technical_specs_json TEXT NOT NULL DEFAULT '{}',
        pacing_json TEXT DEFAULT '{}',
        hook_json TEXT DEFAULT '{}',
        transcript_text TEXT,
        transcript_segments_json TEXT DEFAULT '[]',
        hero_frames_json TEXT DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_memory_items(media_type);
      CREATE INDEX IF NOT EXISTS idx_media_items_created ON media_memory_items(created_at);

      CREATE TABLE IF NOT EXISTS media_memory_vectors (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        vector_type TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'pao-subword-v1',
        created_at TEXT NOT NULL,
        FOREIGN KEY(item_id) REFERENCES media_memory_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_media_vectors_item ON media_memory_vectors(item_id);
      CREATE INDEX IF NOT EXISTS idx_media_vectors_type ON media_memory_vectors(vector_type);
    `);
  }

  saveItem(item: MediaMemoryItem): void {
    const query = this.db.query(`
      INSERT INTO media_memory_items (
        id, media_type, source_url, local_path, title, summary,
        tags_json, concepts_json, entities_json, technical_specs_json,
        pacing_json, hook_json, transcript_text, transcript_segments_json,
        hero_frames_json, metadata_json, created_at, updated_at
      ) VALUES (
        $id, $media_type, $source_url, $local_path, $title, $summary,
        $tags_json, $concepts_json, $entities_json, $technical_specs_json,
        $pacing_json, $hook_json, $transcript_text, $transcript_segments_json,
        $hero_frames_json, $metadata_json, $created_at, $updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        tags_json = excluded.tags_json,
        concepts_json = excluded.concepts_json,
        entities_json = excluded.entities_json,
        technical_specs_json = excluded.technical_specs_json,
        pacing_json = excluded.pacing_json,
        hook_json = excluded.hook_json,
        transcript_text = excluded.transcript_text,
        transcript_segments_json = excluded.transcript_segments_json,
        hero_frames_json = excluded.hero_frames_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);

    query.run({
      $id: item.id,
      $media_type: item.mediaType,
      $source_url: item.sourceUrl ?? null,
      $local_path: item.localPath ?? null,
      $title: item.title,
      $summary: item.summary,
      $tags_json: JSON.stringify(item.tags ?? []),
      $concepts_json: JSON.stringify(item.concepts ?? []),
      $entities_json: JSON.stringify(item.entities ?? []),
      $technical_specs_json: JSON.stringify(item.technicalSpecs ?? {}),
      $pacing_json: JSON.stringify(item.pacing ?? {}),
      $hook_json: JSON.stringify(item.hook ?? {}),
      $transcript_text: item.transcriptText ?? null,
      $transcript_segments_json: JSON.stringify(item.transcriptSegments ?? []),
      $hero_frames_json: JSON.stringify(item.heroFrames ?? []),
      $metadata_json: JSON.stringify(item.metadata ?? {}),
      $created_at: item.createdAt,
      $updated_at: item.updatedAt,
    });
  }

  getItem(id: string): MediaMemoryItem | null {
    const row = this.db
      .query("SELECT * FROM media_memory_items WHERE id = ?")
      .get(id) as Record<string, unknown> | null;

    if (!row) return null;
    return this.mapRowToItem(row);
  }

  deleteItem(id: string): boolean {
    const res = this.db.query("DELETE FROM media_memory_items WHERE id = ?").run(id);
    return res.changes > 0;
  }

  listItems(limit: number = 50, offset: number = 0): MediaMemoryItem[] {
    const rows = this.db
      .query("SELECT * FROM media_memory_items ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as Record<string, unknown>[];

    return rows.map((r) => this.mapRowToItem(r));
  }

  saveVector(vec: MediaVector): void {
    const query = this.db.query(`
      INSERT INTO media_memory_vectors (
        id, item_id, vector_type, dimension, vector_json, model, created_at
      ) VALUES (
        $id, $item_id, $vector_type, $dimension, $vector_json, $model, $created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        vector_json = excluded.vector_json,
        dimension = excluded.dimension,
        model = excluded.model
    `);

    query.run({
      $id: vec.id,
      $item_id: vec.itemId,
      $vector_type: vec.vectorType,
      $dimension: vec.dimension,
      $vector_json: JSON.stringify(vec.vector),
      $model: vec.model,
      $created_at: vec.createdAt,
    });
  }

  getVectorsForItem(itemId: string): MediaVector[] {
    const rows = this.db
      .query("SELECT * FROM media_memory_vectors WHERE item_id = ?")
      .all(itemId) as Record<string, unknown>[];

    return rows.map((r) => this.mapRowToVector(r));
  }

  getAllVectors(vectorType?: VectorType): MediaVector[] {
    if (vectorType) {
      const rows = this.db
        .query("SELECT * FROM media_memory_vectors WHERE vector_type = ?")
        .all(vectorType) as Record<string, unknown>[];
      return rows.map((r) => this.mapRowToVector(r));
    }
    const rows = this.db.query("SELECT * FROM media_memory_vectors").all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToVector(r));
  }

  getStats(): MediaMemoryStats {
    const itemCounts = this.db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as video_count,
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as image_count
      FROM media_memory_items
    `).get() as { total: number; video_count: number; image_count: number };

    const vectorCounts = this.db.query(`
      SELECT COUNT(*) as total_vectors, MAX(dimension) as max_dim
      FROM media_memory_vectors
    `).get() as { total_vectors: number; max_dim: number | null };

    let size = 0;
    if (existsSync(this.dbPath)) {
      try {
        size = statSync(this.dbPath).size;
      } catch {
        size = 0;
      }
    }

    return {
      totalItems: Number(itemCounts?.total ?? 0),
      totalVectors: Number(vectorCounts?.total_vectors ?? 0),
      videoCount: Number(itemCounts?.video_count ?? 0),
      imageCount: Number(itemCounts?.image_count ?? 0),
      vectorDimensions: Number(vectorCounts?.max_dim ?? 64),
      indexSizeBytes: size,
    };
  }

  close(): void {
    this.db.close();
  }

  private mapRowToItem(row: Record<string, unknown>): MediaMemoryItem {
    return {
      id: String(row.id),
      mediaType: String(row.media_type) as MediaType,
      sourceUrl: row.source_url ? String(row.source_url) : undefined,
      localPath: row.local_path ? String(row.local_path) : undefined,
      title: String(row.title),
      summary: String(row.summary),
      tags: JSON.parse(String(row.tags_json || "[]")),
      concepts: JSON.parse(String(row.concepts_json || "[]")),
      entities: JSON.parse(String(row.entities_json || "[]")),
      technicalSpecs: JSON.parse(String(row.technical_specs_json || "{}")),
      pacing: JSON.parse(String(row.pacing_json || "{}")),
      hook: JSON.parse(String(row.hook_json || "{}")),
      transcriptText: row.transcript_text ? String(row.transcript_text) : undefined,
      transcriptSegments: JSON.parse(String(row.transcript_segments_json || "[]")),
      heroFrames: JSON.parse(String(row.hero_frames_json || "[]")),
      metadata: JSON.parse(String(row.metadata_json || "{}")),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapRowToVector(row: Record<string, unknown>): MediaVector {
    return {
      id: String(row.id),
      itemId: String(row.item_id),
      vectorType: String(row.vector_type) as VectorType,
      dimension: Number(row.dimension),
      vector: JSON.parse(String(row.vector_json || "[]")),
      model: String(row.model),
      createdAt: String(row.created_at),
    };
  }
}
