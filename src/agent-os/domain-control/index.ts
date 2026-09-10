// Phase 20.15 — Domain Control Plane: barrel exports and process singletons.
//
// Mirrors the convention every other Pao-hubPro phase subsystem uses, so the
// management API and the tool suite import one module rather than reaching into
// individual files.

export * from "./types";
export * from "./policy";
export * from "./diff";
export * from "./config";
export * from "./store";
export * from "./service";
export * from "./verification";
export * from "./proxy";
export * from "./deployment";
export * from "./providers/base";
export * from "./providers/fake";
export * from "./providers/domain-oss";

import { getDomainControlService, resetDomainControlService } from "./service";
import { getDomainControlStore, resetDomainControlStore } from "./store";
import { createProxyAdapter, type ReverseProxyAdapter } from "./proxy";
import { DeploymentService } from "./deployment";

let deploymentService: DeploymentService | null = null;

/**
 * Deployment service bound to the process-wide control plane and the configured
 * reverse proxy. When CADDY_ADMIN_URL is unset this returns a service whose proxy
 * adapter reports itself unavailable, which is the honest state rather than a
 * silent no-op that looks like success.
 */
export function getDeploymentService(): DeploymentService {
  if (!deploymentService) {
    const service = getDomainControlService();
    const proxy: ReverseProxyAdapter = createProxyAdapter({
      adminUrl: service.getConfig().caddyAdminUrl,
    });
    deploymentService = new DeploymentService({ service, proxy });
  }
  return deploymentService;
}

export function resetDomainControl(): void {
  resetDomainControlService();
  deploymentService = null;
  resetDomainControlStore();
}

export { getDomainControlService, getDomainControlStore };
