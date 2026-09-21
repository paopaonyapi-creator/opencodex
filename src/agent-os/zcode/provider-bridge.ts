/**
 * Phase 20.100 — Pao-hubPro × ZCode Provider Bridge
 * Manages provider leases, capability mapping, budget enforcement, and audited failover.
 */

import type { ProviderLease } from "./types";

export interface CreateLeaseInput {
  providerId: string;
  modelId: string;
  endpointRef?: string;
  credentialRef: string;
  ttlMinutes?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  allowedCapabilities?: string[];
  fallbackChain?: string[];
}

export class ZCodeProviderBridge {
  private leases = new Map<string, ProviderLease>();
  private failoverLogs: Array<{
    leaseId: string;
    fromModel: string;
    toModel: string;
    reason: string;
    timestamp: string;
  }> = [];

  public createLease(input: CreateLeaseInput): ProviderLease {
    const leaseId = `lease_zc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 60) * 60 * 1000).toISOString();

    const lease: ProviderLease = {
      leaseId,
      providerId: input.providerId,
      modelId: input.modelId,
      endpointRef: input.endpointRef || "http://127.0.0.1:10100/v1",
      credentialRef: input.credentialRef,
      expiresAt,
      maxTokens: input.maxTokens ?? 500_000,
      maxCostUsd: input.maxCostUsd ?? 5.0,
      allowedCapabilities: input.allowedCapabilities ?? ["chat", "tools", "vision"],
      fallbackChain: input.fallbackChain ?? ["anthropic/claude-sonnet-4-6", "openai/gpt-5.6-sol"],
      activeTokensUsed: 0,
      activeCostUsd: 0,
    };

    this.leases.set(leaseId, lease);
    return lease;
  }

  public getLease(leaseId: string): ProviderLease | undefined {
    const lease = this.leases.get(leaseId);
    if (!lease) return undefined;

    // Check expiry
    if (new Date(lease.expiresAt).getTime() < Date.now()) {
      return undefined;
    }
    return lease;
  }

  public recordUsage(leaseId: string, tokens: number, costUsd: number): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;

    lease.activeTokensUsed += tokens;
    lease.activeCostUsd += costUsd;

    if (lease.activeCostUsd > lease.maxCostUsd) {
      throw new Error(`Provider lease ${leaseId} exceeded cost budget: $${lease.activeCostUsd.toFixed(4)} > $${lease.maxCostUsd}`);
    }
  }

  public failover(leaseId: string, reason: string): ProviderLease {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new Error(`Provider lease '${leaseId}' not found for failover`);
    }

    if (!lease.fallbackChain || lease.fallbackChain.length === 0) {
      throw new Error(`No fallback models available in lease '${leaseId}'`);
    }

    const fromModel = lease.modelId;
    const nextModel = lease.fallbackChain.shift()!;
    lease.modelId = nextModel;

    this.failoverLogs.push({
      leaseId,
      fromModel,
      toModel: nextModel,
      reason,
      timestamp: new Date().toISOString(),
    });

    return lease;
  }

  public listFailoverLogs() {
    return [...this.failoverLogs];
  }
}
