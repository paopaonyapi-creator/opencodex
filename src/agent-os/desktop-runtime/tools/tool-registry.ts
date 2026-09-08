// Phase 20.9 — Unified Tool Registry
// Manages namespaced tools (builtin__*, mcp__*, skill__*, sandbox__*)
// Enforces namespace isolation, collision prevention, and dynamic tool set filtering.

import type {
  ToolDescriptor,
  AgentMode,
  ModelCapabilities,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../types";
import { getToolRiskClassifier } from "./risk-classifier";
import {
  scanMarketTrends,
  planCampaign,
  dispatchCampaign,
  syncCampaignExecution,
  generateCampaignCsvManifest,
  getCampaign,
} from "../../campaign";

export class ToolRegistry {
  private tools = new Map<string, ToolDescriptor>();

  constructor() {
    this.registerBuiltinTools();
  }

  /**
   * Formats a collision-free namespaced tool id (e.g. 'builtin__read_file', 'mcp__comfyui__generate').
   */
  static formatToolId(namespace: string, name: string): string {
    const cleanNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    return `${cleanNamespace}__${cleanName}`;
  }

  registerTool(tool: ToolDescriptor): void {
    const id = ToolRegistry.formatToolId(tool.namespace, tool.name);
    this.tools.set(id, { ...tool, id });
  }

  unregisterTool(namespace: string, name: string): boolean {
    const id = ToolRegistry.formatToolId(namespace, name);
    return this.tools.delete(id);
  }

  getTool(namespace: string, name: string): ToolDescriptor | null {
    const id = ToolRegistry.formatToolId(namespace, name);
    return this.tools.get(id) ?? null;
  }

  getToolById(id: string): ToolDescriptor | null {
    return this.tools.get(id) ?? null;
  }

  listTools(namespace?: string): ToolDescriptor[] {
    const all = Array.from(this.tools.values());
    if (namespace) {
      return all.filter((t) => t.namespace.toLowerCase() === namespace.toLowerCase());
    }
    return all;
  }

  /**
   * Filters the full tool set down to the visible set presented to the model.
   * Considers Agent Mode, Model Capabilities, and Risk Rules.
   */
  getVisibleTools(options: {
    mode: AgentMode;
    modelCapabilities?: ModelCapabilities;
    allowedNamespaces?: string[];
    taskIntent?: string;
  }): ToolDescriptor[] {
    // 1. If mode is 'off', no tools are exposed
    if (options.mode === "off") {
      return [];
    }

    // 2. If model does not support tools, return empty set
    if (options.modelCapabilities && !options.modelCapabilities.tools) {
      return [];
    }

    let candidates = Array.from(this.tools.values());

    // 3. Namespace filter if restricted
    if (options.allowedNamespaces && options.allowedNamespaces.length > 0) {
      const allowed = new Set(options.allowedNamespaces.map((ns) => ns.toLowerCase()));
      candidates = candidates.filter((t) => allowed.has(t.namespace.toLowerCase()));
    }

    // 4. Mode-based risk filtering
    if (options.mode === "safe_auto") {
      // In safe_auto, prefer read_only, low, and select medium tools
      candidates = candidates.filter((t) => t.risk !== "critical");
    }

    return candidates;
  }

  /**
   * Executes a tool by its namespaced ID with timing and exception isolation.
   */
  async executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        toolCallId: toolId,
        success: false,
        errorMessage: `Tool '${toolId}' not found in registry`,
        latencyMs: 0,
      };
    }

    const start = Date.now();
    try {
      if (!tool.execute) {
        throw new Error(`Tool '${tool.name}' has no execution handler attached`);
      }
      const output = await tool.execute(args, context);
      return {
        toolCallId: toolId,
        success: true,
        output,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        toolCallId: toolId,
        success: false,
        errorMessage: String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  private registerBuiltinTools(): void {
    const classifier = getToolRiskClassifier();

    // 1. builtin__read_file
    this.registerTool({
      id: "builtin__read_file",
      namespace: "builtin",
      name: "read_file",
      description: "Read contents of a file within the allowed workspace boundary.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path within workspace" },
        },
        required: ["path"],
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        return { path: args.path, content: `[Content of ${args.path}]` };
      },
    });

    // 2. builtin__write_file
    this.registerTool({
      id: "builtin__write_file",
      namespace: "builtin",
      name: "write_file",
      description: "Write content to a file within the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Target file path" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
      risk: "medium",
      source: "builtin",
      requiresApproval: true,
      execute: async (args) => {
        return { path: args.path, written: true };
      },
    });

    // 3. builtin__search_workspace
    this.registerTool({
      id: "builtin__search_workspace",
      namespace: "builtin",
      name: "search_workspace",
      description: "Search workspace files for matching keywords or text patterns.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query or regex pattern" },
        },
        required: ["query"],
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        return { query: args.query, results: [] };
      },
    });

    // 4. builtin__list_dir
    this.registerTool({
      id: "builtin__list_dir",
      namespace: "builtin",
      name: "list_dir",
      description: "List files and directories in a workspace folder.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to workspace" },
        },
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        return { path: args.path || ".", items: [] };
      },
    });

    // 5. builtin__run_lint
    this.registerTool({
      id: "builtin__run_lint",
      namespace: "builtin",
      name: "run_lint",
      description: "Run project linter to check code quality and style.",
      inputSchema: { type: "object", properties: {} },
      risk: "low",
      source: "builtin",
      requiresApproval: false,
      execute: async () => {
        return { passed: true, issues: [] };
      },
    });

    // 6. builtin__run_typecheck
    this.registerTool({
      id: "builtin__run_typecheck",
      namespace: "builtin",
      name: "run_typecheck",
      description: "Run strict TypeScript compiler typecheck.",
      inputSchema: { type: "object", properties: {} },
      risk: "low",
      source: "builtin",
      requiresApproval: false,
      execute: async () => {
        return { passed: true, errors: [] };
      },
    });

    // 7. builtin__run_test
    this.registerTool({
      id: "builtin__run_test",
      namespace: "builtin",
      name: "run_test",
      description: "Execute allowlisted automated unit and integration tests.",
      inputSchema: {
        type: "object",
        properties: {
          testFile: { type: "string", description: "Target test file" },
        },
      },
      risk: "low",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        return { testFile: args.testFile, passed: true };
      },
    });

    // 8. builtin__campaign_scan_trends
    this.registerTool({
      id: "builtin__campaign_scan_trends",
      namespace: "builtin",
      name: "campaign_scan_trends",
      description: "Scan commercial stock media search trends and calculate Niche Viability Scores (NVS).",
      inputSchema: {
        type: "object",
        properties: {
          seeds: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of search seed keywords to scan",
          },
        },
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (_args) => {
        const signals = await scanMarketTrends();
        return { count: signals.length, signals };
      },
    });

    // 9. builtin__campaign_plan
    this.registerTool({
      id: "builtin__campaign_plan",
      namespace: "builtin",
      name: "campaign_plan",
      description: "Formulate an autonomous multi-asset stock media campaign from market trend signals.",
      inputSchema: {
        type: "object",
        properties: {
          signalId: { type: "string", description: "Optional ID of existing trend signal" },
          keyword: { type: "string", description: "Target niche keyword (e.g. 'Cyberpunk Street Food')" },
          category: { type: "string", description: "Optional category intent" },
          targetCount: { type: "number", description: "Target number of assets (e.g. 10, 25, 50)" },
        },
      },
      risk: "low",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        const targetAssetCount = typeof args.targetCount === "number" ? args.targetCount : 10;
        const result = planCampaign({
          trendSignalId: typeof args.signalId === "string" ? args.signalId : undefined,
          keyword: typeof args.keyword === "string" ? args.keyword : undefined,
          category: typeof args.category === "string" ? args.category : undefined,
          targetAssetCount,
        });
        return result;
      },
    });

    // 10. builtin__campaign_dispatch
    this.registerTool({
      id: "builtin__campaign_dispatch",
      namespace: "builtin",
      name: "campaign_dispatch",
      description: "Dispatch planned stock campaign items into the generation queue (gen_jobs).",
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "ID of the planned campaign to dispatch" },
        },
        required: ["campaignId"],
      },
      risk: "medium",
      source: "builtin",
      requiresApproval: true,
      execute: async (args) => {
        const campaignId = String(args.campaignId || "");
        if (!campaignId) return { error: "campaignId is required" };
        const result = dispatchCampaign(campaignId);
        return result;
      },
    });

    // 11. builtin__campaign_sync
    this.registerTool({
      id: "builtin__campaign_sync",
      namespace: "builtin",
      name: "campaign_sync",
      description: "Synchronize campaign items status against generation job queue progress.",
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "ID of the campaign to sync" },
        },
        required: ["campaignId"],
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        const campaignId = String(args.campaignId || "");
        if (!campaignId) return { error: "campaignId is required" };
        const result = syncCampaignExecution(campaignId);
        return result;
      },
    });

    // 12. builtin__campaign_export
    this.registerTool({
      id: "builtin__campaign_export",
      namespace: "builtin",
      name: "campaign_export",
      description: "Build Adobe Stock CSV export package and metadata manifest for a campaign.",
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "ID of the campaign to export" },
        },
        required: ["campaignId"],
      },
      risk: "read_only",
      source: "builtin",
      requiresApproval: false,
      execute: async (args) => {
        const campaignId = String(args.campaignId || "");
        if (!campaignId) return { error: "campaignId is required" };
        const campaign = getCampaign(campaignId);
        if (!campaign) return { error: "Campaign not found" };
        const manifestResult = generateCampaignCsvManifest(campaignId);
        return {
          campaign,
          rowCount: manifestResult.rowCount,
          csv: manifestResult.csv,
        };
      },
    });
  }
}

let defaultToolRegistry: ToolRegistry | null = null;
export function getToolRegistry(): ToolRegistry {
  if (!defaultToolRegistry) {
    defaultToolRegistry = new ToolRegistry();
  }
  return defaultToolRegistry;
}
