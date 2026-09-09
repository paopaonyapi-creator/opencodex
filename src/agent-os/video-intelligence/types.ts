/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Core Domain Types & Schemas
 */

export type VideoJobIntent =
  | "general"
  | "summary"
  | "hook_analysis"
  | "competitor_analysis"
  | "adobe_stock_qc"
  | "screen_debug"
  | "tutorial_extract"
  | "knowledge_ingest"
  | "video_factory_review";

export type VideoJobStatus =
  | "queued"
  | "downloading"
  | "probing"
  | "extracting_frames"
  | "transcribing"
  | "analyzing"
  | "reviewing"
  | "reporting"
  | "completed"
  | "failed"
  | "cancelled";

export interface VideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  bitrateKbps?: number;
  fileSizeBytes?: number;
  orientation: "landscape" | "portrait" | "square";
  aspectRatio: string;
}

export interface SceneCut {
  timestamp: number;
  frameIndex: number;
  sceneScore: number;
  framePath?: string;
}

export interface HeroFrame {
  frameIndex: number;
  timestamp: number;
  framePath: string;
  score: number;
  reason: string;
}

export interface HookTimelineEvent {
  timestamp: number;
  event: string;
  type: "visual" | "spoken" | "cut" | "overlay" | "promise";
}

export interface HookAnalysis {
  openingType: string;
  firstSpokenTimestamp?: number;
  firstTextTimestamp?: number;
  firstCutTimestamp?: number;
  visualHookScore: number; // 0-100
  pacingSummary: string;
  timeline: HookTimelineEvent[];
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoTranscript {
  language: string;
  provider: "native" | "local-whisper" | "groq-whisper" | "openai-whisper" | "none";
  fullText: string;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
}

export interface PacingMetrics {
  shotCount: number;
  cutsPerMinute: number;
  meanShotLengthSec: number;
  medianShotLengthSec: number;
  longestShotSec: number;
  shortestShotSec: number;
  openingCutRate: number; // cuts in first 10s
  rhythmProfile: "high-energy" | "balanced" | "contemplative" | "static";
}

export interface StockQcFinding {
  severity: "low" | "medium" | "high";
  timestamp: number;
  type: string;
  message: string;
}

export interface StockQcResult {
  verdict: "PASS" | "REVIEW" | "FAIL";
  score: number; // 0-100
  confidence: number; // 0.0-1.0
  issues: StockQcFinding[];
  recommendations: string[];
}

export interface ReviewerEvaluation {
  name: "openai" | "claude" | "local" | string;
  verdict: "pass" | "review" | "fail";
  score: number; // 0-100
  reasoning?: string;
}

export interface VideoCouncilReview {
  reviewers: ReviewerEvaluation[];
  consensus: "pass" | "review" | "fail";
  confidence: number; // 0.0 - 1.0
  evaluatedAt: string;
}

export interface KnowledgeIngestRecord {
  type: "video_analysis";
  source: string;
  title: string;
  summary: string;
  concepts: string[];
  entities: string[];
  reportPath?: string;
  createdAt: string;
}

export interface VideoAnalysisReport {
  jobId: string;
  source: string;
  sourceType: "url" | "file";
  intent: VideoJobIntent;
  metadata: VideoMetadata;
  pacing: PacingMetrics;
  hook?: HookAnalysis;
  transcript: VideoTranscript;
  scenes: SceneCut[];
  heroFrames: HeroFrame[];
  stockQc?: StockQcResult;
  councilReview?: VideoCouncilReview;
  knowledgeRecord?: KnowledgeIngestRecord;
  markdownReport: string;
  createdAt: string;
  completedAt: string;
}

export interface VideoJobConfig {
  intent?: VideoJobIntent;
  sampling?: "auto" | "scene" | "uniform";
  sceneThreshold?: number;
  maxFrames?: number;
  localOnly?: boolean;
  startSec?: number;
  endSec?: number;
  enableHookMicroscope?: boolean;
  reviewerCouncil?: boolean;
  deepAnalysis?: boolean;
  ingestKnowledge?: boolean;
}

export interface VideoJob {
  id: string;
  source: string;
  sourceType: "url" | "file";
  config: VideoJobConfig;
  status: VideoJobStatus;
  progressPercent: number;
  currentStage: string;
  report?: VideoAnalysisReport;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

