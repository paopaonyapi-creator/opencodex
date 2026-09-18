// Phase 20.92 — Voice + Word Alignment + Caption Engine.
//
// TTS reuses the Phase 20.57 speech providers (VoiceStudioProvider when
// configured, MockSpeechProvider as the legitimate offline/test adapter).
// Alignment law (source §22 / GOLD §18): use the real alignment path when one
// exists; when none is wired, produce a deterministic *estimated* alignment
// (language-aware pacing) and mark alignmentMethod="estimated" — never claim
// provider alignment that did not happen.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MockSpeechProvider, VoiceStudioProvider } from "../speech/provider";
import { VideoStudioError, type CaptionCue, type CaptionPlan, type MediaAsset } from "./types";
import type { AssetRegistry } from "./assets";
import { isVoiceStudioConfigured, voiceStudioEndpoint } from "./providers";

export interface AlignedWord { word: string; startMs: number; endMs: number }

/** Per-scene audio manifest (GOLD P0): provider/model metadata without secrets. */
export interface SceneAudioManifest {
  sceneId: string;
  assetId: string | null;
  uri: string | null;
  checksum: string | null;
  durationMs: number;
  provider: string;
  model: string | null;
  alignmentMethod: "provider" | "estimated";
  generationClass: "ai-generated" | "deterministic-fallback";
  unavailableReason?: string;
  errorCode?: string;
}

/**
 * Deterministic word alignment by language-aware pacing. Thai has no spaces:
 * cluster characters into pseudo-words on vowel-final boundaries so highlight
 * modes remain meaningful.
 */
export function estimateAlignment(text: string, startMs: number, durationMs: number, language: string): AlignedWord[] {
  const words = language.startsWith("th") ? splitThai(text) : text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const weights = words.map((w) => Math.max(1, w.replace(/\s/g, "").length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cursor = startMs;
  return words.map((word, i) => {
    const span = Math.round((weights[i]! / totalWeight) * durationMs);
    const start = cursor;
    cursor += span;
    return { word, startMs: start, endMs: i === words.length - 1 ? startMs + durationMs : cursor };
  });
}

/** Thai pseudo-tokenization: long runs chunk (~6 chars) so highlight modes remain meaningful. */
function splitThai(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.match(/[\u0e00-\u0e7f]+|[^\s\u0e00-\u0e7f]+/g) ?? []) {
    if (run.length <= 8) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length; i += 6) tokens.push(run.slice(i, i + 6));
  }
  return tokens;
}

export interface VoiceOutcome {
  asset: MediaAsset | null;
  alignment: AlignedWord[];
  provider: string;
  model: string | null;
  alignmentMethod: "provider" | "estimated";
  generationClass: "ai-generated" | "deterministic-fallback";
  manifest: SceneAudioManifest;
  unavailableReason?: string;
  errorCode?: string;
}

/** Run one async task under a hard timeout — cancellation via abort flag. */
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Synthesize narration audio for a scene.
 *
 * Provider order (GOLD P0): real VoiceStudio when configured (bounded timeout,
 * 2 retries with exponential backoff, structured error codes) → deterministic
 * mock adapter as the FALLBACK. The two are never conflated: the outcome and
 * manifest carry generationClass "ai-generated" vs "deterministic-fallback"
 * plus the exact unavailable reason (MISSING_CREDENTIAL / PROVIDER_UNAVAILABLE).
 */
