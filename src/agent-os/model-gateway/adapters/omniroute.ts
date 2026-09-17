/**
 * Phase 20.85 — OmniRoute Remote Gateway Adapter
 * Pluggable inference gateway client with protocol translation, bounded
 * retry/backoff, cached connection health, correlation IDs, and structured
 * failure reasons.
 *
 * Phase 20.82 hardening contract: OmniRoute being offline is a DEGRADED
 * state, never a crash — executeCandidate fails with a structured
 * OmniRouteFailure and the gateway falls back per its policy envelope; the
 * health probe is cached so readiness checks never hammer the daemon.
 */

import type { CapabilityRegistry } from "../registry";
import type { BudgetGovernanceEngine } from "../budget";
import type { FailureClass, GatewayRequest, ModelDefinition, PolicyEnvelope } from "../types";
import type { AdapterExecutionResult } from "./direct";

/** Failure classes worth another attempt, with bounded backoff. */
const RETRYABLE_FAILURE_CLASSES = new Set<FailureClass>([
  "timeout",
  "provider_unavailable",
  "rate_limit",
  "transient",
]);

/** Structured failure — carries machine-readable class/retryability metadata. */
export class OmniRouteFailure extends Error {
  readonly failureClass: FailureClass;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly providerId: string | null;
  readonly modelName: string | null;
  readonly correlationId: string | null;
  readonly attempt: number;
  readonly retryAfterMs: number | null;

  constructor(init: {
    message: string;
    failureClass: FailureClass;
    statusCode?: number | null;
    providerId?: string | null;
    modelName?: string | null;
    correlationId?: string | null;
    attempt?: number;
    retryAfterMs?: number | null;
  }) {
    super(init.message);
    this.name = "OmniRouteFailure";
    this.failureClass = init.failureClass;
    this.retryable = RETRYABLE_FAILURE_CLASSES.has(init.failureClass);
    this.statusCode = init.statusCode ?? null;
    this.providerId = init.providerId ?? null;
    this.modelName = init.modelName ?? null;
    this.correlationId = init.correlationId ?? null;
    this.attempt = init.attempt ?? 1;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

export interface OmniRouteConnectionHealth {
  status: "connected" | "unreachable" | "disabled";
  baseUrl: string;
  checkedAt: string;
  latencyMs: number | null;
  error: string | null;
}

export interface OmniRouteAdapterConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Extra attempts after the first (0 = no retry). */
  retryMax?: number;
  /** Health probe cache TTL (ms). */
  healthTtlMs?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export class OmniRouteGatewayAdapter {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private retryMax: number;
  private healthTtlMs: number;
  private healthCache: { value: OmniRouteConnectionHealth; expiresAt: number } | null = null;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly budgetEngine: BudgetGovernanceEngine,
    config?: OmniRouteAdapterConfig,
  ) {
    this.baseUrl = (config?.baseUrl || process.env.PAO_OMNIROUTE_BASE_URL || "http://127.0.0.1:9090").replace(/\/+$/, "");
    this.apiKey = config?.apiKey || process.env.PAO_OMNIROUTE_API_KEY || "";
    this.timeoutMs = config?.timeoutMs || envInt("PAO_OMNIROUTE_TIMEOUT_MS", 30000);
    this.retryMax = config?.retryMax ?? envInt("PAO_OMNIROUTE_RETRY_MAX", 2);
    this.healthTtlMs = config?.healthTtlMs ?? envInt("PAO_OMNIROUTE_HEALTH_TTL_MS", 15000);
    this.assertValidBaseUrl(this.baseUrl);
  }

  private assertValidBaseUrl(raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Invalid PAO_OMNIROUTE_BASE_URL '${raw}': not a valid URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Invalid PAO_OMNIROUTE_BASE_URL '${raw}': protocol must be http or https`);
    }
    // Credentials embedded in the URL would leak into logs/audit; the API key
    // travels only via the Authorization header.
    if (url.username || url.password) {
      throw new Error(`Invalid PAO_OMNIROUTE_BASE_URL '${raw}': credentials in URL are not permitted; use PAO_OMNIROUTE_API_KEY`);
    }
  }

  public get baseUrlValue(): string {
    return this.baseUrl;
  }

  /**
   * Cached connection probe of the OmniRoute daemon. Never throws — an
   * unreachable daemon is a health state, not an error.
   */
  public async connectionHealth(force = false): Promise<OmniRouteConnectionHealth> {
    const now = Date.now();
    if (!force && this.healthCache && this.healthCache.expiresAt > now) {
      return this.healthCache.value;
    }
    const started = Date.now();
    let value: OmniRouteConnectionHealth;
    try {
      const res = await fetch(new URL("/healthz", this.baseUrl).toString(), {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(3000, Math.max(1000, this.healthTtlMs))),
      });
      value = {
        status: res.ok ? "connected" : "unreachable",
        baseUrl: this.baseUrl,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(Date.now() - started, 1),
        error: res.ok ? null : `healthz returned ${res.status}`,
      };
    } catch (err) {
      value = {
        status: "unreachable",
        baseUrl: this.baseUrl,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(Date.now() - started, 1),
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this.healthCache = { value, expiresAt: Date.now() + this.healthTtlMs };
    return value;
  }

  public async executeCandidate(
    modelId: string,
    request: GatewayRequest,
    envelope: PolicyEnvelope,
  ): Promise<AdapterExecutionResult> {
    const model = this.registry.getModel(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found in registry`);
    }

