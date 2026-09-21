// Phase 21.02 — H3 Extender Feature Flags.

function bool(val: string | undefined, def: boolean): boolean {
  if (val === undefined || val === "") return def;
  const s = val.toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function h3ExtenderEnabled(): boolean {
  return bool(process.env.PAO_H3_EXTENDER_ENABLED, true);
}

export function h3GpuBudgetGuardEnabled(): boolean {
  return bool(process.env.PAO_H3_GPU_BUDGET_GUARD, true);
}

export const H3_EXTENDER_DEFAULTS = {
  upstreamVersion: "2.8.1",
  defaultDurationSeconds: 5.0,
  defaultResolution: "720p",
  maxClipsPerProject: 50,
  maxAttemptsPerClip: 3,
};
