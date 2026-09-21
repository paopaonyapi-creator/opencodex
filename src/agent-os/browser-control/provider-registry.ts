/**
 * Phase 20.101 — Browser Provider Registry
 * Central registry managing available browser providers (Local, Oya, Cloud backends).
 */

import { LocalChromeBrowserProvider } from "./adapters/local-chrome";
import { OyaBrowserProvider } from "./adapters/oya";
import type { BrowserProvider } from "./types";

export class BrowserProviderRegistry {
  private providers = new Map<string, BrowserProvider>();

  constructor() {
    this.seedDefaultProviders();
  }

  private seedDefaultProviders(): void {
    this.register(new LocalChromeBrowserProvider());
    this.register(new OyaBrowserProvider());
  }

  public register(provider: BrowserProvider): void {
    this.providers.set(provider.id, provider);
  }

  public get(id: string): BrowserProvider | undefined {
    return this.providers.get(id);
  }

  public list(): BrowserProvider[] {
    return Array.from(this.providers.values());
  }

  public async getFleetHealth(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = {};
    for (const [id, provider] of this.providers.entries()) {
      const health = await provider.health();
      const capabilities = await provider.capabilities();
      report[id] = {
        name: provider.name,
        trustLevel: provider.trustLevel,
        costPerMinuteUsd: provider.costPerMinuteUsd,
        health,
        capabilities,
      };
    }
    return report;
  }
}
