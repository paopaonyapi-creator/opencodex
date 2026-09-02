/**
 * Phase 18 — MockSeoProvider: full contract, zero external cost.
 * Lets the SEO Agent OS, dashboard, agents, and Reviewer Council run locally
 * without OpenSEO credentials. Marked provenance "mock" everywhere so no one
 * mistakes it for live data.
 */
import type {
  SeoCapability,
  SeoProviderHealth,
  KeywordResearchInput,
  KeywordResearchResult,
  SerpInput,
  SerpResult,
  DomainAnalysisInput,
  DomainAnalysisResult,
  CompetitorAnalysisInput,
  CompetitorAnalysisResult,
  BacklinkAnalysisInput,
  BacklinkAnalysisResult,
  RankTrackingInput,
  RankTrackingResult,
} from "./types";

const MOCK_CAPABILITIES: SeoCapability[] = [
  "keyword_research", "keyword_metrics", "serp_analysis", "domain_overview",
  "domain_keywords", "competitor_analysis", "serp_competitors",
  "backlink_overview", "rank_tracking",
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class MockSeoProvider {
  readonly id = "mock";
  readonly name = "Mock SEO Provider";

  async healthCheck(): Promise<SeoProviderHealth> {
    return {
      provider: this.id,
      enabled: true,
      status: "healthy",
      connectionMode: "mock",
      latencyMs: 0,
      capabilities: MOCK_CAPABILITIES,
      security: { status: "safe", publicNoAuthDetected: false },
      checkedAt: new Date().toISOString(),
    };
  }

  async listCapabilities(): Promise<SeoCapability[]> {
    return [...MOCK_CAPABILITIES];
  }

  async keywordResearch(input: KeywordResearchInput): Promise<KeywordResearchResult> {
    const seeds = input.seeds.length > 0 ? input.seeds : ["seo"];
    const limit = input.limit ?? 10;
    const keywords = seeds.flatMap(seed =>
      [seed, `${seed} ราคา`, `${seed} ใกล้ฉัน`, `วิธี ${seed}`, `ทำ ${seed} เอง`].slice(0, limit).map(keyword => {
        const h = hash(keyword);
        return {
          keyword,
          volume: 100 + (h % 4900),
          difficulty: 5 + (h % 80),
          cpcUsd: Number(((h % 300) / 100).toFixed(2)),
          intent: keyword.includes("ราคา") ? "transactional" as const : keyword.includes("ใกล้ฉัน") ? "local" as const : keyword.startsWith("วิธี") ? "informational" as const : "commercial" as const,
          provenance: "mock" as const,
        };
      }),
    );
    return { keywords: keywords.slice(0, limit), provenance: "mock" };
  }

  async getKeywordMetrics(input: { keywords: string[] }) {
    return {
      keywords: input.keywords.map(keyword => {
        const h = hash(keyword);
        return { keyword, volume: 50 + (h % 2400), difficulty: h % 90, cpcUsd: Number(((h % 200) / 100).toFixed(2)), intent: "commercial" as const, provenance: "mock" as const };
      }),
      provenance: "mock" as const,
    };
  }

  async analyzeSerp(input: SerpInput): Promise<SerpResult> {
    const rows = Array.from({ length: input.limit ?? 10 }, (_, i) => {
      const h = hash(`${input.keyword}:${i}`);
      return {
        position: i + 1,
        url: `https://mock-${h % 97}.example/${encodeURIComponent(input.keyword)}`,
        domain: `mock-${h % 97}.example`,
        title: `Mock result ${i + 1} for ${input.keyword}`,
        resultType: "organic",
        isFeaturedSnippet: i === 0,
        isLocalPack: false,
      };
    });
    return { keyword: input.keyword, rows, provenance: "mock" };
  }

  async analyzeDomain(input: DomainAnalysisInput): Promise<DomainAnalysisResult> {
    const h = hash(input.domain);
    return { domain: input.domain, organicKeywords: 120 + (h % 880), organicTraffic: 900 + (h % 42000), backlinks: 40 + (h % 3600), provenance: "mock" };
  }

  async analyzeCompetitors(input: CompetitorAnalysisInput): Promise<CompetitorAnalysisResult> {
    const h = hash(input.domain);
    const competitors = Array.from({ length: Math.min(input.limit ?? 5, 5) }, (_, i) => ({
      domain: `competitor-${(h + i) % 89}.example`,
      overlapKeywords: 30 + ((h + i * 7) % 470),
      organicTraffic: 500 + ((h + i * 13) % 24000),
    }));
    return { domain: input.domain, competitors, provenance: "mock" };
  }

  async analyzeBacklinks(input: BacklinkAnalysisInput): Promise<BacklinkAnalysisResult> {
    const h = hash(input.domain);
    return { domain: input.domain, totalBacklinks: 60 + (h % 5400), referringDomains: 10 + (h % 890), provenance: "mock" };
  }

  async getRankTracking(input: RankTrackingInput): Promise<RankTrackingResult> {
    const h = hash(`${input.domain ?? ""}:${input.keyword}`);
    const position = input.domain ? 1 + (h % 50) : null;
    return { keyword: input.keyword, position, previousPosition: position === null ? null : 1 + ((h + 3) % 50), provenance: "mock" };
  }
}
