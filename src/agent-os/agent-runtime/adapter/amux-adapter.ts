// Phase 20.61 — amux adapter.
//
// Speaks the verified upstream REST surface (amux.io REST API reference,
// pinned commit recorded in docs/integrations/amux-compatibility.md):
//
//   GET    /health                       server health
//   GET    /api/board                    list board items (tasks)
//   POST   /api/board                    create board item
//   POST   /api/board/:id/claim          atomic claim (upstream CAS)
//   GET    /api/sessions                 list workers ("worker = session")
//   GET    /api/sessions/:name/meta      session metadata
//   GET    /api/sessions/:name/peek      read terminal output
//   POST   /api/sessions/:name/send      send text to a session
//   GET    /api/sync?since=<unix>        delta sync (poll-based events)
//
// Auth: bearer token sent as `Authorization: Bearer`. Operations the upstream
// reference does not document (session create/stop, admin APIs) fail closed
// with RUNTIME_UNSUPPORTED instead of guessing (spec §25). A health-time
// commit gate fails closed on drift (RUNTIME_VERSION_MISMATCH).

import { redactSecrets } from "../secrets";
import type { AgentRuntimeEventType } from "../types";
import {
  RuntimeAdapterError,
  type DispatchResult,
  type DispatchTaskInput,
  type RecoveryResult,
  type RuntimeHealth,
  type RuntimeTaskState,
  type RuntimeTransportContract,
  type SessionRef,
  type SessionState,
  type WorkerRef,
  type WorkerRuntimeAdapter,
} from "./types";
import { mapTransportStatus } from "./transport";

interface AmuxBoardItem {
  id?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

interface AmuxSession {
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AmuxAdapterOptions {
  transport: RuntimeTransportContract;
  pinnedCommit: string;
}

export class AmuxAdapter implements WorkerRuntimeAdapter {
  readonly provider = "amux";
  private readonly transport: RuntimeTransportContract;
  private readonly pinnedCommit: string;
  private lastHealth: RuntimeHealth | null = null;

  constructor(options: AmuxAdapterOptions) {
    this.transport = options.transport;
    this.pinnedCommit = options.pinnedCommit;
  }

  private async call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const response = await this.transport.request({ method, path, body, query });
    if (response.status >= 400) {
      throw mapTransportStatus(response.status, path);
    }
    return response.body as T;
  }

  async health(): Promise<RuntimeHealth> {
    let body: Record<string, unknown>;
    try {
      body = await this.call<Record<string, unknown>>("GET", "/health");
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", 502, "amux runtime unreachable: " + redactSecrets(error instanceof Error ? error.message : String(error)));
    }
    const commit = body["commit"] ? String(body["commit"]) : body["version"] ? String(body["version"]) : null;
    const compatible = Boolean(commit) && commit!.startsWith(this.pinnedCommit.slice(0, 7));
    const health: RuntimeHealth = {
      healthy: Boolean(body["status"] ?? true),
      provider: this.provider,
      version: body["version"] ? String(body["version"]) : null,
      commit,
      compatible,
      incompatibilityReason: compatible ? null : "runtime commit " + String(commit) + " does not match the pinned " + this.pinnedCommit,
      raw: body,
    };
    this.lastHealth = health;
    return health;
  }

  /** Guard used by every operation: fail closed on drift or unhealthiness. */
  private async ensureCompatible(): Promise<RuntimeHealth> {
    const health = this.lastHealth ?? (await this.health());
    if (!health.healthy) throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", 502, "amux runtime reports unhealthy");
    if (!health.compatible) throw new RuntimeAdapterError("RUNTIME_VERSION_MISMATCH", 409, health.incompatibilityReason ?? "runtime version drift");
    return health;
  }

  async listWorkers(): Promise<WorkerRef[]> {
    await this.ensureCompatible();
    const body = await this.call<{ items?: AmuxSession[] } | AmuxSession[]>("GET", "/api/sessions");
    const items = Array.isArray(body) ? body : body.items ?? [];
    return items
      .map((s) => ({
        runtimeWorkerId: String(s["name"] ?? ""),
        name: String(s["name"] ?? ""),
        provider: "amux",
        status: String(s["status"] ?? "unknown"),
      }))
      .filter((w) => w.name);
  }

  async createSession(_input: { name: string; taskTitle: string; initialMessage?: string }): Promise<SessionRef> {
    // amux owns worker/session creation (tmux lanes it supervises); the pinned
    // upstream reference documents no create endpoint, so Pao attaches to
    // existing lanes by name instead of guessing one into existence.
    throw new RuntimeAdapterError("RUNTIME_UNSUPPORTED", 501, "session creation is an amux-native operation; register the worker by lane name");
  }

