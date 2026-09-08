// Phase 21 — Provider Registry & Aggregator (spec sections 10, 19, 20).
//
// Manages knowledge providers, executes parallel federated search with fallback,
// deduplicates results, and monitors provider health.

import { GitKnowledgeProvider } from "./providers/git-provider";
import { LocalKnowledgeProvider } from "./providers/local-provider";
import { NotebookLMKnowledgeProvider } from "./providers/notebooklm-provider";
import type { KnowledgeProvider } from "./providers/provider-interface";
import type { GroundedSearchResult, KnowledgeQuery, ProviderHealth, SearchResult } from "./types";

export class ProviderRegistry {
  private providers = new Map<string, KnowledgeProvider>();

  constructor() {
    this.registerProvider(new LocalKnowledgeProvider());
    this.registerProvider(new GitKnowledgeProvider());
    this.registerProvider(new NotebookLMKnowledgeProvider());
  }

  registerProvider(provider: KnowledgeProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): KnowledgeProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): KnowledgeProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Executes federated search across all active providers with safe fallback.
   */
  async search(query: KnowledgeQuery): Promise<GroundedSearchResult> {
    const started = Date.now();
    const providersUsed: string[] = [];
    const allResults: SearchResult[] = [];

    // Filter target providers if specified
    const targetProviders = query.sources && query.sources.length > 0
      ? this.listProviders().filter((p) => query.sources?.includes(p.name))
      : this.listProviders();

    const promises = targetProviders.map(async (provider) => {
      try {
        const results = await provider.search(query);
        providersUsed.push(provider.name);
        return results;
      } catch (err) {
        console.warn(`[ProviderRegistry] Provider "${provider.name}" query failed:`, err);
        return [];
      }
    });

    const settled = await Promise.all(promises);
    for (const batch of settled) {
      allResults.push(...batch);
    }

    // Deduplicate by documentId + section
    const seen = new Set<string>();
    const deduplicated: SearchResult[] = [];
    for (const item of allResults) {
      const key = `${item.documentId}::${item.section}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(item);
      }
    }

    // Sort descending by score, then by sourcePriority
    deduplicated.sort((a, b) => b.score - a.score || b.sourcePriority - a.sourcePriority);

    const limit = query.limit || 15;
    const finalResults = deduplicated.slice(0, limit);

    return {
      query: query.query,
      results: finalResults,
      totalFound: deduplicated.length,
      providersUsed,
      durationMs: Date.now() - started,
    };
  }

  async healthCheck(): Promise<ProviderHealth[]> {
    const checks = Array.from(this.providers.values()).map((p) => p.healthCheck());
    return Promise.all(checks);
  }
}

let registryInstance: ProviderRegistry | null = null;
export function getKnowledgeProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }
  return registryInstance;
}
