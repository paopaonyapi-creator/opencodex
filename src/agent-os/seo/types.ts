/**
 * Phase 18 — Pao SEO Agent OS × OpenSEO MCP Intelligence Layer.
 *
 * Normalized SEO domain model shared by every provider adapter. Upstream MCP
 * payloads never cross this boundary unnormalized; agents consume only the
 * types in this file.
 */

export type SeoCapability =
  | "keyword_research"
  | "keyword_metrics"
  | "serp_analysis"
  | "domain_overview"
  | "domain_keywords"
  | "competitor_analysis"
  | "serp_competitors"
  | "backlink_overview"
  | "rank_tracking"
  | "saved_keywords"
  | "search_console_performance"
  | "url_inspection"
  | "local_search"
  | "site_audit"
  | "ai_visibility"
  | "analytics"
  | "unknown";

export type SeoIntent = "informational" | "navigational" | "commercial" | "transactional" | "local" | "unknown";

export type SeoDataProvenance = "live" | "cached" | "mock" | "estimated" | "ai_inference" | "capability_unavailable";

export interface SeoProviderHealth {
  provider: string;
  enabled: boolean;
  status: "healthy" | "degraded" | "offline" | "misconfigured" | "unauthorized";
  connectionMode: "mcp" | "local" | "mock" | "unconfigured";
  latencyMs: number | null;
  capabilities: SeoCapability[];
  security: { status: "safe" | "warning" | "critical"; publicNoAuthDetected: boolean; reason?: string };
  checkedAt: string;
}

export interface KeywordIdea {
  keyword: string;
  volume?: number | null;
  difficulty?: number | null;
  cpcUsd?: number | null;
  intent: SeoIntent;
  provenance: SeoDataProvenance;
}

export interface KeywordResearchInput {
  seeds: string[];
  country?: string;
  language?: string;
  limit?: number;
}

export interface KeywordResearchResult {
  keywords: KeywordIdea[];
  provenance: SeoDataProvenance;
}

export interface SerpInput {
  keyword: string;
  country?: string;
  language?: string;
  limit?: number;
}

export interface SerpRow {
  position: number;
  url: string;
  domain: string;
  title: string;
  resultType?: string;
  isFeaturedSnippet?: boolean;
  isLocalPack?: boolean;
}

export interface SerpResult {
  keyword: string;
  rows: SerpRow[];
  provenance: SeoDataProvenance;
}

export interface DomainAnalysisInput {
  domain: string;
}

export interface DomainAnalysisResult {
  domain: string;
  organicKeywords?: number | null;
  organicTraffic?: number | null;
  backlinks?: number | null;
  provenance: SeoDataProvenance;
}

export interface CompetitorAnalysisInput {
  domain: string;
  limit?: number;
}

export interface CompetitorRow {
  domain: string;
  overlapKeywords?: number | null;
  organicTraffic?: number | null;
}

export interface CompetitorAnalysisResult {
  domain: string;
  competitors: CompetitorRow[];
  provenance: SeoDataProvenance;
}

export interface BacklinkAnalysisInput {
  domain: string;
}

export interface BacklinkAnalysisResult {
  domain: string;
  totalBacklinks?: number | null;
  referringDomains?: number | null;
  provenance: SeoDataProvenance;
}

export interface RankTrackingInput {
  keyword: string;
  domain?: string;
}

export interface RankTrackingResult {
  keyword: string;
  position?: number | null;
  previousPosition?: number | null;
  provenance: SeoDataProvenance;
}

/** Stable provider contract every SEO provider adapter implements. */
export interface SeoProvider {
  id: string;
  name: string;
  healthCheck(): Promise<SeoProviderHealth>;
  listCapabilities(): Promise<SeoCapability[]>;
  keywordResearch?(input: KeywordResearchInput): Promise<KeywordResearchResult>;
  getKeywordMetrics?(input: { keywords: string[] }): Promise<{ keywords: KeywordIdea[]; provenance: SeoDataProvenance }>;
  analyzeSerp?(input: SerpInput): Promise<SerpResult>;
  analyzeDomain?(input: DomainAnalysisInput): Promise<DomainAnalysisResult>;
  analyzeCompetitors?(input: CompetitorAnalysisInput): Promise<CompetitorAnalysisResult>;
  analyzeBacklinks?(input: BacklinkAnalysisInput): Promise<BacklinkAnalysisResult>;
  getRankTracking?(input: RankTrackingInput): Promise<RankTrackingResult>;
}

// --- Project policy ---------------------------------------------------------

export interface SeoPolicy {
  allowResearch: boolean;
  allowSaveKeywords: boolean;
  allowTechnicalAudit: boolean;
  allowContentDrafts: boolean;
  allowCodeSuggestions: boolean;
  allowAutomaticCodeChanges: boolean;
  requireReviewerCouncil: boolean;
  requireHumanApprovalBeforeWrite: boolean;
  requireHumanApprovalBeforeDeploy: boolean;
  allowIndexingRequests: boolean;
  maxEstimatedCostPerRun?: number;
}

/** Safe defaults: research yes, any website mutation no. */
export const DEFAULT_SEO_POLICY: SeoPolicy = {
  allowResearch: true,
  allowSaveKeywords: true,
  allowTechnicalAudit: true,
  allowContentDrafts: true,
  allowCodeSuggestions: true,
  allowAutomaticCodeChanges: false,
  requireReviewerCouncil: true,
  requireHumanApprovalBeforeWrite: true,
  requireHumanApprovalBeforeDeploy: true,
  allowIndexingRequests: false,
};

export interface SeoKeyPage {
  url: string;
  label?: string;
  purpose?: string;
  targetKeywords?: string[];
  priority?: "low" | "medium" | "high" | "critical";
}

export interface SeoProjectContext {
  id: string;
  domain: string;
  displayName?: string;
  country?: string;
  language?: string;
  businessType?: string;
  businessDescription?: string;
  goals: string[];
  primaryTopics: string[];
  seedKeywords: string[];
  competitors: string[];
  keyPages: SeoKeyPage[];
  brandTerms: string[];
  negativeKeywords: string[];
  policy: SeoPolicy;
  createdAt: string;
  updatedAt: string;
}

export type SeoRecommendationStatus = "open" | "approved" | "dismissed" | "fix_planned";

export interface SeoRecommendation {
  id: string;
  projectId: string;
  area: "keywords" | "content" | "technical" | "competitors" | "backlinks" | "local" | "aeo" | "gsc";
  title: string;
  detail: string;
  impact: "critical" | "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
  status: SeoRecommendationStatus;
  requiresApproval: boolean;
  evidenceJson: string;
  createdAt: string;
}