  async getSession(sessionId: string): Promise<SessionState> {
    await this.ensureCompatible();
    const meta = await this.call<AmuxSession>("GET", "/api/sessions/" + encodeURIComponent(sessionId) + "/meta");
    let lastOutput: string | null = null;
    try {
      const peek = await this.call<{ lines?: string[] } | string>("GET", "/api/sessions/" + encodeURIComponent(sessionId) + "/peek", undefined, { lines: "20" });
      lastOutput = typeof peek === "string" ? peek : Array.isArray(peek.lines) ? peek.lines.join("\n") : null;
    } catch {
      // Peek is advisory; session state still resolves from meta.
    }
    return {
      runtimeSessionId: sessionId,
      name: String(meta["name"] ?? sessionId),
      status: String(meta["status"] ?? "unknown"),
      lastOutput: lastOutput ? redactSecrets(lastOutput.slice(-4000)) : null,
      raw: meta,
    };
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await this.ensureCompatible();
    await this.call("POST", "/api/sessions/" + encodeURIComponent(sessionId) + "/send", { text: redactSecrets(message) });
  }

  async stopSession(_sessionId: string, _reason: string): Promise<void> {
    throw new RuntimeAdapterError("RUNTIME_UNSUPPORTED", 501, "session stop is an amux-native operation in the pinned version");
  }

  async recoverSession(sessionId: string, message: string): Promise<RecoveryResult> {
    // Recovery re-attaches to the existing lane and re-sends the structured
    // checkpoint instruction (spec §13) — never a session recreation.
    const state = await this.getSession(sessionId);
    if (state.status === "exited" || state.status === "dead") {
      return { recovered: false, detail: "session lane is gone; a new dispatch is required" };
    }
    await this.sendMessage(sessionId, message);
    return { recovered: true, detail: "checkpoint instruction re-sent to lane " + sessionId };
  }

  async dispatchTask(input: DispatchTaskInput): Promise<DispatchResult> {
    await this.ensureCompatible();
    const created = await this.call<AmuxBoardItem>("POST", "/api/board", {
      title: input.title,
      description: input.description,
    });
    const runtimeTaskId = String(created["id"] ?? "");
    if (!runtimeTaskId) {
      return { runtimeTaskId: null, runtimeSessionId: null, accepted: false, detail: "board create returned no id" };
    }
    const claim = await this.call<AmuxBoardItem>("POST", "/api/board/" + encodeURIComponent(runtimeTaskId) + "/claim", {
      worker: input.runtimeWorkerId,
    });
    const sessionName = String(claim["worker"] ?? input.runtimeWorkerId);
    await this.call("POST", "/api/sessions/" + encodeURIComponent(sessionName) + "/send", { text: input.message });
    return { runtimeTaskId, runtimeSessionId: sessionName, accepted: true, detail: "board item created, claimed, and dispatched" };
  }

  async getTask(runtimeTaskId: string): Promise<RuntimeTaskState> {
    await this.ensureCompatible();
    const body = await this.call<{ items?: AmuxBoardItem[] } | AmuxBoardItem[]>("GET", "/api/board");
    const items = Array.isArray(body) ? body : body.items ?? [];
    const found = items.find((item) => String(item["id"] ?? "") === runtimeTaskId);
    if (!found) {
      throw new RuntimeAdapterError("RUNTIME_TASK_NOT_FOUND", 404, "board item not found: " + runtimeTaskId);
    }
    return {
      runtimeTaskId,
      title: String(found["title"] ?? ""),
      status: String(found["status"] ?? "unknown"),
      raw: found,
    };
  }

  async subscribeEvents(handler: (event: { eventType: AgentRuntimeEventType; runtimeTaskId: string | null; runtimeSessionId: string | null; payload: Record<string, unknown> }) => void): Promise<() => void> {
    await this.ensureCompatible();
    let since = Math.floor(Date.now() / 1000) - 60;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const delta = await this.call<{ items?: Array<Record<string, unknown>> }>("GET", "/api/sync", undefined, { since: String(since) });
          since = Math.floor(Date.now() / 1000);
          for (const item of delta.items ?? []) {
            handler({
              eventType: normalizeAmuxEvent(item),
              runtimeTaskId: item["board_id"] ? String(item["board_id"]) : null,
              runtimeSessionId: item["session"] ? String(item["session"]) : null,
              payload: item,
            });
          }
        } catch {
          // Poll failure: the next tick retries; local state stays canonical.
        }
      })();
    }, 5_000);
    return () => clearInterval(timer);
  }
}

function normalizeAmuxEvent(item: Record<string, unknown>): AgentRuntimeEventType {
  const kind = String(item["kind"] ?? item["type"] ?? "").toLowerCase();
  if (kind.includes("done")) return "task.done";
  if (kind.includes("fail")) return "task.failed";
  if (kind.includes("claim")) return "task.claimed";
  if (kind.includes("start") || kind.includes("run")) return "task.started";
  if (kind.includes("session")) return "session.started";
  return "task.heartbeat";
}
