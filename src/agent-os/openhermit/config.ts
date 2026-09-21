// Phase 20.98 — OpenHermit runtime configuration. Per-module env config per
// repository convention (see agent-runtime/config.ts, capability-lab/config.ts).

export type SandboxBackend = "docker" | "e2b" | "daytona" | "none";

export interface OpenHermitConfig {
  /** OpenHermit gateway base URL (PAO_OPENHERMIT_URL). Unset → runtime ops fail closed. */
  gatewayBaseUrl: string | undefined;
  /** Credential reference for the gateway token (env:NAME | file:rel). Never a literal token. */
  tokenRef: string | undefined;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  approvalTtlMs: number;
  sandboxBackend: SandboxBackend;
  sandboxImage: string;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function strEnv(name: string): string | undefined {
  const raw = (process.env[name] ?? "").trim();
  return raw || undefined;
}

export function getOpenHermitConfig(): OpenHermitConfig {
  const backendRaw = (process.env.PAO_OPENHERMIT_SANDBOX_BACKEND ?? "docker").trim().toLowerCase();
  const backend: SandboxBackend = backendRaw === "e2b" || backendRaw === "daytona" || backendRaw === "none"
    ? (backendRaw as SandboxBackend)
    : "docker";
  return {
    gatewayBaseUrl: strEnv("PAO_OPENHERMIT_URL"),
    tokenRef: strEnv("PAO_OPENHERMIT_TOKEN_REF"),
    requestTimeoutMs: intEnv("PAO_OPENHERMIT_TIMEOUT_MS", 15_000, 1_000, 120_000),
    maxResponseBytes: intEnv("PAO_OPENHERMIT_MAX_RESPONSE_BYTES", 2 * 1024 * 1024, 1024, 64 * 1024 * 1024),
    approvalTtlMs: intEnv("PAO_OPENHERMIT_APPROVAL_TTL_MS", 10 * 60_000, 1_000, 24 * 60 * 60_000),
    sandboxBackend: backend,
    sandboxImage: strEnv("PAO_OPENHERMIT_SANDBOX_IMAGE") ?? "opencodex-agent-sandbox:latest",
  };
}
