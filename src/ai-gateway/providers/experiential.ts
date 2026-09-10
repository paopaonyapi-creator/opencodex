/**
 * Pao AI Gateway — Experiential provider adapter.
 *
 * Integration boundary (do not erode):
 *  - Experiential is an INDEPENDENT service reached over its OpenAI-compatible
 *    HTTP API. No upstream Python module is imported into this runtime. The
 *    upstream is Apache-2.0 (verified), so there is no licensing obstacle — the
 *    isolation is an architectural choice, not a legal one: upstream ships on its
 *    own cadence with its own dependency tree, and importing across that boundary
 *    would couple this repository to internals the project does not version as API.
 *  - The pinned upstream version lives in config/ai-gateway/upstream.lock.yaml and
 *    is checked at boot, because a silent upstream upgrade would change routing
 *    behaviour underneath a running system.
 *  - Auth is a gateway key, read per call from the environment and never logged,
 *    never returned, and never placed in an error message.
 *
 * Wire surface used (OpenAI-compatible, per upstream README):
 *   GET  /v1/models
 *   POST /v1/chat/completions
 *
 * Every request carries a correlation id so a route decision can be tied to the
 * upstream's own telemetry. Experiential can ingest traces for router optimization;
 * this adapter is the only place that talks to it.
 */

import { resolveApiKey } from "../config";
import type {
  GatewayProviderConfig,
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderHealth,
} from "../types";
import type { ModelInfo, ModelProvider } from "./interface";
import { randomUUID } from "node:crypto";

export interface ExperientialAdapterOptions {
  readonly config: GatewayProviderConfig;
  /** Transport seam so adapter tests never open a socket. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Credential seam; production reads the configured env var. */
  readonly apiKey?: () => string | undefined;
}

export class ExperientialProvider implements ModelProvider {
  readonly id: string;
  readonly type = "experiential" as GatewayProviderConfig["type"];
  private readonly baseUrl: string;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: () => string | undefined;

  constructor(options: ExperientialAdapterOptions) {
    const { config } = options;
    this.id = config.id;
    this.apiKeyEnv = config.apiKeyEnv;
    // Trailing slashes are stripped once here so every path join is unambiguous.
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:8000/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.apiKey = options.apiKey ?? (() => resolveApiKey(this.apiKeyEnv));
  }

  /**
   * A local gateway may legitimately run without a key during setup, but a remote
   * one must never be called unauthenticated — an unauthenticated request to a
   * remote gateway is a misconfiguration that should fail closed, not a request
   * that quietly returns 401 later.
   */
  isConfigured(): boolean {
    if (this.isLocalEndpoint()) return true;
    return Boolean(this.apiKey());
  }

  private isLocalEndpoint(): boolean {
    return this.baseUrl.includes("127.0.0.1") || this.baseUrl.includes("localhost") || this.baseUrl.includes("[::1]");
  }

  private headers(correlationId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Pao-Correlation-Id": correlationId,
    };
    const key = this.apiKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) return [];
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}/models`, {
        headers: this.headers(randomUUID()),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { data?: { id: string; owned_by?: string }[] };
      return (data.data ?? []).map((m) => ({ id: m.id, providerId: this.id, owned_by: m.owned_by }));
    } catch {
      return [];
    }
  }

  /**
   * Send a chat completion through the gateway.
   *
   * Errors are normalized onto codes the router's fallback policy already
   * understands (provider_429, provider_5xx, provider_timeout, auth_failure),
   * because a distinct vocabulary here would silently disable fallback for
   * gateway requests only.
   */
  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const correlationId = randomUUID();
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: false,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.tools) body.tools = request.tools;
    if (request.responseFormat) body.response_format = request.responseFormat;

    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(correlationId),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // A timeout is not a generic failure: it is the case where the request may
      // have been received and charged. It gets its own code so the caller can
      // decide, and so the circuit breaker treats it as degraded rather than dead.
      const isAbort = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      throw Object.assign(
        new Error(isAbort ? `Experiential gateway timed out after ${this.timeoutMs}ms` : "Experiential gateway unreachable"),
        { code: isAbort ? "provider_timeout" : "provider_unreachable", correlationId },
      );
    }

    if (!resp.ok) {
      const status = resp.status;
      if (status === 401 || status === 403) {
        // Auth failures are NOT fallback-eligible and must never loop: a wrong key
        // will still be wrong on the next attempt.
        throw Object.assign(new Error("Experiential gateway rejected the credential"), {
          code: "auth_failure",
          correlationId,
        });
      }
      if (status === 429) {
        throw Object.assign(new Error("Experiential gateway rate limited"), { code: "provider_429", correlationId });
      }
      if (status >= 500) {
        throw Object.assign(new Error(`Experiential gateway error: ${status}`), { code: "provider_5xx", correlationId });
      }
      const text = await resp.text().catch(() => "");
      // The response body is included, but it can echo the request URL; the caller
      // runs it through the secret redactor before it reaches a log or a trace.
      throw Object.assign(new Error(`Experiential gateway error ${status}: ${text.slice(0, 200)}`), {
        code: "provider_4xx",
        correlationId,
      });
    }

    return (await resp.json()) as NormalizedChatResponse;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return {
        providerId: this.id,
        healthy: false,
        lastCheckedAt: new Date().toISOString(),
        lastError: `Credential env var ${this.apiKeyEnv} is not set`,
      };
    }
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}/models`, {
        headers: this.headers(randomUUID()),
        signal: AbortSignal.timeout(5_000),
      });
      return {
        providerId: this.id,
        healthy: resp.ok,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        ...(resp.ok ? {} : { lastError: `HTTP ${resp.status}` }),
      };
    } catch (error) {
      return {
        providerId: this.id,
        healthy: false,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /** Exposed for the boot-time upstream check and the dashboard. Never a secret. */
  describeEndpoint(): { id: string; baseUrl: string; local: boolean; credentialConfigured: boolean } {
    return {
      id: this.id,
      baseUrl: this.baseUrl,
      local: this.isLocalEndpoint(),
      credentialConfigured: Boolean(this.apiKey()),
    };
  }
}

