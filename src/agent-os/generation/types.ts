// Phase 19 & 20 — Pao AI Generation Studio domain types.

export type JobStatus =
  | "draft"
  | "queued"
  | "validating"
  | "selecting_provider"
  | "waiting_capacity"
  | "awaiting_cloud_approval"
  | "provisioning"
  | "starting_provider"
  | "syncing_runtime"
  | "waiting_provider_ready"
  | "routing"
  | "preparing"
  | "generating"
  | "post_processing"
  | "reviewing"
  | "qc"
  | "metadata"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type JobStage =
  | "validating"
  | "selecting_provider"
  | "waiting_capacity"
  | "awaiting_cloud_approval"
  | "provisioning"
  | "starting_provider"
  | "syncing_runtime"
  | "waiting_provider_ready"
  | "routing"
  | "preparing"
  | "generating"
  | "post_processing"
  | "reviewing"
  | "qc"
  | "metadata"
  | "exporting";

/** The explicit forward chain of the job state machine (spec section 6 & Phase 20 section 25). */
export const JOB_STAGE_ORDER: readonly JobStage[] = [
  "validating",
  "selecting_provider",
  "waiting_capacity",
  "awaiting_cloud_approval",
  "provisioning",
  "starting_provider",
  "syncing_runtime",
  "waiting_provider_ready",
  "routing",
  "preparing",
  "generating",
  "post_processing",
  "reviewing",
  "qc",
  "metadata",
  "exporting",
];

/** Explicit allowed transitions. Anything not listed here is rejected. */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["validating", "selecting_provider", "routing", "cancelled", "paused", "failed"],
  validating: ["selecting_provider", "routing", "preparing", "failed", "cancelled"],
  selecting_provider: ["routing", "waiting_capacity", "awaiting_cloud_approval", "provisioning", "preparing", "generating", "failed", "cancelled"],
  waiting_capacity: ["selecting_provider", "provisioning", "preparing", "failed", "cancelled", "paused"],
  awaiting_cloud_approval: ["selecting_provider", "provisioning", "preparing", "cancelled", "failed"],
  provisioning: ["starting_provider", "syncing_runtime", "waiting_provider_ready", "preparing", "generating", "failed", "cancelled"],
  starting_provider: ["syncing_runtime", "waiting_provider_ready", "preparing", "generating", "failed", "cancelled"],
  syncing_runtime: ["waiting_provider_ready", "preparing", "generating", "failed", "cancelled"],
  waiting_provider_ready: ["preparing", "generating", "failed", "cancelled"],
  routing: ["selecting_provider", "waiting_capacity", "provisioning", "preparing", "generating", "failed", "cancelled"],
  preparing: ["generating", "provisioning", "failed", "cancelled"],
  generating: ["post_processing", "failed", "cancelled"],
  post_processing: ["reviewing", "completed", "failed", "cancelled"],
  reviewing: ["qc", "completed", "failed", "cancelled"],
  qc: ["metadata", "completed", "failed", "cancelled"],
  metadata: ["exporting", "completed", "failed", "cancelled"],
  exporting: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"], // retry path: failed -> re-queued (stage is reset below)
  cancelled: [],
  paused: ["queued", "cancelled"],
};

/** A stage a failed job retries back into (validation errors do NOT retry). */
export const RETRYABLE_STAGES: readonly JobStage[] = [
  "selecting_provider",
  "waiting_capacity",
  "provisioning",
  "starting_provider",
  "syncing_runtime",
  "waiting_provider_ready",
  "routing",
  "preparing",
  "generating",
  "post_processing",
];

export type JobErrorCode =
  | "provider_offline"
  | "provider_timeout"
  | "workflow_invalid"
  | "workflow_missing_node"
  | "model_missing"
  | "validation_error"
  | "output_corrupted"
  | "storage_error"
  | "cancelled"
  | "internal"
  | "RP_AUTH_FAILED"
  | "RP_API_UNAVAILABLE"
  | "RP_RATE_LIMITED"
  | "RP_TEMPLATE_NOT_FOUND"
  | "RP_TEMPLATE_INVALID"
  | "RP_GPU_UNAVAILABLE"
  | "RP_BUDGET_BLOCKED"
  | "RP_POD_CREATE_FAILED"
  | "RP_POD_START_FAILED"
  | "RP_POD_TIMEOUT"
  | "RP_RUNTIME_NOT_READY"
  | "RP_COMFYUI_UNREACHABLE"
  | "RP_MODEL_SYNC_FAILED"
  | "RP_VOLUME_NOT_FOUND"
  | "RP_OUTPUT_SYNC_FAILED"
  | "RP_STOP_FAILED"
  | "RP_TERMINATE_FAILED"
  | "RP_BILLING_SYNC_FAILED";

