// Phase 20.98 — OpenHermit feature flags (spec §32).
//
// The runtime integration ships default-OFF: a user who never configures
// OpenHermit must execute no OpenHermit code (same optional-subsystem rule as
// src/lab). Each capability stage has its own gate; the experimental plugin
// integration is hard-default OFF and there is no env that turns it on implicitly.

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return fallback;
}

/** Master switch. Default OFF — staged rollout per spec §38. */
export function openHermitEnabled(): boolean {
  const raw = (process.env.PAO_OPENHERMIT_ENABLED ?? process.env.PHASE_20_98_ENABLED ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export const OPENHERMIT_FLAGS = {
  sessions: () => bool("PAO_OPENHERMIT_SESSIONS", true),
  sandbox: () => bool("PAO_OPENHERMIT_SANDBOX", true),
  skillsSync: () => bool("PAO_OPENHERMIT_SKILLS_SYNC", true),
  mcpSync: () => bool("PAO_OPENHERMIT_MCP_SYNC", true),
  research: () => bool("PAO_OPENHERMIT_RESEARCH", true),
  channels: () => bool("PAO_OPENHERMIT_CHANNELS", false),
  schedules: () => bool("PAO_OPENHERMIT_SCHEDULES", false),
  /**
   * Experimental OpenHermit plugin loader integration. Default OFF and stays
   * OFF unless explicitly enabled; nothing may hard-depend on it (spec §4).
   */
  experimentalPlugins: () => bool("PAO_OPENHERMIT_EXPERIMENTAL_PLUGINS", false),
  dockerSandbox: () => bool("PAO_OPENHERMIT_SANDBOX_DOCKER", true),
};

/** Fleet changes at or above this size require an approval record (spec §26). */
export function fleetApprovalThreshold(): number {
  const raw = Number(process.env.PAO_OPENHERMIT_FLEET_APPROVAL_THRESHOLD ?? "3");
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
}
