// Phase 20.39 — Codex cockpit adapter (spec §9). Wraps the Phase 20.21
// CodexRuntimeService — no Phase 20.21 functionality is duplicated here.
// Where the native runtime lacks a capability the adapter reports
// supportsX=false instead of simulating it.

import { CodexDetector } from "../codex-runtime/detector";
import { getCodexRuntimeService } from "../codex-runtime/service";
import type { PaoRuntimeEvent } from "../codex-runtime/types";
import { capabilitiesOf } from "./providers";
import {
  CockpitError,
  type AgentEventSink,
  type CodingProviderAdapter,
  type DiscoveredNativeSession,
  type NormalizedAgentEvent,
  type ProviderCapabilities,
  type ProviderMessageInput,
  type ProviderProbeResult,
  type ProviderSessionHandle,
  type ProviderUsageSnapshot,
  type ResumeSessionInput,
  type StartSessionInput,
  type UnsubscribeFn,
} from "./types";

export class CodexCockpitAdapter implements CodingProviderAdapter {
  readonly id = "codex";
  readonly displayName = "OpenAI Codex";

  async probe(): Promise<ProviderProbeResult> {
    const version = CodexDetector.probeCodexVersion();
    let runtimeEnabled = false;
    let detail = version ? "codex CLI detected (v" + version + ")" : "codex CLI not found on PATH";
    try {
      const service = getCodexRuntimeService();
      runtimeEnabled = service.isNativeRuntimeEnabled();
      if (version && !runtimeEnabled) detail += "; native runtime disabled via PAO_CODEX_NATIVE_RUNTIME=false";
    } catch {
      detail += "; runtime service unavailable";
    }
    return {
      providerId: this.id,
      installed: Boolean(version),
      authenticated: version ? true : null,
      version,
      supportsResume: Boolean(version),
      supportsStreaming: Boolean(version),
      supportsUsage: false,
      detail,
    };
  }

  getCapabilities(): ProviderCapabilities {
    const available = this.available();
    return capabilitiesOf({
      chat: available,
      nativeSessions: available,
      resume: available,
      streaming: available,
      tools: available,
      toolInputVisibility: available,
      toolOutputVisibility: available,
      fileRead: available,
      fileWrite: available,
      shell: available,
      git: available,
      mcp: available,
      usage: false,
      cost: false,
      artifacts: true,
      cancellation: available,
    });
  }

  private available(): boolean {
    try {
      return Boolean(CodexDetector.probeCodexVersion()) && getCodexRuntimeService().isNativeRuntimeEnabled();
    } catch {
      return false;
    }
  }

  async discoverSessions(workspaceId: string, workspaceRoot: string | null): Promise<DiscoveredNativeSession[]> {
    if (!this.available() || !workspaceRoot) return [];
    try {
      const service = getCodexRuntimeService();
      return service
        .listSessions(200)
        .filter((session) => session.workspaceRoot === workspaceRoot)
        .map((session) => ({
          providerId: this.id,
          nativeSessionId: session.id,
          title: session.title ?? "Untitled codex session",
          workspaceId,
          lastActivityAt: session.updatedAt,
          resumable: true,
          nativeMetadata: { threadId: session.threadId, runtimeMode: session.runtimeMode, status: session.status },
        }));
    } catch {
      return [];
    }
  }

  async startSession(input: StartSessionInput): Promise<ProviderSessionHandle> {
    const service = getCodexRuntimeService();
    if (!service.isNativeRuntimeEnabled()) {
      throw new CockpitError("PROVIDER_UNAVAILABLE", "codex native runtime is disabled (PAO_CODEX_NATIVE_RUNTIME=false)");
    }
    const codexSession = service.createSession({ workspaceRoot: input.workspaceRoot, title: input.title });
    return { sessionId: input.sessionId, nativeSessionId: codexSession.id, processId: null };
  }

