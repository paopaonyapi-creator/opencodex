// Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler Types

export type QueueOwnershipState = "PAO_OWNED" | "EXTERNAL" | "UNKNOWN" | "IMPORTED";

export interface QueueItem {
  nativeQueueId: string;
  paoJobId: string | null;
  executionAttemptId: string | null;
  providerId: string;
  workflowId: string | null;
  modelId: string | null;
  status: "running" | "pending";
  submittedAt: string;
  startedAt: string | null;
  priority: number;
  promptHash: string | null;
  ownershipState: QueueOwnershipState;
  estimatedRuntimeSeconds: number;
  metadata: Record<string, unknown>;
}

export interface QueueSnapshot {
  id: string;
  providerId: string;
  instanceId: string | null;
  capturedAt: string;
  runningCount: number;
  queuedCount: number;
  totalActive: number;
  runningItems: QueueItem[];
  queuedItems: QueueItem[];
  oldestQueuedAt: string | null;
  newestQueuedAt: string | null;
  estimatedBacklogSeconds: number;
  estimatedDrainSeconds: number;
  providerHealth: "healthy" | "degraded" | "offline";
  gpuUtilization?: number;
  vramUsed?: number;
  vramTotal?: number;
  details: Record<string, unknown>;
}

export interface BacklogMetrics {
  queuedCount: number;
  runningCount: number;
  queueAgeSeconds: number;
  oldestWaitSeconds: number;
  estimatedDrainSeconds: number;
  arrivalRate: number; // jobs arrived per minute
  completionRate: number; // jobs completed per minute
}

export type PredictionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface RuntimePrediction {
  estimatedSeconds: number;
  confidence: PredictionConfidence;
  sampleCount: number;
  basis: string;
  observedAt: string;
}

export interface AffinityKey {
  modelId: string;
  workflowFamily: string;
  runtimeClass: string;
  requiredNodesHash?: string;
  modelManifestHash?: string;
}

export interface BatchGroup {
  id: string;
  projectId: string | null;
  affinityKey: string;
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  preferredProvider: string | null;
  estimatedTotalRuntime: number;
  createdAt: string;
  updatedAt: string;
}

export type BurstDecision =
  | "NO_BURST"
  | "BURST_RECOMMENDED"
  | "BURST_REQUIRED"
  | "BURST_BLOCKED_BY_BUDGET"
  | "BURST_BLOCKED_BY_POLICY";

export type BurstMode = "OFF" | "MANUAL" | "ASSISTED" | "AUTO";

export interface ScalePlan {
  id: string;
  currentLocalSlots: number;
  currentCloudSlots: number;
  desiredTotalSlots: number;
  desiredCloudSlots: number;
  reason: string;
  estimatedDrainBefore: number; // in seconds
  estimatedDrainAfter: number; // in seconds
  estimatedHourlyCost: number;
  estimatedBatchCost: number;
  confidence: PredictionConfidence;
  decision: BurstDecision;
  status: "pending" | "approved" | "executed" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export type ReconciliationMismatchType =
  | "prompt_missing"
  | "untracked_prompt"
  | "history_unrecorded"
  | "duplicate_prompt";

export interface ReconciliationRecord {
  id: string;
  nativePromptId: string;
  paoJobId: string | null;
  providerId: string;
  mismatchType: ReconciliationMismatchType;
  resolutionStatus: "pending" | "resolved" | "ignored";
  details: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface DispatchSlot {
  providerId: string;
  slotIndex: number; // 0 = running slot, 1 = prefetch slot
  jobId: string | null;
  attemptId: string | null;
  acquiredAt: number | null;
  expiresAt: number | null;
}

export interface SmartQueueConfig {
  enabled: boolean;
  observerIntervalSeconds: number;
  burstMode: BurstMode;
  burstSoftDepth: number;
  burstHardDepth: number;
  targetDrainMinutes: number;
  maxLocalWaitMinutes: number;
  minBurstTimeSavingPercent: number;
  scaleUpCooldownSeconds: number;
  scaleUpStableWindowSeconds: number;
  scaleDownCooldownSeconds: number;
  scaleDownStableWindowSeconds: number;
  providerMaxPending: number;
  maxPrefetchJobsPerProvider: number;
  batchChunkSize: number;
  maxConcurrentPerProject: number;
  affinityWarmMinutes: number;
  aggressiveScaleUp: boolean;
}
