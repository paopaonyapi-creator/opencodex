/**
 * Phase 20.56 configuration. Names follow PAO_* conventions.
 */

export interface CapabilityLabConfig {
  readonly enabled: boolean;
  readonly sourceDir: string;
  readonly artifactDir: string;
  readonly sandboxBackend: "none" | "process" | "docker";
  readonly timeoutSeconds: number;
  readonly requireReviewHighRisk: boolean;
}

export function getCapabilityLabConfig(): CapabilityLabConfig {
  const backend = (process.env.PAO_CAPABILITY_SANDBOX_BACKEND ?? "process") as CapabilityLabConfig["sandboxBackend"];
  return {
    enabled: process.env.PAO_CAPABILITY_ENABLED !== "false",
    sourceDir: process.env.PAO_CAPABILITY_SOURCE_DIR ?? "data/capability-sources",
    artifactDir: process.env.PAO_CAPABILITY_ARTIFACT_DIR ?? "data/capability-artifacts",
    sandboxBackend: backend === "docker" || backend === "none" ? backend : "process",
    timeoutSeconds: Number(process.env.PAO_CAPABILITY_DEFAULT_TIMEOUT_SECONDS ?? 60),
    requireReviewHighRisk: process.env.PAO_CAPABILITY_REQUIRE_REVIEW_HIGH_RISK !== "false",
  };
}

