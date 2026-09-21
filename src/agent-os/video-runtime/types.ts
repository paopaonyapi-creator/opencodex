/**
 * Phase 20.88 — Pao-hubPro × Remotion AI Video Runtime
 * Video-as-Code Scene Graphs, Timeline Compositions, Brand Profiles, and Render Contracts.
 */

export type SceneType =
  | "hook"
  | "problem"
  | "solution"
  | "demonstration"
  | "workflow"
  | "benefit"
  | "cta";

export interface CaptionWord {
  word: string;
  startSec: number;
  endSec: number;
  startFrame: number;
  endFrame: number;
}

export interface CaptionSegment {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  startFrame: number;
  endFrame: number;
  words: CaptionWord[];
}

export interface SceneNode {
  id: string;
  type: SceneType;
  title: string;
  narrationText: string;
  audioDurationSec?: number;
  startFrame: number;
  durationFrames: number;
  visualAssetRef?: string;
  captions: CaptionSegment[];
}

export interface BrandProfile {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontHeading: string;
  fontBody: string;
  logoUri?: string;
  safeZonePaddingPx: number;
}

export interface VideoTemplate {
  id: string;
  name: string;
  category: "mobile_explainer" | "stock_showcase" | "product_ad" | "ugc_review";
  width: number;
  height: number;
  fps: number;
  defaultSceneTypes: SceneType[];
}

export interface TimelineComposition {
  compositionId: string;
  templateId: string;
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
  totalFrames: number;
  scenes: SceneNode[];
  brand: BrandProfile;
  backgroundAudio?: {
    assetRef: string;
    volume: number;
  };
}

export type VideoJobStatus =
  | "draft"
  | "planning"
  | "timeline_compiled"
  | "qc_passed"
  | "qc_failed"
  | "awaiting_approval"
  | "rendering"
  | "completed"
  | "failed";

export interface MediaQcResult {
  jobId: string;
  passed: boolean;
  score: number; // 0 - 100
  checks: {
    resolutionCheck: boolean;
    durationCheck: boolean;
    safeAreaCheck: boolean;
    readabilityCheck: boolean;
    captionAlignmentCheck: boolean;
  };
  warnings: string[];
  recommendations: string[];
}

export interface VideoProductionJob {
  jobId: string;
  title: string;
  topic: string;
  template: VideoTemplate;
  brand: BrandProfile;
  status: VideoJobStatus;
  composition?: TimelineComposition;
  qcResult?: MediaQcResult;
  renderOutput?: {
    outputUri: string;
    format: "mp4" | "webm";
    fileSizeBytes?: number;
  };
  createdAt: string;
  updatedAt: string;
}
