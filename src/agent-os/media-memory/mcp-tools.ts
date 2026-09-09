// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Canonical WebMCP Tools

import { getMediaMemoryIndex, getMediaMemoryRetriever } from "./index";
import type { MediaMemoryItem, MediaType } from "./types";
import type { VideoAnalysisReport } from "../video-intelligence/types";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

export const MEDIA_MEMORY_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "media_memory_index_video",
    description: "Index a Phase 20.13 VideoAnalysisReport into local visual memory with multimodal vector embeddings.",
    inputSchema: {
      type: "object",
      properties: {
        report: {
          type: "object",
          description: "Full VideoAnalysisReport object from Phase 20.13 analysis.",
        },
      },
      required: ["report"],
    },
    handler: async (args) => {
      try {
        const report = args.report as VideoAnalysisReport;
        if (!report || !report.jobId || !report.source) {
          return {
            content: [{ type: "text", text: "Error: Invalid VideoAnalysisReport payload." }],
            isError: true,
          };
        }
        const retriever = getMediaMemoryRetriever();
        const indexed = retriever.indexVideoReport(report);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  itemId: indexed.item.id,
                  vectorsCreated: indexed.vectors.length,
                  vectorTypes: indexed.vectors.map((v) => v.vectorType),
                  item: indexed.item,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error indexing video report: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_index_item",
    description: "Index an arbitrary video or image asset into media memory with concepts, tags, and technical specs.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional unique item ID (auto-generated if omitted)." },
        mediaType: { type: "string", enum: ["video", "image"], description: "Type of media asset." },
        title: { type: "string", description: "Title or descriptive label of the media asset." },
        summary: { type: "string", description: "Summary or description of the media asset." },
        sourceUrl: { type: "string", description: "Original web URL if applicable." },
        localPath: { type: "string", description: "Local filesystem path if applicable." },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization." },
        concepts: { type: "array", items: { type: "string" }, description: "High-level semantic concepts." },
        width: { type: "number", description: "Media resolution width." },
        height: { type: "number", description: "Media resolution height." },
        durationSec: { type: "number", description: "Video duration in seconds." },
        transcriptText: { type: "string", description: "Optional transcript or dialogue text." },
      },
      required: ["mediaType", "title", "summary"],
    },
    handler: async (args) => {
      try {
        const index = getMediaMemoryIndex();
        const now = new Date().toISOString();
        const item: MediaMemoryItem = {
          id: (args.id as string) || `mitem_${Date.now().toString(36)}`,
          mediaType: (args.mediaType as MediaType) || "video",
          title: String(args.title),
          summary: String(args.summary),
          sourceUrl: args.sourceUrl ? String(args.sourceUrl) : undefined,
          localPath: args.localPath ? String(args.localPath) : undefined,
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
          concepts: Array.isArray(args.concepts) ? (args.concepts as string[]) : [],
          entities: [],
          technicalSpecs: {
            width: Number(args.width) || 1920,
            height: Number(args.height) || 1080,
            durationSec: args.durationSec ? Number(args.durationSec) : undefined,
            orientation:
              (Number(args.width) || 1920) > (Number(args.height) || 1080)
                ? "landscape"
                : (Number(args.width) || 1920) < (Number(args.height) || 1080)
                ? "portrait"
                : "square",
          },
          transcriptText: args.transcriptText ? String(args.transcriptText) : undefined,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        };

        const result = index.indexItem(item);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  itemId: result.item.id,
                  vectorsCreated: result.vectors.length,
                  item: result.item,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error indexing media item: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_search",
    description: "Search visual memory using semantic natural language query with concept filters and similarity scoring.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query describing what visual media to find." },
        mediaType: { type: "string", enum: ["video", "image"], description: "Optional media type filter." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tag filter." },
        concepts: { type: "array", items: { type: "string" }, description: "Optional concept filter." },
        minScore: { type: "number", description: "Minimum cosine similarity score (0.0 to 1.0, default 0.15)." },
        limit: { type: "number", description: "Maximum number of results to return (default 10)." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const retriever = getMediaMemoryRetriever();
        const results = retriever.search({
          queryText: String(args.query),
          mediaType: args.mediaType as MediaType | undefined,
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
          concepts: Array.isArray(args.concepts) ? (args.concepts as string[]) : undefined,
          minScore: args.minScore !== undefined ? Number(args.minScore) : 0.15,
          limit: args.limit !== undefined ? Number(args.limit) : 10,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: args.query,
                  totalMatches: results.length,
                  results: results.map((r) => ({
                    id: r.item.id,
                    title: r.item.title,
                    similarityScore: r.similarityScore,
                    mediaType: r.item.mediaType,
                    summary: r.item.summary,
                    concepts: r.item.concepts,
                    pacing: r.item.pacing,
                    hook: r.item.hook,
                    specs: r.item.technicalSpecs,
                    highlights: r.highlights,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error searching media memory: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_find_similar",
    description: "Find similar media items to a given reference item in media memory.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "ID of the reference media item." },
        limit: { type: "number", description: "Number of similar items to return (default 5)." },
        minScore: { type: "number", description: "Minimum similarity score threshold (default 0.2)." },
      },
      required: ["itemId"],
    },
    handler: async (args) => {
      try {
        const retriever = getMediaMemoryRetriever();
        const results = retriever.findSimilar(
          String(args.itemId),
          args.limit ? Number(args.limit) : 5,
          args.minScore ? Number(args.minScore) : 0.2,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  referenceItemId: args.itemId,
                  similarCount: results.length,
                  results: results.map((r) => ({
                    id: r.item.id,
                    title: r.item.title,
                    similarityScore: r.similarityScore,
                    mediaType: r.item.mediaType,
                    summary: r.item.summary,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error finding similar items: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_get",
    description: "Retrieve complete media memory item and all associated vectors and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the media memory item." },
      },
      required: ["id"],
    },
    handler: async (args) => {
      try {
        const index = getMediaMemoryIndex();
        const item = index.getItem(String(args.id));
        if (!item) {
          return {
            content: [{ type: "text", text: `Media memory item with ID '${args.id}' not found.` }],
            isError: true,
          };
        }
        const vectors = index.getDb().getVectorsForItem(item.id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ item, vectors }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error retrieving item: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_delete",
    description: "Remove a media item and all its associated vectors from media memory.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the media item to delete." },
      },
      required: ["id"],
    },
    handler: async (args) => {
      try {
        const index = getMediaMemoryIndex();
        const deleted = index.deleteItem(String(args.id));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id: args.id, deleted }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error deleting item: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_stats",
    description: "Return visual memory index metrics, item count, vector dimensions, and database size.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      try {
        const index = getMediaMemoryIndex();
        const stats = index.getStats();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error getting stats: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },

  {
    name: "media_memory_rag_context",
    description: "Generate a compact RAG prompt context pack formatted in Markdown for autonomous agents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or agent task context." },
        maxItems: { type: "number", description: "Maximum number of items to include in RAG context (default 3)." },
        minScore: { type: "number", description: "Minimum similarity threshold (default 0.2)." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const retriever = getMediaMemoryRetriever();
        const pack = retriever.buildRagContext(
          String(args.query),
          args.maxItems ? Number(args.maxItems) : 3,
          args.minScore ? Number(args.minScore) : 0.2,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(pack, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error building RAG context: ${String(err)}` }],
          isError: true,
        };
      }
    },
  },
];
