// Phase 20 — RunPod REST Client.
//
// Typed, retry-aware, and secure REST client for the RunPod v1 API.
// Features: SSRF validation, redaction of credentials in errors/logs,
// rate-limit detection, and standard typed errors mapped to JobErrorCode.

import type {
  RunPodPod,
  RunPodCreatePodInput,
  RunPodTemplate,
  RunPodNetworkVolume,
  RunPodBillingPodRecord,
} from "./api-types";
import type { JobErrorCode } from "../../types";

export interface RunPodClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  allowCustomHost?: boolean;
}

export class RunPodApiError extends Error {
  readonly statusCode: number;
  readonly code: JobErrorCode;
  readonly rawBody: string;

  constructor(message: string, statusCode: number, code: JobErrorCode, rawBody = "") {
    super(redactSecret(message));
    this.name = "RunPodApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.rawBody = redactSecret(rawBody);
  }
}

export function redactSecret(text: string): string {
  if (!text) return text;
  return text
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key["':\s=]+[A-Za-z0-9_\-.]+/gi, "apiKey=[REDACTED]")
    .replace(/rpa_[A-Za-z0-9_]+/gi, "rpa_[REDACTED]");
}

function validateBaseUrl(rawUrl: string, allowCustomHost: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RunPodApiError(`Invalid RunPod API base URL: ${rawUrl}`, 400, "RP_API_UNAVAILABLE");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RunPodApiError("RunPod API URL must use https:// (or http:// for tests)", 400, "RP_API_UNAVAILABLE");
  }

  const host = parsed.hostname.toLowerCase();
  const isDefaultHost = host === "rest.runpod.io" || host === "api.runpod.io";
  const isLoopback = host === "127.0.0.1" || host === "localhost";

  if (!isDefaultHost && !isLoopback && !allowCustomHost) {
    throw new RunPodApiError(
      `SSRF protection: hostname "${host}" is not an allowed RunPod host (expected rest.runpod.io)`,
      403,
      "RP_AUTH_FAILED",
    );
  }

  return parsed;
}

