// Phase 21.02 — Mission Control feature flags and configuration.

function bool(val: string | undefined, def: boolean): boolean {
  if (val === undefined || val === "") return def;
  const s = val.toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function missionControlEnabled(): boolean {
  return bool(process.env.PAO_MISSION_CONTROL_ENABLED, true);
}

export function emergencyStopActive(): boolean {
  return bool(process.env.PAO_MISSION_CONTROL_EMERGENCY_STOP, false);
}

export function costControlEnabled(): boolean {
  return bool(process.env.PAO_MISSION_CONTROL_COST_CONTROL, true);
}

export function humanTakeoverEnabled(): boolean {
  return bool(process.env.PAO_MISSION_CONTROL_TAKEOVER, true);
}

export const MISSION_CONTROL_DEFAULTS = {
  approvalTimeoutMinutes: 30,
  dailyBudgetUsd: 50.0,
  maxRetries: 3,
  heartbeatIntervalSec: 15,
  offlineAfterSec: 60,
};
