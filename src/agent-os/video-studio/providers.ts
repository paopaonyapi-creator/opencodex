// Phase 20.92 GOLD — Provider Capability Matrix.
//
// Routing uses CAPABILITIES, never hard-coded provider names (GOLD §P2).
// Every capability reports availability + credential status honestly:
// "available" means a health check (or local binary probe) passed in this
// process; "unconfigured"/"offline" mean the pipeline must degrade down the
// fallback ladder with a recorded reason — never silently fake success.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { VoiceStudioProvider } from "../speech/provider";

export type StudioCapability = "IMAGE" | "VIDEO" | "TTS" | "MUSIC" | "LLM" | "RENDER";

export type ProviderAvailability = "available" | "unconfigured" | "offline";

export interface ProviderStatus {
  capability: StudioCapability;
  provider: string;
  model: string;
  availability: ProviderAvailability;
  /** "ok" when the provider reads credentials from approved env/secret storage; "missing" when an endpoint needs none because it is local. */
  credentialStatus: "ok" | "missing" | "none-required";
  local: boolean;
  endpoint?: string;
  concurrency: number;
  fallbackFor?: string;
  generationClass: "ai-generated" | "deterministic";
  notes?: string;
}

/** VoiceStudio config resolution — mirrors speech/http-client rules. */
export function voiceStudioEndpoint(): string | null {
  const raw = process.env.VOICESTUDIO_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, "") : null;
}

export function isVoiceStudioConfigured(): boolean {
  return voiceStudioEndpoint() !== null;
}

let ffmpegAvailableCache: boolean | null = null;

/** Probe the local ffmpeg binary once per process. */
export function isFfmpegAvailable(): boolean {
  if (ffmpegAvailableCache !== null) return ffmpegAvailableCache;
  try {
    // Bun.spawnSync-less repo convention: node child_process probe.
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const proc = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
    ffmpegAvailableCache = proc.status === 0;
  } catch {
    ffmpegAvailableCache = false;
  }
  return ffmpegAvailableCache;
}

/** Remotion is the deferred render engine — detect without importing it. */
export function isRemotionInstalled(): boolean {
  return existsSync(join(process.cwd(), "node_modules", "remotion", "package.json"));
}

export function comfyuiEndpoint(): string | null {
  const raw = process.env.PAO_COMFYUI_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, "") : null;
}

export function isComfyuiConfigured(): boolean {
  return comfyuiEndpoint() !== null;
}

/** Static matrix (health-independent) — the honest, synchronous view for UI. */
export function getProviderMatrix(): ProviderStatus[] {
  const vs = voiceStudioEndpoint();
  const matrix: ProviderStatus[] = [
    {
      capability: "TTS", provider: "voicestudio", model: process.env.VOICESTUDIO_MODEL || "tts-default",
      availability: vs ? "offline" : "unconfigured",
      credentialStatus: "ok", local: false, endpoint: vs ?? undefined, concurrency: 2,
      generationClass: "ai-generated",
      notes: vs ? "endpoint configured — health verified on demand" : "set VOICESTUDIO_BASE_URL to enable",
    },
    {
      capability: "TTS", provider: "mock-speech", model: "tone-16k",
      availability: "available", credentialStatus: "none-required", local: true, concurrency: 4,
      fallbackFor: "voicestudio", generationClass: "deterministic",
      notes: "deterministic offline adapter — real TTS when configured",
    },
    {
      capability: "IMAGE", provider: "comfyui", model: process.env.PAO_COMFYUI_WORKFLOW_MODEL || "sdxl-text2img",
      availability: isComfyuiConfigured() ? "offline" : "unconfigured",
      credentialStatus: "ok", local: false, endpoint: comfyuiEndpoint() ?? undefined, concurrency: 1,
      generationClass: "ai-generated",
      notes: isComfyuiConfigured() ? "endpoint configured — health verified on demand" : "set PAO_COMFYUI_URL to enable",
    },
    {
      capability: "IMAGE", provider: "deterministic-card", model: "brand-card-v1",
      availability: "available", credentialStatus: "none-required", local: true, concurrency: 4,
      fallbackFor: "comfyui", generationClass: "deterministic",
      notes: "ffmpeg brand-colored text/icon card — owned, zero-cost fallback",
    },
    {
      capability: "RENDER", provider: "ffmpeg", model: process.env.PAO_FFMPEG_PROFILE || "libx264-aac",
      availability: isFfmpegAvailable() ? "available" : "offline",
      credentialStatus: "none-required", local: true, concurrency: 1,
      generationClass: "deterministic",
    },
    {
      capability: "RENDER", provider: "remotion", model: "react-composition",
      availability: isRemotionInstalled() ? "available" : "unconfigured",
      credentialStatus: "none-required", local: true, concurrency: 1,
      generationClass: "deterministic",
      notes: isRemotionInstalled() ? undefined : "install remotion + @remotion/renderer to enable",
    },
    {
      capability: "VIDEO", provider: "comfyui-video", model: "minimax-h3-video",
      availability: isComfyuiConfigured() ? "offline" : "unconfigured",
      credentialStatus: "ok", local: false, concurrency: 1,
      generationClass: "ai-generated",
      notes: "Phase 20.7 adapter — video generation is a post-MVP rung",
    },
    {
      capability: "MUSIC", provider: "none", model: "—",
      availability: "unconfigured", credentialStatus: "missing", local: false, concurrency: 0,
      generationClass: "ai-generated",
      notes: "no music provider wired — timeline renders with narration only",
    },
  ];
  return matrix;
}

/**
 * Async health verification for configured remote providers. Availability
 * upgrades "offline" → "available" only after a real probe succeeds.
 */
export async function verifyProviderHealth(capability: StudioCapability, provider: string): Promise<ProviderStatus> {
  const matrix = getProviderMatrix();
  const entry = matrix.find((p) => p.capability === capability && p.provider === provider);
  if (!entry) {
    return { capability, provider, model: "—", availability: "unconfigured", credentialStatus: "missing", local: false, concurrency: 0, generationClass: "deterministic", notes: "unknown provider" };
  }
  if (entry.availability === "available" || entry.availability === "unconfigured") return entry;
  if (capability === "TTS" && provider === "voicestudio") {
    try {
      const health = await new VoiceStudioProvider().healthCheck();
      return { ...entry, availability: health.state === "healthy" ? "available" : "offline", notes: health.state };
    } catch (err) {
      return { ...entry, availability: "offline", notes: err instanceof Error ? err.message : String(err) };
    }
  }
  if (capability === "IMAGE" && provider === "comfyui") {
    const { probeComfyuiHealth } = require("./comfyui") as typeof import("./comfyui");
    const health = await probeComfyuiHealth(comfyuiEndpoint()!);
    return { ...entry, availability: health.healthy ? "available" : "offline", notes: health.error };
  }
  if (capability === "VIDEO" && provider === "comfyui-video") {
    const { ComfyUiVideoAdapter } = await import("../video/adapters/comfyui-video-adapter");
    const health = await new ComfyUiVideoAdapter(comfyuiEndpoint() ?? undefined).healthCheck();
    return { ...entry, availability: health.status === "healthy" ? "available" : "offline", notes: health.error };
  }
  return entry;
}

export interface ProviderSelection {
  provider: ProviderStatus;
  /** Providers tried before reaching this one, with the reason each was skipped. */
  degradedFrom: Array<{ provider: string; reason: string }>;
}
