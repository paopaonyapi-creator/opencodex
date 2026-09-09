/**
 * Pao AI Gateway — Gemini provider adapter.
 */

import { resolveApiKey } from "../config";
import type { GatewayProviderConfig, NormalizedChatRequest, NormalizedChatResponse, NormalizedChoice, NormalizedMessage, ProviderHealth } from "../types";
import type { ModelInfo, ModelProvider } from "./interface";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements ModelProvider {
  readonly id: string;
  readonly type = "gemini" as const;
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
      const resp = await fetch(`${this.baseUrl}/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { models?: { name: string }[] };
      return (data.models ?? []).map(m => ({
        id: m.name.replace("models/", ""),
        providerId: this.id,
      }));
    } catch {
      return [];
    }
  }

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (!apiKey) throw new Error(`API key not configured for provider ${this.id}`);

    // Convert OpenAI messages to Gemini format
    const systemInstruction = request.messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n");

    const contents = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content ?? "" }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { maxOutputTokens: request.maxTokens }),
        ...(request.topP !== undefined && { topP: request.topP }),
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const model = request.model;
    const resp = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!resp.ok) {
      const status = resp.status;
      if (status === 429) throw Object.assign(new Error("Rate limited"), { code: "provider_429" });
      if (status >= 500) throw Object.assign(new Error(`Provider error: ${status}`), { code: "provider_5xx" });
      const text = await resp.text().catch(() => "");
      throw new Error(`Gemini API error ${status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map(p => p.text ?? "").join("") ?? "";

    const assistantMessage: NormalizedMessage = {
      role: "assistant",
      content: text,
    };

    const choice: NormalizedChoice = {
      index: 0,
      message: assistantMessage,
      finishReason: candidate?.finishReason === "STOP" ? "stop" : (candidate?.finishReason ?? null),
    };

    const usage = data.usageMetadata;

    return {
      id: `gemini-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [choice],
      usage: usage ? {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      } : undefined,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const apiKey = resolveApiKey(this.apiKeyEnv);
      if (!apiKey) return { providerId: this.id, healthy: false, lastCheckedAt: new Date().toISOString(), lastError: "API key not configured" };
      const resp = await fetch(`${this.baseUrl}/models?key=${apiKey}&pageSize=1`, {
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
