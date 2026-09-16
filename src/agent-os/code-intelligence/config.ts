// Phase 20.62 — Code Intelligence configuration.
//
// Safe defaults per spec §22/§24/§25/§51: telemetry off, deep enrichment off,
// machine-wide agent-config writes off, bounded budgets, pinned upstream
// version. Everything fails closed when disabled.

import type { RiskThresholds } from "./types";

export interface CodeIntelConfig {
  enabled: boolean;
  providerKey: string;
  graftBin: string;
  pinnedGraftVersion: string;
  versionPolicy: "compatible" | "exact";
  telemetryDisabled: boolean;
  deepEnrichmentEnabled: boolean;
  allowMachineWideConfig: boolean;
  maxResults: number;
  maxTraceDepth: number;
  maxResponseBytes: number;
  maxContextPackBytes: number;
  maxQuerySeconds: number;
  maxBuildSeconds: number;
  requireFreshForHighRisk: boolean;
  riskThresholds: RiskThresholds;
  protectedPaths: string[];
  defaultDeniedPrefixes: string[];
}

const DEFAULT_DENIED = [
  ".env", ".env.", "secrets/", "credentials/", "private-keys/",
  "*.pem", "*.key", "*.p12", "*.pfx", "vault/", "backups/", "production-dumps/",
];

const DEFAULT_PROTECTED = [
  "src/agent-os/agent-runtime/**",
  "src/server/management/**",
  "src/agent-os/db.ts",
  "src/server/lifecycle.ts",
  "src/router.ts",
  "migrations/**",
  "deploy/**",
  ".github/workflows/**",
];

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getCodeIntelConfig(): CodeIntelConfig {
  return {
    enabled: process.env.PAO_GRAFT_ENABLED === "true",
    providerKey: process.env.PAO_CODEINTEL_PROVIDER?.trim() || "graft",
    graftBin: process.env.PAO_GRAFT_BIN?.trim() || "graft",
    pinnedGraftVersion: process.env.PAO_GRAFT_PINNED_VERSION?.trim() || "0.18.0",
    versionPolicy: process.env.PAO_GRAFT_VERSION_POLICY?.trim() === "exact" ? "exact" : "compatible",
    telemetryDisabled: process.env.PAO_GRAFT_TELEMETRY !== "true",
    deepEnrichmentEnabled: process.env.PAO_GRAFT_DEEP_ENRICHMENT === "true",
    allowMachineWideConfig: process.env.PAO_CODEINTEL_ALLOW_MACHINE_WIDE_CONFIG === "true",
    maxResults: intEnv("PAO_CODEINTEL_MAX_RESULTS", 20, 1, 200),
    maxTraceDepth: intEnv("PAO_CODEINTEL_MAX_TRACE_DEPTH", 5, 1, 10),
    maxResponseBytes: intEnv("PAO_CODEINTEL_MAX_RESPONSE_BYTES", 262_144, 4_096, 16 * 1024 * 1024),
    maxContextPackBytes: intEnv("PAO_CODEINTEL_MAX_CONTEXT_PACK_BYTES", 131_072, 4_096, 8 * 1024 * 1024),
    maxQuerySeconds: intEnv("PAO_CODEINTEL_MAX_QUERY_SECONDS", 30, 1, 600),
    maxBuildSeconds: intEnv("PAO_CODEINTEL_MAX_BUILD_SECONDS", 300, 5, 3_600),
    requireFreshForHighRisk: process.env.PAO_CODEINTEL_REQUIRE_FRESH_FOR_HIGH_RISK !== "false",
    riskThresholds: {
      medium: intEnv("PAO_CODEINTEL_RISK_MEDIUM", 25, 1, 99),
      high: intEnv("PAO_CODEINTEL_RISK_HIGH", 50, 2, 100),
      critical: intEnv("PAO_CODEINTEL_RISK_CRITICAL", 75, 3, 100),
    },
    protectedPaths: (process.env.PAO_CODEINTEL_PROTECTED_PATHS?.trim() || DEFAULT_PROTECTED.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    defaultDeniedPrefixes: (process.env.PAO_CODEINTEL_DENIED_PREFIXES?.trim() || DEFAULT_DENIED.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
  };
}
