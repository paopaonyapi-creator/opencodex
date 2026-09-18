// Phase 20.92 — Deterministic Video Renderer (ffmpeg engine).
//
// Render boundary law (source §25 / GOLD §22): the renderer receives the
// finished timeline + resolved asset URIs and NEVER calls an LLM/image/video
// generation service during rendering. All plans and assets must be ready
// before render starts. Remotion is not installed in this repository yet —
// the ffmpeg engine is the real deterministic preview path (images + audio +
// caption burn-in via drawtext), and `render.engine: "remotion"` is the
// adapter seam for the Phase 20.88a renderer when it lands.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import { defaultFontFile } from "./assets";
import { VideoStudioError, type RenderConfig, type Timeline } from "./types";

export interface RenderInput {
  projectId: string;
  timeline: Timeline;
  /** sceneId → image/card asset absolute URI (from the asset registry). */
  visualUris: Map<string, string>;
  /** sceneId → narration WAV asset absolute URI. */
  voiceUris: Map<string, string>;
  outputDir: string;
}

export interface RenderOutput {
  path: string;
  durationMs: number;
  engine: "ffmpeg";
  width: number;
  height: number;
  checksum: string;
}

export const RENDER_PROFILES: Record<string, { width: number; height: number; bitrateKbps: number }> = {
  PREVIEW_720P: { width: 1280, height: 720, bitrateKbps: 2000 },
  YOUTUBE_1080P: { width: 1920, height: 1080, bitrateKbps: 8000 },
  SHORTS_1080X1920: { width: 1080, height: 1920, bitrateKbps: 8000 },
  SQUARE_1080: { width: 1080, height: 1080, bitrateKbps: 6000 },
  YOUTUBE_4K: { width: 3840, height: 2160, bitrateKbps: 24000 },
  INSTAGRAM_REEL: { width: 1080, height: 1920, bitrateKbps: 8000 },
  TIKTOK: { width: 1080, height: 1920, bitrateKbps: 8000 },
  ADOBE_STOCK_HD: { width: 1920, height: 1080, bitrateKbps: 12000 },
  ADOBE_STOCK_4K: { width: 3840, height: 2160, bitrateKbps: 30000 },
};

export function configForProfile(profile: RenderConfig["profile"], fps: number): RenderConfig {
  const p = RENDER_PROFILES[profile] ?? RENDER_PROFILES.PREVIEW_720P!;
  return { profile, engine: "ffmpeg", width: p.width, height: p.height, fps, bitrateKbps: p.bitrateKbps };
}

/**
 * Render-engine selection seam (GOLD P1): "remotion" requires the Remotion
 * packages to be installed; they are not part of this repository today, so the
 * request fails with a structured code instead of degrading silently. The
 * ffmpeg engine is the verified deterministic production path.
 */
export function assertRenderEngine(engine: RenderConfig["engine"]): void {
  if (engine === "remotion") {
    try {
      require.resolve("remotion");
    } catch {
      throw new VideoStudioError("RENDER_ENGINE_UNAVAILABLE", 409, "remotion is not installed in this repository — use engine 'ffmpeg' or install remotion + @remotion/renderer");
    }
  }
}

/**
 * Render the timeline to MP4 with ffmpeg. Each scene contributes one image
 * segment with its narration audio; captions burn in via drawtext on the
 * bottom safe area. The filtergraph is assembled deterministically from the
 * timeline — no AI calls, no network.
 */
