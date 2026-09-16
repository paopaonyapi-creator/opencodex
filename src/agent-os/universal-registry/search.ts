// Phase 20.25 — Registry search (doc §13, §14).
//
// MVP search is deterministic lexical + capability matching over the canonical
// schema. The interface is intentionally backend-agnostic so a vector/embedding
// backend can be added later behind `searchTools` without touching callers.

import type { RegistryStoreLike } from "./store-types";
import type { SearchFilters, SearchResult, RankedTool, ToolRecord } from "./types";
import { capabilityFamily, CAPABILITY_NAMESPACES } from "./taxonomy";
import { clamp01 } from "./util";

const KNOWN_CAPABILITIES = new Set<string>(CAPABILITY_NAMESPACES);

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length > 1);
}

function textScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  if (h.includes(needle)) return 1;
  return 0;
}

export interface SearchOptions {
  limit?: number;
}

/**
 * Search the registry by keyword, capability namespace, or natural-language
 * text. Filters narrow the candidate set before scoring. Results are ordered
 * by a transparent relevance score; ranking (profile-weighted) happens in
 * ranking.ts on top of these candidates.
 */
export function searchTools(
  store: RegistryStoreLike,
  query: string,
  filters: SearchFilters = {},
  options: SearchOptions = {},
): SearchResult {
  const limit = options.limit ?? 20;
  const all = store.listTools();
  const tokens = tokenize(query);
  const capabilityHit = KNOWN_CAPABILITIES.has(query.trim().toLowerCase())
    || query.includes(".") && KNOWN_CAPABILITIES.has(query.trim().toLowerCase());

  const candidates = all.filter((tool) => matchesFilters(tool, filters));
  const scored: RankedTool[] = [];

  for (const tool of candidates) {
    let score = 0;
    const reasons: string[] = [];

    if (query.trim()) {
      // Exact capability match dominates.
      if (tool.capabilities.includes(query.trim().toLowerCase())) {
        score += 3;
        reasons.push(`exact capability ${query.trim()}`);
      } else if (capabilityHit) {
        const family = capabilityFamily(query.trim().toLowerCase());
        if (tool.capabilities.some((c) => c === query.trim().toLowerCase() || c.startsWith(`${family}.`))) {
          score += 2;
          reasons.push(`capability family ${family}`);
        }
      }

      let tokenHits = 0;
      for (const token of tokens) {
        const nameHit = textScore(token, tool.name);
        const tagHit = tool.tags.some((t) => textScore(token, t) > 0);
        const capHit = tool.capabilities.some((c) => textScore(token, c.replace(/[.-]/g, " ")) > 0 || c.includes(token));
        const descHit = textScore(token, tool.description);
        if (nameHit || tagHit || capHit || descHit) tokenHits += 1;
      }
      if (tokens.length > 0) {
        const coverage = tokenHits / tokens.length;
        score += coverage * 2;
        if (coverage > 0) reasons.push(`${Math.round(coverage * 100)}% keyword coverage`);
      }
    } else {
      score += 1;
    }

    // Health is a soft tiebreaker at search time.
    if (tool.health === "healthy") score += 0.2;
    else if (tool.health === "offline") score -= 0.3;

    if (score > 0) {
      scored.push({
        tool,
        score,
        match: clamp01(score / 5),
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return { query, results: scored.slice(0, limit) };
}

export function matchesFilters(tool: ToolRecord, filters: SearchFilters): boolean {
  if (filters.type && tool.type !== filters.type) return false;
  if (filters.provider && !tool.provider.toLowerCase().includes(filters.provider.toLowerCase())) return false;
  if (filters.health && tool.health !== filters.health) return false;
  if (filters.riskMax !== undefined && tool.risk.level > filters.riskMax) return false;
  if (filters.requiresApproval !== undefined && tool.risk.requiresApproval !== filters.requiresApproval) return false;
  if (filters.execution && tool.runtime.execution !== filters.execution) return false;
  if (filters.costModel && tool.cost.model !== filters.costModel) return false;
  if (filters.executableOnly && !tool.executable) return false;
  if (filters.sourceKind && tool.source.kind !== filters.sourceKind) return false;
  if (filters.capability && !tool.capabilities.includes(filters.capability)) return false;
  return true;
}
