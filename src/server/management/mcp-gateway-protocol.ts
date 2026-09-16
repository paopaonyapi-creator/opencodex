// Phase 20.33 — minimal MCP JSON-RPC transport over the management API
// (doc §6.2, §33, §D). Implements the methods Open WebUI needs to connect:
// initialize, tools/list, tools/call, ping. No MCP SDK dependency (Dependency
// Guard): the protocol surface here is deliberately tiny and policy-aware —
// every tools/call enters the governed pipeline via AiWorkspaceGateway.

import { getAiWorkspaceGateway, type ToolCallOutcome } from "../../agent-os/ai-workspace/gateway";

const PROTOCOL_VERSION = "2024-11-05";

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolToMcp(entry: ReturnType<AiWorkspaceListTools>[number]): Record<string, unknown> {
  return {
    name: entry.name,
    description: `${entry.description} [risk=${entry.risk}; group=${entry.group}; executable=${entry.executable}${entry.availableVia ? `; available via ${entry.availableVia}` : ""}]`,
    inputSchema: entry.parameters,
    annotations: {
      risk: entry.risk,
      group: entry.group,
      executable: entry.executable,
      requiresApproval: ["execute", "deploy", "delete", "credential", "write-high"].includes(entry.risk),
      timeoutSeconds: entry.timeoutSeconds,
      audit: entry.audit,
    },
  };
}

type AiWorkspaceListTools = ReturnType<typeof getAiWorkspaceGateway>["listTools"];

function outcomeToCallResult(outcome: ToolCallOutcome): Record<string, unknown> {
  const isError = outcome.status === "failed" || outcome.status === "denied" || outcome.status === "unknown_tool" || outcome.status === "approval_invalid";
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: outcome.status,
        tool: outcome.tool,
        risk: outcome.risk,
        ...(outcome.output !== undefined ? { output: outcome.output } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.approvalId ? { approvalId: outcome.approvalId } : {}),
        ...(outcome.availableVia ? { availableVia: outcome.availableVia } : {}),
      }, null, 2),
    }],
    isError,
  };
}

/** Handles one JSON-RPC 2.0 request body; returns null for notifications. */
export async function handleMcpRpc(body: unknown): Promise<Record<string, unknown> | null> {
  if (!body || typeof body !== "object") return rpcError(null, -32600, "Invalid JSON-RPC request");
  const record = body as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || typeof record.method !== "string") {
    return rpcError(record.id ?? null, -32600, "Invalid JSON-RPC request");
  }
  const gateway = getAiWorkspaceGateway();
  const params = record.params && typeof record.params === "object" ? (record.params as Record<string, unknown>) : {};

  switch (record.method) {
    case "initialize":
      return rpcResult(record.id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pao-hubpro-mcp-gateway", version: "20.33" },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return rpcResult(record.id, {});
    case "tools/list":
      return rpcResult(record.id, { tools: gateway.listTools().map(toolToMcp) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const rawArgs = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      // Envelope keys ride alongside tool arguments; strip them so the policy
      // engine and the approval argument-match see only the tool's own args.
      const { actor, sessionId, approvalId: approvalRef, ...toolArgs } = rawArgs;
      const outcome = await gateway.callTool({
        name,
        args: toolArgs,
        actor: typeof actor === "string" ? actor : undefined,
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
        approvalId: typeof approvalRef === "string" ? approvalRef : undefined,
      });
      return rpcResult(record.id, outcomeToCallResult(outcome));
    }
    default:
      return rpcError(record.id ?? null, -32601, `Method not supported: ${record.method}`);
  }
}
