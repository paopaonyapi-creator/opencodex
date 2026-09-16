// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Multi-Server MCP Tool Provider & Catalog

import type {
  McpTrustLevel,
  McpToolDefinition,
  OrchestrationMcpServer,
  ToolRiskLevel,
} from "./types";
import { OrchestrationStore } from "./store";

export class McpToolProvider {
  private tools = new Map<string, McpToolDefinition>();
  private store: OrchestrationStore;

  constructor(store?: OrchestrationStore) {
    this.store = store || new OrchestrationStore();
    this.registerBuiltinTools();
    this.seedDefaultServers();
  }

  private registerBuiltinTools(): void {
    this.registerTool({
      name: "read_file",
      serverName: "builtin_fs",
      description: "Read file contents from safe workspace path",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      riskLevel: "R0",
      trustLevel: "trusted_internal",
    });

    this.registerTool({
      name: "write_file",
      serverName: "builtin_fs",
      description: "Write or update file inside designated workspace",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      riskLevel: "R2",
      trustLevel: "trusted_internal",
    });

    this.registerTool({
      name: "run_shell_command",
      serverName: "builtin_terminal",
      description: "Execute validated shell command",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      riskLevel: "R3",
      trustLevel: "trusted_local",
    });

    this.registerTool({
      name: "fetch_web_data",
      serverName: "builtin_network",
      description: "Fetch web content or HTTP endpoint",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      riskLevel: "R1",
      trustLevel: "trusted_internal",
    });
  }

  private seedDefaultServers(): void {
    const existing = this.store.listMcpServers();
    if (existing.length === 0) {
      const now = new Date().toISOString();
      this.store.upsertMcpServer({
        id: "mcp_srv_builtin_fs",
        serverName: "builtin_fs",
        trustLevel: "trusted_internal",
        transport: "stdio",
        endpointOrCommand: "internal:fs",
        status: "active",
        toolCount: 2,
        lastHeartbeat: now,
        metadata: { description: "Pao-hubPro Built-in Filesystem Server" },
        updatedAt: now,
      });

      this.store.upsertMcpServer({
        id: "mcp_srv_builtin_terminal",
        serverName: "builtin_terminal",
        trustLevel: "trusted_local",
        transport: "stdio",
        endpointOrCommand: "internal:terminal",
        status: "active",
        toolCount: 1,
        lastHeartbeat: now,
        metadata: { description: "Pao-hubPro Built-in Safe Terminal" },
        updatedAt: now,
      });
    }
  }

  registerTool(tool: McpToolDefinition): void {
    const key = `${tool.serverName}:${tool.name}`;
    this.tools.set(key, tool);
  }

  getTool(serverName: string, toolName: string): McpToolDefinition | undefined {
    return this.tools.get(`${serverName}:${toolName}`) || this.tools.get(`builtin_fs:${toolName}`) || this.tools.get(`builtin_terminal:${toolName}`);
  }

  findToolByName(toolName: string): McpToolDefinition | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === toolName) return tool;
    }
    return undefined;
  }

  listTools(minTrustLevel: McpTrustLevel = "approved_third_party"): McpToolDefinition[] {
    const trustOrder: Record<McpTrustLevel, number> = {
      untrusted_external: 0,
      approved_third_party: 1,
      trusted_local: 2,
      trusted_internal: 3,
    };

    const minRank = trustOrder[minTrustLevel];
    const result: McpToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      const server = this.store.getMcpServer(tool.serverName);
      const effectiveTrust = server ? server.trustLevel : tool.trustLevel;
      if (trustOrder[effectiveTrust] >= minRank) {
        result.push({
          ...tool,
          trustLevel: effectiveTrust,
        });
      }
    }

    return result;
  }

  filterToolsForModel(allowedNames?: string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    const available = this.listTools("approved_third_party");
    return available
      .filter((t) => !allowedNames || allowedNames.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }
}
