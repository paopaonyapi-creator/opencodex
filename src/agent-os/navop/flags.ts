// Phase Navop & 21.03 feature flags.

function bool(val: string | undefined, def: boolean): boolean {
  if (val === undefined || val === "") return def;
  const s = val.toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function navopRuntimeEnabled(): boolean {
  return bool(process.env.PAO_NAVOP_ENABLED, true);
}

export function ccSwitchEnabled(): boolean {
  return bool(process.env.PAO_CC_SWITCH_ENABLED, true);
}

export function defaultPermissionProfile(): "observe" | "guarded" | "trusted" | "operator" {
  const profile = (process.env.PAO_NAVOP_DEFAULT_PROFILE || "guarded").toLowerCase().trim();
  if (profile === "observe" || profile === "trusted" || profile === "operator") {
    return profile;
  }
  return "guarded";
}
