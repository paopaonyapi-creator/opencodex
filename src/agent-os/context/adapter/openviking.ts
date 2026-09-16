/**
 * Pao Context Control Plane — OpenViking compatibility adapter
 * (Phase 20.53 §12-13, §68-71).
 *
 * Talks to OpenViking ONLY over its documented HTTP surface with defensive
 * normalization: endpoint paths are configurable, unknown shapes degrade to
 * explicit "unknown capability" results, and no upstream internals are
 * imported or queried. OpenViking's AGPLv3 source is not vendored anywhere.
 *
 * Error classification feeds the retry policy and circuit breaker:
 *   retryable      — timeouts, transient 5xx, network failures
 *   non-retryable  — 401/403/400/404/409, policy and ACL denials
 */

import type {
  CompatibilityProbe,
  ContextDbCapabilities,
  ContextDbHealth,
  ContextIngestHandle,
  ContextIngestResult,
  ContextSearchHit,
} from "../types";

export interface OpenVikingAdapterConfig {
  readonly baseUrl: string;
  /** Env var NAME holding the API key; resolved at call time, never logged. */
  readonly apiKeyEnv: string;
  readonly timeoutMs: number;
  readonly now?: () => Date;
}

/** Documented-surface endpoint paths, overridable when upstream changes. */
export interface OpenVikingPaths {
  readonly health: string;
  readonly version: string;
  readonly list: string;
  readonly read: string;
  readonly search: string;
  readonly find: string;
  readonly addResource: string;
  readonly addSkill: string;
  readonly task: string;
  readonly sessions: string;
  readonly sessionCommit: string;
}

export const DEFAULT_PATHS: OpenVikingPaths = {
  health: "/health",
  version: "/api/version",
  list: "/api/viking/list",
  read: "/api/viking/read",
  search: "/api/viking/search",
  find: "/api/viking/find",
  addResource: "/api/resources/add",
  addSkill: "/api/skills/add",
  task: "/api/tasks",
  sessions: "/api/sessions",
  sessionCommit: "/api/sessions/commit",
};

export type AdapterErrorClass = "retryable" | "non_retryable" | "unreachable";

export class AdapterError extends Error {
  readonly errorClass: AdapterErrorClass;
  readonly status?: number;
  constructor(message: string, errorClass: AdapterErrorClass, status?: number) {
    super(message);
    this.errorClass = errorClass;
    this.status = status;
  }
}

