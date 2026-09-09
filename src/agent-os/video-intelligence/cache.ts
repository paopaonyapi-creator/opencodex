/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Video Analysis Cache Layer (Section 38 & Section 63)
 * Avoids redundant frame extraction, transcript, and AI inference on identical media
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { VideoAnalysisReport } from "./types";

export class VideoAnalysisCache {
  private memoryCache: Map<string, VideoAnalysisReport> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  /**
   * Computes a deterministic SHA-256 cache key for a given video source and intent
   */
  public computeHash(source: string, intent = "general", configSignature = ""): string {
    const hasher = createHash("sha256");
    hasher.update(source);
    hasher.update(`:${intent}`);
    hasher.update(`:${configSignature}`);

    // If local file exists, include size and mtime for exact freshness
    if (!source.startsWith("http://") && !source.startsWith("https://") && existsSync(source)) {
      try {
        const stat = statSync(source);
        hasher.update(`:${stat.size}:${stat.mtimeMs}`);
      } catch {
        // Fallback to path only
      }
    }

    return hasher.digest("hex");
  }

  public get(cacheKey: string): VideoAnalysisReport | undefined {
    return this.memoryCache.get(cacheKey);
  }

  public set(cacheKey: string, report: VideoAnalysisReport): void {
    if (this.memoryCache.size >= this.maxEntries) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(cacheKey, report);
  }

  public clear(): void {
    this.memoryCache.clear();
  }
}
