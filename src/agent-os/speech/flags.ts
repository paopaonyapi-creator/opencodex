// Phase 20.32 — feature flags (doc §32). Cloning and dubbing are
// independently disableable and default OFF until they earn trust; the
// stock-safe policy profile defaults ON (doc §11, §25).

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export interface SpeechFlags {
  runtime: boolean;
  tts: boolean;
  stt: boolean;
  clone: boolean;
  dubbing: boolean;
  mcp: boolean;
  remoteGpu: boolean;
  stockSafeMode: boolean;
  /** VOICE_CLONE_REQUIRE_CONSENT (doc §25) — hard gate, not a soft default. */
  cloneRequireConsent: boolean;
  /** COMMERCIAL_LICENSE_GUARD (doc §25). */
  commercialLicenseGuard: boolean;
  /** UNKNOWN_LICENSE_POLICY=block (doc §25) — the only supported value. */
  unknownLicensePolicy: "block";
}

export function speechFlags(): SpeechFlags {
  return {
    runtime: envFlag("FEATURE_SPEECH_RUNTIME", true),
    tts: envFlag("FEATURE_SPEECH_TTS", true),
    stt: envFlag("FEATURE_SPEECH_STT", true),
    clone: envFlag("FEATURE_SPEECH_CLONE", false),
    dubbing: envFlag("FEATURE_SPEECH_DUBBING", false),
    mcp: envFlag("FEATURE_SPEECH_MCP", true),
    remoteGpu: envFlag("FEATURE_SPEECH_REMOTE_GPU", false),
    stockSafeMode: envFlag("ADOBE_STOCK_SAFE_MODE", true),
    cloneRequireConsent: envFlag("VOICE_CLONE_REQUIRE_CONSENT", true),
    commercialLicenseGuard: envFlag("COMMERCIAL_LICENSE_GUARD", true),
    // Fail-closed by design (doc §10.1); any other value is refused upstream.
    unknownLicensePolicy: "block",
  };
}