export function classifyHttpError(status: number): AdapterErrorClass {
  if (status === 401 || status === 403 || status === 400 || status === 404 || status === 409 || status === 422) {
    return "non_retryable";
  }
  if (status >= 500 && status < 600) return "retryable";
  return "non_retryable";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenVikingAdapter {
  readonly id = "openviking";
  private readonly config: OpenVikingAdapterConfig;
  private readonly paths: OpenVikingPaths;

  constructor(config: OpenVikingAdapterConfig, paths: Partial<OpenVikingPaths> = {}) {
    this.config = config;
    this.paths = { ...DEFAULT_PATHS, ...paths };
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env[this.config.apiKeyEnv];
    if (key && key.trim() !== "") headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  private url(path: string): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    return `${base}${path}`;
  }

  private async requestJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; payload: unknown }> {
    let resp: Response;
    try {
      resp = await fetch(this.url(path), {
        method,
        headers: this.authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      // Timeout / DNS / connection refused are unreachable, not auth errors.
      const message = err instanceof Error ? err.message : "network failure";
      throw new AdapterError(`CTX_BACKEND_UNAVAILABLE: ${message}`, "unreachable");
    }
    let payload: unknown = null;
    const text = await resp.text().catch(() => "");
    if (text !== "") {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 256) };
      }
    }
    if (!resp.ok) {
      throw new AdapterError(
        `OpenViking request failed: HTTP ${resp.status}`,
        classifyHttpError(resp.status),
        resp.status,
      );
    }
    return { status: resp.status, payload };
  }

  // -------------------------------------------------------------------------

  async health(): Promise<ContextDbHealth> {
    const started = Date.now();
    try {
      const { payload } = await this.requestJson("GET", this.paths.health);
      return {
        reachable: true,
        compatible: true,
        version: extractVersion(payload),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        reachable: false,
        compatible: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  /**
   * Capability probe. Each capability is verified only insofar as its
   * endpoint answers; unverifiable capabilities are reported as `false` with
   * an explicit warning — missing security features are never emulated
   * silently (spec §12).
   */
  async probeCapabilities(): Promise<CompatibilityProbe> {
    const warnings: string[] = [];
    const health = await this.health();
    if (!health.reachable) {
      return {
        adapter: "openviking",
        status: "unreachable",
        capabilities: deadCapabilities(["backend unreachable during probe"]),
        warnings: [health.error ?? "unreachable"],
      };
    }

    const caps: {
      resources: boolean;
      memory: boolean;
      skills: boolean;
      sessions: boolean;
      mcp: boolean;
      acl: boolean;
      backupRestore: boolean;
      agentEvolution: boolean;
    } = {
      resources: false,
      memory: false,
      skills: false,
      sessions: false,
      mcp: false,
      acl: false,
      backupRestore: false,
      agentEvolution: false,
    };

    // Resource surface: a readable list endpoint means resources exist.
    try {
      await this.requestJson("GET", `${this.paths.list}?uri=${encodeURIComponent("viking://resources/")}`);
      caps.resources = true;
    } catch (err) {
      warnings.push(`resources probe: ${describeError(err)}`);
    }

    // Sessions surface.
    try {
      await this.requestJson("GET", this.paths.sessions);
      caps.sessions = true;
      caps.memory = true; // session memory extraction rides the session surface
    } catch (err) {
      warnings.push(`sessions probe: ${describeError(err)}`);
    }

    // MCP surface (documented /mcp endpoint).
    try {
      const resp = await fetch(this.url("/mcp"), {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 5_000)),
      });
      // Any non-404 response (including 401/405) proves the endpoint exists.
      if (resp.status !== 404) caps.mcp = true;
      else warnings.push("mcp probe: endpoint not found");
    } catch (err) {
      warnings.push(`mcp probe: ${describeError(err)}`);
    }

    // Skills, ACL, backup, agent evolution cannot be verified without
    // side effects; report unknown-as-false with warnings rather than guessing.
    warnings.push("skills/acl/backup/agent-evolution capabilities not verifiable without side effects; reported as false");

    const status: CompatibilityProbe["status"] = caps.resources ? "compatible" : "degraded";
    return {
      adapter: "openviking",
      status,
      serverVersion: health.version,
      capabilities: { ...caps, warnings },
      warnings,
    };
  }

  // -------------------------------------------------------------------------

  async list(uri: string): Promise<Array<{ uri: string; kind: string }>> {
    const { payload } = await this.requestJson(
      "GET",
      `${this.paths.list}?uri=${encodeURIComponent(uri)}`,
    );
    return normalizeEntries(payload, uri);
  }

  async read(uri: string, level?: "L0" | "L1" | "L2"): Promise<{ uri: string; level?: string; content: string }> {
    const suffix = level ? `&level=${level}` : "";
    const { payload } = await this.requestJson(
      "GET",
      `${this.paths.read}?uri=${encodeURIComponent(uri)}${suffix}`,
    );
    const obj = asRecord(payload);
    const content = typeof obj?.content === "string" ? obj.content : typeof obj?.text === "string" ? obj.text : "";
    return { uri, level: typeof obj?.level === "string" ? obj.level : level, content };
  }

  async search(request: { query: string; roots?: readonly string[]; maxResults: number }): Promise<ContextSearchHit[]> {
    const { payload } = await this.requestJson("POST", this.paths.search, {
      query: request.query,
      paths: request.roots ?? ["viking://"],
      limit: request.maxResults,
    });
    return normalizeHits(payload);
  }

  async find(request: { pattern: string; roots?: readonly string[]; maxResults: number }): Promise<ContextSearchHit[]> {
    const { payload } = await this.requestJson("POST", this.paths.find, {
      pattern: request.pattern,
      paths: request.roots ?? ["viking://"],
      limit: request.maxResults,
    });
    return normalizeHits(payload);
  }

  /**
   * Submit a resource for processing. Returns the task handle; use
   * waitProcessed to poll. Idempotency is the CALLER's job (stable source
   * identity + checksum before this call).
   */
  async addResource(input: {
    path: string;
    content: string;
    targetUri: string;
    metadata?: Record<string, unknown>;
  }): Promise<ContextIngestHandle> {
    const { payload } = await this.requestJson("POST", this.paths.addResource, {
      path: input.path,
      content: input.content,
      uri: input.targetUri,
      metadata: input.metadata ?? {},
    });
    const obj = asRecord(payload);
    const taskId =
      typeof obj?.task_id === "string"
        ? obj.task_id
        : typeof obj?.taskId === "string"
          ? obj.taskId
          : `untracked-${Date.now()}`;
    return { taskId, targetUri: input.targetUri };
  }

  async addSkill(input: {
    name: string;
    description: string;
    content: string;
    targetUri: string;
  }): Promise<ContextIngestHandle> {
    const { payload } = await this.requestJson("POST", this.paths.addSkill, {
      name: input.name,
      description: input.description,
      content: input.content,
      uri: input.targetUri,
    });
    const obj = asRecord(payload);
    const taskId = typeof obj?.task_id === "string" ? obj.task_id : `untracked-${Date.now()}`;
    return { taskId, targetUri: input.targetUri };
  }

  /** Poll a processing task until ready/failed or the deadline passes. */
  async waitProcessed(handle: ContextIngestHandle, deadlineMs = 30_000): Promise<ContextIngestResult> {
    const deadline = Date.now() + deadlineMs;
    let delayMs = 250;
    for (;;) {
      try {
        const { payload } = await this.requestJson("GET", `${this.paths.task}?id=${encodeURIComponent(handle.taskId)}`);
        const obj = asRecord(payload);
        const status = typeof obj?.status === "string" ? obj.status.toLowerCase() : "processing";
        if (status === "ready" || status === "done" || status === "completed") {
          return { status: "ready", targetUri: handle.targetUri };
        }
        if (status === "failed" || status === "error") {
          return { status: "failed", targetUri: handle.targetUri, error: typeof obj?.error === "string" ? obj.error : "task failed" };
        }
      } catch (err) {
        const classification = err instanceof AdapterError ? err.errorClass : "retryable";
        if (classification === "non_retryable") {
          return { status: "failed", targetUri: handle.targetUri, error: describeError(err) };
        }
        // Unreachable/retryable: keep polling until the deadline.
      }
      if (Date.now() + delayMs > deadline) {
        return { status: "processing", targetUri: handle.targetUri };
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 2_000);
    }
  }

  // -------------------------------------------------------------------------

  async createSession(input: {
    userId: string;
    peerId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ sessionId: string }> {
    const { payload } = await this.requestJson("POST", this.paths.sessions, {
      user: input.userId,
      peer: input.peerId,
      metadata: input.metadata ?? {},
    });
    const obj = asRecord(payload);
    const sessionId =
      typeof obj?.session_id === "string"
        ? obj.session_id
        : typeof obj?.id === "string"
          ? obj.id
          : "";
    if (sessionId === "") throw new AdapterError("OpenViking session create returned no session id", "non_retryable");
    return { sessionId };
  }

  async appendSessionMessage(sessionId: string, message: { role: "user" | "assistant" | "tool"; content: string }): Promise<void> {
    await this.requestJson("POST", `${this.paths.sessions}/messages`, {
      session_id: sessionId,
      role: message.role,
      content: message.content,
    });
  }

  async commitSession(sessionId: string): Promise<{ taskId?: string }> {
    const { payload } = await this.requestJson("POST", this.paths.sessionCommit, { session_id: sessionId });
    const obj = asRecord(payload);
    const taskId = typeof obj?.task_id === "string" ? obj.task_id : undefined;
    return { taskId };
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function extractVersion(payload: unknown): string | undefined {
  const obj = asRecord(payload);
  if (!obj) return typeof payload === "string" ? payload : undefined;
  for (const key of ["version", "Version", "server_version", "app_version"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function deadCapabilities(warnings: string[]): ContextDbCapabilities {
  return {
    resources: false,
    memory: false,
    skills: false,
    sessions: false,
    mcp: false,
    acl: false,
    backupRestore: false,
    agentEvolution: false,
    warnings,
  };
}

function describeError(err: unknown): string {
  if (err instanceof AdapterError) return `${err.errorClass}${err.status ? `/${err.status}` : ""}`;
  return err instanceof Error ? err.message.slice(0, 120) : "unknown";
}

function normalizeEntries(payload: unknown, parentUri: string): Array<{ uri: string; kind: string }> {
  const obj = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(obj?.entries)
      ? obj.entries
      : Array.isArray(obj?.items)
        ? obj.items
        : Array.isArray(obj?.data)
          ? obj.data
          : [];
  return rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map(r => {
      const name = typeof r.name === "string" ? r.name : typeof r.uri === "string" ? r.uri : "";
      const kind = typeof r.kind === "string" ? r.kind : typeof r.type === "string" ? r.type : "entry";
      const uri = typeof r.uri === "string" ? r.uri : `${parentUri.replace(/\/$/, "")}/${name}`;
      return { uri, kind };
    })
    .filter(e => e.uri !== "");
}

function normalizeHits(payload: unknown): ContextSearchHit[] {
  const obj = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(obj?.results)
      ? obj.results
      : Array.isArray(obj?.hits)
        ? obj.hits
        : Array.isArray(obj?.data)
          ? obj.data
          : [];
  return rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map(r => ({
      uri: typeof r.uri === "string" ? r.uri : typeof r.path === "string" ? r.path : "",
      score: typeof r.score === "number" ? r.score : typeof r.relevance === "number" ? r.relevance : 0,
      snippet: typeof r.snippet === "string" ? r.snippet : undefined,
    }))
    .filter(h => h.uri !== "");
}