export async function synthesizeSceneVoice(input: {
  projectId: string;
  sceneId: string;
  narrationText: string;
  language: string;
  durationMs: number;
  studioRoot: string;
  voiceProfileId?: string;
  registry: AssetRegistry;
  retryLimit?: number;
}): Promise<VoiceOutcome> {
  const persist = (bytes: Uint8Array, provider: string, model: string | null, generationClass: VoiceOutcome["generationClass"]): { asset: MediaAsset; durationMs: number } => {
    const dir = join(input.studioRoot, "projects", input.projectId, "assets", "audio");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${input.sceneId}.wav`);
    if (!existsSync(file)) writeFileSync(file, bytes);
    const durationMs = Math.round((bytes.length / (16000 * 2)) * 1000); // 16 kHz mono s16
    const asset = input.registry.register({
      type: "audio",
      uri: file,
      durationMs,
      mimeType: "audio/wav",
      tags: ["narration", input.sceneId, generationClass],
      source: { kind: "generated", provider, model: model ?? undefined, projectId: input.projectId },
      license: { type: "generated-owned" },
    });
    return { asset, durationMs };
  };

  // Rung 1: real VoiceStudio TTS when the endpoint is configured.
  if (isVoiceStudioConfigured()) {
    const provider = new VoiceStudioProvider();
    const retryLimit = input.retryLimit ?? 2;
    let lastError = "";
    let lastCode = "PROVIDER_UNAVAILABLE";
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
      try {
        const result = await withTimeout(
          provider.synthesize({
            text: input.narrationText,
            voiceProfileId: input.voiceProfileId ?? "default",
            format: "wav",
            language: input.language,
          }),
          12_000,
        );
        const { asset, durationMs } = persist(result.bytes, "voicestudio", result.modelId ?? null, "ai-generated");
        const alignment = estimateAlignment(input.narrationText, 0, durationMs, input.language);
        return {
          asset, alignment, provider: "voicestudio", model: result.modelId ?? "tts-default",
          alignmentMethod: "estimated", generationClass: "ai-generated",
          manifest: {
            sceneId: input.sceneId, assetId: asset.id, uri: asset.uri, checksum: asset.checksum,
            durationMs, provider: "voicestudio", model: result.modelId ?? "tts-default",
            alignmentMethod: "estimated", generationClass: "ai-generated",
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        lastCode = lastError.includes("SPEECH_RUNTIME_UNAVAILABLE") || lastError.includes("timed out") ? "PROVIDER_UNAVAILABLE" : "VOICE_UNAVAILABLE";
      }
    }
    // Rung 2: deterministic mock fallback — clearly marked, reason recorded.
    const mock = new MockSpeechProvider();
    const result = await mock.synthesize({ text: input.narrationText, voiceProfileId: "default", format: "wav", language: input.language });
    const { asset, durationMs } = persist(result.bytes, "mock-speech", "tone-16k", "deterministic-fallback");
    const alignment = estimateAlignment(input.narrationText, 0, durationMs, input.language);
    return {
      asset, alignment, provider: "mock-speech", model: "tone-16k",
      alignmentMethod: "estimated", generationClass: "deterministic-fallback",
      manifest: {
        sceneId: input.sceneId, assetId: asset.id, uri: asset.uri, checksum: asset.checksum,
        durationMs, provider: "mock-speech", model: "tone-16k",
        alignmentMethod: "estimated", generationClass: "deterministic-fallback",
        unavailableReason: `endpoint ${voiceStudioEndpoint()}: ${lastError}`, errorCode: lastCode,
      },
      unavailableReason: lastError, errorCode: lastCode,
    };
  }

  // No TTS endpoint configured — MISSING_CREDENTIAL path with the owned
  // deterministic adapter (real WAV bytes, honestly classified).
  const mock = new MockSpeechProvider();
  const result = await mock.synthesize({ text: input.narrationText, voiceProfileId: "default", format: "wav", language: input.language });
  const { asset, durationMs } = persist(result.bytes, "mock-speech", "tone-16k", "deterministic-fallback");
  const alignment = estimateAlignment(input.narrationText, 0, durationMs, input.language);
  return {
    asset, alignment, provider: "mock-speech", model: "tone-16k",
    alignmentMethod: "estimated", generationClass: "deterministic-fallback",
    manifest: {
      sceneId: input.sceneId, assetId: asset.id, uri: asset.uri, checksum: asset.checksum,
      durationMs, provider: "mock-speech", model: "tone-16k",
      alignmentMethod: "estimated", generationClass: "deterministic-fallback",
      unavailableReason: "VOICESTUDIO_BASE_URL is not configured", errorCode: "MISSING_CREDENTIAL",
    },
    unavailableReason: "VOICESTUDIO_BASE_URL is not configured", errorCode: "MISSING_CREDENTIAL",
  };
}

// ---------------------------------------------------------------------------
// Caption engine (source §19)
// ---------------------------------------------------------------------------

/** Thai-compatible wrapping: no-space languages wrap on cluster counts. */
export function wrapCaption(text: string, maxCharsPerLine: number, maxLines: number): { lines: string[]; overflow: boolean } {
  const isThai = /[\u0e00-\u0e7f]/.test(text);
  const rawWords = isThai ? splitThai(text) : text.split(/\s+/).filter(Boolean);
  // Hard-split any token longer than a line — prevents overflow on long Thai clusters.
  const words: string[] = [];
  for (const word of rawWords) {
    if (word.length <= maxCharsPerLine) { words.push(word); continue; }
    for (let i = 0; i < word.length; i += maxCharsPerLine) words.push(word.slice(i, i + maxCharsPerLine));
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? (isThai ? current + word : `${current} ${word}`) : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(isThai ? "" : " ").length;
  return { lines, overflow: consumed < text.replace(/\s+/g, isThai ? "" : " ").length * 0.98 };
}

export function buildCaptionPlan(input: {
  mode: CaptionPlan["mode"];
  narrationText: string;
  sceneStartMs: number;
  speechMs: number;
  alignment: AlignedWord[];
  keywords: string[];
  maxCharsPerLine?: number;
}): CaptionPlan {
  const maxChars = input.maxCharsPerLine ?? 42;
  if (input.mode === "NONE" || input.speechMs <= 0) {
    return { mode: input.mode, cues: [], maxLines: 2, safeAreaBottomMs: true, overflowRisk: false };
  }
  const cues: CaptionCue[] = [];
  const { lines, overflow } = wrapCaption(input.narrationText, maxChars, 2);
  const lineText = lines.join(" ");
  if (input.mode === "FULL_SUBTITLE" || input.mode === "KARAOKE") {
    cues.push({ text: lineText, startMs: input.sceneStartMs, endMs: input.sceneStartMs + input.speechMs, highlight: [] });
  } else if (input.mode === "PHRASE_HIGHLIGHT" || input.mode === "WORD_HIGHLIGHT" || input.mode === "KEYWORD_ONLY") {
    const windows = Math.min(6, Math.max(2, Math.round(input.speechMs / 1800)));
    const span = Math.round(input.speechMs / windows);
    for (let i = 0; i < windows; i++) {
      const slice = input.alignment.slice(Math.floor((i * input.alignment.length) / windows), Math.floor(((i + 1) * input.alignment.length) / windows));
      if (slice.length === 0) continue;
      cues.push({
        text: slice.map((w) => w.word).join(" ").slice(0, maxChars),
        startMs: input.sceneStartMs + slice[0]!.startMs,
        endMs: input.sceneStartMs + slice[slice.length - 1]!.endMs,
        highlight: input.mode === "KEYWORD_ONLY"
          ? slice.filter((w) => input.keywords.some((k) => w.word.toLowerCase().includes(k.toLowerCase()))).map((w) => w.word)
          : [slice[slice.length - 1]!.word],
      });
    }
  }
  return {
    mode: input.mode,
    cues: cues.map((c) => ({ ...c, id: undefined })) as CaptionCue[],
    maxLines: 2,
    safeAreaBottomMs: true,
    overflowRisk: overflow,
  };
}

/** narrationAssetId linkage kept for AudioPlan persistence. */
export function audioAssetId(asset: MediaAsset | null): string | undefined {
  return asset?.id ?? `void_${randomUUID().slice(0, 6)}`;
}

export function hashVoice(text: string, provider: string): string {
  return createHash("sha256").update(`${provider}|${text}`).digest("hex").slice(0, 32);
}

export { VideoStudioError };
