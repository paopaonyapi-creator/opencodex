/**
 * Pao Market Signal Control Plane — provider exports bridge.
 *
 * The adapters live in adapters.ts with their config types; the registry lives
 * in registry.ts. This module gives index.ts one import surface.
 */

export {
  KamdenAdapter,
  TradingViewAdapter,
  GenericWebhookAdapter,
  ManualSignalAdapter,
  type MarketSignalProviderAdapter,
  type ProviderAdapterConfig,
  type GenericFieldMapping,
} from "./adapters";
export { buildDefaultRegistry, MarketProviderRegistry } from "./registry";
