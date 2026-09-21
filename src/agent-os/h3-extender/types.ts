// Phase 21.02 — Pao-hubPro × MiniMax H3 Extender types.

export type H3ProductionMode = "continuous" | "independent";
export type H3ProjectStatus = "draft" | "in_progress" | "paused" | "completed" | "failed";
export type H3ClipState = "draft" | "queued" | "generating" | "preview_ready" | "validated" | "failed";
export type H3JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface H3Project {
  id: string;
  name: string;
  status: H3ProjectStatus;
  productionMode: H3ProductionMode;
  workflowTemplateId?: string | null;
  workflowTemplateVer: number;
  upstreamVersion: string;
  modelId?: string | null;
  budgetLimit?: number | null;
  estimatedCost: number;
  actualCost: number;
  projectArtifactId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface H3Clip {
  id: string;
  projectId: string;
  sequenceIndex: number;
  name?: string | null;
  state: H3ClipState;
  mode: H3ProductionMode;
  durationSeconds: number;
  promptStructured: Record<string, unknown>;
  promptFinal?: string | null;
  seed?: string | null;
  modelId?: string | null;
  generationHash?: string | null;
  validatedHash?: string | null;
  validatedAt?: string | null;
  validatedById?: string | null;
  activeAttemptId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface H3ClipAttempt {
  id: string;
  clipId: string;
  attemptNumber: number;
  generationHash: string;
  status: "pending" | "running" | "success" | "failed";
  remotePromptId?: string | null;
  workerId?: string | null;
  previewAssetId?: string | null;
  outputAssetId?: string | null;
  failureClass?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  estimatedCost: number;
  actualCost: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface H3Asset {
  id: string;
  projectId: string;
  type: "video" | "audio" | "image" | "lora" | "guide";
  role?: "preview" | "final_clip" | "full_sequence" | "reference" | "guide" | null;
  path: string;
  sha256: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface H3ClipReference {
  id: string;
  clipId: string;
  assetId: string;
  scope: "global" | "clip";
  kind: "visual" | "character" | "style";
  slot: number;
  active: boolean;
  createdAt: string;
}

export interface H3ClipLora {
  id: string;
  clipId: string;
  loraId: string;
  loraHash?: string | null;
  strength: number;
  orderIndex: number;
  purpose?: string | null;
}

export interface H3ClipGuide {
  id: string;
  clipId: string;
  type: "FL2VA" | "depth" | "pose";
  assetId: string;
  frameIndex?: number | null;
  orderIndex: number;
}

export interface H3ExtenderJob {
  id: string;
  projectId: string;
  clipId?: string | null;
  type: "generate" | "preflight" | "export" | "qc";
  state: H3JobState;
  workerId?: string | null;
  remoteJobId?: string | null;
  retryCount: number;
  estimatedCost: number;
  actualCost: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface H3Approval {
  id: string;
  projectId: string;
  clipId?: string | null;
  stage: "preflight" | "clip_validation" | "export" | "stock_submission";
  decision: "pending" | "approved" | "rejected";
  decidedById?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface H3AuditEvent {
  id: string;
  projectId: string;
  actorId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
