// Pao Stock Autonomous Campaign Planner — Domain Types (Phase 21)
//
// Domain interfaces and data contracts for Trend Signals, Niche Viability Scoring,
// Campaign Matrices, Quality Control Gates, and Portfolio Performance Tracking.

export type TrendSignalStatus = "new" | "planned" | "producing" | "archived";

export type PriorityTier = "high_priority" | "secondary" | "rejected";

export interface TrendSignal {
  id: string;
  keyword: string;
  category: string;
  source: string;
  searchVelocity: number; // V in [0, 1]
  commercialIntent: number; // C in [0, 1]
  saturationIndex: number; // S in [0, 1]
  nicheViabilityScore: number; // NVS
  priorityTier: PriorityTier;
  status: TrendSignalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NicheScoringInput {
  commercialIntent: number; // C: [0, 1]
  searchVelocity: number; // V: [0, 1]
  saturationIndex: number; // S: [0, 1]
  ipRiskPenalty?: number; // P_risk: [0, 1], default 0
}

export interface NicheViabilityResult {
  nvs: number;
  priorityTier: PriorityTier;
  breakdown: {
    commercialIntent: number;
    searchVelocity: number;
    saturationIndex: number;
    ipRiskPenalty: number;
  };
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface StockCampaign {
  id: string;
  title: string;
  trendSignalId?: string | null;
  targetPlatform: string;
  targetAssetCount: number;
  completedAssetCount: number;
  budgetCents: number;
  spentCents: number;
  status: CampaignStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AssetType = "video_4k" | "photo_raw" | "isolated_element";

export type RenderStatus = "pending" | "rendering" | "passed_qc" | "failed_qc";

export interface CampaignItem {
  id: string;
  campaignId: string;
  assetType: AssetType;
  title: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  lighting: string;
  angle: string;
  assignedProvider: string;
  gpuJobId?: string | null;
  renderStatus: RenderStatus;
  createdAt: string;
}

export type IpClearanceStatus =
  | "cleared"
  | "flagged_trademark"
  | "flagged_likeness";

export type CouncilVerdict = "approve" | "human_review" | "reject";

export interface QcRecord {
  id: string;
  campaignItemId: string;
  sharpnessScore: number;
  artifactPenalty: number;
  ipClearanceStatus: IpClearanceStatus;
  councilVerdict: CouncilVerdict;
  verifiedAt: string;
}

export interface PortfolioPerformance {
  id: string;
  campaignId: string;
  submittedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  downloadsCount: number;
  revenueUsd: number;
  lastSyncedAt: string;
}

// REST Management API contracts
export interface TrendScanRequest {
  categories?: string[];
  minViabilityScore?: number;
}

export interface TrendScanResponse {
  ok: boolean;
  count: number;
  signals: TrendSignal[];
}

export interface PlanCampaignRequest {
  trendSignalId?: string;
  title?: string;
  category?: string;
  keyword?: string;
  targetAssetCount?: number;
  targetPlatform?: string;
  budgetCents?: number;
  preferredProvider?: string;
}

export interface PlanCampaignResponse {
  ok: boolean;
  campaign: StockCampaign;
  items: CampaignItem[];
}

export interface CampaignDetailResponse {
  ok: boolean;
  campaign: StockCampaign;
  items: CampaignItem[];
  trendSignal?: TrendSignal | null;
  performance?: PortfolioPerformance | null;
}
