// Phase 20.7 — Pao AI Video Factory × MoneyPrinterTurbo Native AI Video Orchestrator
// Core Domain Types & Interfaces

export type VideoProviderId =
  | "moneyprinterturbo"
  | "metaso-minimax-h3"
  | "seedance"
  | "ofox-wan"
  | "comfyui-video"
  | "runpod-video"
  | "local-media"
  | "stock-footage"
  | "mock-mpt";

export type ProductionMode =
  | "adobe_stock"
  | "social"
  | "preview"
  | "internal";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type MusicMode = "none" | "user_owned" | "approved_library" | "provider";

export type CostGuardState =
  | "FREE"
  | "ESTIMATED"
  | "REQUIRES_APPROVAL"
  | "APPROVED"
  | "BLOCKED_BY_LIMIT"
  | "COST_UNKNOWN"
  | "ACTUAL_RECORDED";

export type ProviderHealthStatus = "healthy" | "degraded" | "offline" | "misconfigured" | "unknown";

export type JobStatus =
  | "DRAFT"
  | "VALIDATING"
  | "WAITING_APPROVAL"
  | "QUEUED"
  | "ROUTING"
  | "SUBMITTING"
  | "PROVIDER_RUNNING"
  | "COLLECTING"
  | "POST_PROCESSING"
  | "QC_PENDING"
  | "QC_RUNNING"
  | "REVIEW_PENDING"
  | "READY_FOR_EXPORT"
  | "NEEDS_FIXES"
  | "HOLD_FOR_COMPLIANCE_REVIEW"
  | "REJECTED_INTERNAL"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "CANCELLED";

