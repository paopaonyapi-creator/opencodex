/**
 * Phase 18 — SEO provider resolution: mock (default) or OpenSEO MCP adapter.
 * Configuration comes from env only; switching providers never changes code.
 */
import { MockSeoProvider } from "./mock-provider";
import { OpenSeoMcpClient, type OpenSeoConfig } from "./openseo-mcp-client";
import type { SeoProvider } from "./types";
import type {
  KeywordResearchInput, KeywordResearchResult, SerpInput, SerpResult,
  DomainAnalysisInput, DomainAnalysisResult, CompetitorAnalysisInput,
  CompetitorAnalysisResult, BacklinkAnalysisInput, BacklinkAnalysisResult,
  RankTrackingInput, RankTrackingResult,
} from "./types";

/** Adapter that projects the MCP client onto the stable SeoProvider contract. */
class OpenSeoProvider implements SeoProvider {
  readonly id = "openseo";
  readonly name = "OpenSEO";
  constructor(private readonly client: OpenSeoMcpClient) {}

  async healthCheck() { return this.client.health(); }
  async listCapabilities() { return this.client.discoverCapabilities(); }

  async keywordResearch(input: KeywordResearchInput): Promise<KeywordResearchResult> {
    const raw = await this.client.callTool("keyword_research", {
      seed_keywords: input.seeds,
      ...(input.country ? { location_code: input.country } : {}),
      ...(input.language ? { language_code: input.language } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    }) as { keywords?: unknown } | string;
    return { keywords: normalizeKeywords(raw), provenance: "live" };
  }

  async analyzeSerp(input: SerpInput): Promise<SerpResult> {
    const raw = await this.client.callTool("serp_analysis", { keyword: input.keyword, ...(input.limit ? { limit: input.limit } : {}) }) as { results?: unknown } | string;
    return { keyword: input.keyword, rows: normalizeSerpRows(raw), provenance: "live" };
  }

  async analyzeDomain(input: DomainAnalysisInput): Promise<DomainAnalysisResult> {
    const raw = await this.client.callTool("domain_overview", { domain: input.domain }) as Record<string, unknown> | string;
    const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return { domain: input.domain, organicKeywords: asNumber(record.organic_keywords), organicTraffic: asNumber(record.organic_traffic), backlinks: asNumber(record.backlinks), provenance: "live" };
  }

  async analyzeCompetitors(input: CompetitorAnalysisInput): Promise<CompetitorAnalysisResult> {
    const raw = await this.client.callTool("competitor_analysis", { domain: input.domain, ...(input.limit ? { limit: input.limit } : {}) }) as { competitors?: unknown } | string;
    const list = Array.isArray((raw as { competitors?: unknown })?.competitors) ? (raw as { competitors: unknown[] }).competitors : [];
    return {
      domain: input.domain,
      competitors: list.map(item => {
        const record = (item ?? {}) as Record<string, unknown>;
        return { domain: String(record.domain ?? ""), overlapKeywords: asNumber(record.overlap_keywords), organicTraffic: asNumber(record.organic_traffic) };
      }).filter(row => row.domain),
      provenance: "live",
    };
  }

  async analyzeBacklinks(input: BacklinkAnalysisInput): Promise<BacklinkAnalysisResult> {
    const raw = await this.client.callTool("backlink_overview", { domain: input.domain }) as Record<string, unknown> | string;
    const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return { domain: input.domain, totalBacklinks: asNumber(record.total_backlinks), referringDomains: asNumber(record.referring_domains), provenance: "live" };
  }

  async getRankTracking(input: RankTrackingInput): Promise<RankTrackingResult> {
    const raw = await this.client.callTool("rank_tracking", { keyword: input.keyword, ...(input.domain ? { domain: input.domain } : {}) }) as Record<string, unknown> | string;
    const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return { keyword: input.keyword, position: asNumber(record.position), previousPosition: asNumber(record.previous_position), provenance: "live" };
  }
}

function asNumber(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Defensive normalization: MCP text output is untrusted data. */
function normalizeKeywords(raw: unknown): KeywordResearchResult["keywords"] {
  const list = Array.isArray((raw as { keywords?: unknown })?.keywords)
    ? (raw as { keywords: unknown[] }).keywords
    : Array.isArray(raw) ? raw : [];
  return list.map(item => {
    const record = (item ?? {}) as Record<string, unknown>;
    const keyword = typeof record.keyword === "string" ? record.keyword : String(record.keyword ?? record.keyword_text ?? "").slice(0, 300);
    return {
      keyword,
      volume: asNumber(record.volume ?? record.search_volume),
      difficulty: asNumber(record.difficulty ?? record.competition),
      cpcUsd: asNumber(record.cpc ?? record.cpc_usd),
      intent: typeof record.intent === "string" ? record.intent as KeywordResearchResult["keywords"][number]["intent"] : "unknown",
      provenance: "live" as const,
    };
  }).filter(row => row.keyword);
}

function normalizeSerpRows(raw: unknown): SerpResult["rows"] {
  const list = Array.isArray((raw as { results?: unknown })?.results)
    ? (raw as { results: unknown[] }).results
    : Array.isArray(raw) ? raw : [];
  return list.map((item, index) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.slice(0, 2000) : "";
    let domain = "";
    try { domain = url ? new URL(url).hostname : String(record.domain ?? "").slice(0, 300); } catch { domain = ""; }
    return {
      position: asNumber(record.rank ?? record.position) ?? index + 1,
      url,
      domain,
      title: String(record.title ?? "").slice(0, 500),
      ...(typeof record.type === "string" ? { resultType: record.type.slice(0, 60) } : {}),
    };
  }).filter(row => row.url || row.domain);
}

export interface SeoProviderResolution {
  provider: SeoProvider;
  mode: "mock" | "mcp" | "local";
  config: OpenSeoConfig;
}

export function readSeoProviderConfig(env: Record<string, string | undefined>): OpenSeoConfig {
  const enabled = (env["OPENSEO_ENABLED"] ?? "").toLowerCase() === "true";
  if (!enabled) return { ...DEFAULTS };
  const modeRaw = (env["OPENSEO_MODE"] ?? "mcp").toLowerCase();
  const mode = modeRaw === "local" ? "local" as const : modeRaw === "mock" ? "mock" as const : "mcp" as const;
  return {
    enabled: true,
    mode,
    ...(env["OPENSEO_MCP_URL"] ? { mcpUrl: env["OPENSEO_MCP_URL"] } : {}),
    ...(env["OPENSEO_LOCAL_BASE_URL"] ? { localBaseUrl: env["OPENSEO_LOCAL_BASE_URL"] } : {}),
    ...(env["OPENSEO_API_KEY"] ? { apiKey: env["OPENSEO_API_KEY"] } : {}),
  };
}

const DEFAULTS: OpenSeoConfig = { enabled: false, mode: "mock" };

/** Resolve the active provider from env; falls back to mock on any config problem. */
export function resolveSeoProvider(env: Record<string, string | undefined> = process.env): SeoProviderResolution {
  const config = readSeoProviderConfig(env);
  if (!config.enabled || config.mode === "mock") return { provider: new MockSeoProvider(), mode: "mock", config };
  try {
    const client = new OpenSeoMcpClient(config);
    return { provider: new OpenSeoProvider(client), mode: config.mode, config };
  } catch {
    // Misconfigured real provider degrades to mock rather than crashing routes.
    return { provider: new MockSeoProvider(), mode: "mock", config: { ...DEFAULTS } };
  }
}
