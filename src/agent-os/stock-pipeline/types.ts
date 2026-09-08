// End-to-End Autonomous Stock Production & Submission Pipeline Types
//
// Bridges Trend Intelligence (Phase 20.10), Campaign Planner (Phase 21),
// Generation Studio (Phase 19/20), QC Reviewer Council (Phase 20.4/21),
// and Browser Multi-Agent Web Submission (Phase 20.13/20.14).

export type PipelineStatus =
  | "pending"
  | "trends_running"
  | "planning"
  | "rendering"
  | "qc_evaluating"
  | "browser_preparing"
  | "waiting_approval"
  | "submitting"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type PipelineStageName =
  | "trend_discovery"
  | "campaign_planning"
  | "generative_dispatch"
  | "qc_evaluation"
  | "metadata_csv_packager"
  | "browser_preparation"
  | "human_approval_submission";

export interface StockPipelineRun {
  id: string;
  query: string;
  market: string;
  targetAssetCount: number;
  status: PipelineStatus;
  currentStage: number;
  trendJobId?: string;
  campaignId?: string;
  browserMissionId?: string;
  approvalId?: string;
  conceptSummary: Record<string, unknown>;
  campaignSummary: Record<string, unknown>;
  qcSummary: Record<string, unknown>;
  browserSummary: Record<string, unknown>;
  summary: Record<string, unknown>;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface StartPipelineInput {
  query: string;
  market?: string;
  targetAssetCount?: number;
  autoDispatchGen?: boolean;
  skipBrowserUpload?: boolean;
  targetDomain?: string;
}

export interface PipelineStepResult {
  run: StockPipelineRun;
  stage: number;
  stageName: PipelineStageName;
  output: Record<string, unknown>;
}

export interface PipelineFilter {
  status?: PipelineStatus;
  limit?: number;
}