export function renderWithFfmpeg(input: RenderInput, config: RenderConfig): RenderOutput {
  if (!input.timeline.tracks.some((t) => t.clips.length > 0)) {
    throw new VideoStudioError("RENDER_FAILED", 422, "timeline has no clips — build the timeline before rendering");
  }
  for (const [sceneId, uri] of input.visualUris) {
    if (!existsSync(uri)) {
      throw new VideoStudioError("ASSET_UNRESOLVED", 422, `visual asset for scene ${sceneId} missing on disk before render: ${uri}`);
    }
  }

  mkdirSync(input.outputDir, { recursive: true });
  const outName = `render_${config.profile.toLowerCase()}_${createHash("sha256").update(input.timeline.timelineHash + config.profile).digest("hex").slice(0, 12)}.mp4`;
  const outPath = join(input.outputDir, outName);

  const visualTrack = input.timeline.tracks.find((t) => t.type === "image")!;
  const voiceTrack = input.timeline.tracks.find((t) => t.type === "voice")!;
  const captionTrack = input.timeline.tracks.find((t) => t.type === "caption")!;
  const visualClips = [...visualTrack.clips].sort((a, b) => a.startMs - b.startMs);
  if (visualClips.length === 0) {
    throw new VideoStudioError("RENDER_FAILED", 422, "timeline visual track is empty");
  }

  // Concat scene images scaled to the profile canvas.
  const parts: string[] = [];
  const inputs: string[] = [];
  visualClips.forEach((clip, index) => {
    const uri = input.visualUris.get(clip.sceneId);
    if (!uri) throw new VideoStudioError("ASSET_UNRESOLVED", 422, `no visual asset for scene ${clip.sceneId}`);
    inputs.push("-loop", "1", "-t", (clip.durationMs / 1000).toFixed(3), "-i", uri);
    parts.push(`[${index}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=${config.fps}[v${index}]`);
  });
  const concatChain = `${parts.join(";")};${visualClips.map((_, i) => `[v${i}]`).join("")}concat=n=${visualClips.length}:v=1:a=0[catv]`;

  // Caption burn-in on the concatenated stream (bottom safe area). Requires a
  // font file (fontconfig is unavailable on default Windows ffmpeg builds).
  const fontFile = defaultFontFile();
  const captionFilter = fontFile
    ? captionTrack.clips
      .slice(0, 40)
      .filter((c) => c.text)
      .map((c) => {
        const text = c.text!.replace(/[:\\'\"]/g, " ").slice(0, 60);
        const fontSize = Math.round(config.height * 0.045);
        const start = (c.startMs / 1000).toFixed(2);
        const end = ((c.startMs + c.durationMs) / 1000).toFixed(2);
        return `drawtext=fontfile='${fontFile}':enable='between(t,${start},${end})':text='${text}':fontcolor=0x1d1d1f:fontsize=${fontSize}:box=1:boxcolor=white@0.85:boxborderw=12:x=(w-text_w)/2:y=h-${Math.round(config.height * 0.14)}`;
      })
      .join(",")
    : "";
  const vfChain = [concatChain, captionFilter ? `[catv]${captionFilter}[vout]` : "[catv]null[vout]"].join(";");

  // Audio: narration WAVs placed at scene offsets via adelay + amix. Labels
  // are collected as declared so amix always matches the actual inputs.
  const voiceClips = [...voiceTrack.clips].sort((a, b) => a.startMs - b.startMs);
  const audioInputs: string[] = [];
  const audioFilters: string[] = [];
  const audioLabels: string[] = [];
  voiceClips.forEach((clip) => {
    const uri = input.voiceUris.get(clip.sceneId);
    if (!uri || !existsSync(uri)) return;
    // audioInputs holds 2 strings per input ("−i", uri) — count inputs, not strings.
    const index = visualClips.length + audioInputs.length / 2;
    audioInputs.push("-i", uri);
    audioFilters.push(`[${index}:a]adelay=${clip.startMs}|${clip.startMs}[a${index}]`);
    audioLabels.push(`[a${index}]`);
  });
  const audioChain = audioLabels.length > 0
    ? `;${audioFilters.join(";")};${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0,apad[aout]`
    : "";

  const args = [
    "-y",
    ...inputs,
    ...audioInputs,
    "-filter_complex", `${vfChain}${audioChain}`,
    "-map", "[vout]",
    ...(audioInputs.length > 0 ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "128k"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${config.bitrateKbps}k`,
    "-r", String(config.fps),
    "-t", (input.timeline.durationMs / 1000).toFixed(3),
    "-movflags", "+faststart",
    outPath,
  ];

  const proc = spawnSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
  if (proc.status !== 0 || !existsSync(outPath)) {
    throw new VideoStudioError("RENDER_FAILED", 500, `ffmpeg render failed: ${proc.stderr?.toString().slice(-600) ?? "no output produced"}`);
  }
  return {
    path: outPath,
    durationMs: input.timeline.durationMs,
    engine: "ffmpeg",
    width: config.width,
    height: config.height,
    checksum: createHash("sha256").update(outPath).digest("hex").slice(0, 32),
  };
}

/** Probe the rendered file with ffprobe — render QA evidence (source §44 render QA). */
export function probeRender(path: string): { durationSec: number; width: number; height: number; hasStream: boolean } | null {
  if (!existsSync(path)) return null;
  const proc = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "json", path], { encoding: "utf8" });
  if (proc.status !== 0) return null;
  try {
    const parsed = JSON.parse(proc.stdout ?? "{}") as { streams?: Array<{ width?: number; height?: number; duration?: string }> };
    const stream = parsed.streams?.[0];
    if (!stream) return null;
    return {
      durationSec: Number(stream.duration ?? 0),
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      hasStream: true,
    };
  } catch {
    return null;
  }
}

/** Persist a render artifact row for provenance/QA. */
export function recordRenderArtifact(projectId: string, output: RenderOutput, timelineHash: string): void {
  const db = openAgentOsDb();
  db.run(
    "INSERT INTO vs_provenance (id, project_id, scene_id, origin, provider, model, prompt_hash, input_hash, output_hash, license, created_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?)",
    [`vsprov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, projectId, "render", "ffmpeg", timelineHash || "unknown", output.checksum, "generated-owned", new Date().toISOString()],
  );
}
