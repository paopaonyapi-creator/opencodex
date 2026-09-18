// Phase 20.92 — Video Studio public surface.

export * from "./types";
export { segmentScript, hashScript } from "./segmentation";
export { classifyIntent, planScene, planScenesFromBlocks, sceneDurationMs, MVP_RENDERABLE_STRATEGIES } from "./planner";
export { MOTION_PRIMITIVES, MOTION_TEMPLATES, selectTemplate, repetitionWarnings, type MotionTemplate } from "./motion";
export { AssetRegistry, matchVisuals, resolveSceneVisual, compileImagePrompt, MATCHER_WEIGHTS, defaultStudioRoot, type VisualCandidate, type MatchResult, type LadderOutcome, type LadderContext } from "./assets";
export { estimateAlignment, synthesizeSceneVoice, buildCaptionPlan, wrapCaption, type AlignedWord, type VoiceOutcome } from "./voice";
export { buildTimeline } from "./timeline";
export { runQA } from "./qa";
export { renderWithFfmpeg, probeRender, configForProfile, RENDER_PROFILES, type RenderInput, type RenderOutput } from "./renderer";
export { VideoStudioService, getVideoStudioService, type ProjectDetail, type JobStepRecord } from "./service";
export { createVideoStudioMcpTools } from "./mcp-tools";
export type { VideoStudioMcpTool } from "./mcp-tools";
