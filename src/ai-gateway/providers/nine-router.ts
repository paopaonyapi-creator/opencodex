/**
 * Pao AI Gateway — 9Router provider adapter (Phase 20.51).
 *
 * 9Router (https://github.com/decolua/9router) is a local multi-provider
 * gateway that speaks the OpenAI chat-completions wire format on /v1. All
 * provider credentials stay inside the 9Router process; Pao holds only the
 * gateway credential.
 *
 * Telemetry note: 9Router's management surface changes between releases, so
 * quota/version discovery probes configurable paths and degrades to
 * unknown-confidence results rather than guessing. A 404 is a normal outcome,
 * not an error.
 */

import { resolveApiKey } from "../config";
import type { GatewayProviderConfig, QuotaWindow } from "../types";
import { normalizeQuotaPayload } from "../quota/model";
import { OpenAICompatibleProvider } from "./openai-compatible";

export const NINE_ROUTER_DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";

export interface NineRouterTelemetry {
  /** Empty when no telemetry endpoint answered with a readable payload. */
  readonly windows: Array<{ routeKeyHint: string; window: QuotaWindow }>;
  readonly version: string | null;
  readonly observedAt: string;
}

export class NineRouterProvider extends OpenAICompatibleProvider {
  private readonly quotaPaths: readonly string[];
  private readonly versionPaths: readonly string[];
  private readonly timeoutMs: number;

  constructor(
    config: GatewayProviderConfig,
    options: {
      quotaPaths?: readonly string[];
      versionPaths?: readonly string[];
      timeoutMs?: number;
    } = {},
  ) {
    // An empty interpolated base URL means "not configured"; fall through to
    // the loopback default rather than producing a malformed request URL.
    const baseUrl = config.baseUrl && config.baseUrl.trim() !== "" ? config.baseUrl : NINE_ROUTER_DEFAULT_BASE_URL;
    super({ ...config, baseUrl });
    this.quotaPaths = options.quotaPaths ?? ["/api/quotas", "/api/quota", "/api/usage"];
    this.versionPaths = options.versionPaths ?? ["/api/version", "/api/status"];
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Probe the gateway's telemetry surface. Missing, erroring, and unreadable
   * endpoints all resolve to an empty result with a fresh observedAt — the
   * caller models that as unknown quota, never as unlimited.
   */
  async getTelemetry(): Promise<NineRouterTelemetry> {
    const observedAt = new Date().toISOString();
    const windows: NineRouterTelemetry["windows"] = [];
    let version: string | null = null;

    for (const path of this.quotaPaths) {
      try {
        const resp = await fetch(this.telemetryUrl(path), {
          headers: this.telemetryHeaders(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!resp.ok) continue;
        const payload: unknown = await resp.json();
        windows.push(...normalizeQuotaPayload(payload, observedAt));
        if (windows.length > 0) break; // first readable surface wins
      } catch {
        continue;
      }
    }

    for (const path of this.versionPaths) {
      try {
        const resp = await fetch(this.telemetryUrl(path), {
          headers: this.telemetryHeaders(),
          signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5_000)),
        });
        if (!resp.ok) continue;
        const payload: unknown = await resp.json();
        version = extractVersion(payload);
        if (version) break;
      } catch {
        continue;
      }
    }

    return { windows, version, observedAt };
  }

  private telemetryUrl(path: string): string {
    return `${this.telemetryBase()}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /**
   * Telemetry endpoints hang off the gateway root, not the /v1 inference
   * prefix. Derive the root by stripping a trailing /v1 when present.
   */
  private telemetryBase(): string {
    return this.baseUrl.endsWith("/v1") ? this.baseUrl.slice(0, -3) : this.baseUrl;
  }

  private telemetryHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = resolveApiKey(this.apiKeyEnv);
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }
}

function extractVersion(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") {
    return typeof payload === "string" && payload.trim() !== "" ? payload.trim().slice(0, 64) : null;
  }
  const obj = payload as Record<string, unknown>;
  for (const key of ["version", "Version", "app_version", "release"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 64);
    if (typeof value === "number") return String(value);
  }
  return null;
}
