/**
 * Phase 20.74 — Federated MCP Tool Gateway
 * Manages tool registration, trust scoring, sandboxed execution, and audit logs.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { openAgentOsDb } from "../db";
import { ToolExecutionSandbox, SandboxSecurityError } from "./sandbox";
import { getSensorimotorService } from "../sensorimotor/service";
import { createSensorimotorMcpTools } from "../sensorimotor/mcp-tools";
import type {
  McpServerDefinition,
  McpToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
} from "./types";

export class McpToolGateway {
  private servers = new Map<string, McpServerDefinition>();
  private tools = new Map<string, McpToolDefinition>();

  constructor() {
    this.seedDefaultTools();
  }

  public registerServer(server: McpServerDefinition): void {
    this.servers.set(server.id, { ...server });
  }

  public registerTool(tool: McpToolDefinition): void {
    this.tools.set(tool.name, { ...tool });
  }

  public getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  public listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public listServers(): McpServerDefinition[] {
    return Array.from(this.servers.values());
  }

  public calculateTrustScore(toolName: string): number {
    const tool = this.tools.get(toolName);
    if (!tool) return 0;
    const server = this.servers.get(tool.serverId);
    let baseScore = server?.trustScore ?? 70;

    if (tool.riskTier === "R0") baseScore = Math.min(baseScore + 10, 100);
    if (tool.riskTier === "R4") baseScore = Math.max(baseScore - 40, 10);
    if (tool.mutability === "destructive") baseScore = Math.max(baseScore - 20, 10);

    return baseScore;
  }

  public async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const start = performance.now();
    const tool = this.tools.get(request.toolName);

    if (!tool) {
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        status: "denied",
        error: `Tool '${request.toolName}' is not registered in the MCP gateway`,
        executionTimeMs: 1,
        policyDecision: "deny",
        trustScore: 0,
      };
    }

    if (!tool.enabled) {
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        status: "denied",
        error: `Tool '${request.toolName}' is currently disabled by policy`,
        executionTimeMs: 1,
        policyDecision: "deny",
        trustScore: this.calculateTrustScore(tool.name),
      };
    }

    // R4 / Approval check
    if (tool.approvalRequired && !request.humanApproved) {
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        status: "denied",
        error: `Tool '${request.toolName}' requires mandatory human approval before execution`,
        executionTimeMs: 1,
        policyDecision: "require_approval",
        trustScore: this.calculateTrustScore(tool.name),
      };
    }

    // Sanitize arguments to prevent secret leakage
    const sanitizedArgs = ToolExecutionSandbox.sanitizeArguments(request.arguments);

    let output: unknown;
    let status: "success" | "denied" | "failed" = "success";
    let errorMsg: string | undefined;

    try {
      if (tool.name === "pao.fs.read") {
        const filePath = String(sanitizedArgs.path || "");
        const safePath = ToolExecutionSandbox.assertSafeWorkspacePath(filePath, request.workspacePath);
        if (!existsSync(safePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        output = readFileSync(safePath, "utf8");
      } else if (tool.name === "pao.fs.write") {
        const filePath = String(sanitizedArgs.path || "");
        const safePath = ToolExecutionSandbox.assertSafeWorkspacePath(filePath, request.workspacePath);
        const content = String(sanitizedArgs.content || "");
        writeFileSync(safePath, content, "utf8");
        output = { written: true, path: filePath, bytes: content.length };
      } else if (tool.name === "pao.fs.list") {
        const dirPath = String(sanitizedArgs.path || ".");
        const safePath = ToolExecutionSandbox.assertSafeWorkspacePath(dirPath, request.workspacePath);
        output = readdirSync(safePath);
      } else if (tool.name === "pao.exec.safe") {
        const cmd = String(sanitizedArgs.command || "");
        ToolExecutionSandbox.assertSafeCommand(cmd);
        output = { command: cmd, status: "simulated_safe_execution" };
      } else {
        output = { executed: true, tool: tool.name };
      }
    } catch (err: unknown) {
      if (err instanceof SandboxSecurityError) {
        status = "denied";
        errorMsg = err.message;
      } else {
        status = "failed";
        errorMsg = (err as Error).message;
      }
    }

    const executionTimeMs = Math.max(Math.round(performance.now() - start), 1);
    const trustScore = this.calculateTrustScore(tool.name);

    // Record audit into core_tool_executions
    this.recordAudit(request, tool, status, executionTimeMs, errorMsg);

    return {
      requestId: request.requestId,
      toolName: tool.name,
      status,
      output: status === "success" ? output : undefined,
      error: errorMsg,
      executionTimeMs,
      policyDecision: status === "denied" ? "deny" : "allow",
      trustScore,
    };
  }

  private seedDefaultTools(): void {
    this.registerServer({
      id: "local_system",
      name: "Pao Safe Local System",
      transport: "stdio",
      trustScore: 95,
      status: "active",
    });

    this.registerTool({
      name: "pao.fs.read",
      serverId: "local_system",
      description: "Safely reads a file within the workspace boundary",
      riskTier: "R0",
      mutability: "read_only",
      approvalRequired: false,
      enabled: true,
    });

    this.registerTool({
      name: "pao.fs.write",
      serverId: "local_system",
      description: "Safely writes a file within the workspace boundary",
      riskTier: "R2",
      mutability: "idempotent_write",
      approvalRequired: false,
      enabled: true,
    });

    this.registerTool({
      name: "pao.fs.list",
      serverId: "local_system",
      description: "Lists directory contents within the workspace boundary",
      riskTier: "R0",
      mutability: "read_only",
      approvalRequired: false,
      enabled: true,
    });

    this.registerTool({
      name: "pao.exec.safe",
      serverId: "local_system",
      description: "Executes a command screened against destructive patterns",
      riskTier: "R2",
      mutability: "idempotent_write",
      approvalRequired: false,
      enabled: true,
    });

    this.registerTool({
      name: "pao.admin.destroy",
      serverId: "local_system",
      description: "Privileged destructive system operation",
      riskTier: "R4",
      mutability: "destructive",
      approvalRequired: true, // MANDATORY APPROVAL
      enabled: true,
    });

    // Phase 20.82: register sensorimotor AFT tools
    this.registerServer({
      id: "aft_sensorimotor",
      name: "CortexKit AFT Sensorimotor Runtime",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const service = getSensorimotorService();
      const aftTools = createSensorimotorMcpTools(service);
      for (const tool of aftTools) {
        this.registerTool({
          name: tool.name,
          serverId: "aft_sensorimotor",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Sensorimotor DB may not be initialized in all environments;
      // tools remain unregistered until the runtime is ready.
    }

    // Phase 20.89: register Capability Hub (Bubble) marketplace tools
    this.registerServer({
      id: "capability_marketplace",
      name: "Pao-hubPro Capability Hub (Phase 20.89)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { getCapabilityHubService } = require("../marketplace/service") as typeof import("../marketplace/service");
      const { createMarketplaceMcpTools } = require("../marketplace/mcp-tools") as typeof import("../marketplace/mcp-tools");
      const marketplaceTools = createMarketplaceMcpTools(getCapabilityHubService());
      for (const tool of marketplaceTools) {
        this.registerTool({
          name: tool.name,
          serverId: "capability_marketplace",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Marketplace DB may not be initialized in all environments;
      // tools remain unregistered until the runtime is ready.
    }

    // Phase 20.91b: register Engineering Skill Runtime tools (Addy Osmani Agent Skills)
    this.registerServer({
      id: "engineering_skills",
      name: "Pao-hubPro Engineering Skill Runtime (Phase 20.91b)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { getEngineeringSkillsService } = require("../engineering-skills/service") as typeof import("../engineering-skills/service");
      const { createEngineeringSkillsMcpTools } = require("../engineering-skills/mcp-tools") as typeof import("../engineering-skills/mcp-tools");
      const esTools = createEngineeringSkillsMcpTools(getEngineeringSkillsService());
      for (const tool of esTools) {
        this.registerTool({
          name: tool.name,
          serverId: "engineering_skills",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Engineering-skills DB may not be initialized in all environments;
      // tools remain unregistered until the runtime is ready.
    }

    // Phase 20.92: register Video Studio (AI Script-to-Video) tools
    this.registerServer({
      id: "video_studio",
      name: "Pao-hubPro Video Studio (Phase 20.92)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { getVideoStudioService } = require("../video-studio/service") as typeof import("../video-studio/service");
      const { createVideoStudioMcpTools } = require("../video-studio/mcp-tools") as typeof import("../video-studio/mcp-tools");
      const vsTools = createVideoStudioMcpTools(getVideoStudioService());
      for (const tool of vsTools) {
        this.registerTool({
          name: tool.name,
          serverId: "video_studio",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Video-studio DB may not be initialized in all environments;
      // tools remain unregistered until the runtime is ready.
    }

    // Phase 20.93: register Workflow Studio (visual orchestration) tools
    this.registerServer({
      id: "workflow_studio",
      name: "Pao-hubPro Workflow Studio (Phase 20.93)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { getWorkflowStudioService } = require("../workflow-studio/service") as typeof import("../workflow-studio/service");
      const { createWorkflowStudioMcpTools } = require("../workflow-studio/mcp-tools") as typeof import("../workflow-studio/mcp-tools");
      const wfsTools = createWorkflowStudioMcpTools(getWorkflowStudioService());
      for (const tool of wfsTools) {
        this.registerTool({
          name: tool.name,
          serverId: "workflow_studio",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
  } catch {
    // Workflow-studio DB may not be initialized in all environments;
    // tools remain unregistered until the runtime is ready.
  }
    // Phase 20.94: register ENZO unified workspace tools
    this.registerServer({
      id: "enzo_workspace",
      name: "Pao-hubPro ENZO Workspace (Phase 20.94)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { createEnzoWorkspaceMcpTools } = require("../enzo-workspace/mcp-tools") as typeof import("../enzo-workspace/mcp-tools");
      const enzoTools = createEnzoWorkspaceMcpTools();
      for (const tool of enzoTools) {
        this.registerTool({
          name: tool.name,
          serverId: "enzo_workspace",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Workspace DB may not be initialized in all environments.
    }

    // Phase 20.95: register Content Acquisition Gateway tools
    this.registerServer({
      id: "acquisition",
      name: "Pao-hubPro Content Acquisition Gateway (Phase 20.95)",
      transport: "stdio",
      trustScore: 90,
      status: "active",
    });

    try {
      const { createAcquisitionMcpTools } = require("../acquisition/mcp-tools") as typeof import("../acquisition/mcp-tools");
      const acqTools = createAcquisitionMcpTools();
      for (const tool of acqTools) {
        this.registerTool({
          name: tool.name,
          serverId: "acquisition",
          description: tool.description,
          riskTier: tool.riskTier,
          mutability: tool.riskTier === "R0" || tool.riskTier === "R1" ? "read_only" : "idempotent_write",
          approvalRequired: tool.riskTier === "R3" || tool.riskTier === "R4",
          enabled: true,
        });
      }
    } catch {
      // Acquisition DB may not be initialized in all environments.
    }
  }

  private recordAudit(
    request: ToolExecutionRequest,
    tool: McpToolDefinition,
    status: string,
    executionTimeMs: number,
    error?: string,
  ): void {
    try {
      const db = openAgentOsDb();
      const executionId = `texec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      db.query(`
        INSERT INTO core_tool_executions (
          id, tool_name, server_id, actor_id, task_id,
          arguments_hash, arguments_json, status, result_json,
          execution_time_ms, approved_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId,
        tool.name,
        tool.serverId,
        request.actorId,
        request.requestId,
        "hash_" + request.requestId,
        JSON.stringify(ToolExecutionSandbox.sanitizeArguments(request.arguments)),
        status,
        JSON.stringify(error ? { error } : { success: true }),
        executionTimeMs,
        request.humanApproved ? request.actorId : null,
        new Date().toISOString(),
      );
    } catch {
      // Graceful fallback during tests
    }
  }
}

let defaultMcpGateway: McpToolGateway | null = null;

export function getMcpToolGateway(): McpToolGateway {
  if (!defaultMcpGateway) {
    defaultMcpGateway = new McpToolGateway();
  }
  return defaultMcpGateway;
}
