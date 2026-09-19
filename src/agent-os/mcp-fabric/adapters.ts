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
  readiness?(): Promise<{ status: "ready" | "unconfigured" | "unavailable" | "auth_failed"; latencyMs?: number; detail?: string }>;
  execute(input: { tool: string; args: Record<string, unknown>; credentialHeader?: string; correlationId?: string }): Promise<{ ok: boolean; payload: unknown; httpStatus?: number; durationMs?: number }>;
  discover?(credentialHeader?: string): Promise<Array<Record<string, unknown>>>;
  configuredBase?(): string | undefined;
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
  async readiness(): Promise<{ status: "ready" | "unconfigured" | "unavailable" | "auth_failed"; latencyMs?: number; detail?: string }> {
    return { status: "ready", latencyMs: 0, detail: "mock adapter ready" };
  }
  async execute(input: { tool: string; args: Record<string, unknown> }): Promise<{ ok: boolean; payload: unknown; httpStatus?: number; durationMs?: number }> {
    const started = Date.now();
    if (input.tool.includes("track") || input.tool.includes("shipment")) {
      return { ok: true, payload: { tracking: String(input.args.tracking_number ?? "1Z999"), status: "in_transit", eta: "2026-09-22" }, httpStatus: 200, durationMs: Date.now() - started };
    }
    if (input.tool.includes("order")) {
      return { ok: true, payload: { id: input.args.id ?? "ord_1", tracking_number: "1Z999AA10123456784", email: "ada@example.com", token: "sk-live-should-drop" }, httpStatus: 200, durationMs: Date.now() - started };
    }
    if (input.tool.includes("select") || input.args.sql) {
      return { ok: true, payload: { rows: [{ sku: "A-1", qty: 12 }], truncated: false }, httpStatus: 200, durationMs: Date.now() - started };
    }
    return { ok: true, payload: { echo: input.tool, ok: true, email: "user@example.com" }, httpStatus: 200, durationMs: Date.now() - started };
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

const MAX_RESPONSE_BYTES = 1_048_576;

function invalidResponse(): never {
  throw new McpFabricError("SCHEMA_INVALID", 502, "Invalid AnythingMCP protocol response");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rpcEnvelope(text: string, id: string): Record<string, unknown> | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalidResponse(); }
  if (!object(value) || value.jsonrpc !== "2.0") return invalidResponse();
  // Streamable HTTP may interleave notifications before the response.
  if (typeof value.method === "string" && !("id" in value)) return null;
  if (value.id !== id || ("error" in value) === ("result" in value)) return invalidResponse();
  if ("error" in value) {
    if (!object(value.error) || typeof value.error.code !== "number") return invalidResponse();
    const code = value.error.code;
    const message = String(value.error.message ?? "");
    if (code === -32001 || /unauth|forbidden|token|api.?key|requires.*roles/i.test(message)) {
      throw new McpFabricError("CREDENTIAL_DENIED", 403, "AnythingMCP authorization failed");
    }
    if (/not found|unknown tool|does not exist/i.test(message)) {
      throw new McpFabricError("NOT_FOUND", 404, "AnythingMCP tool not found");
    }
    if (code === -32602) throw new McpFabricError("SCHEMA_INVALID", 400, "AnythingMCP rejected tool arguments");
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 502, "AnythingMCP protocol call failed", { mcpCode: code });
  }
  if (!object(value.result)) return invalidResponse();
  return value;
}

async function readRpc(res: Response, id: string): Promise<Record<string, unknown>> {
  if (!res.body) return invalidResponse();
  if (Number(res.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await res.body.cancel();
    return invalidResponse();
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  let text = "";
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return invalidResponse();
      text += decoder.decode(part.value, { stream: true });
      if (sse) {
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(text))) {
          const frame = text.slice(0, match.index);
          text = text.slice(match.index + match[0].length);
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data) {
            const envelope = rpcEnvelope(data, id);
            if (envelope) return envelope;
          }
        }
      }
    }
    text += decoder.decode();
    if (sse) return invalidResponse();
    return rpcEnvelope(text, id) ?? invalidResponse();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function unwrapToolsCall(rpc: Record<string, unknown> | null): unknown {
  if (!rpc) throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP returned an empty MCP response");
  const result = rpc.result as Record<string, unknown>;
  if (result && result.isError === true) {
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP tool returned isError");
  }
  if (object(result?.structuredContent)) return result.structuredContent;
  if (object(result?.structured)) return result.structured;
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
    if (texts.length > 1) return { content: texts.map(parseJsonish) };
    if (content.length === 0) return { content: [] };
  }
  return invalidResponse();
}

