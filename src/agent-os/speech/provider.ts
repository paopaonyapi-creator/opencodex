// Phase 20.32 — SpeechProvider implementations (doc §4).
// VoiceStudioProvider talks only to documented interfaces: the
// OpenAI-compatible audio API for TTS/STT and the documented MCP tools for
// voice listing/cloning. MockSpeechProvider is deterministic so CI never
// downloads models (doc §31).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SpeechError } from "./errors";
import {
  requestSpeechSynthesis,
  requestSpeechTranscription,
  probeVoiceStudioHealth,
  checkVoiceStudioConfig,
  VOICESTUDIO_VERSION_PIN,
} from "./http-client";
import { callMcpTool, extractVoiceEntries } from "./mcp";
import type {
  ProviderVoiceListing,
  SpeechCapabilities,
  SpeechHealth,
  SpeechProvider,
  TranscriptArtifactData,
} from "./types";

export class VoiceStudioProvider implements SpeechProvider {
  readonly id = "voicestudio";

  async healthCheck(): Promise<SpeechHealth> {
    const probe = await probeVoiceStudioHealth();
    const config = checkVoiceStudioConfig();
    return {
      state: probe.state,
      provider: this.id,
      versionDetected: probe.versionDetected,
      versionPin: VOICESTUDIO_VERSION_PIN,
      versionVerified: probe.versionDetected === VOICESTUDIO_VERSION_PIN,
      baseUrlOrigin: safeOrigin(config.baseUrl),
      remoteMode: config.remoteMode,
      reasons: probe.reasons,
    };
  }

  async capabilities(): Promise<SpeechCapabilities> {
    return {
      tts: true,
      stt: true,
      cloning: true,
      dubbing: false, // kept off until upstream ships a stable programmatic API (doc §19)
      mcp: true,
      outputFormats: ["wav", "mp3", "opus", "aac", "flac", "pcm"],
      transcriptionFormats: ["json", "text", "verbose_json", "srt", "vtt"],
    };
  }

  async listProviderVoices(): Promise<ProviderVoiceListing[]> {
    const result = await callMcpTool("list_voices");
    if (!result.ok) {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", result.error || "VoiceStudio voice listing failed");
    }
    return extractVoiceEntries(result.data);
  }

  async synthesize(req: {
    text: string;
    voiceProfileId: string;
    format: string;
    language?: string;
  }): Promise<{ bytes: Uint8Array; engine?: string; modelId?: string }> {
    const response = await requestSpeechSynthesis(req);
    return {
      bytes: response.bytes,
      engine: process.env.VOICESTUDIO_MODEL || "tts-default",
      modelId: process.env.VOICESTUDIO_MODEL || "tts-default",
    };
  }

  async transcribe(req: {
    audioPath: string;
    language?: string;
    responseFormat: string;
  }): Promise<TranscriptArtifactData> {
    const response = await requestSpeechTranscription(req);
    const payload = response.payload;
    const text = typeof payload.text === "string" ? payload.text : "";
    const language = typeof payload.language === "string" ? payload.language : req.language || "auto";
    const segments = Array.isArray(payload.segments)
      ? (payload.segments as Array<Record<string, unknown>>).map((segment) => ({
          start: typeof segment.start === "number" ? segment.start : 0,
          end: typeof segment.end === "number" ? segment.end : 0,
          text: typeof segment.text === "string" ? segment.text : "",
          ...(typeof segment.confidence === "number" ? { confidence: segment.confidence } : {}),
        }))
      : [];
    return { text, language, segments, format: req.responseFormat, subtitlePaths: {} };
  }

  async cloneVoice(req: { referencePath: string; voiceName: string }): Promise<{ providerProfileId: string }> {
    const result = await callMcpTool("clone_voice", {
      reference_audio_path: req.referencePath,
      voice_name: req.voiceName,
    });
    if (!result.ok) {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", result.error || "VoiceStudio clone request failed");
    }
    const profileId = extractCloneProfileId(result.data);
    if (!profileId) {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", "VoiceStudio clone response did not include a profile id");
    }
    return { providerProfileId: profileId };
  }
}

function extractCloneProfileId(data: unknown): string | null {
  const candidates: unknown[] = [data];
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    candidates.push(record.voice_id, record.profile_id, record.id, record.voice_profile_id);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function safeOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "invalid";
  }
}

// --- Deterministic mock (CI-safe; never downloads models) ---------------------

/** Encodes a minimal valid PCM WAV container. */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * bytesPerSample, samples[index], true);
  }
  return new Uint8Array(buffer);
}

export class MockSpeechProvider implements SpeechProvider {
  readonly id = "mock";

  async healthCheck(): Promise<SpeechHealth> {
    return {
      state: "healthy",
      provider: this.id,
      versionDetected: VOICESTUDIO_VERSION_PIN,
      versionPin: VOICESTUDIO_VERSION_PIN,
      versionVerified: true,
      baseUrlOrigin: "mock://local",
      remoteMode: false,
      reasons: [],
    };
  }

  async capabilities(): Promise<SpeechCapabilities> {
    return {
      tts: true,
      stt: true,
      cloning: true,
      dubbing: false,
      mcp: false,
      outputFormats: ["wav"],
      transcriptionFormats: ["json"],
    };
  }

  async listProviderVoices(): Promise<ProviderVoiceListing[]> {
    return [
      { profileId: "mock_voice_narrator", name: "Mock Narrator", language: "en" },
      { profileId: "mock_voice_thai", name: "Mock Thai Narrator", language: "th" },
    ];
  }

  async synthesize(req: {
    text: string;
    voiceProfileId: string;
    format: string;
    language?: string;
  }): Promise<{ bytes: Uint8Array; engine?: string; modelId?: string }> {
    const sampleRate = 16_000;
    const durationMs = Math.min(60_000, Math.max(400, req.text.length * 60));
    const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
    const samples = new Int16Array(sampleCount);
    // Deterministic low-amplitude tone so the artifact is never empty/silent.
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = ((index % 64) - 32) * 90;
    }
    return { bytes: encodeWav(samples, sampleRate), engine: "tts-default", modelId: "tts-default" };
  }

  async transcribe(req: {
    audioPath: string;
    language?: string;
    responseFormat: string;
  }): Promise<TranscriptArtifactData> {
    // Mock transcript derived from the file itself; confidence is omitted
    // because a mock backend exposes none (doc §17: never invent confidence).
    let sizeBytes = 0;
    try {
      sizeBytes = readFileSync(req.audioPath).byteLength;
    } catch {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", "Mock transcription source file is unreadable");
    }
    const durationSec = Math.max(0.4, sizeBytes / 32_000);
    return {
      text: "[mock] transcript for uploaded audio",
      language: req.language || "en",
      segments: [{ start: 0, end: Number(durationSec.toFixed(2)), text: "[mock] transcript for uploaded audio" }],
      format: req.responseFormat,
      subtitlePaths: {},
    };
  }

  async cloneVoice(req: { referencePath: string; voiceName: string }): Promise<{ providerProfileId: string }> {
    const digest = createHash("sha256").update(`${req.voiceName}:${req.referencePath}`).digest("hex");
    return { providerProfileId: `mock_profile_${digest.slice(0, 12)}` };
  }
}
