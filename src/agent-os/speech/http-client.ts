// Phase 20.32 — VoiceStudio HTTP client over the OpenAI-compatible audio API
// (doc §5, §23, §26, §34). The client only ever targets the operator-configured
// base URL — it never proxies client-supplied URLs, never exposes admin routes,
// and never logs or returns credentials.

import { SpeechError, sanitizeSpeechMessage } from "./errors";
import { authHeadersShape } from "./redact";
import type { SpeechHealth, SpeechHealthState } from "./types";
import { speechWorkspaceRoot } from "./workspace";

export const VOICESTUDIO_VERSION_PIN = process.env.VOICESTUDIO_VERSION_PIN || "0.5.2";
/** Maximum upstream release this integration was validated against (doc §42). */
export const VOICESTUDIO_MAXIMUM_TESTED = "0.5.2";

const DEFAULT_TIMEOUT_MS = 30_000;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

export interface VoiceStudioConfigCheck {
  baseUrl: string;
  remoteMode: boolean;
  problems: string[];
}

/** Validates the operator configuration without contacting the runtime. */
export function checkVoiceStudioConfig(): VoiceStudioConfigCheck {
  const baseUrl = stripTrailingSlash(process.env.VOICESTUDIO_BASE_URL || "http://127.0.0.1:3900");
  const problems: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { baseUrl, remoteMode: false, problems: ["VOICESTUDIO_BASE_URL is not a valid URL"] };
  }
  const remoteMode = !isLoopbackHost(parsed.hostname);
  if (remoteMode) {
    if (process.env.VOICESTUDIO_REMOTE_ENABLED !== "true") {
      problems.push("Remote VoiceStudio host configured but VOICESTUDIO_REMOTE_ENABLED is not enabled");
    }
    if (parsed.protocol !== "https:" && process.env.VOICESTUDIO_TLS_REQUIRED !== "false") {
      problems.push("Remote VoiceStudio requires encrypted transport (REMOTE_TLS_REQUIRED)");
    }
  }
  return { baseUrl, remoteMode, problems };
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.name === "TimeoutError" ? "timed out" : "unreachable" : "unreachable";
    throw new SpeechError("SPEECH_RUNTIME_UNAVAILABLE", `VoiceStudio runtime ${reason} at ${redactUrl(url)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SpeechError("REMOTE_AUTH_FAILED", "VoiceStudio rejected the configured credentials");
  }
  if (!res.ok) {
    throw new SpeechError("SPEECH_RUNTIME_UNAVAILABLE", `VoiceStudio returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new SpeechError("SPEECH_OUTPUT_INVALID", "VoiceStudio returned a malformed JSON response");
  }
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return sanitizeSpeechMessage(url);
  }
}

function extractVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["version", "app_version", "runtime_version", "voicestudio_version"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const data = record.data;
  if (data && typeof data === "object") return extractVersion(data);
  return null;
}

export interface VoiceStudioHealthResult {
  state: SpeechHealthState;
  versionDetected: string | null;
  reasons: string[];
}

/** Health + version-pin evaluation (doc §27, §42). Unknown versions degrade
 *  and disable risky features; they never fail open. */
