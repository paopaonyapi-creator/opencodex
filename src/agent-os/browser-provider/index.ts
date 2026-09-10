// Phase 20.18 — Pao Grok Production Bridge: barrel exports and singletons.

export * from "./types";
export * from "./selectors";
export * from "./page-detector";
export * from "./store";
export * from "./grok-provider";
export * from "./download-manager";
export * from "./bridge";

import { resetGrokBridgeStore } from "./store";
import { resetGrokBrowserProvider } from "./grok-provider";
import { resetGrokBridgeService } from "./bridge";

export function resetGrokBridge(): void {
  resetGrokBrowserProvider();
  resetGrokBridgeService();
  resetGrokBridgeStore();
}
