// Phase 20.92 — AI Script-to-Video Studio: canonical domain model + Zod schemas.
//
// Semantic/director layer on top of the Phase 20.7 video factory: this module
// owns WHAT the video says and shows (script → scenes → visuals → motion →
// timeline); the 20.7 subsystem keeps owning provider production, QC and
// export. One-schema law: UI, agents, the timeline engine and the renderer all
// read and write THIS shape — provider adapters never invent their own project
// schema in the business layer.
//
// Validation law: every LLM-produced structured payload is parsed through the
// schemas below before it enters the project model. Raw model JSON is never
// trusted (source §61).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:5"]);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

/** 16 scene intents (source §10) — primary input to template/motion selection. */
export const SceneIntentSchema = z.enum([
  "INTRO_HOOK", "DEFINITION", "EXPLANATION", "PROCESS", "COMPARISON",
  "STATISTIC", "QUOTE", "TIMELINE", "LIST", "PRODUCT_FEATURE",
  "SCREEN_DEMO", "MAP", "PERSON", "CONCEPT", "CTA", "OUTRO",
]);
export type SceneIntent = z.infer<typeof SceneIntentSchema>;

/** 8 script-block semantic roles (source §7). */
export const SemanticRoleSchema = z.enum([
  "hook", "setup", "explanation", "example", "comparison", "transition", "cta", "conclusion",
]);
export type SemanticRole = z.infer<typeof SemanticRoleSchema>;

/** 20 visual strategies (source §12). MVP renders a deterministic subset. */
export const VisualStrategySchema = z.enum([
  "ICON", "ILLUSTRATION", "AI_IMAGE", "AI_VIDEO", "STOCK_VIDEO", "SCREENSHOT",
  "SCREEN_RECORDING", "TEXT_ONLY", "KINETIC_TYPOGRAPHY", "CHART", "INFOGRAPHIC",
  "MAP", "QUOTE", "PERSON", "PRODUCT", "DIAGRAM", "TIMELINE", "LIST",
  "COMPARISON", "MIXED_MEDIA",
]);
export type VisualStrategy = z.infer<typeof VisualStrategySchema>;

export const MotionPrimitiveSchema = z.enum([
  "fade", "slide", "scale", "spring", "pop", "stagger", "wipe", "maskReveal",
  "countUp", "typewriter", "highlight", "underline", "pulse", "pan", "zoom",
  "parallax", "followPath", "morph",
]);
export type MotionPrimitive = z.infer<typeof MotionPrimitiveSchema>;

export const CaptionModeSchema = z.enum([
  "FULL_SUBTITLE", "PHRASE_HIGHLIGHT", "WORD_HIGHLIGHT", "KARAOKE", "KEYWORD_ONLY", "NONE",
]);
export type CaptionMode = z.infer<typeof CaptionModeSchema>;

