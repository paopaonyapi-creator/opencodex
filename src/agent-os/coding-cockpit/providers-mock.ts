// Phase 20.39 — Deterministic mock provider (spec §49). Fully offline:
// scripted normalized events, a simulated approval flow when the prompt
// mentions "shell", simulated provider-reported usage, streaming deltas,
// resumable native ids, and cancellation. Ships for tests/development only —
// never the default production provider.

import {
  capabilitiesOf,
} from "./providers";
import type {
  AgentEventSink,
  CodingProviderAdapter,
  DiscoveredNativeSession,
  ProviderMessageInput,
  ProviderProbeResult,
  ProviderSessionHandle,
  ProviderUsageSnapshot,
  ResumeSessionInput,
  StartSessionInput,
  UnsubscribeFn,
} from "./types";
import { CockpitError } from "./types";

interface MockSession {
  nativeSessionId: string;
  turns: number;
  sink: AgentEventSink | null;
  cancelled: boolean;
}

export class MockProvider implements CodingProviderAdapter {
  readonly id = "mock";
  readonly displayName = "Mock Provider";

  private sessions = new Map<string, MockSession>();
  private nativeCounter = 0;

  async probe(): Promise<ProviderProbeResult> {
    return {
      providerId: this.id,
      installed: true,
      authenticated: true,
      version: "mock-1.0.0",
      supportsResume: true,
      supportsStreaming: true,
      supportsUsage: true,
      detail: "deterministic in-process mock (tests/development only)",
    };
  }

  getCapabilities() {
    return capabilitiesOf({
      chat: true,
      nativeSessions: true,
      resume: true,
      streaming: true,
      tools: true,
      toolInputVisibility: true,
      toolOutputVisibility: true,
      fileRead: true,
      fileWrite: true,
      shell: true,
      git: true,
      mcp: false,
      usage: true,
      cost: true,
      artifacts: true,
      cancellation: true,
    });
  }

  async discoverSessions(workspaceId: string): Promise<DiscoveredNativeSession[]> {
    // Deterministic inventory: one resumable discovered session per workspace.
    return [
      {
        providerId: this.id,
        nativeSessionId: "mock_native_discovered_" + workspaceId.slice(-8),
        title: "Discovered mock session",
        workspaceId,
        lastActivityAt: new Date().toISOString(),
        resumable: true,
        nativeMetadata: { source: "mock", deterministic: true },
      },
    ];
  }

  async startSession(input: StartSessionInput): Promise<ProviderSessionHandle> {
    this.nativeCounter += 1;
    const nativeSessionId = "mock_native_" + input.sessionId.slice(-8) + "_" + this.nativeCounter;
    this.sessions.set(input.sessionId, { nativeSessionId, turns: 0, sink: null, cancelled: false });
    return { sessionId: input.sessionId, nativeSessionId, processId: null };
  }

  async resumeSession(input: ResumeSessionInput): Promise<ProviderSessionHandle> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      return { sessionId: input.sessionId, nativeSessionId: existing.nativeSessionId, processId: null };
    }
    // Resuming a discovered native session imports its identity verbatim.
    if (!input.nativeSessionId) {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "mock session has no native id to resume");
    }
    this.sessions.set(input.sessionId, { nativeSessionId: input.nativeSessionId, turns: 0, sink: null, cancelled: false });
    return { sessionId: input.sessionId, nativeSessionId: input.nativeSessionId, processId: null };
  }

  async sendMessage(handle: ProviderSessionHandle, input: ProviderMessageInput): Promise<void> {
    const session = this.sessions.get(handle.sessionId);
    if (!session) throw new CockpitError("SESSION_NOT_FOUND", "mock session not found: " + handle.sessionId);
    if (session.cancelled) throw new CockpitError("POLICY_DENIED", "mock session was cancelled");
    session.turns += 1;
    const sink = session.sink;
    if (!sink) return;

    // Simulated approval flow: prompts mentioning "shell" require approval
    // before the mock tool "runs" (tests the approval card end-to-end).
    if (input.text.toLowerCase().includes("shell")) {
      sink({
        type: "ApprovalRequired",
        approvalId: "mock_apr_" + session.turns,
        actionType: "SHELL",
        summary: "mock shell: echo ready",
        riskScore: 35,
      });
    }

    const reply = "Mock reply " + session.turns + ": received " + input.text.length + " chars with " + input.contextRefs.length + " context ref(s).";
    const chunkSize = 12;
    for (let offset = 0; offset < reply.length; offset += chunkSize) {
      if (session.cancelled) return;
      sink({ type: "MessageDelta", text: reply.slice(offset, offset + chunkSize) });
    }
    sink({ type: "MessageCompleted", text: reply });

    // One scripted tool round-trip per turn (collapsed card in the UI).
    const toolExecutionId = "mock_tool_" + session.turns;
    sink({ type: "ToolStarted", toolExecutionId, toolName: "file.read", actionType: "READ", summary: "Read file README.md" });
    sink({ type: "ToolOutput", toolExecutionId, output: "# Mock workspace file (deterministic fixture)" });
    sink({ type: "ToolCompleted", toolExecutionId, status: "COMPLETED", exitCode: 0 });

    sink({
      type: "UsageUpdated",
      usage: this.usageSnapshot(session.turns),
    });
    sink({ type: "SessionCompleted", status: "COMPLETED", detail: "mock turn " + session.turns + " finished" });
  }

  async cancel(handle: ProviderSessionHandle): Promise<void> {
    const session = this.sessions.get(handle.sessionId);
    if (!session) return;
    session.cancelled = true;
    session.sink?.({ type: "SessionCompleted", status: "FAILED", detail: "cancelled by user" });
  }

  subscribe(handle: ProviderSessionHandle, sink: AgentEventSink): UnsubscribeFn {
    const session = this.sessions.get(handle.sessionId);
    if (!session) {
      sessionNotFoundError(handle.sessionId);
      return () => undefined;
    }
    session.sink = sink;
    sink({ type: "SessionStarted", nativeSessionId: session.nativeSessionId, detail: "mock stream attached" });
    return () => {
      if (this.sessions.get(handle.sessionId)?.sink === sink) session.sink = null;
    };
  }

  async getUsage(handle: ProviderSessionHandle): Promise<ProviderUsageSnapshot | null> {
    const session = this.sessions.get(handle.sessionId);
    if (!session) return null;
    return this.usageSnapshot(session.turns);
  }

  private usageSnapshot(turns: number): ProviderUsageSnapshot {
    return {
      model: "mock-model",
      inputTokens: 100 * turns,
      outputTokens: 40 * turns,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      reportedCostUsd: 0,
      source: "PROVIDER_REPORTED",
    };
  }
}

function sessionNotFoundError(sessionId: string): void {
  throw new CockpitError("SESSION_NOT_FOUND", "mock session not found: " + sessionId);
}
