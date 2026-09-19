import { mcpFabricMockForced } from "./flags";
import { McpFabricError } from "./types";

export interface AdapterHealth {
  id: "anythingmcp" | "mock";
  status: "healthy" | "unconfigured" | "offline" | "degraded";
  detail: string;
  version?: string;
  latencyMs?: number;
}

export interface FabricAdapter {
  id: "anythingmcp" | "mock";
  probe(): Promise<AdapterHealth>;
  execute(input: { tool: string; args: Record<string, unknown>; credentialHeader?: string }): Promise<{ ok: boolean; payload: unknown }>;
}

export class MockAnythingMcpAdapter implements FabricAdapter {
  readonly id = "mock" as const;
  async probe(): Promise<AdapterHealth> {
    return { id: "mock", status: "healthy", detail: "deterministic mock connector engine for tests; not a live AnythingMCP" };
  }
  async execute(input: { tool: string; args: Record<string, unknown> }): Promise<{ ok: boolean; payload: unknown }> {
    if (input.tool.includes("track") || input.tool.includes("shipment")) {
      return { ok: true, payload: { tracking: String(input.args.tracking_number ?? "1Z999"), status: "in_transit", eta: "2026-09-22" } };
    }
    if (input.tool.includes("order")) {
      return { ok: true, payload: { id: input.args.id ?? "ord_1", tracking_number: "1Z999AA10123456784", email: "ada@example.com", token: "sk-live-should-drop" } };
    }
    if (input.tool.includes("select") || input.args.sql) {
      return { ok: true, payload: { rows: [{ sku: "A-1", qty: 12 }], truncated: false } };
    }
    return { ok: true, payload: { echo: input.tool, ok: true, email: "user@example.com" } };
  }
}

export class AnythingMcpHttpAdapter implements FabricAdapter {
  readonly id = "anythingmcp" as const;
  async probe(): Promise<AdapterHealth> {
    if (mcpFabricMockForced()) {
      return { id: "anythingmcp", status: "unconfigured", detail: "probe skipped under test/mock flag" };
    }
    const endpoints = [process.env.PAO_ANYTHINGMCP_URL, process.env.ANYTHINGMCP_BASE_URL, "http://127.0.0.1:18080", "http://127.0.0.1:8088"].filter((u): u is string => Boolean(u));
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const res = await fetch(endpoint.replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(800) });
        if (res.ok) return { id: "anythingmcp", status: "healthy", latencyMs: Date.now() - started, detail: "AnythingMCP healthy at discovered endpoint" };
      } catch {
        // try next
      }
    }
    return { id: "anythingmcp", status: "unconfigured", detail: "AnythingMCP not discovered; set PAO_ANYTHINGMCP_URL" };
  }
  async execute(): Promise<{ ok: boolean; payload: unknown }> {
    const health = await this.probe();
    if (health.status !== "healthy") throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP is unavailable; failing closed");
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "live AnythingMCP execute requires a healthy bridge; tests use the mock adapter");
  }
}

export function defaultAdapters(): FabricAdapter[] {
  return [new AnythingMcpHttpAdapter(), new MockAnythingMcpAdapter()];
}
