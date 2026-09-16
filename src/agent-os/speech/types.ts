// Phase 20.32 — Pao-hubPro × VoiceStudio Local AI Speech Runtime
// Provider contract + entity types (doc §4, §8, §9, §10, §12, §14).
// VoiceStudio stays an external service: this module only ever talks HTTP/MCP
// to a pinned runtime and never vendors upstream code (doc §1.1).

export type SpeechJobType = "tts" | "stt" | "clone" | "dubbing" | "batch_tts";

export type SpeechJobStatus =
  | "queued"
  | "preflight"
  | "waiting_for_runtime"
  | "running"
  | "postprocessing"
  | "policy_check"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type SpeechHealthState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "misconfigured"
  | "version_mismatch"
  | "policy_blocked";

export interface SpeechCapabilities {
  tts: boolean;
  stt: boolean;
  cloning: boolean;
  dubbing: boolean;
  mcp: boolean;
  outputFormats: string[];
  transcriptionFormats: string[];
}

export interface SpeechHealth {
  state: SpeechHealthState;
  provider: string;
  versionDetected: string | null;
  versionPin: string;
  versionVerified: boolean;
  baseUrlOrigin: string;
  remoteMode: boolean;
  reasons: string[];
}

export interface SynthesisRequest {
  projectId: string;
  text: string;
  /** Pao-hubPro Voice Registry id — never a raw provider profile id. */
  voiceId: string;
  language?: string;
  format?: "wav" | "mp3" | "flac" | "opus" | "aac" | "pcm";
  purpose?: string;
  /** Adobe Stock Safe Mode (doc §11). Defaults to the flag value. */
  stockSafe?: boolean;
  requestedBy?: string;
}

export interface TranscriptionRequest {
  projectId: string;
  /** Must resolve inside the confined speech workspace (doc §7). */
  audioPath: string;
  language?: string;
  responseFormat?: "json" | "text" | "verbose_json" | "srt" | "vtt";
  requestedBy?: string;
}

export interface CloneRequest {
  projectId: string;
  voiceName: string;
  referencePath: string;
  consentId: string;
  language?: string;
  requestedBy?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** Only present when the ASR backend exposes usable confidence data (doc §17). */
  confidence?: number;
}

export interface TranscriptArtifactData {
  text: string;
  language: string;
  segments: TranscriptSegment[];
  format: string;
  subtitlePaths: { srt?: string; vtt?: string; json?: string; txt?: string };
}

export type SpeechArtifactRole =
  | "narration"
  | "dialogue"
  | "reference"
  | "transcript"
  | "subtitle"
  | "dubbed_video";

export interface SpeechManifest {
  artifactId: string;
  projectId: string;
  createdAt: string;
  provider: string;
  voicestudioVersion: string | null;
  operation: SpeechJobType;
  engine: string | null;
  modelId: string | null;
  modelVersion: string | null;
  voiceId: string | null;
  providerProfileId: string | null;
  language: string | null;
  scriptSha256: string | null;
  sourceReferenceSha256: string | null;
  consentStatus: string;
  licenseStatus: string;
  commercialUse: boolean;
  stockUse: boolean;
  output: {
    path: string;
    sha256: string | null;
    durationMs: number | null;
    sampleRate: number | null;
    channels: number | null;
  };
}

export interface SpeechArtifactRecord {
  id: string;
  jobId: string;
  projectId: string;
  role: SpeechArtifactRole;
  rawPath: string | null;
  finalPath: string | null;
  sha256: string | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  manifest: SpeechManifest | null;
  createdAt: string;
}

export interface VoiceProfileRecord {
  id: string;
  provider: string;
  providerProfileId: string | null;
  name: string;
  language: string | null;
  purposes: string[];
  origin: "builtin" | "cloned" | "synced";
  status: "unreviewed" | "pending_review" | "active" | "blocked" | "archived";
  commercialUseStatus: "unknown" | "approved" | "blocked";
  consentStatus: "none" | "verified" | "revoked";
  licenseStatus: "unknown" | "approved" | "blocked" | "review_required";
  impersonatesPublicFigure: boolean;
  stockApprovedAt: string | null;
  createdFrom: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConsentBasis =
  | "self_voice"
  | "written_permission"
  | "licensed_voice_dataset"
  | "synthetic_non_person_impersonation";

/** Bases that can never authorize production cloning (doc §9). */
export const REJECTED_CONSENT_BASES: readonly string[] = [
  "unknown",
  "scraped_voice",
  "celebrity_voice",
  "public_figure_voice",
  "third_party_without_permission",
];

export const ALLOWED_CONSENT_BASES: readonly ConsentBasis[] = [
  "self_voice",
  "written_permission",
  "licensed_voice_dataset",
  "synthetic_non_person_impersonation",
];

export interface VoiceConsentRecord {
  id: string;
  voiceId: string | null;
  subjectType: string;
  subjectAlias: string;
  consentBasis: ConsentBasis;
  consentDocumentRef: string | null;
  allowedUses: string[];
  commercialUseAllowed: boolean;
  stockUseAllowed: boolean;
  voiceCloneAllowed: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelLicenseRecord {
  id: string;
  provider: string;
  engine: string;
  modelId: string;
  modelVersion: string | null;
  codeLicense: string | null;
  weightsLicense: string | null;
  commercialUse: boolean;
  stockUse: boolean;
  attributionRequired: boolean;
  status: "approved" | "blocked" | "review_required" | "unknown";
  sourceUrl: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  updatedAt: string;
}

export interface SpeechJobRecord {
  id: string;
  projectId: string;
  type: SpeechJobType;
  provider: string;
  engine: string | null;
  modelId: string | null;
  voiceId: string | null;
  request: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  status: SpeechJobStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputArtifactId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProviderVoiceListing {
  profileId: string;
  name: string;
  language?: string;
}

/**
 * Provider contract (doc §4). Application code never calls VoiceStudio
 * directly — it talks to an implementation of this interface so future
 * TTS/STT engines can be routed without redesigning the pipeline.
 */
export interface SpeechProvider {
  readonly id: string;
  healthCheck(): Promise<SpeechHealth>;
  capabilities(): Promise<SpeechCapabilities>;
  listProviderVoices(): Promise<ProviderVoiceListing[]>;
  synthesize(req: {
    text: string;
    voiceProfileId: string;
    format: string;
    language?: string;
  }): Promise<{ bytes: Uint8Array; engine?: string; modelId?: string }>;
  transcribe(req: {
    audioPath: string;
    language?: string;
    responseFormat: string;
  }): Promise<TranscriptArtifactData>;
  cloneVoice(req: { referencePath: string; voiceName: string }): Promise<{ providerProfileId: string }>;
}

/** Audit entries carry before/after/reason but never raw voice samples (doc §36). */
export interface SpeechAuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
}
