/**
 * Phase 20.101 — Universal Browser Router
 * Policy-governed, cost-aware, and capability-matched browser routing with safe failover.
 */

import { BrowserProviderRegistry } from "./provider-registry";
import type { BrowserLease, BrowserProvider, BrowserStartRequest } from "./types";

export interface BrowserRouteRequest extends BrowserStartRequest {
  workloadType: "research" | "authenticated_task" | "stock_upload" | "general";
  sensitivity: "low" | "medium" | "high" | "regulated";
  requireLocal?: boolean;
  maxCostPerMinuteUsd?: number;
  preferredProviderId?: string;
}

export interface RoutingDecision {
  selectedProvider: BrowserProvider;
  reason: string;
  failoverCandidates: string[];
}

export class UniversalBrowserRouter {
  public readonly registry: BrowserProviderRegistry;

  constructor(registry?: BrowserProviderRegistry) {
    this.registry = registry ?? new BrowserProviderRegistry();
  }

  public async selectRoute(req: BrowserRouteRequest): Promise<RoutingDecision> {
    const providers = this.registry.list();
    if (providers.length === 0) {
      throw new Error("No browser providers registered in fleet");
    }

    // 1. Explicit Preferred Provider
    if (req.preferredProviderId) {
      const preferred = this.registry.get(req.preferredProviderId);
      if (preferred) {
        const health = await preferred.health();
        if (health.status !== "unhealthy") {
          return {
            selectedProvider: preferred,
            reason: `Requested explicit provider '${req.preferredProviderId}' is healthy.`,
            failoverCandidates: providers.filter((p) => p.id !== preferred.id).map((p) => p.id),
          };
        }
      }
    }

    // 2. Security & Sensitivity: High/Regulated sensitivity strictly requires Local-First (§8.2)
    if (req.sensitivity === "high" || req.sensitivity === "regulated" || req.requireLocal) {
      const local = this.registry.get("local-chrome");
      if (local) {
        const health = await local.health();
        if (health.status !== "unhealthy") {
          return {
            selectedProvider: local,
            reason: "High sensitivity workload pinned to local-first browser provider.",
            failoverCandidates: [], // Regulated tasks cannot cross trust boundaries to cloud providers
          };
        }
      }
    }

    // 3. Workload matching (Research or general tasks can utilize Oya cloud fleet)
    const oya = this.registry.get("oya");
    const local = this.registry.get("local-chrome")!;

    if (req.workloadType === "research" && oya) {
      const health = await oya.health();
      if (health.status === "healthy" && (!req.maxCostPerMinuteUsd || oya.costPerMinuteUsd <= req.maxCostPerMinuteUsd)) {
        return {
          selectedProvider: oya,
          reason: "General research workload routed to cloud browser fleet for concurrency.",
          failoverCandidates: [local.id],
        };
      }
    }

    // Default to Local Chrome
    return {
      selectedProvider: local,
      reason: "Defaulted to primary local browser provider.",
      failoverCandidates: oya ? [oya.id] : [],
    };
  }

  public async leaseBrowser(req: BrowserRouteRequest): Promise<{ lease: BrowserLease; routing: RoutingDecision }> {
    const routing = await this.selectRoute(req);
    try {
      const lease = await routing.selectedProvider.start(req);
      return { lease, routing };
    } catch (err) {
      // Safe failover to candidate if available (§8.3)
      if (routing.failoverCandidates.length > 0) {
        const fallbackId = routing.failoverCandidates[0];
        const fallbackProvider = this.registry.get(fallbackId);
        if (fallbackProvider) {
          const lease = await fallbackProvider.start(req);
          return {
            lease,
            routing: {
              selectedProvider: fallbackProvider,
              reason: `Primary provider failed (${(err as Error).message}); safely failed over to '${fallbackId}'.`,
              failoverCandidates: [],
            },
          };
        }
      }
      throw err;
    }
  }
}
