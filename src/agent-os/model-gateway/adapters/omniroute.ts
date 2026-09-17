/**
 * Phase 20.85 — OmniRoute Remote Gateway Adapter
 * Pluggable inference gateway client with protocol translation and error normalization.
 */

import type { CapabilityRegistry } from "../registry";
import type { BudgetGovernanceEngine } from "../budget";
import type { FailureClass, GatewayRequest, ModelDefinition, PolicyEnvelope } from "../types";
import type { AdapterExecutionResult } from "./direct";

export class OmniRouteGatewayAdapter {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly budgetEngine: BudgetGovernanceEngine,
    config?: { baseUrl?: string; apiKey?: string; timeoutMs?: number },
  ) {
    this.baseUrl = config?.baseUrl || process.env.PAO_OMNIROUTE_BASE_URL || "http://127.0.0.1:9090";
    this.apiKey = config?.apiKey || process.env.PAO_OMNIROUTE_API_KEY || "";
    this.timeoutMs = config?.timeoutMs || 30000;
  }

  public async executeCandidate(
    modelId: string,
    request: GatewayRequest,
    envelope: PolicyEnvelope,
  ): Promise<AdapterExecutionResult> {
    const model = this.registry.getModel(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found in registry`);
    }

    const start = performance.now();

    // Protocol translation: format payload for OmniRoute API
    const payload = {
      model: model.modelName,
      provider: model.providerId,
      messages: request.messages || [{ role: "user", content: request.prompt || "" }],
      temperature: request.runtime?.temperature ?? 0.2,
      metadata: {
        requestId: request.requestId,
        routeGroup: envelope.routeGroup,
        policyDecisionId: envelope.policyDecisionId,
        dataClass: envelope.dataClass,
        localOnly: envelope.localOnly,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Validate URL protocol strictly
      const url = new URL("/v1/chat/completions", this.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Invalid protocol in OmniRoute baseUrl: ${url.protocol}`);
      }

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const failureClass = this.classifyError(res.status, errorText);
        const err = new Error(`OmniRoute error ${res.status}: ${errorText}`);
        (err as unknown as { failureClass: FailureClass }).failureClass = failureClass;
        throw err;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const output = data.choices?.[0]?.message?.content ?? "";
      const latencyMs = Math.max(Math.round(performance.now() - start), 1);
      const inputTokens = data.usage?.prompt_tokens ?? Math.max(Math.round(JSON.stringify(payload).length / 4), 10);
      const outputTokens = data.usage?.completion_tokens ?? Math.max(Math.round(output.length / 4), 10);
      const actualCostUsd = this.budgetEngine.calculateCost(model, inputTokens, outputTokens);

      return {
        output,
        structuredOutput: this.tryParseJson(output),
        inputTokens,
        outputTokens,
        actualCostUsd,
        latencyMs,
      };
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        const timeoutErr = new Error(`OmniRoute timed out after ${this.timeoutMs}ms`);
        (timeoutErr as unknown as { failureClass: FailureClass }).failureClass = "timeout";
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  public classifyError(status: number, message: string): FailureClass {
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "authentication";
    if (status === 400) return "invalid_request";
    if (status >= 500 && status < 600) return "provider_unavailable";
    if (message.toLowerCase().includes("timeout")) return "timeout";
    return "transient";
  }

  private tryParseJson(text: string): unknown | undefined {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
