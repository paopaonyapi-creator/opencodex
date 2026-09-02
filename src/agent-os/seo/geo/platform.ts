/**
 * Phase 18.1 — AI platform readiness (HEURISTIC).
 * Projects the verified GEO signals onto each configured AI platform.
 * Basis is always general_retrieval_principle: no proprietary ranking
 * knowledge is claimed for any platform.
 */
import type { GeoCrawlerPolicyStatus, GeoPlatform, LlmsTxtState } from "./types";

export interface PlatformReadinessRow {
  platform: GeoPlatform;
  score: number;                     // 0..100 heuristic
  blockers: string[];
  basis: "general_retrieval_principle";
}

const PLATFORM_CRAWLER: Partial<Record<GeoPlatform, string>> = {
  chatgpt: "gptbot",
  claude: "claudebot",
  perplexity: "perplexitybot",
  other: "bytespider",
};

export function assessPlatformReadiness(input: {
  crawlerPolicy: GeoCrawlerPolicyStatus[];
  llmsTxtState: LlmsTxtState;
  schemaFamilies: string[];
  citabilityScore: number | null;
}): PlatformReadinessRow[] {
  const platforms: GeoPlatform[] = ["chatgpt", "claude", "perplexity", "gemini", "google_ai_overviews", "copilot"];
  return platforms.map(platform => {
    const blockers: string[] = [];
    let score = 70;
    const crawlerId = PLATFORM_CRAWLER[platform];
    if (crawlerId) {
      const status = input.crawlerPolicy.find(row => row.crawlerId === crawlerId);
      if (status?.access === "blocked") { score -= 40; blockers.push(`${status.displayName} is blocked in robots.txt (verified)`); }
      else if (!status || status.access === "unknown") { score -= 5; blockers.push("crawler access unverified"); }
    }
    if (input.llmsTxtState === "missing") { score -= 5; blockers.push("llms.txt missing (verified 404)"); }
    else if (input.llmsTxtState !== "present_valid" && input.llmsTxtState !== "present_with_issues") blockers.push("llms.txt state unknown");
    if (!input.schemaFamilies.includes("Organization")) { score -= 10; blockers.push("no Organization schema (verified)"); }
    if (input.citabilityScore !== null && input.citabilityScore < 50) { score -= 10; blockers.push(`heuristic citability is low (${input.citabilityScore}/100)`); }
    return { platform, score: Math.max(0, score), blockers, basis: "general_retrieval_principle" as const };
  });
}
