import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaMemoryDbStore } from "../src/agent-os/media-memory/db-store";
import { MediaMemoryIndex } from "../src/agent-os/media-memory/memory-index";
import type { MediaMemoryItem } from "../src/agent-os/media-memory/types";

describe("Phase 20.14 — MediaMemoryIndex & SQLite Store", () => {
  let testDbPath: string;
  let dbStore: MediaMemoryDbStore;
  let index: MediaMemoryIndex;

  beforeEach(() => {
    testDbPath = join(tmpdir(), `test-media-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
    dbStore = new MediaMemoryDbStore(testDbPath);
    index = new MediaMemoryIndex(dbStore);
  });

  afterEach(() => {
    dbStore.close();
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {}
    }
  });

  const sampleItem1: MediaMemoryItem = {
    id: "mitem_sample_1",
    mediaType: "video",
    sourceUrl: "https://example.com/neon_tokyo.mp4",
    title: "Neon Tokyo Cyberpunk Reel",
    summary: "High energy vertical short of futuristic Tokyo neon lights and flying vehicles.",
    tags: ["cyberpunk", "tokyo", "reel"],
    concepts: ["futuristic", "neon", "high-energy"],
    entities: ["h264"],
    technicalSpecs: { width: 1080, height: 1920, durationSec: 15, orientation: "portrait" },
    pacing: { shotCount: 8, cutsPerMinute: 32, rhythmProfile: "HIGH-ENERGY" },
    hook: { openingType: "Kinetic Visual Hook", visualHookScore: 95 },
    transcriptText: "Welcome to Tokyo in year 2099.",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleItem2: MediaMemoryItem = {
    id: "mitem_sample_2",
    mediaType: "video",
    sourceUrl: "https://example.com/cooking_pasta.mp4",
    title: "Authentic Italian Carbonara",
    summary: "Cozy culinary video teaching how to make authentic pasta carbonara with egg and guanciale.",
    tags: ["cooking", "food", "italian"],
    concepts: ["culinary", "recipe", "calm"],
    entities: ["aac"],
    technicalSpecs: { width: 1920, height: 1080, durationSec: 180, orientation: "landscape" },
    pacing: { shotCount: 12, cutsPerMinute: 4, rhythmProfile: "CONTEMPLATIVE" },
    hook: { openingType: "Narrative Hook", visualHookScore: 70 },
    transcriptText: "First we slice the guanciale and prepare the eggs.",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("indexes items and creates multimodal and sub-modality vectors", () => {
    const res = index.indexItem(sampleItem1);
    expect(res.item.id).toBe("mitem_sample_1");
    expect(res.vectors.length).toBeGreaterThanOrEqual(3);

    const fetched = index.getItem("mitem_sample_1");
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe("Neon Tokyo Cyberpunk Reel");
    expect(fetched?.tags).toContain("cyberpunk");
  });

  it("computes stats accurately", () => {
    index.indexItem(sampleItem1);
    index.indexItem(sampleItem2);

    const stats = index.getStats();
    expect(stats.totalItems).toBe(2);
    expect(stats.videoCount).toBe(2);
    expect(stats.imageCount).toBe(0);
    expect(stats.totalVectors).toBeGreaterThanOrEqual(6);
  });

  it("performs semantic search and ranks by relevance", () => {
    index.indexItem(sampleItem1);
    index.indexItem(sampleItem2);

    const techResults = index.search({ queryText: "cyberpunk futuristic neon city", limit: 5 });
    expect(techResults.length).toBeGreaterThanOrEqual(1);
    expect(techResults[0].item.id).toBe("mitem_sample_1");
    expect(techResults[0].similarityScore).toBeGreaterThan(0.2);

    const foodResults = index.search({ queryText: "pasta italian cooking recipe", limit: 5 });
    expect(foodResults.length).toBeGreaterThanOrEqual(1);
    expect(foodResults[0].item.id).toBe("mitem_sample_2");
    expect(foodResults[0].similarityScore).toBeGreaterThan(0.2);
  });

  it("filters search results by tags and concepts", () => {
    index.indexItem(sampleItem1);
    index.indexItem(sampleItem2);

    const filtered = index.search({
      queryText: "video",
      tags: ["cooking"],
      limit: 5,
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].item.id).toBe("mitem_sample_2");
  });

  it("finds similar items excluding self", () => {
    index.indexItem(sampleItem1);
    index.indexItem(sampleItem2);

    const similar = index.findSimilar("mitem_sample_1", 5, 0.0);
    expect(similar.length).toBe(1);
    expect(similar[0].item.id).toBe("mitem_sample_2");
  });

  it("deletes items and their vectors cleanly", () => {
    index.indexItem(sampleItem1);
    expect(index.getItem("mitem_sample_1")).not.toBeNull();

    const deleted = index.deleteItem("mitem_sample_1");
    expect(deleted).toBe(true);
    expect(index.getItem("mitem_sample_1")).toBeNull();

    const stats = index.getStats();
    expect(stats.totalItems).toBe(0);
  });
});
