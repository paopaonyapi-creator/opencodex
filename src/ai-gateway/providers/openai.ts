/**
 * Pao AI Gateway — OpenAI provider adapter.
 */

import { resolveApiKey } from "../config";
import type { GatewayProviderConfig, NormalizedChatRequest, NormalizedChatResponse, ProviderHealth } from "../types";
import type { ModelInfo, ModelProvider } from "./interface";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAIProvider implements ModelProvider {
  readonly id: string;
  readonly type = "openai" as const;
  private readonly baseUrl: string;
  private readonly apiKeyEnv: string;

  constructor(config: GatewayProviderConfig) {
    this.id = config.id;
    this.apiKeyEnv = config.apiKeyEnv;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  isConfigured(): boolean {
    return !!resolveApiKey(this.apiKeyEnv);
  }

  async listModels(): Promise<ModelInfo[]> {
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (!apiKey) return [];
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (!apiKey) throw new Error(`API key not configured for provider ${this.id}`);

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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const status = resp.status;
      const text = await resp.text().catch(() => "");
      if (status === 429) throw Object.assign(new Error("Rate limited"), { code: "provider_429" });
      if (status >= 500) throw Object.assign(new Error(`Provider error: ${status}`), { code: "provider_5xx" });
      throw new Error(`OpenAI API error ${status}: ${text.slice(0, 200)}`);
    }

    return (await resp.json()) as NormalizedChatResponse;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const apiKey = resolveApiKey(this.apiKeyEnv);
      if (!apiKey) return { providerId: this.id, healthy: false, lastCheckedAt: new Date().toISOString(), lastError: "API key not configured" };
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
