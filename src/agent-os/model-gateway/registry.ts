/**
 * Phase 20.85 — Model and Capability Registry
 * Normalizes providers, model families, hardware endpoints, and pricing.
 */

import type {
  ModelDefinition,
  ProviderDefinition,
  RouteGroupDefinition,
} from "./types";

export class CapabilityRegistry {
  private models = new Map<string, ModelDefinition>();
  private providers = new Map<string, ProviderDefinition>();
  private routeGroups = new Map<string, RouteGroupDefinition>();

  constructor() {
    this.seedDefaults();
  }

  public registerProvider(provider: ProviderDefinition): void {
    this.providers.set(provider.id, { ...provider });
  }

  public registerModel(model: ModelDefinition): void {
    this.models.set(model.id, { ...model });
  }

  public registerRouteGroup(route: RouteGroupDefinition): void {
    this.routeGroups.set(route.routeGroup, { ...route });
  }

  public getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  public getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  public getRouteGroup(group: string): RouteGroupDefinition | undefined {
    return this.routeGroups.get(group);
  }

  public listModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  public listProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  public listRouteGroups(): RouteGroupDefinition[] {
    return Array.from(this.routeGroups.values());
  }

  public hasCapabilities(modelId: string, required: string[]): boolean {
    const model = this.models.get(modelId);
    if (!model) return false;
    return required.every((req) => model.capabilities.includes(req));
  }

  public isLocalEndpoint(modelId: string): boolean {
    const model = this.models.get(modelId);
    if (!model) return false;
    if (model.isLocal) return true;
    const provider = this.providers.get(model.providerId);
    return Boolean(provider?.isLocal);
  }

  public getModelFamily(modelId: string): string {
    const model = this.models.get(modelId);
    return model?.modelFamily ?? "unknown";
  }

  private seedDefaults(): void {
    // Providers
    this.registerProvider({
      id: "anthropic",
      name: "Anthropic",
      endpointUrl: "https://api.anthropic.com/v1",
      isLocal: false,
      healthStatus: "healthy",
      rateLimitRpm: 1000,
    });

    this.registerProvider({
      id: "openai",
      name: "OpenAI",
      endpointUrl: "https://api.openai.com/v1",
      isLocal: false,
      healthStatus: "healthy",
      rateLimitRpm: 2000,
    });

    this.registerProvider({
      id: "google",
      name: "Google Gemini",
      endpointUrl: "https://generativelanguage.googleapis.com/v1",
      isLocal: false,
      healthStatus: "healthy",
      rateLimitRpm: 1500,
    });

    this.registerProvider({
      id: "deepseek",
      name: "DeepSeek",
      endpointUrl: "https://api.deepseek.com/v1",
      isLocal: false,
      healthStatus: "healthy",
      rateLimitRpm: 1000,
    });

    this.registerProvider({
      id: "ollama",
      name: "Local Ollama Runtime",
      endpointUrl: "http://127.0.0.1:11434",
      isLocal: true,
      healthStatus: "healthy",
      rateLimitRpm: 10000,
    });

    // Models
    this.registerModel({
      id: "anthropic/claude-3-7-sonnet",
      providerId: "anthropic",
      modelName: "claude-3-7-sonnet",
      modelFamily: "claude",
      capabilities: ["text.chat", "coding", "structured_output", "vision", "reasoning"],
      contextWindow: 200000,
      isLocal: false,
      pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "anthropic/claude-3-5-haiku",
      providerId: "anthropic",
      modelName: "claude-3-5-haiku",
      modelFamily: "claude",
      capabilities: ["text.chat", "coding", "structured_output"],
      contextWindow: 200000,
      isLocal: false,
      pricing: { inputPerMillion: 0.8, outputPerMillion: 4.0, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "openai/gpt-4o",
      providerId: "openai",
      modelName: "gpt-4o",
      modelFamily: "gpt-4",
      capabilities: ["text.chat", "coding", "structured_output", "vision", "reasoning"],
      contextWindow: 128000,
      isLocal: false,
      pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "openai/gpt-4o-mini",
      providerId: "openai",
      modelName: "gpt-4o-mini",
      modelFamily: "gpt-4",
      capabilities: ["text.chat", "coding", "structured_output"],
      contextWindow: 128000,
      isLocal: false,
      pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "google/gemini-2.0-flash",
      providerId: "google",
      modelName: "gemini-2.0-flash",
      modelFamily: "gemini",
      capabilities: ["text.chat", "coding", "structured_output", "vision"],
      contextWindow: 1000000,
      isLocal: false,
      pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "deepseek/deepseek-coder",
      providerId: "deepseek",
      modelName: "deepseek-coder",
      modelFamily: "deepseek",
      capabilities: ["text.chat", "coding", "structured_output"],
      contextWindow: 64000,
      isLocal: false,
      pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "ollama/deepseek-coder-v2",
      providerId: "ollama",
      modelName: "deepseek-coder-v2",
      modelFamily: "deepseek",
      capabilities: ["text.chat", "coding", "structured_output"],
      contextWindow: 64000,
      isLocal: true,
      pricing: { inputPerMillion: 0.0, outputPerMillion: 0.0, status: "known" },
      status: "approved",
    });

    this.registerModel({
      id: "ollama/llama3.3",
      providerId: "ollama",
      modelName: "llama3.3",
      modelFamily: "llama",
      capabilities: ["text.chat", "coding", "structured_output"],
      contextWindow: 128000,
      isLocal: true,
      pricing: { inputPerMillion: 0.0, outputPerMillion: 0.0, status: "known" },
      status: "approved",
    });

    // Route groups
    this.registerRouteGroup({
      routeGroup: "coding-high",
      policyType: "quality_first",
      candidates: [
        "anthropic/claude-3-7-sonnet",
        "openai/gpt-4o",
        "deepseek/deepseek-coder",
      ],
      requiredCapabilities: ["coding", "structured_output"],
      maxBudgetUsd: 0.5,
    });

    this.registerRouteGroup({
      routeGroup: "coding-cheap",
      policyType: "cost_first",
      candidates: [
        "deepseek/deepseek-coder",
        "anthropic/claude-3-5-haiku",
        "openai/gpt-4o-mini",
        "ollama/deepseek-coder-v2",
      ],
      requiredCapabilities: ["coding"],
      maxBudgetUsd: 0.05,
    });

    this.registerRouteGroup({
      routeGroup: "private-local",
      policyType: "local_first",
      candidates: [
        "ollama/deepseek-coder-v2",
        "ollama/llama3.3",
      ],
      requiredCapabilities: ["coding"],
      localOnly: true,
      maxBudgetUsd: 0.0,
    });

    this.registerRouteGroup({
      routeGroup: "reviewer-independent",
      policyType: "quality_first",
      candidates: [
        "anthropic/claude-3-7-sonnet",
        "openai/gpt-4o",
        "google/gemini-2.0-flash",
      ],
      requiredCapabilities: ["coding", "structured_output"],
      maxBudgetUsd: 0.25,
    });

    this.registerRouteGroup({
      routeGroup: "fast-decision",
      policyType: "cost_first",
      candidates: [
        "anthropic/claude-3-5-haiku",
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash",
      ],
      requiredCapabilities: ["text.chat"],
      maxBudgetUsd: 0.01,
    });
  }
}
