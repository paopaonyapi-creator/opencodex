// Phase 20.43 — Governed MCP memory tools (spec §10). Registered in the
// central WebMCP gateway. Each tool: strict validation, explicit scope,
// bounded results, structured error codes. Raw destructive sync/delete is
// NOT exposed — sync is preview-only here; execute stays dashboard-gated.

import { getPlurMemoryService } from "./service";
import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { MemoryError } from "./types";

function req(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MemoryError("VALIDATION_FAILED", "field '" + field + "' is required");
  }
  return value;
}

export const PLUR_MEMORY_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "pao_memory_learn",
    description: "Learn a governed memory (engram) with scope + secret guard + policy (write; auto-learn off stores candidates).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.learn({
        title: req(args, "title"),
        content: req(args, "content"),
        memoryType: (typeof args.memoryType === "string" ? args.memoryType : "note") as never,
        scope: typeof args.scope === "string" ? args.scope : undefined,
        visibility: (typeof args.visibility === "string" ? args.visibility : "project") as never,
        sourceKind: (typeof args.sourceKind === "string" ? args.sourceKind : "explicit") as never,
      });
    },
  },
  {
    name: "pao_memory_recall",
    description: "Recall memories by query with scope isolation and engine disclosure (read).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.recall({ query: req(args, "query"), limit: typeof args.limit === "number" ? args.limit : 10 });
    },
  },
  {
    name: "pao_memory_inject",
    description: "Token-budgeted context injection with policy filter and persisted receipt (read).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.inject({ query: req(args, "query"), budgetTokens: typeof args.budgetTokens === "number" ? args.budgetTokens : undefined });
    },
  },
  {
    name: "pao_memory_feedback",
    description: "Submit explicit feedback (useful/irrelevant/harmful/obsolete/conflicting) for a memory (write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.feedback(req(args, "engramRegistryId"), (req(args, "signal") as "positive"), typeof args.reason === "string" ? args.reason : null);
    },
  },
  {
    name: "pao_memory_forget",
    description: "Retire a memory (policy-gated; audit recorded) (write).",
    riskTier: "R3", readOnly: false,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.forget(req(args, "engramRegistryId"));
    },
  },
  {
    name: "pao_memory_rescope",
    description: "Rescope a memory (shared targets require approval per policy) (write).",
    riskTier: "R3", readOnly: false,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.rescope(req(args, "engramRegistryId"), req(args, "scope"));
    },
  },
  {
    name: "pao_memory_capture",
    description: "Capture an operational episode (incident/decision/milestone) into the timeline (write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getPlurMemoryService();
      return service.captureEpisode({ summary: req(args, "summary"), eventType: req(args, "eventType"), severity: typeof args.severity === "string" ? args.severity : "info" });
    },
  },
  {
    name: "pao_memory_timeline",
    description: "Operational episode timeline with filters (read).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const service = getPlurMemoryService();
      return service.timeline({ eventType: typeof args.eventType === "string" ? args.eventType : undefined, limit: typeof args.limit === "number" ? args.limit : 50 });
    },
  },
  {
    name: "pao_memory_status",
    description: "Memory plane status: engine, counts, adapters, sync state (read).",
    riskTier: "R0", readOnly: true,
    execute: async () => getPlurMemoryService().status(),
  },
  {
    name: "pao_memory_receipt",
    description: "Inspect recent injection receipts (query hashes only, never raw queries) (read).",
    riskTier: "R0", readOnly: true,
    execute: () => getPlurMemoryService().listReceipts(20),
  },
  {
    name: "pao_memory_sync_preview",
    description: "Dry-run sync preview with scope/visibility/secret blocks (read; sync itself is disabled by default).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => getPlurMemoryService().syncPreview(req(args, "profile")),
  },
  {
    name: "pao_memory_doctor",
    description: "Memory doctor: PASS/WARN/FAIL/MANUAL checks including Codex hook-trust reminder (read).",
    riskTier: "R0", readOnly: true,
    execute: async () => getPlurMemoryService().doctor(),
  },
];
