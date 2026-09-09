// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: In-Memory & Persistent Vector Index

import { randomUUID } from "node:crypto";
import { MediaEmbeddingEngine, DEFAULT_VECTOR_DIMENSION } from "./embedding-engine";
import { MediaMemoryDbStore } from "./db-store";
import type {
  MediaMemoryItem,
  MediaVector,
  MemorySearchQuery,
  MemorySearchResult,
  MediaMemoryStats,
  VectorType,
} from "./types";

export class MediaMemoryIndex {
  private db: MediaMemoryDbStore;
  private embeddingEngine: MediaEmbeddingEngine;
  private vectorCache: Map<string, { item: MediaMemoryItem; vector: number[] }> = new Map();
  private initialized = false;

  constructor(db?: MediaMemoryDbStore, engine?: MediaEmbeddingEngine) {
    this.db = db ?? new MediaMemoryDbStore();
    this.embeddingEngine = engine ?? new MediaEmbeddingEngine(DEFAULT_VECTOR_DIMENSION);
    this.warmCache();
  }

  getDb(): MediaMemoryDbStore {
    return this.db;
  }

  getEngine(): MediaEmbeddingEngine {
    return this.embeddingEngine;
  }

  private warmCache(): void {
    if (this.initialized) return;
    const items = this.db.listItems(500, 0);
    for (const item of items) {
      const vectors = this.db.getVectorsForItem(item.id);
      const mmVec = vectors.find((v) => v.vectorType === "multimodal") ?? vectors[0];
      if (mmVec) {
        this.vectorCache.set(item.id, { item, vector: mmVec.vector });
      }
    }
    this.initialized = true;
  }

  /**
   * Index or update a MediaMemoryItem. Automatically generates multimodal and sub-modality vectors.
   */
  indexItem(item: MediaMemoryItem): { item: MediaMemoryItem; vectors: MediaVector[] } {
    const dim = this.embeddingEngine.getDimension();
    const now = new Date().toISOString();

    // 1. Generate Multimodal Vector
    const mmRaw = this.embeddingEngine.generateMultimodalVector(item, dim);
    const mmVector: MediaVector = {
      id: `mvec_${randomUUID().slice(0, 8)}`,
      itemId: item.id,
      vectorType: "multimodal",
      dimension: dim,
      vector: mmRaw,
      model: "pao-multimodal-v1",
      createdAt: now,
    };

    // 2. Generate Text Concept Vector
    const textCorpus = `${item.title} ${item.summary} ${(item.tags || []).join(" ")} ${(item.concepts || []).join(" ")}`;
    const textRaw = this.embeddingEngine.generateTextVector(textCorpus, dim);
    const textVector: MediaVector = {
      id: `mvec_${randomUUID().slice(0, 8)}`,
      itemId: item.id,
      vectorType: "text",
      dimension: dim,
      vector: textRaw,
      model: "pao-text-v1",
      createdAt: now,
    };

    // 3. Generate Visual Feature Vector
    const heroScore = item.heroFrames?.[0]?.score ?? 0.8;
    const cutCount = item.pacing?.shotCount ?? 5;
    const visualRaw = this.embeddingEngine.generateVisualVector(item.technicalSpecs, heroScore, cutCount, dim);
    const visualVector: MediaVector = {
      id: `mvec_${randomUUID().slice(0, 8)}`,
      itemId: item.id,
      vectorType: "visual",
      dimension: dim,
      vector: visualRaw,
      model: "pao-visual-v1",
      createdAt: now,
    };

    const vectorsToSave = [mmVector, textVector, visualVector];

    // 4. If transcript present, generate transcript vector
    if (item.transcriptText && item.transcriptText.length > 5) {
      const transcriptRaw = this.embeddingEngine.generateTextVector(item.transcriptText, dim);
      vectorsToSave.push({
        id: `mvec_${randomUUID().slice(0, 8)}`,
        itemId: item.id,
        vectorType: "transcript",
        dimension: dim,
        vector: transcriptRaw,
        model: "pao-transcript-v1",
        createdAt: now,
      });
    }

    // Persist to SQLite
    this.db.saveItem(item);
    for (const vec of vectorsToSave) {
      this.db.saveVector(vec);
    }

    // Update in-memory cache
    this.vectorCache.set(item.id, { item, vector: mmRaw });

    return { item, vectors: vectorsToSave };
  }