    // Provider/model metadata propagation + trace/correlation IDs: every hop
    // carries the same correlation id so gateway attempts and OmniRoute-side
    // logs can be joined.
    const correlationId =
      (request as unknown as { traceId?: string }).traceId ||
      request.requestId ||
      crypto.randomUUID();
    const maxAttempts = this.retryMax + 1;
    let lastFailure: OmniRouteFailure | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executeOnce(model, request, envelope, correlationId, attempt);
      } catch (err) {
        lastFailure = err instanceof OmniRouteFailure
          ? err
          : new OmniRouteFailure({
              message: err instanceof Error ? err.message : String(err),
              failureClass: "transient",
              providerId: model.providerId,
              modelName: model.modelName,
              correlationId,
              attempt,
            });
        // Structured failure reasons must never carry the API key.
        lastFailure.message = this.redact(lastFailure.message);
        const retryable = lastFailure.retryable && attempt < maxAttempts;
        if (!retryable) break;
        // Bounded exponential backoff; rate_limit honors Retry-After (capped).
        let backoffMs = Math.min(200 * Math.pow(2, attempt - 1), 2000);
        if (lastFailure.failureClass === "rate_limit" && lastFailure.retryAfterMs) {
          backoffMs = Math.min(Math.max(lastFailure.retryAfterMs, 100), 5000);
        }
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw lastFailure ?? new OmniRouteFailure({ message: "OmniRoute request failed", failureClass: "transient", correlationId, attempt: maxAttempts });
  }

  private async executeOnce(
    model: ModelDefinition,
    request: GatewayRequest,
    envelope: PolicyEnvelope,
    correlationId: string,
    attempt: number,
  ): Promise<AdapterExecutionResult> {
    const start = performance.now();

    // Protocol translation: format payload for the OmniRoute API
    const payload = {
      model: model.modelName,
      provider: model.providerId,
      messages: request.messages || [{ role: "user", content: request.prompt || "" }],
      temperature: request.runtime?.temperature ?? 0.2,
      metadata: {
        requestId: request.requestId,
        correlationId,
        attempt,
        routeGroup: envelope.routeGroup,
        policyDecisionId: envelope.policyDecisionId,
        dataClass: envelope.dataClass,
        localOnly: envelope.localOnly,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Protocol is validated once at construction; re-check per request so a
      // mutated baseUrl can never smuggle a non-http scheme.
      const url = new URL("/v1/chat/completions", this.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new OmniRouteFailure({
          message: `Invalid protocol in OmniRoute baseUrl: ${url.protocol}`,
          failureClass: "invalid_request",
          providerId: model.providerId,
          modelName: model.modelName,
          correlationId,
          attempt,
        });
      }

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          "x-pao-request-id": request.requestId ?? correlationId,
          "x-pao-trace-id": correlationId,
          "x-pao-attempt": String(attempt),
          "x-pao-provider": model.providerId,
          "x-pao-model": model.modelName,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = this.redact(await res.text().catch(() => ""));
        const failureClass = this.classifyError(res.status, errorText);
        const retryAfterRaw = Number(res.headers.get("retry-after"));
        const retryAfterMs = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
          ? retryAfterRaw * 1000
          : null;
        throw new OmniRouteFailure({
          message: `OmniRoute error ${res.status}: ${errorText.slice(0, 200)}`,
          failureClass,
          statusCode: res.status,
          providerId: model.providerId,
          modelName: model.modelName,
          correlationId,
          attempt,
          retryAfterMs,
        });
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const output = data.choices?.[0]?.message?.content ?? "";
      const latencyMs = Math.max(Math.round(performance.now() - start), 1);
      const inputTokens = data.usage?.prompt_tokens ?? Math.max(Math.round(JSON.stringify(payload).length / 4), 10);
      const outputTokens = data.usage?.completion_tokens ?? Math.max(Math.round(output.length / 4), 10);
      const actualCostUsd = this.budgetEngine.calculateCost(model, inputTokens, outputTokens);

      return {
        output,
        structuredOutput: this.tryParseJson(output),
        inputTokens,
        outputTokens,
        actualCostUsd,
        latencyMs,
      };
    } catch (err: unknown) {
      if (err instanceof OmniRouteFailure) throw err;
      if ((err as Error).name === "AbortError" || (err as Error).name === "TimeoutError") {
        throw new OmniRouteFailure({
          message: `OmniRoute timed out after ${this.timeoutMs}ms`,
          failureClass: "timeout",
          providerId: model.providerId,
          modelName: model.modelName,
          correlationId,
          attempt,
        });
      }
      // Network-layer refusal (ECONNREFUSED, DNS, TLS) → provider_unavailable.
      throw new OmniRouteFailure({
        message: `OmniRoute unreachable: ${err instanceof Error ? err.message : String(err)}`,
        failureClass: "provider_unavailable",
        providerId: model.providerId,
        modelName: model.modelName,
        correlationId,
        attempt,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  public classifyError(status: number, message: string): FailureClass {
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "authentication";
    if (status === 400) return "invalid_request";
    if (status >= 500 && status < 600) return "provider_unavailable";
    if (message.toLowerCase().includes("timeout")) return "timeout";
    return "transient";
  }

  private redact(text: string): string {
    return text
      .replace(this.apiKey, "[REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
  }

  private tryParseJson(text: string): unknown | undefined {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
