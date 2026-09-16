// Phase 20.63 — External APIs configuration (spec §51, §65-§66).
//
// Conservative defaults: registry read-only, tool generation produces
// disabled tools, runtime execution off, HTTPS required, private networks
// denied. Credentials never live in this config.

export interface ExternalApiConfig {
  enabled: boolean;
  sourcePublicApisEnabled: boolean;
  enrichmentEnabled: boolean;
  healthChecksEnabled: boolean;
  openapiDiscoveryEnabled: boolean;
  toolGenerationEnabled: boolean;
  runtimeExecutionEnabled: boolean;
  autoRegisterDiscovered: boolean;
  autoEnableTools: boolean;
  requireHttps: boolean;
  blockPrivateNetworks: boolean;
  maxRedirects: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxSpecBytes: number;
  globalConcurrency: number;
  perDomainConcurrency: number;
  defaultMinIntervalMs: number;
  maxRowDropRatio: number;
  maxParseWarningRatio: number;
  healthBaseIntervalHours: number;
  defaultRateLimitPerMinute: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getExternalApiConfig(): ExternalApiConfig {
  return {
    enabled: process.env.PAO_EXTERNAL_API_REGISTRY_ENABLED === "true",
    sourcePublicApisEnabled: process.env.PAO_PUBLIC_APIS_SOURCE_ENABLED !== "false",
    enrichmentEnabled: process.env.PAO_EXTERNAL_API_ENRICHMENT === "true",
    healthChecksEnabled: process.env.PAO_EXTERNAL_API_HEALTH_CHECKS === "true",
    openapiDiscoveryEnabled: process.env.PAO_EXTERNAL_API_OPENAPI_DISCOVERY === "true",
    toolGenerationEnabled: process.env.PAO_EXTERNAL_API_TOOL_GENERATION === "true",
    runtimeExecutionEnabled: process.env.PAO_EXTERNAL_API_RUNTIME_EXECUTION === "true",
    autoRegisterDiscovered: process.env.PAO_EXTERNAL_API_AUTO_REGISTER !== "false",
    autoEnableTools: false,
    requireHttps: process.env.PAO_EXTERNAL_API_REQUIRE_HTTPS !== "false",
    blockPrivateNetworks: process.env.PAO_EXTERNAL_API_BLOCK_PRIVATE_NETWORKS !== "false",
    maxRedirects: intEnv("PAO_EXTERNAL_API_MAX_REDIRECTS", 5, 0, 10),
    connectTimeoutMs: intEnv("PAO_EXTERNAL_API_CONNECT_TIMEOUT_MS", 5_000, 500, 60_000),
    requestTimeoutMs: intEnv("PAO_EXTERNAL_API_REQUEST_TIMEOUT_MS", 15_000, 1_000, 120_000),
    maxResponseBytes: intEnv("PAO_EXTERNAL_API_MAX_RESPONSE_BYTES", 5_242_880, 4_096, 64 * 1024 * 1024),
    maxSpecBytes: intEnv("PAO_EXTERNAL_API_MAX_SPEC_BYTES", 1_048_576, 4_096, 16 * 1024 * 1024),
    globalConcurrency: intEnv("PAO_EXTERNAL_API_GLOBAL_CONCURRENCY", 10, 1, 100),
    perDomainConcurrency: intEnv("PAO_EXTERNAL_API_PER_DOMAIN_CONCURRENCY", 1, 1, 10),
    defaultMinIntervalMs: intEnv("PAO_EXTERNAL_API_MIN_INTERVAL_MS", 1_000, 0, 60_000),
    maxRowDropRatio: Number(process.env.PAO_EXTERNAL_API_MAX_ROW_DROP ?? "0.10"),
    maxParseWarningRatio: Number(process.env.PAO_EXTERNAL_API_MAX_PARSE_WARNING ?? "0.02"),
    healthBaseIntervalHours: intEnv("PAO_EXTERNAL_API_HEALTH_INTERVAL_H", 6, 1, 168),
    defaultRateLimitPerMinute: intEnv("PAO_EXTERNAL_API_DEFAULT_RATE_PER_MIN", 30, 1, 10_000),
  };
}