  getItem(id: string): MediaMemoryItem | null {
    const cached = this.vectorCache.get(id);
    if (cached) return cached.item;
    return this.db.getItem(id);
  }

  deleteItem(id: string): boolean {
    this.vectorCache.delete(id);
    return this.db.deleteItem(id);
  }

  listItems(limit: number = 50, offset: number = 0): MediaMemoryItem[] {
    return this.db.listItems(limit, offset);
  }

  getStats(): MediaMemoryStats {
    return this.db.getStats();
  }

  /**
   * Search visual memory using semantic natural language query or dense vector.
   */
  search(query: MemorySearchQuery): MemorySearchResult[] {
    this.warmCache();

    let targetVector: number[];
    if (query.queryVector && query.queryVector.length > 0) {
      targetVector = query.queryVector;
    } else if (query.queryText && query.queryText.trim().length > 0) {
      targetVector = this.embeddingEngine.generateTextVector(query.queryText);
    } else {
      // Return recent items with 1.0 relevance if no query given
      const items = this.db.listItems(query.limit ?? 10, 0);
      return items.map((item) => ({
        item,
        similarityScore: 1.0,
        matchedVectorType: "multimodal" as VectorType,
      }));
    }

    const minScore = query.minScore ?? 0.15;
    const limit = query.limit ?? 10;
    const results: MemorySearchResult[] = [];

    for (const [id, entry] of this.vectorCache.entries()) {
      const item = entry.item;

      // Filter: Media Type
      if (query.mediaType && item.mediaType !== query.mediaType) {
        continue;
      }

      // Filter: Tags (if provided, item must contain at least one tag)
      if (query.tags && query.tags.length > 0) {
        const itemTags = new Set(item.tags.map((t) => t.toLowerCase()));
        const hasTag = query.tags.some((t) => itemTags.has(t.toLowerCase()));
        if (!hasTag) continue;
      }

      // Filter: Concepts (if provided, item must contain at least one concept)
      if (query.concepts && query.concepts.length > 0) {
        const itemConcepts = new Set(item.concepts.map((c) => c.toLowerCase()));
        const hasConcept = query.concepts.some((c) => itemConcepts.has(c.toLowerCase()));
        if (!hasConcept) continue;
      }

      // Cosine similarity comparison
      const score = this.embeddingEngine.cosineSimilarity(targetVector, entry.vector);

      if (score >= minScore) {
        results.push({
          item,
          similarityScore: score,
          matchedVectorType: "multimodal",
          highlights: this.generateHighlights(query.queryText ?? "", item),
        });
      }
    }

    // Sort descending by similarity score
    results.sort((a, b) => b.similarityScore - a.similarityScore);
    return results.slice(0, limit);
  }

  /**
   * Find nearest neighbor media items to a given reference item.
   */
  findSimilar(itemId: string, limit: number = 5, minScore: number = 0.2): MemorySearchResult[] {
    this.warmCache();
    const ref = this.vectorCache.get(itemId);
    if (!ref) return [];

    const results: MemorySearchResult[] = [];

    for (const [id, entry] of this.vectorCache.entries()) {
      if (id === itemId) continue; // Exclude self
      const score = this.embeddingEngine.cosineSimilarity(ref.vector, entry.vector);
      if (score >= minScore) {
        results.push({
          item: entry.item,
          similarityScore: score,
          matchedVectorType: "multimodal",
        });
      }
    }

    results.sort((a, b) => b.similarityScore - a.similarityScore);
    return results.slice(0, limit);
  }

  private generateHighlights(queryText: string, item: MediaMemoryItem): string[] {
    if (!queryText) return [];
    const keywords = queryText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const highlights: string[] = [];

    const candidates = [item.title, item.summary, item.hook?.pacingSummary ?? "", item.transcriptText ?? ""];

    for (const text of candidates) {
      for (const kw of keywords) {
        if (text.toLowerCase().includes(kw)) {
          highlights.push(text.slice(0, 120));
          break;
        }
      }
      if (highlights.length >= 2) break;
    }

    return highlights;
  }
}
