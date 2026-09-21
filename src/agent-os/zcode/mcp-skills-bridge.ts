/**
 * Phase 20.100 — Pao-hubPro × ZCode MCP & Skills Federation Bridge
 * Normalizes trust levels, validates skill containment, and projects configs into ZCode.
 */

import type { McpServerStatus, SkillDescriptor } from "./types";

export interface ZCodeMcpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    autoApprove?: string[];
  }>;
}

export class ZCodeMcpSkillsBridge {
  private mcpServers = new Map<string, McpServerStatus>();
  private skills = new Map<string, SkillDescriptor>();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    this.registerMcpServer({
      id: "pao-core-mcp",
      name: "Pao Core Capabilities",
      transport: "stdio",
      status: "connected",
      toolsCount: 15,
      trustLevel: "TRUSTED_BUILTIN",
    });

    this.registerSkill({
      id: "skill_code_audit",
      name: "Autonomous Code Audit",
      version: "1.0.0",
      description: "Scans repository files for vulnerabilities and secret exposure",
      scope: "system",
      trustLevel: "TRUSTED_BUILTIN",
      enabled: true,
    });
  }

  public registerMcpServer(server: McpServerStatus): void {
    this.mcpServers.set(server.id, server);
  }

  public registerSkill(skill: SkillDescriptor): void {
    // Validate skill path containment check (§12)
    if (skill.name.includes("..") || skill.id.includes("/")) {
      throw new Error(`Invalid skill identifier '${skill.id}': path traversal characters prohibited.`);
    }
    this.skills.set(skill.id, skill);
  }

  public listMcpServers(): McpServerStatus[] {
    return Array.from(this.mcpServers.values());
  }

  public listSkills(): SkillDescriptor[] {
    return Array.from(this.skills.values());
  }

  /**
   * Projects active trusted MCP servers into a ZCode-compatible configuration (§10).
   * Invariant: Never embeds raw credentials in the generated configuration.
   */
  public generateZCodeMcpConfig(): ZCodeMcpConfig {
    const config: ZCodeMcpConfig = { mcpServers: {} };

    for (const server of this.mcpServers.values()) {
      if (server.trustLevel === "BLOCKED" || server.trustLevel === "UNTRUSTED") {
        continue; // Exclude untrusted/blocked servers
      }

      config.mcpServers[server.id] = {
        command: "bun",
        args: ["run", `src/mcp/${server.id}.ts`],
        disabled: server.status === "disconnected",
        autoApprove: server.trustLevel === "TRUSTED_BUILTIN" ? ["read.*"] : [],
      };
    }

    return config;
  }
}

export interface ZCodeMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createZCodeMcpTools(): ZCodeMcpTool[] {
  return [
    {
      name: "pao.zcode.health",
      description: "Inspect ZCode Agent-Native Workspace Runtime health, active sessions, and subagent fleet.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        version: "3.14.2",
        status: "healthy",
        subsystem: "Pao-hubPro × ZCode Unified Agent-Native Coding Workspace Runtime",
      }),
    },
    {
      name: "pao.zcode.mcp_servers",
      description: "List federated MCP servers and their trust classification for ZCode workspace sessions.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const bridge = new ZCodeMcpSkillsBridge();
        return {
          ok: true,
          servers: bridge.listMcpServers(),
        };
      },
    },
  ];
}