export const SceneStatusSchema = z.enum(["draft", "planned", "assets_ready", "approved", "rendered"]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const TrackTypeSchema = z.enum([
  "video", "image", "graphics", "text", "voice", "music", "sfx", "caption",
]);
export type TrackType = z.infer<typeof TrackTypeSchema>;

export const AssetTypeSchema = z.enum(["image", "video", "audio", "icon", "font", "template"]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSourceKindSchema = z.enum(["local", "generated", "stock", "uploaded", "provider"]);
export type AssetSourceKind = z.infer<typeof AssetSourceKindSchema>;

export const ProjectStatusSchema = z.enum([
  "DRAFT", "SCRIPTED", "SEGMENTED", "PLANNED", "ASSETS_READY", "TIMELINE_READY",
  "QA_PASSED", "WAITING_APPROVAL", "RENDERING", "RENDERED", "EXPORTED",
  "FAILED_RETRYABLE", "FAILED_BLOCKED", "CANCELLED",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Video-studio pipeline steps (durable, resumable — source §28). */
export const JobStepSchema = z.enum([
  "SEGMENT", "PLAN", "RESOLVE_ASSETS", "GENERATE_ASSETS", "VOICE",
  "ALIGN", "CAPTIONS", "TIMELINE", "QA", "PREVIEW_RENDER", "FINAL_RENDER", "EXPORT",
]);
export type JobStep = z.infer<typeof JobStepSchema>;

export const QualityPresetSchema = z.enum(["FAST", "BALANCED", "QUALITY", "STOCK"]);
export type QualityPreset = z.infer<typeof QualityPresetSchema>;

export const RenderProfileSchema = z.enum([
  "PREVIEW_720P", "YOUTUBE_1080P", "SHORTS_1080X1920",
  "YOUTUBE_4K", "INSTAGRAM_REEL", "TIKTOK", "SQUARE_1080", "ADOBE_STOCK_HD", "ADOBE_STOCK_4K",
]);
export type RenderProfile = z.infer<typeof RenderProfileSchema>;

/** Scene-level locks (source §37) — human override wins; agents may not touch locked fields. */
export const SceneLocksSchema = z.object({
  script: z.boolean().default(false),
  asset: z.boolean().default(false),
  layout: z.boolean().default(false),
  motion: z.boolean().default(false),
  timing: z.boolean().default(false),
  voice: z.boolean().default(false),
});
export type SceneLocks = z.infer<typeof SceneLocksSchema>;

// ---------------------------------------------------------------------------
// Script & scenes
// ---------------------------------------------------------------------------

export const ScriptBlockSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  semanticRole: SemanticRoleSchema,
  keywords: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  visualHints: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  estimatedSpeechMs: z.number().int().positive(),
});
export type ScriptBlock = z.infer<typeof ScriptBlockSchema>;

export const ScriptDocumentSchema = z.object({
  language: z.string().default("en"),
  title: z.string().optional(),
  hook: z.string().optional(),
  blocks: z.array(ScriptBlockSchema).min(1),
  estimatedSpeechDurationMs: z.number().int().nonnegative(),
});
export type ScriptDocument = z.infer<typeof ScriptDocumentSchema>;

export const VisualPlanSchema = z.object({
  strategy: VisualStrategySchema,
  layout: z.string(),
  assetRequirements: z.array(z.object({ kind: AssetTypeSchema, query: z.string(), optional: z.boolean().default(false) })).default([]),
  resolvedAssetIds: z.array(z.string()).default([]),
  explanation: z.string().default(""),
  /** Bumped on every visual regeneration — provenance tracks each version. */
  generationVersion: z.number().int().nonnegative().default(0),
  /** How the current visual was produced — fallback is never shown as AI. */
  generationClass: z.enum(["ai-generated", "deterministic-fallback", "library"]).optional(),
  candidateScores: z.array(z.object({
    candidateId: z.string(),
    score: z.number(),
    reasons: z.array(z.string()),
    selected: z.boolean().default(false),
  })).default([]),
});
export type VisualPlan = z.infer<typeof VisualPlanSchema>;

export const MotionCueSchema = z.object({
  primitive: MotionPrimitiveSchema,
  target: z.string().default("scene"),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type MotionCue = z.infer<typeof MotionCueSchema>;

export const MotionPlanSchema = z.object({
  templateId: z.string(),
  entrance: z.string().default("fade"),
  emphasis: z.string().default("pulse"),
  exit: z.string().default("fade"),
  cues: z.array(MotionCueSchema).default([]),
});
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export const CaptionCueSchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  highlight: z.array(z.string()).default([]),
});
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const CaptionPlanSchema = z.object({
  mode: CaptionModeSchema.default("FULL_SUBTITLE"),
  cues: z.array(CaptionCueSchema).default([]),
  maxLines: z.number().int().positive().default(2),
  safeAreaBottomMs: z.boolean().default(true),
  overflowRisk: z.boolean().default(false),
});
export type CaptionPlan = z.infer<typeof CaptionPlanSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  order: z.number().int().nonnegative(),
  blockIds: z.array(z.string()).default([]),
  narrationText: z.string(),
  intent: SceneIntentSchema,
  durationMs: z.number().int().positive(),
  estimatedSpeechMs: z.number().int().nonnegative().default(0),
  alignmentMs: z.number().int().nonnegative().default(0),
  visualPlan: VisualPlanSchema,
  motionPlan: MotionPlanSchema,
  captions: CaptionPlanSchema,
  transitionInMs: z.number().int().nonnegative().default(300),
  transitionOutMs: z.number().int().nonnegative().default(300),
  locks: SceneLocksSchema,
  /** Disabled scenes are skipped by the timeline/render but kept for re-enable. */
  disabled: z.boolean().default(false),
  status: SceneStatusSchema.default("draft"),
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const MediaAssetSchema = z.object({
  id: z.string(),
  type: AssetTypeSchema,
  uri: z.string(),
  checksum: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  mimeType: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.object({
    kind: AssetSourceKindSchema,
    provider: z.string().optional(),
    model: z.string().optional(),
    sourceUrl: z.string().optional(),
    projectId: z.string().optional(),
  }),
  license: z.object({ type: z.string(), notes: z.string().optional() }).optional(),
  createdAt: z.string(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// ---------------------------------------------------------------------------
// Brand & audio
// ---------------------------------------------------------------------------

export const BrandKitSchema = z.object({
  id: z.string(),
  name: z.string(),
  typography: z.object({
    headingFont: z.string().default("Arial"),
    bodyFont: z.string().default("Arial"),
    weights: z.array(z.number()).default([400, 700]),
  }),
  palette: z.object({
    primary: z.string().default("#1d1d1f"),
    secondary: z.string().default("#6e6e73"),
    accent: z.string().default("#0a84ff"),
    background: z.string().default("#ffffff"),
    foreground: z.string().default("#1d1d1f"),
  }),
  logoAssetIds: z.array(z.string()).default([]),
  motionProfile: z.object({
    energy: z.enum(["calm", "balanced", "dynamic"]).default("balanced"),
    preferredTransitions: z.array(z.string()).default(["fade"]),
  }),
  visualStyle: z.object({
    cornerRadius: z.number().int().nonnegative().default(24),
    iconStyle: z.string().default("outline"),
    illustrationStyle: z.string().optional(),
  }),
  locks: z.object({ brand: z.boolean().default(false), typography: z.boolean().default(false), colors: z.boolean().default(false), motionLanguage: z.boolean().default(false) }),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

export const AudioPlanSchema = z.object({
  voiceProvider: z.string().default("mock"),
  voiceProfileId: z.string().default("default"),
  language: z.string().default("en"),
  alignmentMethod: z.enum(["provider", "estimated"]).default("estimated"),
  narrationAssetId: z.string().optional(),
  musicAssetId: z.string().optional(),
  cues: z.array(z.object({ sceneId: z.string(), startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive() })).default([]),
});
export type AudioPlan = z.infer<typeof AudioPlanSchema>;

// ---------------------------------------------------------------------------
// Timeline (deterministic — the engine computes frames, never the LLM)
// ---------------------------------------------------------------------------

export const TimelineClipSchema = z.object({
  id: z.string(),
  trackType: TrackTypeSchema,
  sceneId: z.string(),
  sourceId: z.string().optional(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  text: z.string().optional(),
  transitionInMs: z.number().int().nonnegative().default(0),
});
export type TimelineClip = z.infer<typeof TimelineClipSchema>;

export const TimelineTrackSchema = z.object({
  id: z.string(),
  type: TrackTypeSchema,
  clips: z.array(TimelineClipSchema),
});
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;

export const TimelineSchema = z.object({
  fps: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  tracks: z.array(TimelineTrackSchema),
  timelineHash: z.string(),
});
export type Timeline = z.infer<typeof TimelineSchema>;

// ---------------------------------------------------------------------------
// Render, QA, governance records
// ---------------------------------------------------------------------------

export const RenderConfigSchema = z.object({
  profile: RenderProfileSchema.default("PREVIEW_720P"),
  engine: z.enum(["ffmpeg", "remotion"]).default("ffmpeg"),
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
  fps: z.number().int().positive().default(30),
  bitrateKbps: z.number().int().positive().default(2000),
});
export type RenderConfig = z.infer<typeof RenderConfigSchema>;

export const QAReportSchema = z.object({
  projectId: z.string(),
  passed: z.boolean(),
  checks: z.array(z.object({
    category: z.enum(["script", "asset", "layout", "timeline", "audio", "render"]),
    name: z.string(),
    passed: z.boolean(),
    detail: z.string().default(""),
  })),
  createdAt: z.string(),
});
export type QAReport = z.infer<typeof QAReportSchema>;

export const ApprovalKindSchema = z.enum([
  "SCRIPT_APPROVAL", "STORYBOARD_APPROVAL", "ASSET_APPROVAL", "DRAFT_VIDEO_APPROVAL", "FINAL_EXPORT_APPROVAL",
]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ProvenanceRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sceneId: z.string().nullable(),
  origin: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptHash: z.string().nullable(),
  inputHash: z.string().nullable(),
  outputHash: z.string().nullable(),
  license: z.string().nullable(),
  createdAt: z.string(),
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

export const CostEventSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sceneId: z.string().nullable(),
  provider: z.string(),
  operation: z.string(),
  costUsd: z.number().nonnegative(),
  createdAt: z.string(),
});
export type CostEvent = z.infer<typeof CostEventSchema>;

export const ProjectBudgetSchema = z.object({
  maxUsd: z.number().positive().optional(),
  maxImageGenerations: z.number().int().positive().optional(),
  maxVideoGenerations: z.number().int().positive().optional(),
  maxRenderMinutes: z.number().positive().optional(),
});
export type ProjectBudget = z.infer<typeof ProjectBudgetSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const VideoProjectInputSchema = z.object({
  title: z.string().min(1).max(200),
  sourceType: z.enum(["topic", "script", "article", "template", "batch"]).default("script"),
  rawInput: z.string().default(""),
  aspectRatio: AspectRatioSchema.default("16:9"),
  fps: z.number().int().positive().default(30),
  language: z.string().default("en"),
  brandKitId: z.string().optional(),
  budget: ProjectBudgetSchema.optional(),
  quality: QualityPresetSchema.default("BALANCED"),
  /** Target total duration in seconds — drives scene-count budgeting (source §6). */
  targetDurationSec: z.number().positive().max(3600).optional(),
  /** Preferred motion template id (honoured when it supports the scene intent). */
  templateId: z.string().optional(),
  /** Visual/voice provider preferences — "auto" routes by capability matrix. */
  visualProvider: z.enum(["auto", "comfyui", "deterministic-card"]).default("auto"),
  voiceProvider: z.enum(["auto", "voicestudio", "mock-speech"]).default("auto"),
});
export type VideoProjectInput = z.infer<typeof VideoProjectInputSchema>;

/** Persisted operator preferences from the INPUT section (GOLD P1 UI). */
export const ProjectPrefsSchema = z.object({
  templateId: z.string().nullable().default(null),
  visualProvider: z.enum(["auto", "comfyui", "deterministic-card"]).default("auto"),
  voiceProvider: z.enum(["auto", "voicestudio", "mock-speech"]).default("auto"),
});
export type ProjectPrefs = z.infer<typeof ProjectPrefsSchema>;

export const VideoProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: ProjectStatusSchema,
  format: z.object({
    aspectRatio: AspectRatioSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    targetDurationSec: z.number().positive().optional(),
  }),
  source: z.object({ type: z.enum(["topic", "script", "article", "template", "batch"]), rawInput: z.string() }),
  language: z.string().default("en"),
  quality: QualityPresetSchema,
  brandKitId: z.string().nullable(),
  budget: ProjectBudgetSchema.nullable(),
  prefs: ProjectPrefsSchema.nullable(),
  scriptHash: z.string().nullable(),
  plansHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VideoProject = z.infer<typeof VideoProjectSchema>;

/** Aspect-ratio → pixel dimensions (source §26 render profiles). */
export const ASPECT_DIMENSIONS: Record<AspectRatio, { preview: [number, number]; final: [number, number] }> = {
  "16:9": { preview: [1280, 720], final: [1920, 1080] },
  "9:16": { preview: [720, 1280], final: [1080, 1920] },
  "1:1": { preview: [720, 720], final: [1080, 1080] },
  "4:5": { preview: [720, 900], final: [1080, 1350] },
};

/** Wrong-shape payloads are rejected, never silently coerced (source §61). */
export function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, payload: unknown, what: string): T {
  try {
    return schema.parse(payload);
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(err);
    throw new VideoStudioError("SCHEMA_INVALID", 422, `${what} failed structured validation — raw model output is not trusted`, { detail });
  }
}

export type VideoStudioErrorCode =
  | "PROJECT_NOT_FOUND" | "SCENE_NOT_FOUND" | "ASSET_NOT_FOUND" | "SCHEMA_INVALID"
  | "LOCKED_FIELD" | "BUDGET_EXCEEDED" | "APPROVAL_REQUIRED" | "ASSET_UNRESOLVED"
  | "RENDER_FAILED" | "RENDER_ENGINE_UNAVAILABLE" | "VOICE_UNAVAILABLE"
  | "SEGMENTATION_FAILED" | "QA_FAILED" | "INVALID_TRANSITION";

export class VideoStudioError extends Error {
  readonly code: VideoStudioErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;
  constructor(code: VideoStudioErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "VideoStudioError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}
