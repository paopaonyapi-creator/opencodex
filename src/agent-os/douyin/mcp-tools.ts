// Phase 20.26 — Douyin MCP tool suite (typed, limited, audited).
//
// Follows the Phase 20.24 canonical WebMCP tool shape. Every tool validates
// input, enforces bounded limits, routes through the DouyinService control
// plane, and never returns secrets or raw session material.

import { getDouyinService } from "./service";
import type { DownloadPreset, UsageClass } from "../media-acquisition/types";

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

function text(result: unknown, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }], isError: isError || undefined };
}

export const DOUYIN_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "douyin_inspect",
    description: "Inspect a public Douyin URL (video/note/gallery/music) and return normalized canonical metadata.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Public Douyin URL." } },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const item = await getDouyinService().inspectUrl(String(args.url));
        return text({ provider: "douyin", kind: item.type, item, downloadable: true, requires_auth: false });
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_download",
    description: "Queue a bounded Douyin media download through the Phase 20.24 media queue (research-only rights).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public Douyin media URL." },
        preset: { type: "string", enum: ["best", "video", "audio", "reference", "transcript"] },
        usageClass: { type: "string", enum: ["research_reference", "internal_training", "concept_analysis"] },
      },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const job = await getDouyinService().enqueueDownload({
          url: String(args.url),
          preset: args.preset as DownloadPreset,
          usageClass: (args.usageClass as UsageClass) ?? "research_reference",
          requestedBy: "mcp",
        });
        return text({ jobId: job.id, status: job.status, rights: "research_only" });
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_search",
    description: "Bounded Douyin keyword search; results are stored as an immutable research snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword." },
        max_items: { type: "number", description: "Bounded result count (default 20, ceiling 50)." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const result = await getDouyinService().search({
          query: String(args.query),
          maxItems: typeof args.max_items === "number" ? args.max_items : undefined,
          requestedBy: "mcp",
        });
        return text(result);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_hot_board",
    description: "Capture a Douyin hot-search board snapshot (append-only history for trend comparison).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Bounded entry count (default 20, ceiling 50)." } },
    },
    handler: async (args) => {
      try {
        const result = await getDouyinService().hotBoard({
          limit: typeof args.limit === "number" ? args.limit : undefined,
          requestedBy: "mcp",
        });
        return text(result);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_get_job",
    description: "Get the status of a queued Douyin download job.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
    handler: async (args) => {
      const media = (await import("../media-acquisition/service")).getMediaAcquisitionService();
      const job = media.queue.getJob(String(args.job_id));
      if (!job) return text(`Job '${args.job_id}' not found.`, true);
      return text(job);
    },
  },
  {
    name: "douyin_sync_creator",
    description: "Incremental creator sync for a Douyin profile URL (bounded; requires approval per policy).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Douyin user profile URL." },
        max_items: { type: "number", description: "Bounded item count." },
      },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const result = await getDouyinService().syncCreator({
          url: String(args.url),
          maxItems: typeof args.max_items === "number" ? args.max_items : undefined,
          requestedBy: "mcp",
        });
        return text({ creator: result.creator, newItems: result.newItems.length, total: result.items.length });
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_get_comments",
    description: "Fetch normalized Douyin comments (untrusted data) for an item.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        media_item_id: { type: "string", description: "Optional canonical item id to attach comments to." },
        max_comments: { type: "number", description: "Bounded comment count (default 50, ceiling 200)." },
        include_replies: { type: "boolean" },
      },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const result = await getDouyinService().fetchComments({
          url: String(args.url),
          mediaItemId: typeof args.media_item_id === "string" ? args.media_item_id : undefined,
          maxComments: typeof args.max_comments === "number" ? args.max_comments : undefined,
          includeReplies: args.include_replies === true,
          requestedBy: "mcp",
        });
        return text(result);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_transcribe",
    description: "Transcribe an acquired Douyin media artifact (requires the artifact id; degrades clearly when absent).",
    inputSchema: {
      type: "object",
      properties: {
        media_item_id: { type: "string" },
        artifact_id: { type: "string", description: "Artifact id from the media acquisition registry." },
        language: { type: "string" },
      },
      required: ["media_item_id"],
    },
    handler: async (args) => {
      try {
        const transcript = await getDouyinService().saveTranscript({
          mediaItemId: String(args.media_item_id),
          artifactId: typeof args.artifact_id === "string" ? args.artifact_id : undefined,
          language: typeof args.language === "string" ? args.language : undefined,
        });
        return text(transcript);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  },
  {
    name: "douyin_list_artifacts",
    description: "List canonical Douyin media items with rights metadata (research-only by default).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    handler: async (args) => {
      const items = getDouyinService().listItems(typeof args.limit === "number" ? args.limit : 50);
      return text(items);
    },
  },
];
