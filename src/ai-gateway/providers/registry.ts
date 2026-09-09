/**
 * Pao AI Gateway — Provider registry.
 *
 * Instantiates and manages provider adapters from config. Provider failure
 * is isolated — one broken provider cannot crash unrelated providers.
 */

import type { GatewayProviderConfig, ProviderHealth } from "../types";
import type { ModelProvider } from "./interface";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";

/**
 * Create a provider adapter from configuration.
 * Returns null for unsupported provider types rather than throwing.
 */
function createProvider(config: GatewayProviderConfig): ModelProvider | null {
  if (config.enabled === false) return null;

  switch (config.type) {
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "openrouter":
    case "openai-compatible":
      return new OpenAICompatibleProvider(config);
    default:
      return null;
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly healthCache = new Map<string, ProviderHealth>();

  constructor(configs: readonly GatewayProviderConfig[]) {
    for (const config of configs) {
      try {
        const provider = createProvider(config);
        if (provider) {
          this.providers.set(config.id, provider);
        }
      } catch {
        // Provider initialization failure must not crash the registry.
        // Log and continue.
        console.error(`[ai-gateway] Failed to initialize provider: ${config.id}`);
      }
    }
  }

  /** Get a provider by id. Returns undefined if not found or disabled. */
  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  /** List all registered provider ids. */
  listIds(): string[] {
    return [...this.providers.keys()];
  }

  /** List all registered providers. */
  listAll(): ModelProvider[] {
    return [...this.providers.values()];
  }

  /** Check whether a provider id is registered and has a valid configuration. */
  isConfigured(id: string): boolean {
    const p = this.providers.get(id);
    return !!p && p.isConfigured();
  }

  /** Run health checks on all providers. Results are cached. */
  async checkAllHealth(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>();
    const promises = [...this.providers.entries()].map(async ([id, provider]) => {
      try {
        const health = await provider.healthCheck();
        results.set(id, health);
        this.healthCache.set(id, health);
      } catch {
        const unhealthy: ProviderHealth = {
          providerId: id,
          healthy: false,
          lastCheckedAt: new Date().toISOString(),
          lastError: "Health check threw unexpectedly",
        };
        results.set(id, unhealthy);
        this.healthCache.set(id, unhealthy);
      }
    });
    await Promise.allSettled(promises);
    return results;
  }

  /** Manually update cached health for a provider. */
  setCachedHealth(id: string, health: ProviderHealth): void {
    this.healthCache.set(id, health);
  }

  /** Get cached health for a provider. */
  getCachedHealth(id: string): ProviderHealth | undefined {
    return this.healthCache.get(id);
  }

  /** Check whether a provider is healthy (from cache). */
  isHealthy(id: string): boolean {
    const health = this.healthCache.get(id);
    return !!health && health.healthy;
  }
}
