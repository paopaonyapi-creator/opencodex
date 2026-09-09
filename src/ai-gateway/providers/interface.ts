/**
 * Pao AI Gateway — Provider interface.
 *
 * Every provider adapter implements this interface. Provider failure must not
 * crash unrelated providers.
 */

import type {
  GatewayProviderConfig,
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderHealth,
} from "../types";

export interface ModelInfo {
  readonly id: string;
  readonly providerId: string;
  readonly owned_by?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly type: GatewayProviderConfig["type"];

  /** List models available from this provider. */
  listModels(): Promise<ModelInfo[]>;

  /** Send a chat completion request. */
  chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse>;

  /** Check provider health. Must not throw. */
  healthCheck(): Promise<ProviderHealth>;

  /** Whether this provider has a valid API key configured. */
  isConfigured(): boolean;
}

/**
 * Create a provider adapter from configuration.
 * Returns null if the provider type is not supported.
 */
export type ProviderFactory = (config: GatewayProviderConfig) => ModelProvider | null;
