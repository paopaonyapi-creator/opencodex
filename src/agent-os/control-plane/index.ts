// Phase 20.16 — Multi-AI Control Plane: barrel exports and singletons.

export * from "./types";
export * from "./policy";
export * from "./reviewers";
export * from "./router";
export * from "./store";
export * from "./service";
export * from "./mcp-tools";

import { getControlPlaneService, resetControlPlaneService } from "./service";
import { getControlPlaneStore, resetControlPlaneStore } from "./store";

export function resetControlPlane(): void {
  resetControlPlaneService();
  resetControlPlaneStore();
}

export { getControlPlaneService, getControlPlaneStore };
