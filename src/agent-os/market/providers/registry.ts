/**
 * Pao Market Signal Control Plane — provider registry (Phase 20.52).
 *
 * Adding a future provider means constructing an adapter and registering it;
 * the ingest pipeline never learns provider specifics (spec §74).
 */

import type { IncomingWebhookRequest, VerificationResult } from "../types";
import {
  GenericWebhookAdapter,
  KamdenAdapter,
  ManualSignalAdapter,
  TradingViewAdapter,
  type GenericFieldMapping,
  type MarketSignalProviderAdapter,
  type ProviderAdapterConfig,
} from "./adapters";

export class MarketProviderRegistry {
  private readonly adapters = new Map<string, MarketSignalProviderAdapter>();

  register(adapter: MarketSignalProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: string): MarketSignalProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): MarketSignalProviderAdapter[] {
    return [...this.adapters.values()];
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }
}

export interface RegistryBuildInput {
  readonly limits: { maxAgeSeconds: number; maxBodyKb: number };
  readonly genericMapping?: GenericFieldMapping;
  readonly genericProviderId?: string;
}

/**
 * Build the default registry from configuration. Disabled providers still
 * register (so operators see them) — ingress rejects their deliveries with
 * MARKET_PROVIDER_DISABLED.
 */
export function buildDefaultRegistry(input: RegistryBuildInput): MarketProviderRegistry {
  const registry = new MarketProviderRegistry();

  const kamden: ProviderAdapterConfig = {
    providerId: "kamden",
    displayName: "KamdenAI",
    secretEnv: "MARKET_KAMDEN_WEBHOOK_SECRET",
    authType: "hmac_sha256",
    enabled: process.env.MARKET_PROVIDER_KAMDEN_ENABLED === "true",
  };
  registry.register(new KamdenAdapter(kamden, input.limits));

  const tradingview: ProviderAdapterConfig = {
    providerId: "tradingview",
    displayName: "TradingView",
    secretEnv: "MARKET_TRADINGVIEW_WEBHOOK_SECRET",
    authType: "static_token",
    enabled: process.env.MARKET_PROVIDER_TRADINGVIEW_ENABLED === "true",
  };
  registry.register(new TradingViewAdapter(tradingview, input.limits));

  const genericId = input.genericProviderId ?? "generic";
  registry.register(
    new GenericWebhookAdapter(
      {
        providerId: genericId,
        displayName: "Generic Webhook",
        secretEnv: "MARKET_GENERIC_WEBHOOK_SECRET",
        authType: process.env.MARKET_GENERIC_AUTH_TYPE === "hmac_sha256" ? "hmac_sha256" : "static_token",
        signatureHeader: "x-signature-256",
        timestampHeader: "x-timestamp",
        tokenHeader: "x-webhook-token",
        enabled: process.env.MARKET_PROVIDER_GENERIC_ENABLED === "true",
      },
      input.genericMapping ?? {
        symbolField: "symbol",
        actionField: "action",
        priceField: "price",
        stopField: "stop",
        targetField: "target",
      },
      input.limits,
    ),
  );

  registry.register(new ManualSignalAdapter());

  return registry;
}

export type { MarketSignalProviderAdapter, IncomingWebhookRequest, VerificationResult };
