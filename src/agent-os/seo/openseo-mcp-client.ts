/**
 * Phase 18 — OpenSEO MCP client (HTTP JSON-RPC transport).
 *
 * Connects to a remote MCP endpoint or a local self-hosted OpenSEO instance,
 * performs capability discovery via tools/list, and maps discovered tool
 * names to normalized internal capabilities. Credentials come only from
 * config/env, are sent only as an Authorization header, and never appear in
 * errors or logs. Upstream payloads are treated as untrusted data.
 */
import {
  SeoAuthenticationError,
  SeoConnectionError,
  SeoConfigurationError,
  SeoRateLimitError,
  SeoProviderError,
} from "./errors";
import type { SeoCapability, SeoProviderHealth } from "./types";

export interface OpenSeoConfig {
  enabled: boolean;
  mode: "mcp" | "local" | "mock";
  mcpUrl?: string;
  localBaseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export const DEFAULT_OPENSEO_CONFIG: OpenSeoConfig = { enabled: false, mode: "mock" };

/** Stable internal capability names; upstream tool names are matched by hint. */
const CAPABILITY_TOOL_HINTS: ReadonlyArray<readonly [SeoCapability, RegExp]> = [
  ["keyword_research", /keyword[_-]?(research|ideas|suggestions|expansion)/i],
  ["keyword_metrics", /keyword[_-]?metrics?|search[_-]?volume/i],
  ["serp_analysis", /serp[_-]?(analysis|results?|analyze|analyses?)|analyz(e|ing)_[_-]?serp/i],
  ["domain_overview", /domain[_-]?(overview|info|analytics?)|domain[_-]?authority/i],
  ["domain_keywords", /domain[_-]?keywords?|organic[_-]?keywords?/i],
  ["competitor_analysis", /competitor[s]?[_-]?(analysis|research|overview)?/i],
  ["serp_competitors", /serp[_-]?competitors?|organic[_-]?competitors?/i],
  ["backlink_overview", /backlink[s]?[_-]?(overview|profile|summary)?/i],
  ["rank_tracking", /rank[_-]?(track(er|ing)?|position)|position[_-]?tracking/i],
  ["saved_keywords", /saved[_-]?keywords?|keyword[_-]?lists?/i],
  ["search_console_performance", /search[_-]?console|gsc[_-]?(performance|queries)/i],
  ["url_inspection", /url[_-]?inspection|inspect[_-]?url/i],
  ["local_search", /local[_-]?(search|pack|seo)/i],
  ["site_audit", /site[_-]?(audit|crawler?|crawl)/i],
  ["ai_visibility", /ai[_-]?(visibility|overview|presence)|ai[_-]?search/i],
  ["analytics", /analytics?[_-]?(overview|report|traffic)/i],
];

export function normalizeCapabilityFromToolName(toolName: string): SeoCapability {
  for (const [capability, pattern] of CAPABILITY_TOOL_HINTS) {
    if (pattern.test(toolName)) return capability;
  }
  return "unknown";
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class OpenSeoMcpClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private nextRequestId = 1;
  private cachedCapabilities: SeoCapability[] | null = null;

  constructor(config: OpenSeoConfig) {
    if (!config.enabled) throw new SeoConfigurationError();
    if (config.mode === "mcp") {
      if (!config.mcpUrl?.trim()) throw new SeoConfigurationError("OPENSEO_MCP_URL is required for mcp mode");
      this.endpoint = config.mcpUrl.trim();
    } else if (config.mode === "local") {
      if (!config.localBaseUrl?.trim()) throw new SeoConfigurationError("OPENSEO_LOCAL_BASE_URL is required for local mode");
      const base = config.localBaseUrl.trim().replace(/\/+$/, "");
      this.endpoint = `${base}/mcp`;
    } else {
      throw new SeoConfigurationError("OpenSeoMcpClient requires mcp or local mode");
    }
    this.apiKey = config.apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /** Raw JSON-RPC 2.0 POST. Errors are mapped to the SEO error hierarchy. */
  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextRequestId++, method, params: params ?? {} }),
        signal: controller.signal,
      });
    } catch (error) {
      throw (error as { name?: string }).name === "AbortError"
        ? new SeoConnectionError("OpenSEO request timed out")
        : new SeoConnectionError(error instanceof Error ? error.message : "OpenSEO request failed");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new SeoAuthenticationError();
    if (res.status === 429) throw new SeoRateLimitError();
    if (!res.ok) throw new SeoProviderError(`OpenSEO returned HTTP ${res.status}`);
    let payload: JsonRpcResponse;
    try {
      payload = await res.json() as JsonRpcResponse;
    } catch {
      throw new SeoProviderError("OpenSEO returned a non-JSON response");
    }
    if (payload.error) {
      throw new SeoProviderError(`OpenSEO JSON-RPC error ${payload.error.code ?? ""}: ${payload.error.message ?? "unknown"}`);
    }
    return payload.result;
  }

  /** MCP tools/list mapped to normalized capabilities (unknown tools ignored). */
  async discoverCapabilities(): Promise<SeoCapability[]> {
    if (this.cachedCapabilities) return [...this.cachedCapabilities];
    const result = await this.call("tools/list") as { tools?: Array<{ name?: unknown }> } | undefined;
    const tools = Array.isArray(result?.tools) ? result!.tools! : [];
    const capabilities = new Set<SeoCapability>();
    for (const tool of tools) {
      if (typeof tool?.name !== "string") continue;
      const capability = normalizeCapabilityFromToolName(tool.name);
      if (capability !== "unknown") capabilities.add(capability);
    }
    this.cachedCapabilities = [...capabilities];
    return [...this.cachedCapabilities];
  }

  /** Call a tool by its UPSTREAM name (from tools/list). Input is validated upstream-side only here. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!/^[-a-zA-Z0-9_]+$/.test(name)) throw new SeoProviderError("invalid upstream tool name");
    const result = await this.call("tools/call", { name, arguments: args }) as
      | { content?: Array<{ type?: unknown; text?: unknown }> }
      | undefined;
    const firstText = Array.isArray(result?.content)
      ? result!.content!.find(part => part?.type === "text" && typeof part.text === "string")?.text
      : undefined;
    if (typeof firstText !== "string") return result ?? null;
    try {
      return JSON.parse(firstText) as unknown;
    } catch {
      return firstText;
    }
  }

  async health(): Promise<SeoProviderHealth> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const capabilities = await this.discoverCapabilities();
      const latencyMs = Date.now() - started;
      const url = new URL(this.endpoint);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
      const publicNoAuthDetected = !loopback && !this.apiKey;
      return {
        provider: "openseo",
        enabled: true,
        status: capabilities.length === 0 ? "degraded" : "healthy",
        connectionMode: "mcp",
        latencyMs,
        capabilities,
        security: {
          status: publicNoAuthDetected ? (loopback ? "warning" : "critical") : "safe",
          publicNoAuthDetected,
          ...(publicNoAuthDetected ? { reason: loopback ? "local endpoint without authentication" : "public endpoint without authentication" } : {}),
        },
        checkedAt,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error instanceof SeoAuthenticationError) {
        return { provider: "openseo", enabled: true, status: "unauthorized", connectionMode: "mcp", latencyMs, capabilities: [], security: { status: "safe", publicNoAuthDetected: false }, checkedAt };
      }
      if (error instanceof SeoConfigurationError) {
        return { provider: "openseo", enabled: true, status: "misconfigured", connectionMode: "mcp", latencyMs: null, capabilities: [], security: { status: "safe", publicNoAuthDetected: false }, checkedAt };
      }
      return { provider: "openseo", enabled: true, status: "offline", connectionMode: "mcp", latencyMs, capabilities: [], security: { status: "safe", publicNoAuthDetected: false }, checkedAt };
    }
  }
}
