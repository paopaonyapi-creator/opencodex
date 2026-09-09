import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaMemoryDbStore } from "../src/agent-os/media-memory/db-store";
import { MediaMemoryIndex } from "../src/agent-os/media-memory/memory-index";
import { MediaMemoryRetriever } from "../src/agent-os/media-memory/memory-retriever";
import type { VideoAnalysisReport } from "../src/agent-os/video-intelligence/types";

describe("Phase 20.14 — MediaMemoryRetriever & RAG Synthesis", () => {
  let testDbPath: string;
  let dbStore: MediaMemoryDbStore;
  let index: MediaMemoryIndex;
  let retriever: MediaMemoryRetriever;

  beforeEach(() => {
    testDbPath = join(tmpdir(), `test-retriever-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    dbStore = new MediaMemoryDbStore(testDbPath);
    index = new MediaMemoryIndex(dbStore);
    retriever = new MediaMemoryRetriever(index);
  });

  afterEach(() => {
    dbStore.close();
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {}
    }
  });

  const mockReport: VideoAnalysisReport = {
    jobId: "vjob_retriever_1",
    source: "https://example.com/ai_stock_nature.mp4",
    sourceType: "url",
    intent: "adobe_stock_qc",
    metadata: {
      durationSec: 20.0,
      width: 3840,
      height: 2160,
      fps: 60,
      videoCodec: "h264",
      audioCodec: "aac",
      bitrateKbps: 12000,
      fileSizeBytes: 30000000,
      orientation: "landscape",
      aspectRatio: "16:9",
    },
    pacing: {
      shotCount: 4,
      cutsPerMinute: 12,
      meanShotLengthSec: 5.0,
      medianShotLengthSec: 5.0,
      longestShotSec: 6.0,
      shortestShotSec: 4.0,
      openingCutRate: 2,
      rhythmProfile: "balanced",
    },
    hook: {
      openingType: "Scenic Visual Hook",
      firstCutTimestamp: 4.0,
      visualHookScore: 90,
      pacingSummary: "Breathtaking landscape reveal",
      timeline: [{ timestamp: 0, event: "Sunrise over mountain range" }],
    },
    transcript: {
      language: "en",
      provider: "none",
      fullText: "Discover the untouched beauty of the alpine lakes.",
      segments: [{ start: 0, end: 5.0, text: "Discover the untouched beauty of the alpine lakes." }],
    },
    heroFrames: [
      { frameIndex: 1, timestamp: 0.0, framePath: "frames/hero1.jpg", score: 0.95, reason: "Alpine sunrise panorama" },
    ],
    stockQc: {
      verdict: "PASS",
      score: 98,
      confidence: 0.95,
      issues: [],
      recommendations: ["Commercial quality verified."],
    },
    knowledgeRecord: {
      type: "video_analysis",
      source: "https://example.com/ai_stock_nature.mp4",
      title: "Alpine Sunrise Nature Stock",
      summary: "Cinematic 4K 60fps drone footage over alpine lakes and mountain ranges.",
      concepts: ["nature", "alpine", "landscape", "4k", "stock"],
      entities: ["h264"],
      reportPath: "report.json",
      createdAt: new Date().toISOString(),
    },
    markdownReport: "# Report",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  it("indexes a VideoAnalysisReport directly through retriever", () => {
    const res = retriever.indexVideoReport(mockReport);
    expect(res.item.id).toBe("mitem_vjob_retriever_1");
    expect(res.item.title).toContain("Alpine Sunrise Nature Stock");
  });

  it("performs semantic search and retrieves relevant video items", () => {
    retriever.indexVideoReport(mockReport);

    const matches = retriever.search({ queryText: "alpine mountain sunrise drone 4k" });
    expect(matches.length).toBe(1);
    expect(matches[0].item.id).toBe("mitem_vjob_retriever_1");
    expect(matches[0].similarityScore).toBeGreaterThan(0.2);
  });

  it("builds a structured RAG context pack for autonomous LLM agents", () => {
    retriever.indexVideoReport(mockReport);

    const ragPack = retriever.buildRagContext("alpine mountain stock footage", 3);
    expect(ragPack.totalMatches).toBe(1);
    expect(ragPack.contextMarkdown).toContain("Media Memory Knowledge Context");
    expect(ragPack.contextMarkdown).toContain("Alpine Sunrise Nature Stock");
    expect(ragPack.contextMarkdown).toContain("3840x2160");
    expect(ragPack.contextMarkdown).toContain("Scenic Visual Hook");
    expect(ragPack.contextMarkdown).toContain("Discover the untouched beauty");
    expect(ragPack.tokensEstimated).toBeGreaterThan(50);
  });

  it("handles RAG context generation for unmatched queries gracefully", () => {
    const ragPack = retriever.buildRagContext("cryptocurrency trading bot", 3, 0.9);
    expect(ragPack.totalMatches).toBe(0);
    expect(ragPack.contextMarkdown).toContain("No visual media matches found");
  });
});