/**
 * Official AnythingMCP contract (HelpCode-ai/anythingmcp):
 *   GET  {base}/health     — liveness, no auth
 *   POST {base}/mcp        — Streamable HTTP JSON-RPC (tools/call)
 * There is no REST /execute path. Keep that detail inside this adapter.
 */
export class AnythingMcpHttpAdapter implements FabricAdapter {
  readonly id = "anythingmcp" as const;

  constructor(
    private readonly extraEndpoints: string[] = [],
    private readonly timeouts: AnythingMcpAdapterTimeouts = {},
  ) {}

  private probeMs(): number { return this.timeouts.probeMs ?? 2500; }
  private executeMs(): number { return this.timeouts.executeMs ?? 15000; }

  configuredBase(): string | undefined {
    const extra = this.extraEndpoints.map((u) => u.trim().replace(/\/+$/, "")).find(Boolean);
    const raw = extra || anythingMcpBaseUrl();
    if (!raw) return undefined;
    try {
      const url = new URL(raw);
      if (url.username || url.password || url.search || url.hash ||
          !["http:", "https:"].includes(url.protocol) ||
          (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw new Error();
      }
      return url.href.replace(/\/+$/, "");
    } catch { throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "Invalid AnythingMCP base URL; use HTTPS or loopback HTTP"); }
  }

  private shouldProbeNetwork(): boolean {
    if (this.extraEndpoints.length > 0) return true;
    if (!this.configuredBase()) return false;
    if (anythingMcpLiveRequested()) return true;
    if (mcpFabricMockForced()) return false;
    return true;
  }

