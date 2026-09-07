// Smart Video Production Router
import type { VideoProductionRequest, VideoProviderId, VideoProviderCapabilities } from "../domain/types";
import { getVideoProviderRegistry } from "./provider-registry";

export interface ProviderRouteScore {
  providerId: VideoProviderId;
  score: number;
  reasons: string[];
  eligible: boolean;
  estimatedCostUsd: number;
}

export interface RoutingDecision {
  selectedProvider: VideoProviderId;
  allScores: ProviderRouteScore[];
  explanation: {
    selected: VideoProviderId;
    reasons: string[];
    rejected: Array<{ providerId: VideoProviderId; reason: string }>;
  };
}

export class SmartProductionRouter {
  async route(request: VideoProductionRequest): Promise<RoutingDecision> {
    const registry = getVideoProviderRegistry();
    const capabilities = await registry.getAllCapabilities();

    const scores: ProviderRouteScore[] = [];

    for (const cap of capabilities) {
      const reasons: string[] = [];
      let eligible = true;
      let score = 50;

      // 1. Health check
      if (cap.health === "offline" || cap.health === "misconfigured") {
        eligible = false;
        reasons.push(`Provider is ${cap.health}`);
      } else if (cap.health === "healthy") {
        score += 25;
        reasons.push("Provider is healthy");
      }

      // 2. Aspect Ratio compatibility
      if (!cap.supportedAspectRatios.includes(request.aspectRatio)) {
        eligible = false;
        reasons.push(`Does not support ${request.aspectRatio}`);
      } else {
        score += 15;
        reasons.push(`Supports ${request.aspectRatio}`);
      }

      // 3. User Preference
      if (request.providerPreference && request.providerPreference.length > 0) {
        const prefIdx = request.providerPreference.indexOf(cap.providerId);
        if (prefIdx === 0) {
          score += 40;
          reasons.push("First user preference");
        } else if (prefIdx > 0) {
          score += 20;
          reasons.push(`User preference ranked #${prefIdx + 1}`);
        } else if (!request.allowFallback) {
          eligible = false;
          reasons.push("Not in user preference and fallback disabled");
        }
      }

      // 4. Paid vs Free policy
      const adapter = registry.getAdapter(cap.providerId);
      const estimate = adapter ? await adapter.estimate(request) : { estimatedCostUsd: 0 };
      if (!request.allowPaidProviders && estimate.estimatedCostUsd > 0) {
        eligible = false;
        reasons.push("Paid provider disallowed by policy");
      }

      // 5. Cost ceiling
      if (request.maxEstimatedCost && estimate.estimatedCostUsd > request.maxEstimatedCost) {
        eligible = false;
        reasons.push(`Estimated cost $${estimate.estimatedCostUsd} exceeds limit $${request.maxEstimatedCost}`);
      }

      // 6. Mode fit (Adobe Stock Mode requires clean footage, no mandatory audio)
      if (request.mode === "adobe_stock") {
        score += 10;
        reasons.push("Stock mode compatible");
      }

      scores.push({
        providerId: cap.providerId,
        score: eligible ? score : -1,
        reasons,
        eligible,
        estimatedCostUsd: estimate.estimatedCostUsd,
      });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const winning = scores.find((s) => s.eligible);
    if (!winning) {
      throw new Error(
        `No eligible video provider found for request. Reasons: ${scores
          .map((s) => `${s.providerId}: ${s.reasons.join(", ")}`)
          .join(" | ")}`,
      );
    }

    return {
      selectedProvider: winning.providerId,
      allScores: scores,
      explanation: {
        selected: winning.providerId,
        reasons: winning.reasons,
        rejected: scores
          .filter((s) => !s.eligible)
          .map((s) => ({ providerId: s.providerId, reason: s.reasons.join("; ") })),
      },
    };
  }
}
