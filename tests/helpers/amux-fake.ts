// Phase 20.61 test helper — deterministic in-memory amux.
//
// Two layers:
// - FakeAmuxTransport: JSON-level RuntimeTransportContract with a stateful
//   board/sessions model and fault injection (adapter tests).
// - FakeAmuxAdapter: WorkerRuntimeAdapter for service tests without sockets.

import type {
  DispatchResult,
  DispatchTaskInput,
  RecoveryResult,
  RuntimeHealth,
  RuntimeTaskState,
  RuntimeTransportContract,
  RuntimeTransportRequest,
  RuntimeTransportResponse,
  SessionRef,
  SessionState,
  WorkerRef,
  WorkerRuntimeAdapter,
} from "../../src/agent-os/agent-runtime/adapter/types";

export const PINNED_COMMIT = "3a205a41a60ea790dfae48a5056ef70d6f9361e9";

interface FakeFault {
  pathMatch: string;
  status?: number;
  times: number;
}

export class FakeAmuxTransport implements RuntimeTransportContract {
  readonly calls: string[] = [];
  readonly board: Array<Record<string, unknown>> = [];
  readonly sessions: Array<Record<string, unknown>> = [];
  readonly sentMessages: Array<{ session: string; text: string }> = [];
  faults: FakeFault[] = [];
  commit = PINNED_COMMIT;

  private nextId = 10;

  async request(req: RuntimeTransportRequest): Promise<RuntimeTransportResponse> {
    const fault = this.faults.find((f) => f.times > 0 && req.path.includes(f.pathMatch));
    if (fault) {
      fault.times -= 1;
      return { status: fault.status ?? 500, body: { error: "injected" } };
    }
    this.calls.push(req.method + " " + req.path);

    if (req.method === "GET" && req.path === "/health") {
      return { status: 200, body: { status: "ok", commit: this.commit, version: "1.0.0-test" } };
    }
    if (req.method === "GET" && req.path === "/api/board") {
      return { status: 200, body: { items: this.board } };
    }
    if (req.method === "POST" && req.path === "/api/board") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      this.nextId += 1;
      const item = { id: "AMUX-" + String(this.nextId), title: body["title"] ?? "", status: "open" };
      this.board.push(item);
      return { status: 201, body: item };
    }
    if (req.method === "POST" && req.path.startsWith("/api/board/") && req.path.endsWith("/claim")) {
      const id = req.path.slice("/api/board/".length, -"/claim".length);
      const item = this.board.find((b) => b["id"] === id);
      if (!item) return { status: 404, body: { error: "not found" } };
      const body = (req.body ?? {}) as Record<string, unknown>;
      item["status"] = "claimed";
      return { status: 200, body: { ...item, worker: body["worker"] ?? "worker-1" } };
    }
    if (req.method === "GET" && req.path === "/api/sessions") {
      return { status: 200, body: { items: this.sessions } };
    }
    if (req.method === "GET" && req.path.startsWith("/api/sessions/") && req.path.endsWith("/meta")) {
      const name = req.path.slice("/api/sessions/".length, -"/meta".length);
      const session = this.sessions.find((s) => s["name"] === name);
      if (!session) return { status: 404, body: { error: "not found" } };
      return { status: 200, body: session };
    }
    if (req.method === "GET" && req.path.startsWith("/api/sessions/") && req.path.includes("/peek")) {
      const name = req.path.slice("/api/sessions/".length, req.path.indexOf("/peek"));
      return { status: 200, body: { lines: ["output of " + name] } };
    }
    if (req.method === "POST" && req.path.startsWith("/api/sessions/") && req.path.endsWith("/send")) {
      const session = req.path.slice("/api/sessions/".length, -"/send".length);
      const body = (req.body ?? {}) as Record<string, unknown>;
      this.sentMessages.push({ session, text: String(body["text"] ?? "") });
      return { status: 200, body: { ok: true } };
    }
    if (req.method === "GET" && req.path.startsWith("/api/sync")) {
      return { status: 200, body: { items: [] } };
    }
    return { status: 404, body: { error: "no route: " + req.method + " " + req.path } };
  }

  addSession(name: string, status = "running"): void {
    this.sessions.push({ name, status });
  }
}

export class FakeAmuxAdapter implements WorkerRuntimeAdapter {
  readonly provider = "amux";
  readonly dispatchedTasks: DispatchTaskInput[] = [];
  readonly sentMessages: Array<{ sessionId: string; message: string }> = [];
  health_: RuntimeHealth;
  dispatchFault: Error | null = null;
  laneStatus = "running";
  recoverOutcome: RecoveryResult = { recovered: true, detail: "checkpoint re-sent (fake)" };

  constructor(pinnedCommit = PINNED_COMMIT) {
    this.health_ = { healthy: true, provider: "amux", version: "1.0.0-test", commit: pinnedCommit, compatible: true, incompatibilityReason: null, raw: {} };
  }

  breakCompatibility(commit: string | null): void {
    this.health_ = { healthy: true, provider: "amux", version: "9.9.9", commit, compatible: false, incompatibilityReason: "runtime commit drift", raw: {} };
  }

  async health(): Promise<RuntimeHealth> {
    return this.health_;
  }

  async listWorkers(): Promise<WorkerRef[]> {
    return [{ runtimeWorkerId: "impl-1", name: "impl-1", provider: "amux", status: this.laneStatus }];
  }

  async createSession(): Promise<SessionRef> {
    throw new Error("RUNTIME_UNSUPPORTED: session creation is amux-native");
  }

  async getSession(sessionId: string): Promise<SessionState> {
    return { runtimeSessionId: sessionId, name: sessionId, status: this.laneStatus, lastOutput: null, raw: {} };
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    this.sentMessages.push({ sessionId, message });
  }

  async stopSession(): Promise<void> {
    throw new Error("RUNTIME_UNSUPPORTED: session stop is amux-native");
  }

  async recoverSession(sessionId: string, message: string): Promise<RecoveryResult> {
    if (!this.recoverOutcome.recovered) return this.recoverOutcome;
    this.sentMessages.push({ sessionId, message });
    return this.recoverOutcome;
  }

  async dispatchTask(input: DispatchTaskInput): Promise<DispatchResult> {
    if (this.dispatchFault) throw this.dispatchFault;
    if (!this.health_.healthy || !this.health_.compatible) {
      throw new Error("RUNTIME_VERSION_MISMATCH: " + (this.health_.incompatibilityReason ?? "unhealthy runtime"));
    }
    this.dispatchedTasks.push(input);
    return { runtimeTaskId: "AMUX-" + String(this.dispatchedTasks.length), runtimeSessionId: input.runtimeWorkerId, accepted: true, detail: "dispatched (fake)" };
  }

  async getTask(runtimeTaskId: string): Promise<RuntimeTaskState> {
    return { runtimeTaskId, title: "fake", status: "open", raw: {} };
  }

  async subscribeEvents(): Promise<() => void> {
    return () => undefined;
  }
}
