import { anythingMcpBaseUrl, anythingMcpLiveRequested, anythingMcpTransportToken, mcpFabricMockForced } from "./flags";
import { McpFabricError } from "./types";

export type AdapterHealthStatus =
  | "healthy"
  | "unconfigured"
  | "unhealthy"
  | "timeout"
  | "auth_failed"
  | "offline"
  | "degraded";

export interface AdapterHealth {
  id: "anythingmcp" | "mock";
  status: AdapterHealthStatus;
  configured: boolean;
  detail: string;
  version?: string;
  latencyMs?: number;
  endpoint?: string;
}

export interface FabricAdapter {
  id: "anythingmcp" | "mock";
  probe(): Promise<AdapterHealth>;
  execute(input: { tool: string; args: Record<string, unknown>; credentialHeader?: string }): Promise<{ ok: boolean; payload: unknown }>;
}

export class MockAnythingMcpAdapter implements FabricAdapter {
  readonly id = "mock" as const;
  async probe(): Promise<AdapterHealth> {
    return {
      id: "mock",
      status: "healthy",
      configured: true,
      detail: "deterministic mock connector engine for tests; not a live AnythingMCP",
    };
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

export interface AnythingMcpAdapterTimeouts {
  probeMs?: number;
  executeMs?: number;
}

function publicOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.origin;
  } catch {
    return "configured";
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = String((err as { name?: string }).name ?? "");
  const msg = err instanceof Error ? err.message : String(err);
  return name === "TimeoutError" || name === "AbortError" || /aborted|timeout/i.test(msg);
}

function parseJsonish(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }
  return trimmed;
}

function parseMcpHttpBody(text: string, contentType: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const sse = contentType.includes("text/event-stream") || /^(?:event:|data:|id:)/m.test(trimmed);
  if (sse) {
    const chunks: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith("data:")) chunks.push(line.slice(5).trim());
    }
    const last = chunks.filter(Boolean).at(-1);
    if (!last) return null;
    const parsed = parseJsonish(last);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { result: parsed };
  }
  const parsed = parseJsonish(trimmed);
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { result: parsed };
}

function unwrapToolsCall(rpc: Record<string, unknown> | null): unknown {
  if (!rpc) throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP returned an empty MCP response");
  const err = rpc.error as { code?: number; message?: string } | undefined;
  if (err) {
    const message = String(err.message ?? "MCP error");
    if (/unauth|forbidden|invalid token|api key/i.test(message) || err.code === -32001) {
      throw new McpFabricError("CREDENTIAL_DENIED", 403, "AnythingMCP rejected the MCP credential");
    }
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP tools/call failed: " + message, { mcpCode: err.code });
  }
  const result = (rpc.result ?? rpc) as Record<string, unknown>;
  if (result && result.isError === true) {
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP tool returned isError");
  }
  const content = result?.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((item): item is { type?: string; text?: string } => Boolean(item) && typeof item === "object")
      .map((item) => item.text)
      .filter((text): text is string => typeof text === "string");
    if (texts.length === 1) {
      const parsed = parseJsonish(texts[0]!);
      return parsed;
    }
    if (texts.length > 1) return { content: texts };
  }
  if (result?.structuredContent) return result.structuredContent;
  if (result?.structured) return result.structured;
  return result;
}

/**
 * Official AnythingMCP contract (HelpCode-ai/anythingmcp):
 *   GET  {base}/health     — liveness, no auth
 *   POST {base}/mcp        — Streamable HTTP JSON-RPC (tools/call)
 * There is no REST /execute path. Keep that detail inside this adapter.
 */
export class AnythingMcpHttpAdapter implements FabricAdapter {
  readonly id = "anythingmcp" as const;
  private sessionId: string | null = null;
  private lastHealthyBase: string | null = null;

  constructor(
    private readonly extraEndpoints: string[] = [],
    private readonly timeouts: AnythingMcpAdapterTimeouts = {},
  ) {}

  private probeMs(): number { return this.timeouts.probeMs ?? 2500; }
  private executeMs(): number { return this.timeouts.executeMs ?? 15000; }

  private configuredBase(): string | undefined {
    const extra = this.extraEndpoints.map((u) => u.trim().replace(/\/+$/, "")).find(Boolean);
    return extra || anythingMcpBaseUrl();
  }

  private shouldProbeNetwork(): boolean {
    if (this.extraEndpoints.length > 0) return true;
    if (!this.configuredBase()) return false;
    if (anythingMcpLiveRequested()) return true;
    if (mcpFabricMockForced()) return false;
    return true;
  }

