// Phase 19 — ComfyUI HTTP client.
//
// Real transport against the ComfyUI REST API: /system_stats, /prompt,
// /history, /view, /interrupt, /object_info, /queue. Every call has a timeout
// and maps failures to typed errors the orchestrator can classify (retry vs
// fail-fast). No business logic here — binding application and job policy live
// in the registry/orchestrator.

export interface ComfyUiHistoryOutput {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyUiHistoryEntry {
  prompt: unknown;
  outputs: Record<string, Record<string, ComfyUiHistoryOutput[]>>;
  status: { completed: boolean; messages: unknown[] } | null;
}

export class ComfyUiRequestError extends Error {
  readonly kind: "offline" | "timeout" | "http";
  readonly status?: number;
  constructor(kind: "offline" | "timeout" | "http", message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface ComfyUiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  clientId?: string;
}

function classifyFetchError(error: unknown, timeoutMs: number): ComfyUiRequestError {
  if (error instanceof ComfyUiRequestError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ComfyUiRequestError("timeout", `ComfyUI request exceeded ${timeoutMs}ms`);
  }
  return new ComfyUiRequestError("offline", error instanceof Error ? error.message : String(error));
}

export class ComfyUiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  readonly clientId: string;

  constructor(options: ComfyUiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.clientId = options.clientId ?? `pao-hubpro_${crypto.randomUUID()}`;
  }

  private async request(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new ComfyUiRequestError("http", `ComfyUI ${init?.method ?? "GET"} ${path} failed with HTTP ${response.status}`, response.status);
      }
      return response;
    } catch (error) {
      throw classifyFetchError(error, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Health probe with a short timeout — used by health checks, never blocks startup. */
  async healthCheck(timeoutMs = 5_000): Promise<{ healthy: boolean; systemStats?: Record<string, unknown>; error?: string }> {
    try {
      const response = await this.request("/system_stats", { timeoutMs });
      return { healthy: true, systemStats: await response.json() as Record<string, unknown> };
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getSystemStats(): Promise<Record<string, unknown>> {
    return await this.request("/system_stats").then(r => r.json()) as Record<string, unknown>;
  }

  /** Queues a prompt graph. Returns the ComfyUI prompt id. */
  async queuePrompt(promptGraph: Record<string, unknown>): Promise<{ promptId: string; number: number | null }> {
    const response = await this.request("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptGraph, client_id: this.clientId }),
    });
    const body = await response.json() as { prompt_id?: string; number?: number; error?: unknown; node_errors?: unknown };
    // ComfyUI returns 400 with node_errors for validation failures.
    if (!body.prompt_id) {
      throw new ComfyUiRequestError("http", `ComfyUI rejected prompt: ${JSON.stringify(body.error ?? body.node_errors ?? body).slice(0, 400)}`);
    }
    return { promptId: body.prompt_id, number: body.number ?? null };
  }

  async getHistory(promptId: string): Promise<ComfyUiHistoryEntry | null> {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
    const body = await response.json() as Record<string, ComfyUiHistoryEntry>;
    return body[promptId] ?? null;
  }

  async getQueue(): Promise<{ running: unknown[]; pending: unknown[] }> {
    return await this.request("/queue").then(r => r.json()) as { running: unknown[]; pending: unknown[] };
  }

  async getObjectInfo(): Promise<Record<string, unknown>> {
    return await this.request("/object_info").then(r => r.json()) as Record<string, unknown>;
  }

  /** Downloads one output file. Returns the raw bytes + content type. */
  async fetchOutput(output: ComfyUiHistoryOutput): Promise<{ bytes: Uint8Array; contentType: string }> {
    const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
    const response = await this.request(`/view?${params.toString()}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  async interrupt(): Promise<void> {
    await this.request("/interrupt", { method: "POST" });
  }

  /** Uploads an input file (for image_edit / image_to_image workflows). */
  async uploadInput(filename: string, bytes: Uint8Array, mimeType: string): Promise<{ name: string; subfolder: string; type: string }> {
    const form = new FormData();
    form.append("image", new Blob([bytes as BlobPart], { type: mimeType }), filename);
    form.append("overwrite", "true");
    const response = await this.request("/upload/image", { method: "POST", body: form });
    return await response.json() as { name: string; subfolder: string; type: string };
  }
}
