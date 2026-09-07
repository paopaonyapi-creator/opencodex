// Phase 20.8 — Agent Search Engine with Diversity Filtering
// Fast lexical search with capability expansion, explainable ranking, and duplicate suppression.

import { getAgentRegistry } from "../registry/agent-registry";
import { expandSearchQueryCapabilities } from "./capability-taxonomy";
import { calculateRoutingScore } from "./routing-score";
import type { AgentSearchQuery, AgentSearchResult } from "../types";

export class AgentSearchEngine {
  /**
   * Searches the registry for top specialists matching query criteria.
   */
  search(query: AgentSearchQuery): AgentSearchResult[] {
    const registry = getAgentRegistry();
    const allAgents = registry.listAgents({
      division: query.division,
      enabledOnly: true,
    });

    const targetCaps = [
      ...(query.capabilities ?? []),
      ...expandSearchQueryCapabilities(query.query),
    ];

    const results: AgentSearchResult[] = [];

    for (const agent of allAgents) {
      if (query.exclude?.includes(agent.slug)) continue;

      const evalResult = calculateRoutingScore(
        agent,
        query.query,
        targetCaps,
        query.division,
      );

      // Require minimal relevance threshold
      if (evalResult.score > 0.15) {
        results.push({
          agent,
          score: evalResult.score,
          reasons: evalResult.reasons,
          breakdown: evalResult.breakdown,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply diversity filter if requesting multiple agents
    const filtered = this.applyDiversityFilter(results, query.limit ?? 6);

    return filtered;
  }

  /**
   * Prevents over-indexing 4 identical developer personas; ensures role diversity.
   */
  private applyDiversityFilter(
    ranked: AgentSearchResult[],
    limit: number,
  ): AgentSearchResult[] {
    const selected: AgentSearchResult[] = [];
    const divisionCounts = new Map<string, number>();

    // Pass 1: Select highest scoring diverse agents (max 2 per division)
    for (const item of ranked) {
      if (selected.length >= limit) break;

      const div = item.agent.division;
      const count = divisionCounts.get(div) ?? 0;

      if (count < 2) {
        selected.push(item);
        divisionCounts.set(div, count + 1);
      }
    }

    // Pass 2: Fill remaining slots if any left
    if (selected.length < limit) {
      for (const item of ranked) {
        if (selected.length >= limit) break;
        if (!selected.some((s) => s.agent.slug === item.agent.slug)) {
          selected.push(item);
        }
      }
    }

    return selected;
  }
}

let defaultSearchEngine: AgentSearchEngine | null = null;
export function getAgentSearchEngine(): AgentSearchEngine {
  if (!defaultSearchEngine) {
    defaultSearchEngine = new AgentSearchEngine();
  }
  return defaultSearchEngine;
}
