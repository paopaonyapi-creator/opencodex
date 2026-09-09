/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Central Barrel Export & Singletons
 */

import { VideoJobManager } from "./job-manager";

export * from "./types";
export { VideoSecurityValidator } from "./security";
export { MediaProbe } from "./media-probe";
export { FrameExtractor } from "./frame-extractor";
export { HookAnalyzer } from "./hook-analyzer";
export { TranscriptEngine } from "./transcript-engine";
export { PacingAnalyzer } from "./pacing-analyzer";
export { StockQcEngine } from "./stock-qc";
export { ReportBuilder } from "./report-builder";
export { VideoJobManager } from "./job-manager";
export { VideoReviewerCouncil } from "./council-adapter";
export { KnowledgeAdapter } from "./knowledge-adapter";
export { VideoDbStore } from "./db-store";
export * from "./mcp-tools";

let defaultJobManager: VideoJobManager | null = null;

export function getVideoJobManager(): VideoJobManager {
  if (!defaultJobManager) {
    defaultJobManager = new VideoJobManager();
  }
  return defaultJobManager;
}

export function resetVideoJobManager(): void {
  defaultJobManager = null;
}
