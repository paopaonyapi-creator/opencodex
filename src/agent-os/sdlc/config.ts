// Phase 20.2 — SDLC Configuration
//
// Reads configuration settings from process.env with safe defaults.

import type { SdlcConfig, AutoRunMode } from "./types";

function boolEnv(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return val.toLowerCase() === "true" || val === "1";
}

function numberEnv(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

export function loadSdlcConfig(env: Record<string, string | undefined> = process.env): SdlcConfig {
  const modeRaw = env.PAO_SDLC_DEFAULT_MODE?.toUpperCase();
  const validModes: AutoRunMode[] = ["MANUAL", "GUIDED", "AUTO_UNTIL_APPROVAL", "FULL_AUTO_SAFE_ONLY"];
  const defaultMode: AutoRunMode = validModes.includes(modeRaw as AutoRunMode)
    ? (modeRaw as AutoRunMode)
    : "GUIDED";

  return {
    enabled: boolEnv(env.PAO_SDLC_ENABLED, true),
    defaultMode,
    autoReview: boolEnv(env.PAO_SDLC_AUTO_REVIEW, true),
    strictGates: boolEnv(env.PAO_SDLC_STRICT_GATES, true),
    allowDirtyTree: boolEnv(env.PAO_SDLC_ALLOW_DIRTY_TREE, false),
    defaultBranchPrefix: env.PAO_SDLC_DEFAULT_BRANCH_PREFIX ?? "feature/sdlc-",
    maxConcurrentTasks: numberEnv(env.PAO_SDLC_MAX_CONCURRENT_TASKS, 2),
    commandTimeoutMs: numberEnv(env.PAO_SDLC_COMMAND_TIMEOUT_MS, 60_000),
    approvalExpiryMinutes: numberEnv(env.PAO_SDLC_APPROVAL_EXPIRY_MINUTES, 60),
  };
}
