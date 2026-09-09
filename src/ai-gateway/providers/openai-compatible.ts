/**
 * Pao AI Gateway — OpenAI-compatible provider adapter.
 *
 * Covers OpenRouter, local vLLM/Ollama endpoints, Runpod, and any other
 * endpoint that speaks the OpenAI chat completions wire format.
 */

import { resolveApiKey } from "../config";
import type { GatewayProviderConfig, NormalizedChatRequest, NormalizedChatResponse, ProviderHealth } from "../types";
import type { ModelInfo, ModelProvider } from "./interface";

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly type: GatewayProviderConfig["type"];
  private readonly baseUrl: string;
  private readonly apiKeyEnv: string;

  constructor(config: GatewayProviderConfig) {
    this.id = config.id;
    this.type = config.type;
    this.apiKeyEnv = config.apiKeyEnv;
    this.baseUrl = config.baseUrl ?? "http://127.0.0.1:8001/v1";
  }

  isConfigured(): boolean {
    // Local providers may not need an API key
    if (this.baseUrl.includes("127.0.0.1") || this.baseUrl.includes("localhost")) return true;
    return !!resolveApiKey(this.apiKeyEnv);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const headers: Record<string, string> = {};
      const apiKey = resolveApiKey(this.apiKeyEnv);
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const resp = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { data?: { id: string; owned_by?: string }[] };
      return (data.data ?? []).map(m => ({
        id: m.id,
        providerId: this.id,
        owned_by: m.owned_by,
      }));
    } catch {
      return [];
    }
  }

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

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

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status === 429) throw Object.assign(new Error("Rate limited"), { code: "provider_429" });
      if (status >= 500) throw Object.assign(new Error(`Provider error: ${status}`), { code: "provider_5xx" });
      const text = await resp.text().catch(() => "");
      throw new Error(`Provider ${this.id} error ${status}: ${text.slice(0, 200)}`);
    }

    return (await resp.json()) as NormalizedChatResponse;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const headers: Record<string, string> = {};
      const apiKey = resolveApiKey(this.apiKeyEnv);
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const resp = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      return {
        providerId: this.id,
        healthy: resp.ok,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        lastError: resp.ok ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        providerId: this.id,
        healthy: false,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}
