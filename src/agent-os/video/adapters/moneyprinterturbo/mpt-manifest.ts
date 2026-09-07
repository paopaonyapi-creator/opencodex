// MPT Batch Manifest Builder & Serializer
import type { VideoProductionRequest } from "../../domain/types";

export interface MptManifest {
  request_id: string;
  topic: string;
  script: string;
  aspect_ratio: string;
  video_source: string;
  voiceover: boolean;
  subtitle: boolean;
  music: string;
  duration?: number;
  resolution?: string;
  created_at: string;
}

export function buildMptManifest(req: VideoProductionRequest): MptManifest {
  let source = "metaso_minimax";
  if (req.providerPreference && req.providerPreference.length > 0) {
    const pref = req.providerPreference[0];
    if (pref === "seedance") source = "ark_seedance";
    else if (pref === "ofox-wan") source = "ofox";
    else if (pref === "local-media") source = "local";
    else if (pref === "stock-footage") source = "pexels";
  }

  return {
    request_id: req.jobId || ("pao-video-" + Math.random().toString(36).slice(2, 10)),
    topic: req.prompt.trim(),
    script: req.script || "",
    aspect_ratio: req.aspectRatio,
    video_source: source,
    voiceover: Boolean(req.voiceoverEnabled),
    subtitle: Boolean(req.subtitlesEnabled),
    music: req.musicMode || "none",
    duration: req.targetDurationSeconds,
    resolution: req.resolution || "1080P",
    created_at: new Date().toISOString(),
  };
}

export function sanitizeManifestJson(manifest: MptManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export const buildMptTaskManifest = buildMptManifest;
