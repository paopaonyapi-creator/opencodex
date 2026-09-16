// Phase 20.41 — MCP tools for the Memory Plane (spec §21-§22). Registered in
// the CENTRAL Pao-hubPro WebMCP gateway (no second MCP endpoint). Risk
// classes map to tool riskTier: READ_ONLY→R0, WRITE_REVERSIBLE→R2,
// DESTRUCTIVE_PREVIEW→R2, DESTRUCTIVE_CONFIRM→R3, ADMIN→R4. Every mutating
// call is scope-checked server-side; destructive tools are preview-confirm.

import { getMemoryPlaneService } from "./service";
import { systemActor } from "./scopes";
import type { WebMcpToolDefinition } from "../video/mcp-tools";

function str(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("[VALIDATION_ERROR] field '" + field + "' is required");
  }
  return value;
}

function actorOf(args: Record<string, unknown>) {
  return systemActor();
}

export const MEMORY_PLANE_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "memory_info",
    description: "Memory Plane capability/provider info (READ_ONLY, safe metadata only).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const service = getMemoryPlaneService();
      const health = await service.health();
      return { provider: service.embeddingProvider.id, model: service.embeddingProvider.model, dimensions: service.embeddingProvider.dimensions, health };
    },
  },
  {
    name: "memory_remember",
    description: "Create an authoritative/observed memory with revision snapshot + best-effort indexing (WRITE_REVERSIBLE, scope memory:write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getMemoryPlaneService();
      return service.remember({
        workspace: typeof args.workspace === "string" ? args.workspace : undefined,
        project: typeof args.project === "string" ? args.project : null,
        title: str(args, "title"),
        content: str(args, "content"),
        kind: (typeof args.kind === "string" ? args.kind : "note") as never,
        authority: (typeof args.authority === "string" ? args.authority : "observed") as never,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
        sourcePath: typeof args.sourcePath === "string" ? args.sourcePath : null,
        actor: { agentKey: "mcp-client", name: "mcp" },
        idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : null,
      }, actorOf(args));
    },
  },
  {
    name: "memory_recall",
    description: "Keyword/semantic/hybrid recall with rank provenance and honest degradation (READ_ONLY, scope memory:read).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const service = getMemoryPlaneService();
      return service.recall({
        workspace: typeof args.workspace === "string" ? args.workspace : undefined,
        query: str(args, "query"),
        mode: (typeof args.mode === "string" ? args.mode : undefined) as never,
        allowFallback: args.allowFallback !== false,
        limit: typeof args.limit === "number" ? args.limit : 8,
        kinds: Array.isArray(args.kinds) ? (args.kinds as never) : undefined,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
        includeContent: args.includeContent !== false,
        trace: args.trace !== false,
      }, actorOf(args));
    },
  },
  {
    name: "memory_observe",
    description: "Create an evidence-backed observation referencing source memories (WRITE_REVERSIBLE, scope memory:write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getMemoryPlaneService();
      return service.observe({
        workspace: typeof args.workspace === "string" ? args.workspace : undefined,
        observationText: str(args, "observationText"),
        confidence: typeof args.confidence === "number" ? args.confidence : null,
        sources: Array.isArray(args.sources) ? (args.sources as Array<{ memoryId: string; evidenceJson?: Record<string, unknown> | null }>) : [],
        actor: { agentKey: "mcp-client", name: "mcp" },
      }, actorOf(args));
    },
  },
  {
    name: "memory_forget_preview",
    description: "Preview forgetting a memory: impact snapshot + server-signed confirmation receipt (DESTRUCTIVE_PREVIEW, scope memory:delete).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getMemoryPlaneService().forgetPreview(str(args, "memoryId"), actorOf(args)),
  },
  {
    name: "memory_forget_confirm",
    description: "Execute an exact forget preview with the server-issued receipt; stale state is rejected 409 (DESTRUCTIVE_CONFIRM, scope memory:delete).",
    riskTier: "R3", readOnly: false,
    execute: (args) => getMemoryPlaneService().forgetConfirm(str(args, "memoryId"), str(args, "confirmationReceipt"), actorOf(args)),
  },
  {
    name: "memory_rebuild_preview",
    description: "Preview bounded derived-index rebuild (DESTRUCTIVE_PREVIEW, scope memory:admin).",
    riskTier: "R2", readOnly: false,
    execute: () => getMemoryPlaneService().rebuildPreview(),
  },
  {
    name: "memory_rebuild_confirm",
    description: "Execute a bounded index rebuild; rechecks source revision/hash per memory (ADMIN, scope memory:admin).",
    riskTier: "R4", readOnly: false,
    execute: async (args) => getMemoryPlaneService().rebuildConfirm(str(args, "confirmationReceipt")),
  },
  {
    name: "memory_stats",
    description: "Counts, index state and provider health with no secret content (READ_ONLY, scope memory:read).",
    riskTier: "R0", readOnly: true,
    execute: async () => getMemoryPlaneService().stats(),
  },
  {
    name: "memory_trace_list",
    description: "List trace metadata (query hashes only, never raw queries) (READ_ONLY, scope memory:trace).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getMemoryPlaneService().store.listTraces(typeof args.workspace === "string" ? args.workspace : null, typeof args.limit === "number" ? args.limit : 50),
  },
  {
    name: "memory_trace_get",
    description: "Inspect one trace's result provenance (revision/hash/rank/scores) (READ_ONLY, scope memory:trace).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getMemoryPlaneService().store.getTrace(str(args, "traceId")),
  },
  {
    name: "memory_list_workspaces",
    description: "List memory workspaces (READ_ONLY, scope memory:read).",
    riskTier: "R0", readOnly: true,
    execute: () => getMemoryPlaneService().store.listWorkspaces(),
  },
  {
    name: "memory_list_projects",
    description: "List memory projects (READ_ONLY, scope memory:read).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getMemoryPlaneService().store.listProjects(typeof args.workspace === "string" ? args.workspace : undefined),
  },
  {
    name: "memory_list_tags",
    description: "List tags with link counts (READ_ONLY, scope memory:read).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getMemoryPlaneService().store.listTags(str(args, "workspace")),
  },
];
