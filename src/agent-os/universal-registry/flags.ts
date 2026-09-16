// Phase 20.25 — Feature flags (doc §93). Every flag has a safe default so the
// phase can be rolled back without a code change.

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export interface RegistryFlags {
  /** Master switch for the registry surface. */
  registry: boolean;
  /** Automatic tool selection for goals (search+ranking exposed via API either way). */
  autoToolRouter: boolean;
  /** Toolchain planner (goal → plan). */
  planner: boolean;
  /** Fallback chain during execution. */
  autoFallback: boolean;
  /** Replay of past runs. */
  replay: boolean;
}

export function registryFlags(): RegistryFlags {
  return {
    registry: envFlag("ENABLE_UNIVERSAL_REGISTRY", true),
    autoToolRouter: envFlag("ENABLE_AUTO_TOOL_ROUTER", false),
    planner: envFlag("ENABLE_TOOLCHAIN_PLANNER", true),
    autoFallback: envFlag("ENABLE_AUTO_FALLBACK", true),
    replay: envFlag("ENABLE_REPLAY", true),
  };
}
