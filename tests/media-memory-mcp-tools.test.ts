import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MEDIA_MEMORY_MCP_TOOLS } from "../src/agent-os/media-memory/mcp-tools";
import { resetMediaMemory } from "../src/agent-os/media-memory";

describe("Phase 20.14 — Media Memory WebMCP Tools Suite", () => {
  beforeEach(() => {
    resetMediaMemory();
  });

  afterEach(() => {
    resetMediaMemory();
  });

  it("registers all 8 canonical WebMCP tools with valid schemas", () => {
    expect(MEDIA_MEMORY_MCP_TOOLS.length).toBe(8);

    const toolNames = MEDIA_MEMORY_MCP_TOOLS.map((t) => t.name);
    expect(toolNames).toContain("media_memory_index_video");
    expect(toolNames).toContain("media_memory_index_item");
    expect(toolNames).toContain("media_memory_search");
    expect(toolNames).toContain("media_memory_find_similar");
    expect(toolNames).toContain("media_memory_get");
    expect(toolNames).toContain("media_memory_delete");
    expect(toolNames).toContain("media_memory_stats");
    expect(toolNames).toContain("media_memory_rag_context");

    for (const tool of MEDIA_MEMORY_MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("indexes arbitrary media item via media_memory_index_item", async () => {
    const indexTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_index_item")!;
    const res = await indexTool.handler({
      id: "mitem_mcp_test_1",
      mediaType: "image",
      title: "Neon Cyberpunk Poster",
      summary: "High resolution graphic design poster for cyber fiction",
      tags: ["cyberpunk", "poster"],
      concepts: ["neon", "future"],
      width: 2048,
      height: 2048,
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.itemId).toBe("mitem_mcp_test_1");
  });

  it("queries stats via media_memory_stats", async () => {
    const statsTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_stats")!;
    const res = await statsTool.handler({});
    expect(res.isError).toBeFalsy();
    const stats = JSON.parse(res.content[0].text);
    expect(stats.totalItems).toBeDefined();
    expect(stats.vectorDimensions).toBe(64);
  });

  it("searches media memory and retrieves context via MCP tools", async () => {
    const indexTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_index_item")!;
    await indexTool.handler({
      id: "mitem_mcp_search_1",
      mediaType: "video",
      title: "Underwater Coral Reef Exploration",
      summary: "Marine biology documentary exploring vibrant ocean coral reefs and sea turtles.",
      tags: ["nature", "ocean"],
      concepts: ["marine", "coral", "ocean"],
      width: 1920,
      height: 1080,
    });

    const searchTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_search")!;
    const searchRes = await searchTool.handler({ query: "ocean coral marine life", limit: 5 });
    expect(searchRes.isError).toBeFalsy();
    const searchPayload = JSON.parse(searchRes.content[0].text);
    expect(searchPayload.totalMatches).toBeGreaterThanOrEqual(1);

    const ragTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_rag_context")!;
    const ragRes = await ragTool.handler({ query: "underwater marine documentary", maxItems: 2 });
    expect(ragRes.isError).toBeFalsy();
    const ragPayload = JSON.parse(ragRes.content[0].text);
    expect(ragPayload.contextMarkdown).toContain("Underwater Coral Reef Exploration");
  });

  it("finds similar items and retrieves full item by ID", async () => {
    const indexTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_index_item")!;
    await indexTool.handler({
      id: "mitem_ref_1",
      mediaType: "video",
      title: "First Reference Video",
      summary: "Reference video for testing retrieval",
    });

    const getTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_get")!;
    const getRes = await getTool.handler({ id: "mitem_ref_1" });
    expect(getRes.isError).toBeFalsy();
    const getPayload = JSON.parse(getRes.content[0].text);
    expect(getPayload.item.id).toBe("mitem_ref_1");

    const deleteTool = MEDIA_MEMORY_MCP_TOOLS.find((t) => t.name === "media_memory_delete")!;
    const delRes = await deleteTool.handler({ id: "mitem_ref_1" });
    expect(delRes.isError).toBeFalsy();
    const delPayload = JSON.parse(delRes.content[0].text);
    expect(delPayload.deleted).toBe(true);
  });
});
