// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// MCP Tool Inventory: Tool Governance, Independent Risk Assessment & Server Registry.

import { CodexRuntimeStore } from "./store";
import type { McpToolInventoryItem, RiskClassification } from "./types";

export class McpInventory {
  constructor(private store = new CodexRuntimeStore()) {}

  // Seed baseline built-in tools into inventory
  seedBuiltinTools(): void {
    const baselineTools: Array<Omit<McpToolInventoryItem, "updatedAt">> = [
      {
        id: "builtin_fs_read",
        serverName: "codex_builtin",
        toolName: "read_file",
        description: "Read file content within workspace boundaries",
        risk: "low",
        approvalBehavior: "auto",
        source: "builtin",
        health: "healthy",
      },
      {
        id: "builtin_fs_write",
        serverName: "codex_builtin",
        toolName: "write_file",
        description: "Create or overwrite file content inside workspace",
        risk: "medium",
        approvalBehavior: "auto",
        source: "builtin",
        health: "healthy",
      },
      {
        id: "builtin_shell_exec",
        serverName: "codex_builtin",
        toolName: "exec_command",
        description: "Execute shell commands inside workspace",
        risk: "medium",
        approvalBehavior: "ask",
        source: "builtin",
        health: "healthy",
      },
      {
        id: "builtin_fs_delete",
        serverName: "codex_builtin",
        toolName: "delete_file",
        description: "Delete files or directories inside workspace",
        risk: "high",
        approvalBehavior: "ask",
        source: "builtin",
        health: "healthy",
      },
      {
        id: "mcp_browser_navigate",
        serverName: "browser_mcp",
        toolName: "navigate",
        description: "Navigate browser session to target URL",
        risk: "low",
        approvalBehavior: "auto",
        source: "mcp",
        health: "healthy",
      },
      {
        id: "mcp_browser_action",
        serverName: "browser_mcp",
        toolName: "click_element",
        description: "Interact with elements in web page DOM",
        risk: "low",
        approvalBehavior: "auto",
        source: "mcp",
        health: "healthy",
      },
    ];

    const now = new Date().toISOString();
    for (const tool of baselineTools) {
      this.store.upsertMcpTool({ ...tool, updatedAt: now });
    }
  }

  registerTool(
    serverName: string,
    toolName: string,
    description: string,
    rawAnnotations?: { isReadOnly?: boolean; isDestructive?: boolean; isNetwork?: boolean },
  ): McpToolInventoryItem {
    // Independent Risk Assessment (Never trust annotations alone)
    let risk: RiskClassification = "low";
    let approvalBehavior: "auto" | "ask" | "deny" = "auto";

    const nameLower = toolName.toLowerCase();
    const descLower = description.toLowerCase();

    if (
      nameLower.includes("delete") ||
      nameLower.includes("remove") ||
      nameLower.includes("drop") ||
      nameLower.includes("format") ||
      rawAnnotations?.isDestructive
    ) {
      risk = "high";
      approvalBehavior = "ask";
    } else if (
      nameLower.includes("write") ||
      nameLower.includes("update") ||
      nameLower.includes("patch") ||
      nameLower.includes("exec") ||
      rawAnnotations?.isNetwork
    ) {
      risk = "medium";
      approvalBehavior = "ask";
    } else {
      risk = "low";
      approvalBehavior = "auto";
    }

    const item: McpToolInventoryItem = {
      id: `mcp_${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_"),
      serverName,
      toolName,
      description,
      risk,
      approvalBehavior,
      source: "mcp",
      health: "healthy",
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertMcpTool(item);
    return item;
  }

  listTools(): McpToolInventoryItem[] {
    let tools = this.store.listMcpTools();
    if (tools.length === 0) {
      this.seedBuiltinTools();
      tools = this.store.listMcpTools();
    }
    return tools;
  }
}
