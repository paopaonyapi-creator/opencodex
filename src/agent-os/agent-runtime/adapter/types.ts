// Phase 20.61 — Provider-neutral worker runtime adapter contract (spec §7).
//
// amux-specific payloads stop at the AmuxAdapter implementation. Domain
// services depend only on these normalized shapes, so the runtime can be
// replaced without redesigning Pao-hubPro. Undocumented or unsupported
// upstream operations must fail closed with a typed error, never guess.

import type { AgentRuntimeErrorCode, AgentRuntimeEventType } from "../types";

export interface RuntimeHealth {
  healthy: boolean;
  provider: string;
  version: string | null;
  commit: string | null;
  /** True when the runtime matched the pinned compatibility contract. */
  compatible: boolean;
  incompatibilityReason: string | null;
  raw: Record<string, unknown>;
}

export interface WorkerRef {
  runtimeWorkerId: string;
  name: string;
  provider: string;
  status: string;
}

export interface SessionState {
  runtimeSessionId: string;
  name: string;
  status: string;
  lastOutput: string | null;
  raw: Record<string, unknown>;
}

export interface CreateSessionInput {
  name: string;
  taskTitle: string;
  initialMessage?: string;
}

export interface DispatchTaskInput {
  runtimeWorkerId: string;
  title: string;
  description: string;
  message: string;
}

export interface DispatchResult {
  runtimeTaskId: string | null;
  runtimeSessionId: string | null;
  accepted: boolean;
  detail: string;
}

export interface RuntimeTaskState {
  runtimeTaskId: string;
  title: string;
  status: string;
  raw: Record<string, unknown>;
}

export interface RuntimeEvent {
  eventType: AgentRuntimeEventType;
  runtimeTaskId: string | null;
  runtimeSessionId: string | null;
  payload: Record<string, unknown>;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export interface Unsubscribe {
  (): void;
}

export interface RuntimeAdapterErrorShape {
  code: AgentRuntimeErrorCode;
  httpStatus: number;
}

export class RuntimeAdapterError extends Error {
  readonly code: AgentRuntimeErrorCode;
  readonly httpStatus: number;

  constructor(code: AgentRuntimeErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "RuntimeAdapterError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// --- transport seam (JSON-level; see transport.ts for the fetch impl) ---

export interface RuntimeTransportRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

export interface RuntimeTransportResponse {
  status: number;
  body: unknown;
}

export interface RuntimeTransportContract {
  request(req: RuntimeTransportRequest): Promise<RuntimeTransportResponse>;
}

export interface WorkerRuntimeAdapter {
  readonly provider: string;

  health(): Promise<RuntimeHealth>;
  listWorkers(): Promise<WorkerRef[]>;
  createSession(input: CreateSessionInput): Promise<SessionRef>;
  getSession(sessionId: string): Promise<SessionState>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  stopSession(sessionId: string, reason: string): Promise<void>;
  recoverSession(sessionId: string, message: string): Promise<RecoveryResult>;
  dispatchTask(input: DispatchTaskInput): Promise<DispatchResult>;
  getTask(runtimeTaskId: string): Promise<RuntimeTaskState>;
  subscribeEvents(handler: RuntimeEventHandler): Promise<Unsubscribe>;
}

export interface SessionRef {
  runtimeSessionId: string;
  name: string;
}

export interface RecoveryResult {
  recovered: boolean;
  detail: string;
}
