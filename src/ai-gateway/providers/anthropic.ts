/**
 * Pao AI Gateway — Anthropic provider adapter.
 */

import { resolveApiKey } from "../config";
import type { GatewayProviderConfig, NormalizedChatRequest, NormalizedChatResponse, NormalizedChoice, NormalizedMessage, ProviderHealth } from "../types";
import type { ModelInfo, ModelProvider } from "./interface";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements ModelProvider {
  readonly id: string;
  readonly type = "anthropic" as const;
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
    // Anthropic doesn't have a public /models endpoint, return empty
    return [];
  }

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (!apiKey) throw new Error(`API key not configured for provider ${this.id}`);

    // Convert OpenAI-style messages to Anthropic format
    const systemMessages = request.messages.filter(m => m.role === "system");
    const nonSystemMessages = request.messages.filter(m => m.role !== "system");

    const body: Record<string, unknown> = {
      model: request.model,
      messages: nonSystemMessages.map(m => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content ?? "",
      })),
      max_tokens: request.maxTokens ?? 4096,
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join("\n");
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;

    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status === 429) throw Object.assign(new Error("Rate limited"), { code: "provider_429" });
      if (status >= 500) throw Object.assign(new Error(`Provider error: ${status}`), { code: "provider_5xx" });
      const text = await resp.text().catch(() => "");
      throw new Error(`Anthropic API error ${status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as {
      id: string;
      model: string;
      content: { type: string; text: string }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    // Normalize Anthropic response to OpenAI shape
    const assistantMessage: NormalizedMessage = {
      role: "assistant",
      content: data.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join(""),
    };

    const choice: NormalizedChoice = {
      index: 0,
      message: assistantMessage,
      finishReason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason,
    };

    return {
      id: data.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: data.model,
      choices: [choice],
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    const apiKey = resolveApiKey(this.apiKeyEnv);
    return {
      providerId: this.id,
      healthy: !!apiKey,
      latencyMs: Date.now() - start,
      lastCheckedAt: new Date().toISOString(),
      lastError: apiKey ? undefined : "API key not configured",
    };
  }
}
