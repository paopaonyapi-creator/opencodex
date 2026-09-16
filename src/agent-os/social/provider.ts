// Phase 20.20 — SocialDataProvider abstraction (spec section 4).
//
// The research layer depends on this interface only. Providers register into a
// process-level slot at activation, so a future provider (official APIs, Bright Data,
// browser agent, local scraper) plugs in without touching the router or run engine.

import type { PricingState, SocialTool } from "./types";

export interface DiscoveredTool {
  externalId: string;
  owner: string | null;
  name: string;
  title: string | null;
  description: string | null;
  url: string | null;
  categories: string[];
  tags: string[];
  verified: boolean;
  pricingState: PricingState;
  pricingModel: string | null;
  estimatedUnitCost: number | null;
  currency: string | null;
  externalCreatedAt: string | null;
  externalModifiedAt: string | null;
}

export interface DiscoverToolsInput {
  /** Hard ceiling on pages fetched; discovery is always bounded. */
  maxPages?: number;
  pageSize?: number;
  search?: string;
}

export interface CostEstimate {
  /** null means the provider could not estimate — Cost Guard decides policy. */
  estimatedUsd: number | null;
  pricingState: PricingState;
  pricingModel: string | null;
  currency: string;
  basis: string;
}

export interface ProviderRunInput {
  tool: Pick<SocialTool, "id" | "providerId" | "externalId" | "name">;
  query: string;
  maxItems: number;
  market?: string;
}

export interface ProviderRunOutput {
  providerRunId: string;
  status: "succeeded" | "failed" | "timed_out";
  items: Record<string, unknown>[];
  /** Provider-reported spend when the provider exposes it; null stays null. */
  actualCostUsd: number | null;
  itemCount: number;
}

export interface SocialDataProvider {
  readonly id: string;
  readonly name: string;
  discoverTools(input: DiscoverToolsInput): Promise<DiscoveredTool[]>;
  getTool(externalId: string): Promise<DiscoveredTool | null>;
  estimateCost(input: ProviderRunInput): Promise<CostEstimate>;
  run(input: ProviderRunInput): Promise<ProviderRunOutput>;
  getRunStatus(runId: string): Promise<{ status: "running" | "succeeded" | "failed"; itemCount?: number }>;
  cancelRun?(runId: string): Promise<void>;
}

const providers = new Map<string, SocialDataProvider>();

export function registerSocialProvider(provider: SocialDataProvider): void {
  providers.set(provider.id, provider);
}

export function getSocialProvider(id: string): SocialDataProvider | null {
  return providers.get(id) ?? null;
}

export function listSocialProviders(): SocialDataProvider[] {
  return [...providers.values()];
}