export async function probeVoiceStudioHealth(): Promise<VoiceStudioHealthResult> {
  const config = checkVoiceStudioConfig();
  if (config.problems.length > 0) {
    return { state: "misconfigured", versionDetected: null, reasons: config.problems };
  }
  let payload: unknown;
  try {
    payload = await fetchJson(`${config.baseUrl}/health`, { method: "GET", headers: authHeadersShape() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "unavailable", versionDetected: null, reasons: [message] };
  }
  const version = extractVersion(payload);
  const reasons: string[] = [];
  let state: SpeechHealthState = "healthy";
  if (version === null) {
    state = "degraded";
    reasons.push("Runtime version could not be detected; risky features stay disabled (untested version policy)");
  } else if (!isValidVersionPin(version, VOICESTUDIO_MAXIMUM_TESTED)) {
    state = "version_mismatch";
    reasons.push(`Detected version ${version} exceeds the maximum tested version ${VOICESTUDIO_MAXIMUM_TESTED}`);
  } else if (version !== VOICESTUDIO_VERSION_PIN) {
    state = "degraded";
    reasons.push(`Detected version ${version} differs from the production pin ${VOICESTUDIO_VERSION_PIN}`);
  }
  return { state, versionDetected: version, reasons };
}

function isValidVersionPin(detected: string, maximumTested: string): boolean {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [dMajor, dMinor, dPatch] = parse(detected);
  const [mMajor, mMinor, mPatch] = parse(maximumTested);
  if (dMajor !== mMajor) return dMajor < mMajor;
  if (dMinor !== mMinor) return dMinor < mMinor;
  return dPatch <= mPatch;
}

export interface SpeechSynthesisHttpResponse {
  bytes: Uint8Array;
  contentType: string;
}

export async function requestSpeechSynthesis(input: {
  text: string;
  voiceProfileId: string;
  format: string;
  language?: string;
}): Promise<SpeechSynthesisHttpResponse> {
  const config = checkVoiceStudioConfig();
  if (config.problems.length > 0) {
    throw new SpeechError("SPEECH_POLICY_BLOCKED", config.problems.join("; "));
  }
  const body: Record<string, unknown> = {
    input: input.text,
    model: process.env.VOICESTUDIO_MODEL || "tts-default",
    voice: input.voiceProfileId,
    response_format: input.format,
  };
  if (input.language) body.language = input.language;
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { ...authHeadersShape(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.SPEECH_JOB_TIMEOUT_SECONDS || 1800) * 1000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new SpeechError(
      timedOut ? "SPEECH_GENERATION_TIMEOUT" : "SPEECH_RUNTIME_UNAVAILABLE",
      timedOut ? "VoiceStudio synthesis timed out" : "VoiceStudio synthesis runtime is unreachable",
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new SpeechError("REMOTE_AUTH_FAILED", "VoiceStudio rejected the configured credentials");
  }
  if (!res.ok) {
    throw new SpeechError("SPEECH_RUNTIME_UNAVAILABLE", `VoiceStudio synthesis returned HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new SpeechError("SPEECH_OUTPUT_INVALID", "VoiceStudio returned an empty audio payload");
  }
  return { bytes, contentType: res.headers.get("content-type") || `audio/${input.format}` };
}

export interface SpeechTranscriptionHttpResponse {
  payload: Record<string, unknown>;
}

export async function requestSpeechTranscription(input: {
  audioPath: string;
  language?: string;
  responseFormat: string;
}): Promise<SpeechTranscriptionHttpResponse> {
  const config = checkVoiceStudioConfig();
  if (config.problems.length > 0) {
    throw new SpeechError("SPEECH_POLICY_BLOCKED", config.problems.join("; "));
  }
  const bytes = await import("node:fs").then((fs) => fs.readFileSync(input.audioPath));
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), input.audioPath.split(/[\\/]/).pop() || "audio.wav");
  form.append("model", process.env.VOICESTUDIO_ASR_MODEL || "asr-default");
  form.append("response_format", input.responseFormat);
  if (input.language) form.append("language", input.language);
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: authHeadersShape(),
      body: form,
      signal: AbortSignal.timeout(Number(process.env.SPEECH_JOB_TIMEOUT_SECONDS || 1800) * 1000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new SpeechError(
      timedOut ? "SPEECH_GENERATION_TIMEOUT" : "SPEECH_RUNTIME_UNAVAILABLE",
      timedOut ? "VoiceStudio transcription timed out" : "VoiceStudio transcription runtime is unreachable",
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new SpeechError("REMOTE_AUTH_FAILED", "VoiceStudio rejected the configured credentials");
  }
  if (!res.ok) {
    throw new SpeechError("SPEECH_TRANSCRIPTION_FAILED", `VoiceStudio transcription returned HTTP ${res.status}`);
  }
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) throw new SpeechError("SPEECH_TRANSCRIPTION_FAILED", "VoiceStudio returned a malformed transcription response");
  return { payload };
}

/** Redacted preflight bundle (doc §41) — never includes the API key. */
export function speechConnectionDiagnostics(): Record<string, unknown> {
  const config = checkVoiceStudioConfig();
  return {
    baseUrlOrigin: safeOrigin(config.baseUrl),
    remoteMode: config.remoteMode,
    problems: config.problems,
    versionPin: VOICESTUDIO_VERSION_PIN,
    apiKeyConfigured: Boolean(process.env.VOICESTUDIO_API_KEY),
    workspace: speechWorkspaceRoot().split(/[\\/]/).slice(-2).join("/"),
  };
}

function safeOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "invalid";
  }
}
