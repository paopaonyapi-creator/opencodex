// Phase 20.99 — Whip feature flags (spec §42).

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return fallback;
}

/** Master switch for Phase 20.99 Mobile Agent Operations Plane. */
export function whipEnabled(): boolean {
  const raw = (process.env.PAO_WHIP_ENABLED ?? process.env.PHASE_20_99_ENABLED ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export const WHIP_FLAGS = {
  sshTransport: () => bool("WHIP_SSH_TRANSPORT", true),
  tailscaleHints: () => bool("WHIP_TAILSCALE_HINTS", true),
  fleet: () => bool("WHIP_FLEET", true),
  codexTranscript: () => bool("WHIP_CODEX_TRANSCRIPT", true),
  opencodeTranscript: () => bool("WHIP_OPENCODE_TRANSCRIPT", true),
  terminal: () => bool("WHIP_TERMINAL", true),
  files: () => bool("WHIP_FILES", true),
  offlineQueue: () => bool("WHIP_OFFLINE_QUEUE", true),
  approvals: () => bool("WHIP_APPROVALS", true),
  biometricGate: () => bool("WHIP_BIOMETRIC_GATE", true),
  qrPairing: () => bool("WHIP_QR_PAIRING", true),
  notifications: () => bool("WHIP_NOTIFICATIONS", false),
  voice: () => bool("WHIP_VOICE", false),
};
