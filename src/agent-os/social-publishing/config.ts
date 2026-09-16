// Phase 20.60 — Social Publishing configuration.
//
// Module-local env config, following the capability-lab config.ts pattern.
// Everything defaults to safe values: the subsystem is off unless explicitly
// enabled, approval is human-required, and network calls are bounded.

import type { ApprovalMode, OpenPostTransportMode } from "./types";

export interface SocialPublishingConfig {
  enabled: boolean;
  defaultInstanceId: string;
  defaultBaseUrl: string;
  /** Direct token override for local/dev; production should use secret refs. */
  apiToken: string;
  apiTokenSecretRef: string;
  mcpUrl: string;
  mcpTokenSecretRef: string;
  transport: OpenPostTransportMode;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  reconcileIntervalSec: number;
  capabilityCacheTtlSec: number;
  approvalMode: ApprovalMode;
  maxDeliveryAttempts: number;
  analyticsSyncEnabled: boolean;
  analyticsSyncIntervalMin: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getSocialPublishingConfig(): SocialPublishingConfig {
  const transport = (process.env.PAO_OPENPOST_TRANSPORT?.trim() || "hybrid") as OpenPostTransportMode;
  return {
    enabled: process.env.PAO_SOCIAL_PUBLISHING_ENABLED === "true",
    defaultInstanceId: process.env.PAO_OPENPOST_DEFAULT_INSTANCE_ID?.trim() || "main",
    defaultBaseUrl: (process.env.PAO_OPENPOST_BASE_URL?.trim() || "http://openpost:8080").replace(/\/+$/, ""),
    apiToken: process.env.PAO_OPENPOST_API_TOKEN?.trim() || "",
    apiTokenSecretRef: process.env.PAO_OPENPOST_API_TOKEN_SECRET_REF?.trim() || "",
    mcpUrl: process.env.PAO_OPENPOST_MCP_URL?.trim() || "",
    mcpTokenSecretRef: process.env.PAO_OPENPOST_MCP_TOKEN_SECRET_REF?.trim() || "",
    transport: ["http", "mcp", "hybrid"].includes(transport) ? transport : "hybrid",
    connectTimeoutMs: intEnv("PAO_OPENPOST_CONNECT_TIMEOUT_MS", 5_000, 500, 120_000),
    requestTimeoutMs: intEnv("PAO_OPENPOST_REQUEST_TIMEOUT_MS", 30_000, 1_000, 600_000),
    maxResponseBytes: intEnv("PAO_OPENPOST_MAX_RESPONSE_BYTES", 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024),
    reconcileIntervalSec: intEnv("PAO_OPENPOST_RECONCILE_INTERVAL_SEC", 60, 10, 86_400),
    capabilityCacheTtlSec: intEnv("PAO_OPENPOST_CAPABILITY_CACHE_TTL_SEC", 300, 5, 86_400),
    approvalMode: (process.env.PAO_SOCIAL_APPROVAL_MODE?.trim() || "human_required") as ApprovalMode,
    maxDeliveryAttempts: intEnv("PAO_SOCIAL_MAX_DELIVERY_ATTEMPTS", 5, 1, 20),
    analyticsSyncEnabled: process.env.PAO_SOCIAL_ANALYTICS_SYNC_ENABLED !== "false",
    analyticsSyncIntervalMin: intEnv("PAO_SOCIAL_ANALYTICS_SYNC_INTERVAL_MIN", 60, 5, 10_080),
  };
}
