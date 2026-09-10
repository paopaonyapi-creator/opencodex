// Phase 20.19 — Pao Universal AI Browser Provider: barrel exports.

export * from "./types";
export * from "./registry";
export * from "./adapters";
export * from "./file-grants";
export * from "./state";

import { AdapterRegistry } from "./registry";
import { BUILTIN_ADAPTERS } from "./adapters";

/**
 * A registry preloaded with the built-in adapters.
 *
 * Callers that want a different set construct their own registry; this exists so the
 * common case does not repeat four registration calls and cannot forget one.
 */
export function createBuiltinRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const adapter of BUILTIN_ADAPTERS) registry.register(adapter);
  return registry;
}
