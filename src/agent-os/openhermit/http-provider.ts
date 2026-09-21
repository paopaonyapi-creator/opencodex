// Phase 20.98 — Real HTTP adapter talking to an OpenHermit gateway (spec §3, §4).
//
// Strictly respects the OpenHermit adapter boundary:
//   - All raw network I/O is encapsulated here
//   - Returns canonical normalized types from types.ts
//   - Fails closed on transport or protocol errors
//   - No plaintext tokens logged; secrets resolved via secrets.ts helper

import { HermitError, type HermitHealth, type HermitRemoteAgent, type HermitRemoteSession, type HermitRuntimeProvider } from "./types";
import { resolveRuntimeToken } from "../agent-runtime/secrets";

export interface HttpProviderOptions {
  baseUrl: string;
  tokenRef?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class OpenHermitHttpProvider implements HermitRuntimeProvider {
  readonly provider = "openhermit-http";

  private readonly baseUrl: string;
  private readonly tokenRef?: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(opts: HttpProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.tokenRef = opts.tokenRef;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 2 * 1024 * 1024;
  }

  private authHeader(): Record<string, string> {
    if (!this.tokenRef) return {};
    try {
      const token = resolveRuntimeToken(this.tokenRef);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.authHeader(),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, 512);
        if (resp.status === 404) {
          throw new HermitError("AGENT_NOT_FOUND", `upstream returned 404: ${text}`);
        }
        if (resp.status === 401 || resp.status === 403) {
          throw new HermitError("CREDENTIAL_DENIED", `upstream auth failed (${resp.status}): ${text}`);
        }
        throw new HermitError("HERMIT_BAD_RESPONSE", `upstream returned status ${resp.status}: ${text}`);
      }

      const raw = await resp.text();
      if (raw.length > this.maxResponseBytes) {
        throw new HermitError(
          "HERMIT_BAD_RESPONSE",
          `response exceeds maximum byte cap (${raw.length} > ${this.maxResponseBytes})`,
        );
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      if (err instanceof HermitError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new HermitError("HERMIT_TIMEOUT", `upstream timed out after ${this.timeoutMs}ms`);
      }
      throw new HermitError(
        "HERMIT_UNAVAILABLE",
        `failed to reach OpenHermit gateway at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ health: HermitHealth; version: string | null; capabilities: string[]; message?: string }> {
    try {
      const data = await this.requestJson<{
        status?: string;
        version?: string;
        capabilities?: string[];
      }>("GET", "/health");
      const healthy = data.status === "ok" || data.status === "healthy";
      return {
        health: healthy ? "healthy" : "degraded",
        version: data.version ?? null,
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      };
    } catch (err) {
      return {
        health: "unhealthy",
        version: null,
        capabilities: [],
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async createAgent(input: {
    name: string;
    instruction: string;
    skills?: string[];
    mcpServers?: string[];
  }): Promise<{ runtimeAgentId: string }> {
    const res = await this.requestJson<{ id?: string; agent_id?: string }>("POST", "/api/v1/agents", input);
    const runtimeAgentId = res.id ?? res.agent_id;
    if (!runtimeAgentId) {
      throw new HermitError("HERMIT_BAD_RESPONSE", "createAgent response missing id");
    }
    return { runtimeAgentId };
  }

  async startAgent(runtimeAgentId: string): Promise<{ state: string }> {
    const res = await this.requestJson<{ state?: string }>("POST", `/api/v1/agents/${runtimeAgentId}/start`);
    return { state: res.state ?? "running" };
  }

  async stopAgent(runtimeAgentId: string, reason: string): Promise<{ state: string }> {
    const res = await this.requestJson<{ state?: string }>("POST", `/api/v1/agents/${runtimeAgentId}/stop`, { reason });
    return { state: res.state ?? "stopped" };
  }

  async restartAgent(runtimeAgentId: string): Promise<{ state: string }> {
    const res = await this.requestJson<{ state?: string }>("POST", `/api/v1/agents/${runtimeAgentId}/restart`);
    return { state: res.state ?? "running" };
  }

  async getAgent(runtimeAgentId: string): Promise<HermitRemoteAgent | null> {
    try {
      const res = await this.requestJson<{ id: string; state: string; health?: HermitHealth }>(
        "GET",
        `/api/v1/agents/${runtimeAgentId}`,
      );
      return {
        runtimeAgentId: res.id,
        state: res.state,
        health: res.health ?? "healthy",
      };
    } catch (err) {
      if (err instanceof HermitError && err.code === "AGENT_NOT_FOUND") return null;
      throw err;
    }
  }

  async deleteAgent(runtimeAgentId: string): Promise<void> {
    await this.requestJson<void>("DELETE", `/api/v1/agents/${runtimeAgentId}`);
  }

  async createSession(runtimeAgentId: string, input: { traceId: string }): Promise<{ runtimeSessionId: string }> {
    const res = await this.requestJson<{ session_id?: string; id?: string }>(
      "POST",
      `/api/v1/agents/${runtimeAgentId}/sessions`,
      { trace_id: input.traceId },
    );
    const runtimeSessionId = res.session_id ?? res.id;
    if (!runtimeSessionId) {
      throw new HermitError("HERMIT_BAD_RESPONSE", "createSession response missing id");
    }
    return { runtimeSessionId };
  }

  async sendMessage(runtimeSessionId: string, message: string): Promise<{ accepted: boolean }> {
    const res = await this.requestJson<{ accepted?: boolean }>(
      "POST",
      `/api/v1/sessions/${runtimeSessionId}/messages`,
      { message },
    );
    return { accepted: res.accepted !== false };
  }

  async getSession(runtimeSessionId: string): Promise<HermitRemoteSession | null> {
    try {
      const res = await this.requestJson<{ id: string; state: string }>("GET", `/api/v1/sessions/${runtimeSessionId}`);
      return { runtimeSessionId: res.id, state: res.state };
    } catch (err) {
      if (err instanceof HermitError && err.code === "AGENT_NOT_FOUND") return null;
      throw err;
    }
  }

  async checkpointSession(runtimeSessionId: string): Promise<{ checkpoint: unknown }> {
    const res = await this.requestJson<{ checkpoint: unknown }>(
      "POST",
      `/api/v1/sessions/${runtimeSessionId}/checkpoint`,
    );
    return { checkpoint: res.checkpoint ?? null };
  }

  async resumeSession(runtimeSessionId: string): Promise<{ state: string }> {
    const res = await this.requestJson<{ state?: string }>("POST", `/api/v1/sessions/${runtimeSessionId}/resume`);
    return { state: res.state ?? "active" };
  }

  async closeSession(runtimeSessionId: string): Promise<void> {
    await this.requestJson<void>("DELETE", `/api/v1/sessions/${runtimeSessionId}`);
  }

  async listEvents(input: { runtimeAgentId?: string; since?: string }): Promise<any[]> {
    const params = new URLSearchParams();
    if (input.runtimeAgentId) params.set("agent_id", input.runtimeAgentId);
    if (input.since) params.set("since", input.since);
    const q = params.toString() ? `?${params.toString()}` : "";
    const res = await this.requestJson<{ events?: any[] }>("GET", `/api/v1/events${q}`);
    return Array.isArray(res.events) ? res.events : [];
  }
}