/** Retryable per spec section 55 & 72; validation/user/budget errors are not. */
export const RETRYABLE_ERROR_CODES: readonly JobErrorCode[] = [
  "provider_offline",
  "provider_timeout",
  "output_corrupted",
  "internal",
  "RP_API_UNAVAILABLE",
  "RP_RATE_LIMITED",
  "RP_GPU_UNAVAILABLE",
  "RP_POD_TIMEOUT",
  "RP_COMFYUI_UNREACHABLE",
  "RP_OUTPUT_SYNC_FAILED",
];

export type JobType =
  | "text_to_image"
  | "image_to_image"
  | "image_edit"
  | "image_upscale"
  | "text_to_video"
  | "image_to_video"
  | "audio_generation"
  | "image_to_text";

export interface GenerationJob {
  id: string;
  parentJobId: string | null;
  projectId: string | null;
  userId: string;
  idempotencyKey: string | null;
  jobType: JobType;
  status: JobStatus;
  stage: JobStage | null;
  priority: number;
  providerId: string | null;
  workflowId: string | null;
  workflowVersion: number | null;
  modelId: string | null;
  prompt: string;
  negativePrompt: string;
  seed: number;
  resolvedSeed: number | null;
  width: number;
  height: number;
  batchSize: number;
  inputAssetIds: string[];
  loras: Array<{ id: string; strength: number }>;
  parameters: Record<string, unknown>;
  stockMode: boolean;
  autoReview: boolean;
  autoMetadata: boolean;
  autoExport: boolean;
  progress: number;
  errorCode: JobErrorCode | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  runAfterMs: number;
  claimedBy: string | null;
  heartbeatMs: number | null;
  cancelRequested: boolean;
  cancelReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export type AssetRole = "original" | "generated" | "edited" | "upscaled" | "input";

export interface GeneratedAsset {
  id: string;
  jobId: string | null;
  projectId: string | null;
  assetType: "image" | "video" | "audio" | "text";
  role: AssetRole;
  filename: string;
  storagePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fps: number | null;
  fileSize: number;
  sha256: string;
  prompt: string;
  negativePrompt: string;
  seed: number | null;
  modelId: string | null;
  workflowId: string | null;
  workflowVersion: number | null;
  providerId: string | null;
  parentAssetId: string | null;
  sourceJobId: string | null;
  generationMetadata: Record<string, unknown>;
  technicalScore: number | null;
  visualScore: number | null;
  commercialScore: number | null;
  policyScore: number | null;
  overallScore: number | null;
  reviewStatus: "pending" | "approved" | "needs_fixes" | "rejected" | "hold";
  stockStatus: "none" | "ready" | "manual_review" | "rejected" | "exported";
  metadataStatus: "none" | "pending" | "complete" | "failed";
  exportStatus: "none" | "pending" | "complete" | "failed";
  favorite: boolean;
  userRating: number | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinition {
  id: string;
  version: number;
  name: string;
  category: JobType | "utility" | "identity_edit" | "controlnet" | "face_swap" | "lipsync" | "video_upscale";
  provider: string;
  workflowJson: string;
  enabled: boolean;
  status: "ready" | "missing_model" | "missing_node" | "invalid_binding" | "provider_offline" | "disabled";
  capabilities: string[];
  bindings: Record<string, { node_id: string; input_key: string }>;
  outputNodes: Array<{ node_id: string; type: "image" | "video" | "audio" | "text" }>;
  requiredInputs: string[];
  optionalInputs: string[];
  parameterSchema: Record<string, unknown>;
  modelRequirements: Record<string, unknown>;
  minVramGb: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerationProvider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  maxConcurrency: number;
  timeoutSeconds: number;
  capabilities: Record<string, unknown>;
  healthStatus: "unknown" | "healthy" | "degraded" | "offline";
  lastHealthCheckMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GenerationModel {
  id: string;
  displayName: string;
  family: string;
  type: string;
  checkpointName: string;
  provider: string;
  minVramGb: number | null;
  recommendedVramGb: number | null;
  licenseNotes: string;
  commercialUseNotes: string;
  enabled: boolean;
  tags: string[];
  createdAt: string;
}

export interface GenerationLora {
  id: string;
  name: string;
  filename: string;
  baseModelFamily: string;
  triggerWords: string[];
  defaultStrength: number;
  minStrength: number;
  maxStrength: number;
  commercialUseNotes: string;
  enabled: boolean;
  tags: string[];
  createdAt: string;
}

export interface GenerationProject {
  id: string;
  name: string;
  description: string;
  mode: "general" | "adobe_stock" | "social" | "product";
  defaultWorkflow: string | null;
  defaultModel: string | null;
  createdAt: string;
}

export type ReviewDecision = "PASS" | "PASS_WITH_WARNING" | "REWORK" | "REJECT";

export interface GenerationReviewIssue {
  code: string;
  severity: "info" | "low" | "medium" | "high" | "blocking";
  message: string;
  region?: string | null;
  suggestedAction?: "rework" | "reject" | "accept" | "manual_review";
}

export interface GenerationReview {
  id: string;
  assetId: string;
  reviewer: string;
  reviewType: string;
  score: number | null;
  verdict: "pass" | "warn" | "fail";
  decision: ReviewDecision;
  issues: GenerationReviewIssue[];
  suggestions: string[];
  raw: Record<string, unknown>;
  createdAt: string;
}

export interface StockMetadataRecord {
  assetId: string;
  title: string;
  description: string;
  keywords: string[];
  category: number | null;
  commercialIntent: string;
  releaseRequired: boolean;
  aiGenerated: boolean;
  editorial: boolean;
  language: string;
  metadataVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportPackageRecord {
  id: string;
  assetId: string;
  destination: string;
  status: "pending" | "complete" | "failed";
  packagePath: string | null;
  imagePath: string | null;
  metadataPath: string | null;
  manifestPath: string | null;
  csvPath: string | null;
  checksum: string | null;
  mode: "stock-ready" | "manual-review";
  createdAt: string;
  completedAt: string | null;
}

export interface GenerationAuditEntry {
  id: number;
  tsMs: number;
  actor: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  details: Record<string, unknown>;
}

export interface GenerationJobEvent {
  id: number;
  jobId: string;
  tsMs: number;
  type: string;
  stage: string | null;
  progress: number | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Phase 20 — Multi-GPU Generation Grid × RunPod Intelligent Workload Router
// ---------------------------------------------------------------------------

export type RoutingMode = "AUTO" | "LOCAL_ONLY" | "CLOUD_ONLY" | "CHEAPEST" | "FASTEST" | "BALANCED";

export type WorkloadClass =
  | "LIGHT_IMAGE"
  | "STANDARD_IMAGE"
  | "HEAVY_IMAGE"
  | "IMAGE_EDIT"
  | "UPSCALE_IMAGE"
  | "LIGHT_VIDEO"
  | "HEAVY_VIDEO"
  | "VIDEO_UPSCALE"
  | "AUDIO"
  | "VISION"
  | "BATCH";

export interface ComputeInstance {
  id: string;
  providerId: string;
  providerType: "comfyui-local" | "comfyui-remote" | "runpod";
  externalId: string | null;
  name: string;
  lifecycleState: "unknown" | "creating" | "provisioned" | "starting" | "booting" | "ready" | "busy" | "idle" | "stopping" | "stopped" | "terminating" | "terminated" | "failed";
  healthState: "unknown" | "healthy" | "degraded" | "unreachable" | "runtime_failed" | "provider_failed";
  gpuType: string | null;
  gpuCount: number;
  gpuMemoryGb: number | null;
  region: string | null;
  datacenterId: string | null;
  templateId: string | null;
  networkVolumeId: string | null;
  baseUrl: string | null;
  internalMetadata: Record<string, unknown>;
  ownershipToken: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  lastSeenAt: string | null;
  stoppedAt: string | null;
  terminatedAt: string | null;
}

export interface GpuCapabilityProfile {
  id: string;
  gpuTypeId: string;
  displayName: string;
  vramGb: number;
  architecture: string;
  provider: string;
  supportsCuda: boolean;
  allowedWorkloadClasses: WorkloadClass[];
  observedPricePerHour: number | null;
  priceObservedAt: string | null;
  benchmarkScore: number;
  enabled: boolean;
  notes: string;
}

export interface WorkloadRequirement {
  jobId: string;
  workflowId: string | null;
  modelId: string | null;
  jobType: JobType;
  workloadClass: WorkloadClass;
  minVramGb: number;
  preferredVramGb: number;
  gpuCount: number;
  minCuda: boolean;
  requiredModels: string[];
  requiredLoras: string[];
  requiredCustomNodes: string[];
  estimatedRuntimeSeconds: number;
  estimatedInputBytes: number;
  estimatedOutputBytes: number;
  priority: number;
  stockMode: boolean;
  requiresPersistentCache: boolean;
}

export interface PlacementCandidateScore {
  provider: string;
  instanceId?: string;
  gpuType: string;
  decisionScore: number;
  estimatedHourlyCost: number;
  estimatedJobCost: number;
  availabilityScore: number;
  modelLocalityScore: number;
  performanceScore: number;
  costScore: number;
  queuePenalty: number;
  coldStartPenalty: number;
  reason: string;
}

export interface PlacementDecision {
  id: string;
  jobId: string;
  selectedProvider: string;
  selectedInstanceId: string | null;
  selectedGpu: string | null;
  decisionScore: number;
  estimatedHourlyCost: number | null;
  estimatedJobCost: number | null;
  coldStartPenalty: number;
  queuePenalty: number;
  modelLocalityScore: number;
  availabilityScore: number;
  costScore: number;
  performanceScore: number;
  reason: string;
  alternatives: PlacementCandidateScore[];
  createdAt: string;
}

export interface CloudResourceLease {
  id: string;
  resourceType: string;
  resourceId: string;
  owner: string;
  leaseToken: string;
  acquiredAt: number;
  expiresAt: number;
  heartbeatAt: number;
}

export interface RunPodPodRecord {
  id: string;
  runpodPodId: string;
  templateId: string | null;
  gpuType: string;
  gpuCount: number;
  datacenterId: string | null;
  networkVolumeId: string | null;
  desiredState: string;
  actualState: string;
  costPerHour: number;
  createdByPao: boolean;
  ownershipMarker: string;
  currentJobId: string | null;
  lastActiveAt: string | null;
  idleSince: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunPodBillingRecord {
  id: string;
  provider: string;
  podId: string;
  gpuType: string;
  period: string | null;
  amount: number;
  timeBilledMs: number;
  observedAt: string;
  createdAt: string;
}

export interface ExecutionAttempt {
  id: string;
  jobId: string;
  attempt: number;
  provider: string;
  instanceId: string | null;
  gpuType: string | null;
  startedAt: string;
  completedAt: string | null;
  runtimeSeconds: number | null;
  estimatedCost: number | null;
  actualCost: number | null;
  status: "started" | "completed" | "failed" | "interrupted";
  error: Record<string, unknown>;
}

export interface ComputePriceObservation {
  id: number;
  provider: string;
  gpuType: string;
  pricePerHour: number;
  observedAt: string;
}

export type BudgetDecisionVerdict = "ALLOW" | "WARN" | "BLOCK" | "REQUIRE_APPROVAL";

export interface BudgetDecision {
  verdict: BudgetDecisionVerdict;
  allowed: boolean;
  estimatedCost: number;
  hourlyPrice: number;
  currentDailySpend: number;
  currentMonthlySpend: number;
  activePods: number;
  reasons: string[];
}

export interface FinOpsSummary {
  todaySpend: number;
  monthlySpend: number;
  dailyBudget: number;
  monthlyBudget: number;
  budgetRemaining: number;
  activeCostPerHour: number;
  activePodCount: number;
  spendByGpu: Record<string, number>;
  spendByProject: Record<string, number>;
}