  async probe(): Promise<AdapterHealth> {
    let base: string | undefined;
    try { base = this.configuredBase(); }
    catch { return { id: "anythingmcp", status: "unhealthy", configured: true, detail: "Invalid AnythingMCP base URL" }; }
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
      const res = await fetch(base + "/health", { signal: AbortSignal.timeout(this.probeMs()), redirect: "error" });
      const latencyMs = Date.now() - started;
      await res.body?.cancel();
      if (res.status === 401 || res.status === 403) {
        return { id: "anythingmcp", status: "auth_failed", configured: true, endpoint: publicOrigin(base), latencyMs, detail: "AnythingMCP health returned HTTP " + res.status };
      }
      if (res.ok) {
        return {
          id: "anythingmcp",
          status: "healthy",
          configured: true,
          endpoint: publicOrigin(base),
          latencyMs,
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

  async readiness(): Promise<{ status: "ready" | "unconfigured" | "unavailable" | "auth_failed"; latencyMs?: number; detail?: string }> {
    const health = await this.probe();
    if (health.status !== "healthy") {
      const mapped = health.status === "auth_failed" ? "auth_failed" : health.status === "unconfigured" ? "unconfigured" : "unavailable";
      return { status: mapped, latencyMs: health.latencyMs, detail: health.detail };
    }
    const base = this.configuredBase();
    if (!base) return { status: "unconfigured", detail: "AnythingMCP not configured" };
    const authHeader = this.bearer();
    const started = performance.now();
    try {
      const sessionId = await this.ensureSession(base, authHeader);
      await this.mcpRpc(base, authHeader, { method: "tools/list", params: {} }, sessionId);
      return { status: "ready", latencyMs: performance.now() - started, detail: "AnythingMCP /mcp ready" };
    } catch (err) {
      const status = (err instanceof McpFabricError && err.code === "CREDENTIAL_DENIED") ? "auth_failed" : "unavailable";
      return { status, latencyMs: performance.now() - started, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(input: { tool: string; args: Record<string, unknown>; credentialHeader?: string; correlationId?: string }): Promise<{ ok: boolean; payload: unknown; httpStatus?: number; durationMs?: number }> {
    const base = this.configuredBase();
    if (!base) throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP is not configured; set PAO_ANYTHINGMCP_URL");
    const health = await this.probe();
    if (health.status !== "healthy") {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP is unavailable (" + health.status + ")", { status: health.status, detail: health.detail });
    }
    const authHeader = this.bearer(input.credentialHeader);
    try {
      const sessionId = await this.ensureSession(base, authHeader, input.correlationId);
      const rpc = await this.mcpRpc(base, authHeader, {
        method: "tools/call",
        params: { name: input.tool, arguments: input.args ?? {} },
      }, sessionId, input.correlationId);
      const payload = unwrapToolsCall(rpc.body);
      if (authHeader && JSON.stringify(payload).includes(authHeader.slice(7))) {
        throw new McpFabricError("SECRET_IN_RESPONSE", 502, "Runtime credential reflected by upstream; response withheld");
      }
      return { ok: true, payload, httpStatus: rpc.status, durationMs: rpc.durationMs };
    } catch (err) {
      if (err instanceof McpFabricError) throw err;
      if (isAbortError(err)) throw new McpFabricError("ADAPTER_UNAVAILABLE", 504, "AnythingMCP tools/call timed out", { status: "timeout" });
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP tools/call failed");
    }
  }

  private bearer(explicit?: string): string | undefined {
    const token = anythingMcpTransportToken();
    const header = explicit ?? (token ? "Bearer " + token : undefined);
    if (header !== undefined && !/^Bearer [A-Za-z0-9._~+/=-]+$/.test(header)) {
      throw new McpFabricError("CREDENTIAL_DENIED", 403, "Invalid AnythingMCP bearer credential");
    }
    return header;
  }

  async discover(credentialHeader?: string): Promise<Array<Record<string, unknown>>> {
    const base = this.configuredBase();
    if (!base) throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP not configured");
    const auth = this.bearer(credentialHeader);
    try {
      const sessionId = await this.ensureSession(base, auth);
      const response = await this.mcpRpc(base, auth, { method: "tools/list", params: {} }, sessionId);
      const result = response.body?.result as Record<string, unknown>;
      if (!Array.isArray(result?.tools) || !result.tools.every(t => object(t) && typeof t.name === "string" && object(t.inputSchema))) return invalidResponse();
      const names = result.tools.map(t => (t as Record<string, unknown>).name);
      if (new Set(names).size !== names.length) throw new McpFabricError("SCHEMA_INVALID", 409, "Ambiguous upstream tool names");
      return result.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, ...(object(t.outputSchema) ? { outputSchema: t.outputSchema } : {}), annotations: t.annotations }));
    } catch (error) {
      if (error instanceof McpFabricError) throw error;
      throw new McpFabricError("ADAPTER_UNAVAILABLE", isAbortError(error) ? 504 : 503, "AnythingMCP discovery unavailable");
    }
  }

  private async ensureSession(base: string, authHeader: string | undefined, correlationId?: string): Promise<string | undefined> {
      const initialized = await this.mcpRpc(base, authHeader, {
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "pao-mcp-fabric", version: "20.96" },
        },
      }, undefined, correlationId);
      const result = initialized.body?.result as Record<string, unknown>;
      if (result?.protocolVersion !== "2025-03-26" || !object(result.capabilities) || !object(result.serverInfo)) return invalidResponse();
      await this.mcpRpc(base, authHeader, { method: "notifications/initialized", notification: true }, initialized.sessionId, correlationId);
      return initialized.sessionId;
  }

  private async mcpRpc(
    base: string,
    authHeader: string | undefined,
    input: { method: string; params?: unknown; notification?: boolean },
    sessionId?: string,
    correlationId?: string,
  ): Promise<{ body: Record<string, unknown> | null; status: number; durationMs: number; sessionId?: string }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    };
    if (authHeader) headers.authorization = authHeader;
    if (sessionId) headers["mcp-session-id"] = sessionId;
    if (correlationId && /^[A-Za-z0-9_-]{1,80}$/.test(correlationId)) headers["x-request-id"] = correlationId;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method: input.method };
    if (!input.notification) payload.id = crypto.randomUUID();
    if (input.params !== undefined) payload.params = input.params;
    const started = performance.now();
    const res = await fetch(base.replace(/\/+$/, "") + "/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.executeMs()),
      redirect: "error",
    });
    const sid = res.headers.get("mcp-session-id");
    if (!res.ok) await res.body?.cancel();
    if (res.status === 401 || res.status === 403) {
      throw new McpFabricError("CREDENTIAL_DENIED", 403, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    if (res.status >= 500) {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    if (res.status === 404) throw new McpFabricError("NOT_FOUND", 404, "AnythingMCP endpoint not found");
    if (res.status === 400 || res.status === 422) throw new McpFabricError("SCHEMA_INVALID", 400, "AnythingMCP rejected the request");
    if (input.notification && (res.status === 202 || res.status === 204 || res.status === 200)) {
      await res.body?.cancel();
      return { body: null, status: res.status, durationMs: performance.now() - started };
    }
    if (!res.ok) {
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "AnythingMCP MCP endpoint returned HTTP " + res.status);
    }
    const body = await readRpc(res, String(payload.id));
    return { body, status: res.status, durationMs: performance.now() - started, sessionId: sid ?? undefined };
  }
}

export function defaultAdapters(): FabricAdapter[] {
  return [new AnythingMcpHttpAdapter(), new MockAnythingMcpAdapter()];
}
