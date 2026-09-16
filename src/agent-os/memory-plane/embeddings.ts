// Phase 20.41 — Deterministic chunking (spec §9) and the local embedding
// provider (spec §4, §42). The chunker is a stable whitespace-token sliding
// window: no empty chunks, bounded count, revision/hash attached by the
// caller. The local provider is a deterministic hashing-trick embedding
// (bag-of-signed-hashed-tokens, L2-normalized) — fully offline, zero
// dependencies, no memory text leaves the host. It is a real, working
// provider for local/development-grade semantic recall; higher-quality
// providers plug into the same EmbeddingProvider contract (P1).

import { createHash } from "node:crypto";
import type { ProviderHealth } from "./types";

export interface ChunkPlan {
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

/** Deterministic sliding-window chunker. */
export function chunkText(content: string, options: { targetTokens: number; overlapTokens: number; maxChunks: number }): ChunkPlan[] {
  const target = Math.max(16, options.targetTokens);
  const overlap = Math.min(Math.max(0, options.overlapTokens), Math.floor(target / 2));
  const maxChunks = Math.max(1, options.maxChunks);
  const tokens = tokenize(content);
  if (tokens.length === 0) return [];
  const chunks: ChunkPlan[] = [];
  const step = Math.max(1, target - overlap);
  let start = 0;
  while (start < tokens.length && chunks.length < maxChunks) {
    const slice = tokens.slice(start, start + target);
    if (slice.length === 0) break;
    const text = slice.join(" ");
    chunks.push({
      chunkIndex: chunks.length,
      chunkText: text,
      tokenCount: slice.length,
    });
    if (start + target >= tokens.length) break;
    start += step;
  }
  return chunks;
}

export function chunkHashOf(memoryId: string, revision: number, chunkIndex: number, chunkText: string): string {
  return "sha256:" + createHash("sha256").update(memoryId + ":" + revision + ":" + chunkIndex + ":" + chunkText).digest("hex");
}

// --- Embedding provider contract -------------------------------------------------------

export interface EmbeddingProvider {
  id: string;
  model: string;
  dimensions: number;
  embedTexts(texts: string[]): Promise<number[][]>;
  health(): Promise<ProviderHealth>;
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hash";
  readonly model = "hashing-trick-v1";
  readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = Math.max(64, Math.min(1024, dimensions));
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text.toLowerCase());
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      // Two independent hash-derived buckets with +1/-1 signs (hashing trick).
      const digestA = createHash("sha256").update("a:" + token).digest();
      const digestB = createHash("sha256").update("b:" + token).digest();
      const bucketA = digestA.readUInt32BE(0) % this.dimensions;
      const bucketB = digestB.readUInt32BE(0) % this.dimensions;
      vector[bucketA] += 1;
      vector[bucketB] += digestB[1] % 2 === 0 ? 1 : -1;
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }

  async health(): Promise<ProviderHealth> {
    return {
      state: "healthy",
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      lastSuccessfulCheckAt: new Date().toISOString(),
      lastFailureCategory: null,
      detail: "local deterministic hashing provider; no network, no memory text leaves the host",
    };
  }
}

/** Cosine similarity for L2-normalized vectors reduces to a dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return dot;
}

/** Reciprocal Rank Fusion (spec §10.3): score(d) = Σ 1/(k + rank_i(d)). */
export function reciprocalRankFusion(rankLists: Array<Array<{ memoryId: string }>>, k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const rankList of rankLists) {
    for (let index = 0; index < rankList.length; index += 1) {
      const memoryId = rankList[index].memoryId;
      fused.set(memoryId, (fused.get(memoryId) ?? 0) + 1 / (k + index + 1));
    }
  }
  return fused;
}