export class RunPodClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly allowCustomHost: boolean;

  constructor(options: RunPodClientOptions) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.allowCustomHost = options.allowCustomHost ?? false;
    const validated = validateBaseUrl(options.baseUrl ?? "https://rest.runpod.io/v1", this.allowCustomHost);
    this.baseUrl = validated.toString().replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  private mapStatusToCode(status: number, subPath: string, message: string): JobErrorCode {
    if (status === 401 || status === 403) return "RP_AUTH_FAILED";
    if (status === 429) return "RP_RATE_LIMITED";
    if (status === 404) {
      if (subPath.startsWith("/templates")) return "RP_TEMPLATE_NOT_FOUND";
      if (subPath.startsWith("/networkvolumes")) return "RP_VOLUME_NOT_FOUND";
    }
    if (status === 400 && /gpu.*not available|capacity|out of stock/i.test(message)) {
      return "RP_GPU_UNAVAILABLE";
    }
    if (status >= 500) return "RP_API_UNAVAILABLE";
    return "internal";
  }

  async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.apiKey) {
      throw new RunPodApiError("RunPod API key is not configured", 401, "RP_AUTH_FAILED");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      timer.unref?.();

      try {
        const res = await fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          if (res.status === 204) return {} as T;
          const text = await res.text();
          try {
            return (text ? JSON.parse(text) : {}) as T;
          } catch {
            return text as unknown as T;
          }
        }

        const rawText = await res.text().catch(() => "");
        let errMsg = `RunPod HTTP ${res.status}: ${res.statusText}`;
        try {
          const parsed = JSON.parse(rawText) as { error?: string; message?: string };
          errMsg = parsed.message || parsed.error || errMsg;
        } catch { /* use status text */ }

        const code = this.mapStatusToCode(res.status, path, errMsg);
        const apiError = new RunPodApiError(errMsg, res.status, code, rawText);

        // Retry on 429 or 5xx if retries remain
        if ((res.status === 429 || res.status >= 500) && attempt <= this.maxRetries) {
          lastError = apiError;
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        throw apiError;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof RunPodApiError) throw err;

        const isAbort = (err as Error)?.name === "AbortError";
        const message = isAbort ? `RunPod request timed out after ${this.timeoutMs}ms` : (err as Error).message;
        const code: JobErrorCode = isAbort ? "RP_POD_TIMEOUT" : "RP_API_UNAVAILABLE";
        const apiError = new RunPodApiError(message, isAbort ? 504 : 500, code);

        if (attempt <= this.maxRetries) {
          lastError = apiError;
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }

        throw lastError ?? apiError;
      }
    }

    throw lastError ?? new RunPodApiError("RunPod request failed after retries", 500, "RP_API_UNAVAILABLE");
  }

  // ---- Pods Operations (spec section 16)
  async listPods(): Promise<RunPodPod[]> {
    const data = await this.request<RunPodPod[] | { pods: RunPodPod[] }>("/pods");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as { pods?: RunPodPod[] }).pods)) {
      return (data as { pods: RunPodPod[] }).pods;
    }
    return [];
  }

  async getPod(podId: string): Promise<RunPodPod> {
    if (!podId) throw new RunPodApiError("podId is required", 400, "RP_POD_CREATE_FAILED");
    return await this.request<RunPodPod>(`/pods/${encodeURIComponent(podId)}`);
  }

  async createPod(input: RunPodCreatePodInput): Promise<RunPodPod> {
    if (!input.name) throw new RunPodApiError("Pod name is required", 400, "RP_POD_CREATE_FAILED");
    if (!input.gpuTypeIds || input.gpuTypeIds.length === 0) {
      throw new RunPodApiError("At least one gpuTypeId is required", 400, "RP_POD_CREATE_FAILED");
    }
    return await this.request<RunPodPod>("/pods", { method: "POST", body: input });
  }

  async startPod(podId: string): Promise<RunPodPod> {
    if (!podId) throw new RunPodApiError("podId is required", 400, "RP_POD_START_FAILED");
    return await this.request<RunPodPod>(`/pods/${encodeURIComponent(podId)}/start`, { method: "POST" });
  }

  async stopPod(podId: string): Promise<RunPodPod> {
    if (!podId) throw new RunPodApiError("podId is required", 400, "RP_STOP_FAILED");
    return await this.request<RunPodPod>(`/pods/${encodeURIComponent(podId)}/stop`, { method: "POST" });
  }

  async deletePod(podId: string): Promise<boolean> {
    if (!podId) throw new RunPodApiError("podId is required", 400, "RP_TERMINATE_FAILED");
    await this.request<unknown>(`/pods/${encodeURIComponent(podId)}`, { method: "DELETE" });
    return true;
  }

  // ---- Templates Operations (spec section 16 & 61)
  async listTemplates(): Promise<RunPodTemplate[]> {
    const data = await this.request<RunPodTemplate[] | { templates: RunPodTemplate[] }>("/templates");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as { templates?: RunPodTemplate[] }).templates)) {
      return (data as { templates: RunPodTemplate[] }).templates;
    }
    return [];
  }

  async getTemplate(templateId: string): Promise<RunPodTemplate> {
    if (!templateId) throw new RunPodApiError("templateId is required", 400, "RP_TEMPLATE_NOT_FOUND");
    return await this.request<RunPodTemplate>(`/templates/${encodeURIComponent(templateId)}`);
  }

  // ---- Network Volumes Operations (spec section 16 & 64)
  async listNetworkVolumes(): Promise<RunPodNetworkVolume[]> {
    const data = await this.request<RunPodNetworkVolume[] | { networkVolumes: RunPodNetworkVolume[] }>("/networkvolumes");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as { networkVolumes?: RunPodNetworkVolume[] }).networkVolumes)) {
      return (data as { networkVolumes: RunPodNetworkVolume[] }).networkVolumes;
    }
    return [];
  }

  async getNetworkVolume(volumeId: string): Promise<RunPodNetworkVolume> {
    if (!volumeId) throw new RunPodApiError("volumeId is required", 400, "RP_VOLUME_NOT_FOUND");
    return await this.request<RunPodNetworkVolume>(`/networkvolumes/${encodeURIComponent(volumeId)}`);
  }

  // ---- Billing Operations (spec section 16 & 41)
  async getPodBilling(): Promise<RunPodBillingPodRecord[]> {
    const data = await this.request<RunPodBillingPodRecord[] | { billing: RunPodBillingPodRecord[] }>("/billing/pods");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as { billing?: RunPodBillingPodRecord[] }).billing)) {
      return (data as { billing: RunPodBillingPodRecord[] }).billing;
    }
    return [];
  }
}
