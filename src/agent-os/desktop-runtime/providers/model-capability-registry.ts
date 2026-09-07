// Phase 20.9 — Model Capability Registry
// Declares capabilities per model so Agent Runtime never assumes universal tool/vision support.

import type { ModelCapabilities, ModelInfo } from "../types";

export class ModelCapabilityRegistry {
  private customCapabilities = new Map<string, ModelCapabilities>();

  /**
   * Resolves capabilities for a model by inspecting model identifier or custom declarations.
   */
  resolveCapabilities(modelId: string, providerId = "openai"): ModelCapabilities {
    const custom = this.customCapabilities.get(`${providerId}:${modelId}`);
    if (custom) return custom;

    const lower = modelId.toLowerCase();

    // Default heuristics based on well-known model families
    const isClaude = lower.includes("claude");
    const isGpt4 = lower.includes("gpt-4") || lower.includes("o1") || lower.includes("o3") || lower.includes("gpt-4o");
    const isGemini = lower.includes("gemini");
    const isO1OrO3 = lower.includes("o1") || lower.includes("o3");
    const isReasoning = isO1OrO3 || lower.includes("deepseek-r1") || lower.includes("reasoner") || lower.includes("reasoning");
    const isLocalSmall = lower.includes("qwen") || lower.includes("llama") || lower.includes("mistral") || lower.includes("gemma");

    // Vision support
    const hasVision =
      lower.includes("vision") ||
      lower.includes("gpt-4o") ||
      lower.includes("gemini") ||
      lower.includes("claude-3") ||
      lower.includes("vl");

    // Tool calling support (small local models might not support reliable function calling)
    const hasTools = !isO1OrO3 && (isGpt4 || isClaude || isGemini || lower.includes("tool") || lower.includes("instruct"));

    return {
      tools: hasTools,
      vision: hasVision,
      reasoning: isReasoning,
      structuredOutput: isGpt4 || isClaude || isGemini,
      streaming: true,
      maxContext: isClaude ? 200000 : isGemini ? 1000000 : isGpt4 ? 128000 : 32000,
    };
  }

  registerCustomCapabilities(providerId: string, modelId: string, capabilities: ModelCapabilities): void {
    this.customCapabilities.set(`${providerId}:${modelId}`, capabilities);
  }

  createModelInfo(providerId: string, modelId: string, name?: string): ModelInfo {
    const caps = this.resolveCapabilities(modelId, providerId);
    return {
      id: modelId,
      name: name ?? modelId,
      provider: providerId,
      capabilities: caps,
      contextWindow: caps.maxContext,
    };
  }
}

let defaultCapabilityRegistry: ModelCapabilityRegistry | null = null;
export function getModelCapabilityRegistry(): ModelCapabilityRegistry {
  if (!defaultCapabilityRegistry) {
    defaultCapabilityRegistry = new ModelCapabilityRegistry();
  }
  return defaultCapabilityRegistry;
}
