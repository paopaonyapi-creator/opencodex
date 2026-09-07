// MoneyPrinterTurbo Runtime Manager
import type { ProviderHealthStatus } from "../../domain/types";
import { MptClient } from "./mpt-client";

export type MptRuntimeMode = "external_api" | "managed_docker" | "local_cli" | "agent_skill";

export interface MptRuntimeConfig {
  enabled: boolean;
  mode: MptRuntimeMode;
  apiBaseUrl: string;
  webuiUrl?: string;
  allowAutoStart: boolean;
  timeoutMs: number;
}

export class MptRuntimeManager {
  private config: MptRuntimeConfig;
  private client: MptClient;

  constructor(customConfig?: Partial<MptRuntimeConfig>) {
    this.config = {
      enabled: process.env.MPT_ENABLED === "true" || (customConfig?.enabled ?? true),
      mode: (process.env.MPT_RUNTIME_MODE as MptRuntimeMode) || customConfig?.mode || "external_api",
      apiBaseUrl: process.env.MPT_API_BASE_URL || customConfig?.apiBaseUrl || "http://127.0.0.1:8080",
      webuiUrl: process.env.MPT_WEBUI_URL || customConfig?.webuiUrl || "http://127.0.0.1:8501",
      allowAutoStart: process.env.MPT_ALLOW_AUTO_START === "true" || (customConfig?.allowAutoStart ?? false),
      timeoutMs: Number(process.env.MPT_REQUEST_TIMEOUT_MS) || customConfig?.timeoutMs || 1800000,
    };
    this.client = new MptClient({ baseUrl: this.config.apiBaseUrl, timeoutMs: this.config.timeoutMs });
  }

  getConfig(): MptRuntimeConfig {
    return { ...this.config };
  }

  getClient(): MptClient {
    return this.client;
  }

  async probeHealth(): Promise<{
    status: ProviderHealthStatus;
    mode: MptRuntimeMode;
    version?: string;
    latencyMs: number;
    error?: string;
  }> {
    if (!this.config.enabled) {
      return { status: "offline", mode: this.config.mode, latencyMs: 0, error: "MPT disabled by configuration" };
    }

    const res = await this.client.checkHealth();
    if (res.ok) {
      return { status: "healthy", mode: this.config.mode, version: res.version, latencyMs: res.latencyMs };
    }

    return {
      status: "degraded",
      mode: this.config.mode,
      latencyMs: res.latencyMs,
      error: res.error,
    };
  }

  async healthCheck() {
    return this.probeHealth();
  }
}
