// Phase 21.01 — Parley feature flags (§42).

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return fallback;
}

/** Master switch for Phase 21.01 Parley Multi-Agent Work Room. */
export function parleyEnabled(): boolean {
  const raw = (process.env.PAO_PARLEY_ENABLED ?? process.env.PHASE_21_01_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export const PARLEY_FLAGS = {
  multiAgentHandoff: () => bool("PARLEY_MULTI_AGENT_HANDOFF", true),
  runInspector: () => bool("PARLEY_RUN_INSPECTOR", true),
  timelineCapture: () => bool("PARLEY_TIMELINE_CAPTURE", true),
  autoTurns: () => bool("PARLEY_AUTO_TURNS", true),
};
