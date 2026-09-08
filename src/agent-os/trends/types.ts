// Phase 20.10 — Pao Trend Intelligence Types
//
// Domain models for research jobs, actor registry, trend signals,
// multi-dimensional opportunity scores, stock production concepts, and cost accounting.

export type ResearchJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type TrendPlatformSource = "adobe_stock" | "youtube" | "tiktok" | "instagram" | "direct_search";

export type OpportunityRecommendation = "MUST_PRODUCE" | "GOOD_OPPORTUNITY" | "EXPLORE" | "AVOID";

export type StockConceptStatus = "draft" | "approved" | "dispatched" | "rejected";

export interface ResearchJob {
  id: string;
  query: string;
  market: string;
  assetType: string;
  status: ResearchJobStatus;
  requestedSources: TrendPlatformSource[];
  config: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ActorRegistryItem {
  id: string;
  provider: string;
  actorId: string;
  category: string;
  enabled: boolean;
  priority: number;
  healthScore: number;
  pricing: {
    model: "per_run" | "per_result" | "per_minute";
    unitPriceUsd: number;
  };
  capabilities: string[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActorRun {
  id: string;
  researchJobId: string;
  actorRegistryId: string;
  providerRunId: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "timed_out";
  resultCount: number;
  estimatedCost: number;
  actualCost: number;
  runtimeMs: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TrendSignal {
  id: string;
  researchJobId: string;
  source: TrendPlatformSource;
  sourceType: string;
  topic: string;
  title: string;
  description: string;
  keywords: string[];
  hashtags: string[];
  publishedAt: string | null;
  views: number;
  likes: number;
  commentsCount: number;
  shares: number;
  downloads: number;
  engagementRate: number;
  aiGenerated: boolean;
  sourceUrl: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NormalizedTrendSignal {
  id: string;
  source: TrendPlatformSource;
  topic: string;
  title: string;
  views: number;
  downloads: number;
  engagementRate: number;
  aiGenerated: boolean;
  keywords: string[];
  publishedAt?: string;
  commercialBuyerIntentScore: number;
}

export interface OpportunityScore {
  id: string;
  researchJobId: string;
  topic: string;
  demandScore: number;                 // 0..100 (download rate, search volume)
  momentumScore: number;               // 0..100 (social growth, velocity)
  buyerIntentScore: number;            // 0..100 (commercial keywords, business utility)
  competitionScore: number;            // 0..100 (existing assets volume)
  competitionGapScore: number;        // 0..100 (demand vs existing quality/relevance)
  freshnessScore: number;              // 0..100 (how recent the trend is)
  productionFeasibilityScore: number;  // 0..100 (difficulty of generating via ComfyUI / MiniMax)
  aiSaturationScore: number;           // 0..100 (prevalence of generic AI assets in stock)
  opportunityScore: number;            // 0..100 (weighted composite score)
  recommendation: OpportunityRecommendation;
  reasoning: {
    summary: string;
    pros: string[];
    cons: string[];
    suggestedAssetTypes: string[];
  };
  createdAt: string;
}

export interface StockConcept {
  id: string;
  researchJobId: string;
  opportunityScoreId: string | null;
  title: string;
  buyer: {
    targetIndustry: string;
    buyerPersona: string;
    useCase: string;
  };
  assetTypes: ("video_4k" | "photo_raw" | "isolated_element")[];
  visualDirection: string;
  mustInclude: string[];
  mustAvoid: string[];
  commercialUseCases: string[];
  productionDifficulty: number; // 1..10
  status: StockConceptStatus;
  payload: {
    recommendedPrompt: string;
    recommendedNegativePrompt: string;
    suggestedLighting: string;
    suggestedAngle: string;
    aspectRatio: string;
  };
  createdAt: string;
}

export interface UsageCostRecord {
  id: string;
  researchJobId: string;
  provider: string;
  actorId: string;
  providerRunId: string | null;
  costUsd: number;
  units: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TrendConfig {
  enabled: boolean;
  dailyCostCapUsd: number;
  perJobCostCapUsd: number;
  defaultMarket: string;
  defaultSources: TrendPlatformSource[];
  apifyToken?: string;
  mockMode: boolean;
}
