import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleMediaMemoryRoutes } from "../src/server/management/media-memory-routes";
import { resetMediaMemory } from "../src/agent-os/media-memory";
import type { ManagementContext } from "../src/server/management/context";

function makeContext(path: string, method: string = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:10100${path}`);
  const headers = new Headers();
  headers.set("content-type", "application/json");

  const req = new Request(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    req,
    url,
    config: {} as any,
    configActions: {} as any,
  };
}

describe("Phase 20.14 — Media Memory Management Routes", () => {
  beforeEach(() => {
    resetMediaMemory();
  });

  afterEach(() => {
    resetMediaMemory();
  });

  it("handles GET /api/agent-os/media-memory/stats and alias /api/media-memory/stats", async () => {
    const ctx1 = makeContext("/api/agent-os/media-memory/stats", "GET");
    const res1 = await handleMediaMemoryRoutes(ctx1);
    expect(res1).not.toBeNull();
    expect(res1!.status).toBe(200);
    const data1 = (await res1!.json()) as { stats: { totalItems: number } };
    expect(data1.stats.totalItems).toBeDefined();

    const ctx2 = makeContext("/api/media-memory/stats", "GET");
    const res2 = await handleMediaMemoryRoutes(ctx2);
    expect(res2).not.toBeNull();
    expect(res2!.status).toBe(200);
  });

  it("indexes, retrieves, searches, and deletes items via REST API", async () => {
    // 1. POST /items
    const postCtx = makeContext("/api/agent-os/media-memory/items", "POST", {
      id: "mitem_rest_test_1",
      mediaType: "video",
      title: "Alpine Forest Flight",
      summary: "Scenic drone overview of green coniferous forest in mountains.",
      tags: ["nature", "drone", "forest"],
      concepts: ["alpine", "trees", "aerial"],
    });

    const postRes = await handleMediaMemoryRoutes(postCtx);
    expect(postRes).not.toBeNull();
    expect(postRes!.status).toBe(201);
    const postData = (await postRes!.json()) as { success: boolean; itemId: string };
    expect(postData.success).toBe(true);
    expect(postData.itemId).toBe("mitem_rest_test_1");

    // 2. GET /items
    const listCtx = makeContext("/api/agent-os/media-memory/items", "GET");
    const listRes = await handleMediaMemoryRoutes(listCtx);
    expect(listRes!.status).toBe(200);
    const listData = (await listRes!.json()) as { items: any[] };
    expect(listData.items.length).toBeGreaterThanOrEqual(1);

    // 3. GET /items/:id
    const getCtx = makeContext("/api/agent-os/media-memory/items/mitem_rest_test_1", "GET");
    const getRes = await handleMediaMemoryRoutes(getCtx);
    expect(getRes!.status).toBe(200);
    const getData = (await getRes!.json()) as { item: { id: string }; vectors: any[] };
    expect(getData.item.id).toBe("mitem_rest_test_1");
    expect(getData.vectors.length).toBeGreaterThanOrEqual(3);

    // 4. POST /search
    const searchCtx = makeContext("/api/agent-os/media-memory/search", "POST", {
      query: "mountain forest drone aerial",
    });
    const searchRes = await handleMediaMemoryRoutes(searchCtx);
    expect(searchRes!.status).toBe(200);
    const searchData = (await searchRes!.json()) as { totalMatches: number; results: any[] };
    expect(searchData.totalMatches).toBeGreaterThanOrEqual(1);
    expect(searchData.results[0].id).toBe("mitem_rest_test_1");

    // 5. POST /rag
    const ragCtx = makeContext("/api/agent-os/media-memory/rag", "POST", {
      query: "scenic forest footage",
      maxItems: 2,
    });
    const ragRes = await handleMediaMemoryRoutes(ragCtx);
    expect(ragRes!.status).toBe(200);
    const ragData = (await ragRes!.json()) as { pack: { contextMarkdown: string } };
    expect(ragData.pack.contextMarkdown).toContain("Alpine Forest Flight");

    // 6. DELETE /items/:id
    const delCtx = makeContext("/api/agent-os/media-memory/items/mitem_rest_test_1", "DELETE");
    const delRes = await handleMediaMemoryRoutes(delCtx);
    expect(delRes!.status).toBe(200);

    // 7. Re-check GET /items/:id should return 404
    const getAfterDel = await handleMediaMemoryRoutes(getCtx);
    expect(getAfterDel!.status).toBe(404);
  });
});
