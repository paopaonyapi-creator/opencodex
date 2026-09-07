// Phase 20.7 — Zod Schemas for Input Validation and Boundary Safety
import { z } from "zod";

export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);

export const ProductionModeSchema = z.enum([
  "adobe_stock",
  "social",
  "preview",
  "internal",
]);

export const MusicModeSchema = z.enum([
  "none",
  "user_owned",
  "approved_library",
  "provider",
]);

export const VideoProviderIdSchema = z.enum([
  "moneyprinterturbo",
  "metaso-minimax-h3",
  "seedance",
  "ofox-wan",
  "comfyui-video",
  "runpod-video",
  "local-media",
  "stock-footage",
  "mock-mpt",
]);

export const VideoProductionRequestSchema = z.object({
  jobId: z.string().optional(),
  projectId: z.string().optional(),
  conceptId: z.string().optional(),
  mode: ProductionModeSchema.default("adobe_stock"),
  prompt: z.string().min(3, "Prompt must be at least 3 characters").max(4000),
  script: z.string().max(8000).optional().default(""),
  aspectRatio: AspectRatioSchema.default("16:9"),
  resolution: z.string().optional().default("1080P"),
  targetDurationSeconds: z.number().positive().max(120).default(8.0),
  voiceoverEnabled: z.boolean().default(false),
  subtitlesEnabled: z.boolean().default(false),
  musicMode: MusicModeSchema.default("none"),
  providerPreference: z.array(VideoProviderIdSchema).optional(),
  maxEstimatedCost: z.number().positive().optional(),
  allowPaidProviders: z.boolean().default(true),
  allowFallback: z.boolean().default(true),
  clientRequestId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const MptManifestSchema = z.object({
  request_id: z.string(),
  topic: z.string(),
  script: z.string().default(""),
  aspect_ratio: z.string().default("16:9"),
  video_source: z.string().default("metaso_minimax"),
  voiceover: z.boolean().default(false),
  subtitle: z.boolean().default(false),
  music: z.string().default("none"),
  duration: z.number().optional(),
  resolution: z.string().optional(),
});