export const VIDEO_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["WAITING_APPROVAL", "QUEUED", "ROUTING", "FAILED_FINAL", "CANCELLED"],
  WAITING_APPROVAL: ["QUEUED", "CANCELLED", "FAILED_FINAL"],
  QUEUED: ["ROUTING", "CANCELLED", "FAILED_RETRYABLE"],
  ROUTING: ["SUBMITTING", "WAITING_APPROVAL", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  SUBMITTING: ["PROVIDER_RUNNING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  PROVIDER_RUNNING: ["COLLECTING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  COLLECTING: ["POST_PROCESSING", "QC_PENDING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  POST_PROCESSING: ["QC_PENDING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  QC_PENDING: ["QC_RUNNING", "CANCELLED", "FAILED_FINAL"],
  QC_RUNNING: ["REVIEW_PENDING", "NEEDS_FIXES", "HOLD_FOR_COMPLIANCE_REVIEW", "FAILED_FINAL"],
  REVIEW_PENDING: ["READY_FOR_EXPORT", "NEEDS_FIXES", "HOLD_FOR_COMPLIANCE_REVIEW", "REJECTED_INTERNAL", "CANCELLED"],
  READY_FOR_EXPORT: ["CANCELLED"],
  NEEDS_FIXES: ["DRAFT", "VALIDATING", "QUEUED", "CANCELLED"],
  HOLD_FOR_COMPLIANCE_REVIEW: ["READY_FOR_EXPORT", "REJECTED_INTERNAL", "CANCELLED"],
  REJECTED_INTERNAL: [],
  FAILED_RETRYABLE: ["QUEUED", "ROUTING", "SUBMITTING", "COLLECTING", "FAILED_FINAL", "CANCELLED"],
  FAILED_FINAL: [],
  CANCELLED: [],
};

export interface VideoProductionRequest {
  jobId?: string;
  projectId?: string;
  conceptId?: string;
  mode: ProductionMode;
  prompt: string;
  script?: string;
  aspectRatio: AspectRatio;
  resolution?: string; // e.g. "768P", "1080P", "2K", "4K"
  targetDurationSeconds?: number;
  voiceoverEnabled?: boolean;
  subtitlesEnabled?: boolean;
  musicMode?: MusicMode;
  providerPreference?: VideoProviderId[];
  maxEstimatedCost?: number;
  allowPaidProviders?: boolean;
  allowFallback?: boolean;
  clientRequestId?: string;
  metadata?: Record<string, unknown>;
}

export interface VideoProductionJob {
  id: string;
  projectId?: string;
  conceptId?: string;
  mode: ProductionMode;
  status: JobStatus;
  stage: string;
  prompt: string;
  script: string;
  aspectRatio: AspectRatio;
  resolution: string;
  targetDurationSeconds: number;
  voiceoverEnabled: boolean;
  subtitlesEnabled: boolean;
  musicMode: MusicMode;
  selectedProvider?: VideoProviderId;
  externalProviderJobId?: string;
  clientRequestId?: string;
  requestJson: Record<string, unknown>;
  routingJson: Record<string, unknown>;
  costGuardState: CostGuardState;
  estimatedCost?: number;
  actualCost?: number;
  currency: string;
  pricingObservedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  metadataJson: Record<string, unknown>;
}

export interface VideoProductionScene {
  id: string;
  jobId: string;
  sceneIndex: number;
  buyerStory: string;
  scriptSegment: string;
  visualPrompt: string;
  negativePrompt: string;
  provider?: string;
  model?: string;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  status: string;
  sourceType: "ai_generated" | "stock_footage" | "local_media";
  sourceAssetId?: string;
  outputAssetId?: string;
  qcStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProductionAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  provider: string;
  providerModel?: string;
  externalProviderJobId?: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  submittedAt?: string;
  finishedAt?: string;
  usageJson: Record<string, unknown>;
  costJson: Record<string, unknown>;
  createdAt: string;
}

export interface VideoProductionArtifact {
  id: string;
  jobId: string;
  attemptId?: string;
  sceneId?: string;
  type: "raw_video" | "processed_video" | "audio" | "subtitle" | "preview_image" | "manifest";
  path: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  fileSizeBytes?: number;
  containerFormat?: string;
  videoCodec?: string;
  audioCodec?: string;
  lineageJson: Record<string, unknown>;
  qcJson: Record<string, unknown>;
  createdAt: string;
}

export interface VideoProviderCapabilities {
  providerId: VideoProviderId;
  available: boolean;
  displayName: string;
  textToVideo: boolean;
  imageToVideo: boolean;
  stockFootage: boolean;
  localMedia: boolean;
  supportedAspectRatios: AspectRatio[];
  supportedResolutions: string[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsAudio: boolean;
  supportsSubtitles: boolean;
  supportsBatch: boolean;
  supportsResume: boolean;
  requiresPaidConfirmation: boolean;
  estimatedCostPerSecondUsd?: number;
  health: ProviderHealthStatus;
}

export interface CostEstimate {
  estimatedCostUsd: number;
  currency: string;
  pricingSource: "rate_table" | "provider_response" | "admin_override" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  observedAt: string;
  requiresApproval: boolean;
}

export interface ProviderSubmission {
  success: boolean;
  externalJobId: string;
  providerId: VideoProviderId;
  providerModel?: string;
  submittedAt: string;
  rawResponse?: Record<string, unknown>;
  error?: string;
}

export interface ProviderJobStatus {
  externalJobId: string;
  status: "submitting" | "running" | "completed" | "failed" | "timeout";
  progress?: number;
  videoUrl?: string;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface ProducedArtifact {
  type: "raw_video" | "processed_video" | "audio" | "subtitle" | "preview_image";
  localPath: string;
  remoteUrl?: string;
  fileSizeBytes?: number;
  mimeType?: string;
}

export interface VideoProductionAdapter {
  id: VideoProviderId;
  healthCheck(): Promise<{ status: ProviderHealthStatus; latencyMs: number; error?: string }>;
  getCapabilities(): Promise<VideoProviderCapabilities>;
  estimate(request: VideoProductionRequest): Promise<CostEstimate>;
  submit(request: VideoProductionRequest): Promise<ProviderSubmission>;
  getStatus(externalJobId: string): Promise<ProviderJobStatus>;
  cancel?(externalJobId: string): Promise<void>;
  recover?(externalJobId: string): Promise<ProviderJobStatus>;
  collectArtifacts(externalJobId: string): Promise<ProducedArtifact[]>;
}

export interface TechnicalVideoQCResult {
  id: string;
  jobId: string;
  artifactId?: string;
  passed: boolean;
  containerFormat?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  fps?: number;
  durationSeconds?: number;
  bitrateKbps?: number;
  fileSizeBytes?: number;
  checks: Array<{ name: string; passed: boolean; message: string }>;
  warnings: string[];
  failures: string[];
  inspectedAt: string;
}

export type CouncilDecision =
  | "READY_FOR_HUMAN_SUBMISSION_REVIEW"
  | "NEEDS_FIXES"
  | "HOLD_FOR_COMPLIANCE_REVIEW"
  | "REJECT_INTERNALLY";

export interface CouncilEvaluationSummary {
  id: string;
  jobId: string;
  artifactId?: string;
  decision: CouncilDecision;
  compositeScore: number; // 0..100
  technicalScore: number;
  commercialScore: number;
  visualScore: number;
  similarityScore: number;
  complianceScore: number;
  similarityFlag: "LOW" | "MEDIUM" | "HIGH" | "NEAR_DUPLICATE";
  rightsStatus: "VERIFIED" | "UNKNOWN" | "HOLD";
  notes: string;
  evaluatedBy: string;
  evaluatedAt: string;
  humanApprovedBy?: string;
  humanApprovedAt?: string;
}

export interface ExportPackage {
  id: string;
  jobId: string;
  artifactId?: string;
  packagePath: string;
  manifestJson: Record<string, unknown>;
  csvContent: string;
  metadataJson: Record<string, unknown>;
  lineageJson: Record<string, unknown>;
  rightsJson: Record<string, unknown>;
  isValid: boolean;
  exportedAt: string;
  createdAt: string;
}