  async probe(): Promise<AdapterHealth> {
    const base = this.configuredBase();
    if (!base) {
      return { id: "anythingmcp", status: "unconfigured", configured: false, detail: "AnythingMCP not configured; set PAO_ANYTHINGMCP_URL" };
    }
    if (!this.shouldProbeNetwork()) {
      return {
        id: "anythingmcp",
        status: "unconfigured",
        configured: true,
        endpoint: publicOrigin(base),
        detail: "live probe skipped under test unless PAO_MCP_FABRIC_LIVE=1 or LIVE_ANYTHINGMCP=1",
      };
    }
    const started = Date.now();
    try {
      const res = await fetch(base + "/health", { signal: AbortSignal.timeout(this.probeMs()) });
      const latencyMs = Date.now() - started;
      const body = await res.text().catch(() => "");
      const parsed = parseJsonish(body);
      const version = parsed && typeof parsed === "object" ? String((parsed as { version?: unknown }).version ?? (parsed as { status?: unknown }).status ?? "") : body.slice(0, 48);
      if (res.status === 401 || res.status === 403) {
        return { id: "anythingmcp", status: "auth_failed", configured: true, endpoint: publicOrigin(base), latencyMs, detail: "AnythingMCP health returned HTTP " + res.status };
      }
      if (res.ok) {
        this.lastHealthyBase = base;
        return {
          id: "anythingmcp",
          status: "healthy",
          configured: true,
          endpoint: publicOrigin(base),
          latencyMs,
          version: version || "ok",
          detail: "AnythingMCP /health 2xx",
        };
      }
      return { id: "anythingmcp", status: "unhealthy", configured: true, endpoint: publicOrigin(base), latencyMs, detail: "AnythingMCP /health HTTP " + res.status };
    } catch (err) {
      if (isAbortError(err)) {
        return { id: "anythingmcp", status: "timeout", configured: true, endpoint: publicOrigin(base), detail: "AnythingMCP /health timed out after " + this.probeMs() + "ms" };
      }
      return { id: "anythingmcp", status: "unhealthy", configured: true, endpoint: publicOrigin(base), detail: "AnythingMCP /health unreachable" };
    }
  }

  async execute(input: { tool: string; args: Record<string, unknown>; credentialHeader?: string }): Promise<{ ok: boolean; payload: unknown }> {
    const base = this.configuredBase();
    if (!base) throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP is not configured; set PAO_ANYTHINGMCP_URL");
    const health = await this.probe();
    if (health.status !== "healthy") {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP is unavailable (" + health.status + ")", { status: health.status, detail: health.detail });
    }
    const authHeader = input.credentialHeader || (anythingMcpTransportToken() ? "Bearer " + anythingMcpTransportToken() : undefined);
    try {
      await this.ensureSession(base, authHeader);
      const rpc = await this.mcpRpc(base, authHeader, {
        method: "tools/call",
        params: { name: input.tool, arguments: input.args ?? {} },
      });
      const payload = unwrapToolsCall(rpc);
      return { ok: true, payload };
    } catch (err) {
      if (err instanceof McpFabricError) throw err;
      if (isAbortError(err)) throw new McpFabricError("ADAPTER_UNAVAILABLE", 504, "AnythingMCP tools/call timed out");
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP tools/call failed");
    }
  }

  private async ensureSession(base: string, authHeader: string | undefined): Promise<void> {
    if (this.sessionId && this.lastHealthyBase === base) return;
    this.sessionId = null;
    try {
      await this.mcpRpc(base, authHeader, {
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "pao-mcp-fabric", version: "20.96" },
        },
      });
      await this.mcpRpc(base, authHeader, { method: "notifications/initialized", notification: true });
    } catch (err) {
      if (err instanceof McpFabricError && (err.code === "CREDENTIAL_DENIED" || err.httpStatus === 504)) throw err;
      // Stateless AnythingMCP can accept tools/call without a session.
      this.sessionId = null;
    }
  }

  private async mcpRpc(
    base: string,
    authHeader: string | undefined,
    input: { method: string; params?: unknown; notification?: boolean },
  ): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    };
    if (authHeader) headers.authorization = authHeader;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method: input.method };
    if (!input.notification) payload.id = crypto.randomUUID();
    if (input.params !== undefined) payload.params = input.params;
    const res = await fetch(base.replace(/\/+$/, "") + "/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.executeMs()),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 401 || res.status === 403) {
      throw new McpFabricError("CREDENTIAL_DENIED", 403, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    if (res.status >= 500) {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    if (input.notification && (res.status === 202 || res.status === 204 || res.status === 200)) {
      return null;
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    return parseMcpHttpBody(text, res.headers.get("content-type") ?? "");
  }
}

export function defaultAdapters(): FabricAdapter[] {
  return [new AnythingMcpHttpAdapter(), new MockAnythingMcpAdapter()];
}
