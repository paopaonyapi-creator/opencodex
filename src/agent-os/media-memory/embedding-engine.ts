// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Embedding & Semantic Vector Engine

import type { MediaMemoryItem, MediaTechnicalSpecs } from "./types";

export const DEFAULT_VECTOR_DIMENSION = 64;

export class MediaEmbeddingEngine {
  private dimension: number;

  constructor(dimension: number = DEFAULT_VECTOR_DIMENSION) {
    this.dimension = dimension;
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Compute Cosine Similarity between two numeric vectors.
   * Expects L2-normalized vectors, but computes full cosine formula safely.
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    const len = Math.min(vecA.length, vecB.length);

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    // Clamp to [0, 1] for clean percentage scores
    return Math.max(0, Math.min(1, Number(similarity.toFixed(4))));
  }

  /**
   * Generate a deterministic, dense semantic text embedding using subword n-gram hashing
   * and term frequency projection with L2 normalization.
   */
  generateTextVector(text: string, dim: number = this.dimension): number[] {
    const vec = new Array<number>(dim).fill(0);
    if (!text || text.trim().length === 0) return vec;

    const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ");
    const words = normalized.split(/\s+/).filter((w) => w.length > 1);

    if (words.length === 0) return vec;

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      // Position weight: words appearing earlier receive higher semantic prominence
      const posWeight = 1.0 + Math.max(0, (10 - wIdx) * 0.05);

      // Whole word hash
      const wHash = this.hashString(word);
      const slot = Math.abs(wHash) % dim;
      const sign = (wHash & 1) === 0 ? 1 : -1;
      vec[slot] += sign * posWeight * 1.5;

      // 3-gram subwords for morphological capture
      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          const gram = word.slice(i, i + 3);
          const gHash = this.hashString(gram);
          const gSlot = Math.abs(gHash) % dim;
          const gSign = (gHash & 1) === 0 ? 1 : -1;
          vec[gSlot] += gSign * 0.5;
        }
      }
    }

    return this.l2Normalize(vec);
  }

  /**
   * Generate a visual feature vector from technical specs, geometry, and keyframe scores.
   */
  generateVisualVector(
    specs?: MediaTechnicalSpecs,
    heroScore: number = 0.8,
    cutCount: number = 5,
    dim: number = this.dimension,
  ): number[] {
    const vec = new Array<number>(dim).fill(0);
    if (!specs) return vec;

    // Slot 0: Aspect ratio ratio (width / height)
    const ratio = specs.height > 0 ? specs.width / specs.height : 1.777;
    vec[0] = Math.min(3, ratio) / 3;

    // Slot 1: Orientation code
    vec[1] = specs.orientation === "landscape" ? 1.0 : specs.orientation === "portrait" ? -1.0 : 0.0;

    // Slot 2: Normalized duration (up to 120s)
    const dur = specs.durationSec ?? 15;
    vec[2] = Math.min(1.0, dur / 120);

    // Slot 3: Frame rate / motion smoothness (24fps vs 60fps)
    vec[3] = Math.min(1.0, (specs.fps ?? 30) / 60);

    // Slot 4: Hero frame aesthetic score
    vec[4] = Math.max(0, Math.min(1, heroScore));

    // Slot 5: Scene dynamism / cut count
    vec[5] = Math.min(1.0, cutCount / 30);

    // Fill remaining slots using harmonic projections to avoid sparse orthogonal artifacts
    for (let i = 6; i < dim; i++) {
      const angle = (i * Math.PI) / dim;
      vec[i] = Math.sin(angle * ratio) * 0.3 + Math.cos(angle * dur) * 0.2;
    }

    return this.l2Normalize(vec);
  }

  /**
   * Fuse text, visual, and transcript vectors into a unified multimodal representation.
   */
  generateMultimodalVector(item: Partial<MediaMemoryItem>, dim: number = this.dimension): number[] {
    const textCorpus = [
      item.title ?? "",
      item.summary ?? "",
      (item.tags ?? []).join(" "),
      (item.concepts ?? []).join(" "),
      (item.entities ?? []).join(" "),
      item.hook?.openingType ?? "",
      item.pacing?.rhythmProfile ?? "",
    ].join(" ");

    const textVec = this.generateTextVector(textCorpus, dim);

    const heroScore = item.heroFrames?.[0]?.score ?? 0.8;
    const cutCount = item.pacing?.shotCount ?? 5;
    const visualVec = this.generateVisualVector(item.technicalSpecs, heroScore, cutCount, dim);

    const transcriptVec = item.transcriptText
      ? this.generateTextVector(item.transcriptText, dim)
      : new Array<number>(dim).fill(0);

    // Multimodal fusion weights: 60% text/concepts, 25% visual metrics, 15% speech transcript
    const fused = new Array<number>(dim).fill(0);
    const hasTranscript = item.transcriptText && item.transcriptText.length > 5;
    const wText = hasTranscript ? 0.6 : 0.7;
    const wVisual = hasTranscript ? 0.25 : 0.3;
    const wTranscript = hasTranscript ? 0.15 : 0.0;

    for (let i = 0; i < dim; i++) {
      fused[i] = textVec[i] * wText + visualVec[i] * wVisual + transcriptVec[i] * wTranscript;
    }

    return this.l2Normalize(fused);
  }

  /**
   * L2 normalization helper: scales vector so Euclidean length equals 1.0.
   */
  private l2Normalize(vec: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    if (sumSq === 0) return vec;
    const norm = Math.sqrt(sumSq);
    return vec.map((v) => Number((v / norm).toFixed(5)));
  }

  /**
   * Deterministic 32-bit FNV-1a hash implementation.
   */
  private hashString(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash;
  }
}
