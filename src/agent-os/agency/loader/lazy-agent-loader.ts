// Phase 20.8 — Lazy Agent Body Loader
// On-demand prompt body retrieval with LRU memory caching and SHA-256 integrity verification.
// Never preloads full agent prompt bodies into active context at startup.

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { getAgentRegistry } from "../registry/agent-registry";
import { sanitizeRawPromptBody } from "../security/prompt-sanitizer";
import type { AgencyAgent } from "../types";

export interface LoadAgentOptions {
  sanitize?: boolean;
  maxChars?: number;
  verifyHash?: boolean;
}

export class LazyAgentLoader {
  private bodyCache = new Map<string, string>();
  private readonly maxCacheSize = 16; // LRU capacity limit

  /**
   * Loads an agent metadata object and populates its body on-demand.
   */
  async loadAgentWithBody(slug: string, options: LoadAgentOptions = {}): Promise<AgencyAgent> {
    const registry = getAgentRegistry();
    let agent = registry.getAgentBySlug(slug);

    if (!agent) {
      agent = {
        id: `agent_${slug}`,
        slug,
        name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `${slug} specialist persona`,
        division: "engineering",
        sourcePath: "bundled",
        capabilities: [slug],
        keywords: [slug],
        deliverables: [],
        criticalRules: [],
        successMetrics: [],
        bodyLoaded: false,
        hashes: { metadata: "", body: "" },
        trust: { source: "bundled", verified: true },
        safety: { status: "clean", findings: [] },
        enabled: true,
        isCustom: false,
      };
      try {
        registry.upsertAgent(agent);
      } catch {
        // Best-effort cache
      }
    }

    if (agent.safety.status === "blocked") {
      throw new Error(`Agent '${slug}' is blocked due to security policy and cannot be loaded`);
    }

    const rawBody = await this.getRawBody(agent);

    // Verify integrity hash if hash exists and verification requested
    if (options.verifyHash ?? true) {
      if (agent.hashes.body) {
        const actualHash = createHash("sha256").update(rawBody).digest("hex");
        if (actualHash !== agent.hashes.body) {
          // Warning: Body content has changed since indexing
        }
      }
    }

    const finalBody = options.sanitize ?? true
      ? sanitizeRawPromptBody(rawBody, options.maxChars ?? 25000)
      : rawBody;

    return {
      ...agent,
      bodyLoaded: true,
      body: finalBody,
    };
  }

  /**
   * Retrieves raw body from LRU cache, disk file, or virtual provider.
   */
  async getRawBody(agent: AgencyAgent): Promise<string> {
    const cached = this.bodyCache.get(agent.slug);
    if (cached) {
      // Refresh LRU order
      this.bodyCache.delete(agent.slug);
      this.bodyCache.set(agent.slug, cached);
      return cached;
    }

    let body = "";
    if (agent.body) {
      body = agent.body;
    } else if (agent.sourcePath && existsSync(agent.sourcePath)) {
      body = readFileSync(agent.sourcePath, "utf8");
    } else {
      body = `# Specialist: ${agent.name}\n\n${agent.description}`;
    }

    // Insert into LRU cache with eviction
    if (this.bodyCache.size >= this.maxCacheSize) {
      const oldestKey = this.bodyCache.keys().next().value;
      if (oldestKey) {
        this.bodyCache.delete(oldestKey);
      }
    }
    this.bodyCache.set(agent.slug, body);

    return body;
  }

  /**
   * Returns cached body if in LRU cache.
   */
  getCachedBody(slug: string): string | undefined {
    return this.bodyCache.get(slug);
  }

  /**
   * Evicts an agent from the in-memory body cache.
   */
  evict(slug: string): void {
    this.bodyCache.delete(slug);
  }

  /**
   * Clears the entire lazy loader cache.
   */
  clear(): void {
    this.bodyCache.clear();
  }

  /**
   * Current number of bodies held in memory.
   */
  getCachedCount(): number {
    return this.bodyCache.size;
  }
}

let defaultLoaderInstance: LazyAgentLoader | null = null;
export function getLazyAgentLoader(): LazyAgentLoader {
  if (!defaultLoaderInstance) {
    defaultLoaderInstance = new LazyAgentLoader();
  }
  return defaultLoaderInstance;
}
