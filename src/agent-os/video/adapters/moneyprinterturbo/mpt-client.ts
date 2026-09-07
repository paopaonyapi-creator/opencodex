// MoneyPrinterTurbo REST API Client
import type { MptApiTaskRequest, MptApiTaskResponse, MptTaskStatusResponse } from "./mpt-types";

export interface MptClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class MptClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(config: MptClientConfig = {}) {
    this.baseUrl = (config.baseUrl || process.env.MPT_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
    this.apiKey = config.apiKey || process.env.MPT_API_KEY;
    this.timeoutMs = config.timeoutMs || Number(process.env.MPT_REQUEST_TIMEOUT_MS) || 1800000; // 30 mins
  }

  async checkHealth(): Promise<{ ok: boolean; version?: string; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/v1/health`, {
        signal: controller.signal,
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      }).finally(() => clearTimeout(id));

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}` };
      }
      const data = await res.json().catch(() => ({})) as { version?: string };
      return { ok: true, version: data.version || "1.3.6", latencyMs };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async createTask(req: MptApiTaskRequest): Promise<MptApiTaskResponse> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      }).finally(() => clearTimeout(id));

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`MPT Task creation failed with HTTP ${res.status}: ${text}`);
      }

      return (await res.json()) as MptApiTaskResponse;
    } catch (err: unknown) {
      throw new Error(`MPT createTask network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getTaskStatus(taskId: string): Promise<MptTaskStatusResponse> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: controller.signal,
      }).finally(() => clearTimeout(id));

      if (!res.ok) {
        throw new Error(`MPT getTaskStatus HTTP ${res.status}`);
      }

      return (await res.json()) as MptTaskStatusResponse;
    } catch (err: unknown) {
      throw new Error(`MPT getTaskStatus error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
