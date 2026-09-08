// Configuration and feature flags for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

export interface MobileConfig {
  enabled: boolean;
  provider: string;
  allowPhysical: boolean;
  allowShell: boolean;
  requireReview: boolean;
  defaultProfile: "auto" | "flash" | "pro";
  defaultVerification: "off" | "final" | "checkpoints" | "strict";
  artemisHost: string;
  artemisPort: number;
  artemisTransport: "stdio" | "http" | "mock";
}

export function getMobileConfig(): MobileConfig {
  return {
    enabled: process.env.PAO_MOBILE_ENABLED !== "false",
    provider: process.env.PAO_MOBILE_PROVIDER || "artemis",
    allowPhysical: process.env.PAO_MOBILE_ALLOW_PHYSICAL === "true",
    allowShell: process.env.PAO_MOBILE_ALLOW_SHELL === "true",
    requireReview: process.env.PAO_MOBILE_REQUIRE_REVIEW !== "false",
    defaultProfile: (process.env.PAO_MOBILE_DEFAULT_PROFILE as any) || "flash",
    defaultVerification: (process.env.PAO_MOBILE_DEFAULT_VERIFICATION as any) || "final",
    artemisHost: process.env.ARTEMIS_HOST || "127.0.0.1",
    artemisPort: Number(process.env.ARTEMIS_PORT || 8000),
    artemisTransport: (process.env.ARTEMIS_TRANSPORT as any) || "mock",
  };
}
