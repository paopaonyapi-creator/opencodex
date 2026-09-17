/**
 * Phase 20.74 — Federated MCP Tool Gateway & Sandbox Types
 */

export type ToolRiskTier = "R0" | "R1" | "R2" | "R3" | "R4";

export interface McpServerDefinition {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "websocket";
  command?: string;
  url?: string;
  trustScore: number; // 0 - 100
  status: "active" | "quarantined" | "disabled";
}

export interface McpToolDefinition {
  name: string;
  serverId: string;
  description: string;
  riskTier: ToolRiskTier;
  mutability: "read_only" | "idempotent_write" | "destructive";
  approvalRequired: boolean;
  enabled: boolean;
  inputSchema?: Record<string, unknown>;
}

export interface ToolExecutionRequest {
  requestId: string;
  toolName: string;
  serverId?: string;
  actorId: string;
  workspacePath: string;
  arguments: Record<string, unknown>;
  humanApproved?: boolean;
}

export interface ToolExecutionResult {
  requestId: string;
  toolName: string;
  status: "success" | "denied" | "failed";
  output?: unknown;
  error?: string;
  executionTimeMs: number;
  policyDecision: "allow" | "deny" | "require_approval";
  trustScore: number;
}
