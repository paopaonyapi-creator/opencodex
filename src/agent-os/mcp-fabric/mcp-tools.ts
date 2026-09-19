import { getMcpFabricService } from "./service";
import { McpFabricError, looksLikeSecretPayload } from "./types";

export interface McpFabricMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function err(e: unknown): Record<string, unknown> {
  if (e instanceof McpFabricError) return { ok: false, status: e.httpStatus, error: { code: e.code, message: e.message, detail: e.detail } };
  return { ok: false, status: 500, error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) } };
}

export function createMcpFabricMcpTools(): McpFabricMcpTool[] {
  const svc = getMcpFabricService();
  return [
    {
      name: "pao.connector.health",
      description: "Phase 20.96 MCP fabric / AnythingMCP adapter health.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const health = await svc.health();
        return { ok: Boolean(health.ok), phase: health.phase, flags: health.flags, adapters: health.adapters };
      },
    },
    {
      name: "pao.connector.catalog",
      description: "List governed connectors. Never returns secrets.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, connectors: svc.listConnectors() }),
    },
    {
      name: "pao.connector.invoke",
      description: "Execute a published canonical tool through Pao policy. Do not pass secrets or AnythingMCP admin tokens.",
      riskTier: "R2",
      parameters: { type: "object", properties: { canonicalName: { type: "string" }, args: { type: "object" } }, required: ["canonicalName"] },
      handler: async (args) => {
        try {
          if (looksLikeSecretPayload(args) || looksLikeSecretPayload(args.args) || args.ENCRYPTION_KEY) {
            return { ok: false, error: { code: "SECRET_IN_REQUEST", message: "secrets are not allowed on invoke" } };
          }
          return await svc.execute({ canonicalName: String(args.canonicalName), args: (args.args as Record<string, unknown>) ?? {}, actor: "mcp" });
        } catch (e) { return err(e); }
      },
    },
  ];
}
