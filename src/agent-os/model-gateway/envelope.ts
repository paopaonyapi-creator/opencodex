/**
 * Phase 20.85 — Policy Envelope Builder
 * Constructs an immutable boundary that OmniRoute or direct adapters must respect.
 */

import type { CapabilityRegistry } from "./registry";
import type { GatewayRequest, PolicyEnvelope } from "./types";

export class PolicyViolationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[PolicyViolation] ${code}: ${message}`);
    this.name = "PolicyViolationError";
  }
}

export class LocalOnlyViolationError extends PolicyViolationError {
  constructor(message: string) {
    super("LOCAL_ONLY_VIOLATION", message);
    this.name = "LocalOnlyViolationError";
  }
}

export class PolicyEnvelopeBuilder {
  constructor(private readonly registry: CapabilityRegistry) {}

  public build(request: GatewayRequest): PolicyEnvelope {
    const dataClass = request.policy.dataClass ?? "internal";
    // Restricted data strictly forces local-only execution
    const isRestricted = dataClass === "restricted";
    const localOnly = Boolean(request.policy.localOnly || isRestricted);

    const routeGroupDef = this.registry.getRouteGroup(request.policy.routeGroup);
    const effectiveLocalOnly = localOnly || Boolean(routeGroupDef?.localOnly);

    const allowedProviders = request.policy.allowedProviders ?? [];
    const deniedProviders = request.policy.deniedProviders ?? [];
    const allowedModels = request.policy.allowedModels;
    const deniedModels: string[] = [];

    const unknownPriceBehavior = request.policy.unknownPriceBehavior ?? "deny";
    const maxAttempts = Math.min(Math.max(request.budget?.maxAttempts ?? 2, 1), 5);

    const hardBudgetUsd = request.budget?.maxCostUsd ?? routeGroupDef?.maxBudgetUsd;

    return {
      requestId: request.requestId,
      routeGroup: request.policy.routeGroup,
      dataClass,
      allowedProviders,
      allowedModels,
      deniedProviders,
      deniedModels,
      localOnly: effectiveLocalOnly,
      allowFallback: request.runtime?.allowFallback !== false,
      maxAttempts,
      hardBudgetUsd,
      unknownPriceBehavior,
      policyDecisionId: `pol_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  /**
   * Filters and validates candidates strictly against the policy envelope.
   * If localOnly is set and a candidate is cloud-based, it is rejected.
   */
  public resolveApprovedCandidates(
    envelope: PolicyEnvelope,
    requestedCapabilities: string[],
  ): string[] {
    const routeGroup = this.registry.getRouteGroup(envelope.routeGroup);
    const initialCandidates = routeGroup ? routeGroup.candidates : (envelope.allowedModels ?? []);

    const approved: string[] = [];

    for (const modelId of initialCandidates) {
      const model = this.registry.getModel(modelId);
      if (!model) continue;

      // 1. Check provider allowlist / denylist
      if (envelope.deniedProviders.includes(model.providerId)) continue;
      if (
        envelope.allowedProviders.length > 0 &&
        !envelope.allowedProviders.includes(model.providerId)
      ) {
        continue;
      }

      // 2. Check local-only constraint (Physical endpoint check)
      if (envelope.localOnly && !this.registry.isLocalEndpoint(modelId)) {
        continue;
      }

      // 3. Check capabilities
      const required = Array.from(
        new Set([...requestedCapabilities, ...(routeGroup?.requiredCapabilities ?? [])]),
      );
      if (!this.registry.hasCapabilities(modelId, required)) {
        continue;
      }

      // 4. Check unknown pricing policy
      if (
        model.pricing.status === "unknown" &&
        envelope.unknownPriceBehavior === "deny"
      ) {
        continue;
      }

      approved.push(modelId);
    }

    if (envelope.localOnly && approved.length === 0) {
      throw new LocalOnlyViolationError(
        `Local-only request for route group '${envelope.routeGroup}' has no approved local models available. Cloud fallback is strictly prohibited.`,
      );
    }

    if (approved.length === 0) {
      throw new PolicyViolationError(
        "NO_APPROVED_CANDIDATES",
        `No candidates in route group '${envelope.routeGroup}' satisfy policy envelope constraints.`,
      );
    }

    return approved;
  }
}