  async resumeSession(input: ResumeSessionInput): Promise<ProviderSessionHandle> {
    const service = getCodexRuntimeService();
    if (!input.nativeSessionId) {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "codex session has no native id");
    }
    const codexSession = service.getSession(input.nativeSessionId);
    if (!codexSession) {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "native codex session not found: " + input.nativeSessionId);
    }
    if (codexSession.workspaceRoot !== input.workspaceRoot) {
      throw new CockpitError("WORKSPACE_NOT_TRUSTED", "native codex session belongs to a different workspace");
    }
    return { sessionId: input.sessionId, nativeSessionId: codexSession.id, processId: null };
  }

  async sendMessage(handle: ProviderSessionHandle, input: ProviderMessageInput): Promise<void> {
    const service = getCodexRuntimeService();
    if (!handle.nativeSessionId) {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "codex handle has no native session");
    }
    const turn = await service.executeTurn(handle.nativeSessionId, input.text);
    if (turn.error) {
      throw new CockpitError("PROCESS_FAILED", "codex turn failed: " + turn.error);
    }
  }

  async cancel(handle: ProviderSessionHandle): Promise<void> {
    if (!handle.nativeSessionId) return;
    const service = getCodexRuntimeService();
    void service.cancelTurn(handle.nativeSessionId);
  }

  /** Bridge the 20.21 event bus onto the normalized contract. */
  subscribe(handle: ProviderSessionHandle, sink: AgentEventSink): UnsubscribeFn {
    if (!handle.nativeSessionId) return () => undefined;
    try {
      const service = getCodexRuntimeService();
      const bus = (service as unknown as { events?: { subscribeSession(sessionId: string, cb: (event: PaoRuntimeEvent) => void): () => void } }).events;
      if (!bus) return () => undefined;
      const unsubscribe = bus.subscribeSession(handle.nativeSessionId, (event) => {
        for (const normalized of normalizeCodexEvent(event)) sink(normalized);
      });
      return unsubscribe;
    } catch {
      return () => undefined;
    }
  }

  async getUsage(): Promise<ProviderUsageSnapshot | null> {
    // The 20.21 runtime does not expose token usage; report null rather than
    // invent values (spec non-goal).
    return null;
  }
}

/** PaoRuntimeEvent → NormalizedAgentEvent mapping (adapter-owned parsing). */
export function normalizeCodexEvent(event: PaoRuntimeEvent): NormalizedAgentEvent[] {
  switch (event.type) {
    case "ThreadStarted":
      return [{ type: "SessionStarted", nativeSessionId: event.threadId, detail: "codex thread started" }];
    case "ThreadResumed":
      return [{ type: "SessionStarted", nativeSessionId: event.threadId, detail: "codex thread resumed" }];
    case "TurnStarted":
      return [{ type: "SessionStarted", nativeSessionId: null, detail: "turn " + event.turnId + " started" }];
    case "AgentMessageDelta":
      return [{ type: "MessageDelta", text: event.textDelta }];
    case "AgentMessageCompleted":
      return [{ type: "MessageCompleted", text: event.fullText }];
    case "ToolStarted":
      return [{ type: "ToolStarted", toolExecutionId: event.toolId, toolName: event.toolName, actionType: "PRIVILEGED", summary: "codex tool " + event.toolName }];
    case "ToolCompleted":
      return [{ type: "ToolCompleted", toolExecutionId: event.toolId, status: "COMPLETED", exitCode: 0 }];
    case "ToolFailed":
      return [{ type: "ToolCompleted", toolExecutionId: event.toolId, status: "FAILED", exitCode: 1 }];
    case "ApprovalRequested":
      return [{ type: "ApprovalRequired", approvalId: event.approvalId, actionType: "PRIVILEGED", summary: "codex approval: " + event.toolName, riskScore: 60 }];
    case "ApprovalResolved":
      return [{ type: "SessionStarted", nativeSessionId: null, detail: "approval " + event.approvalId + " " + event.decision }];
    case "SandboxViolation":
      return [{ type: "RuntimeError", errorCode: "POLICY_DENIED", message: "codex sandbox violation: " + event.violation }];
    case "RuntimeDisconnected":
      return [{ type: "RuntimeError", errorCode: "STREAM_DISCONNECTED", message: event.reason ?? "runtime disconnected" }];
    default:
      return [];
  }
}
