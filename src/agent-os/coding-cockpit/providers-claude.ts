// Phase 20.39 — Claude Code cockpit adapter (spec §8). Structured CLI
// subprocess integration (fallback tier of the spec's preference order: no
// official SDK is vendored here). Each turn is a ONE-SHOT headless
// invocation (`claude -p ... --output-format stream-json`) executed through
// the 20.24 safe runner — argv-only, no shell, captured stdout/stderr.
// Native session ids from stream-json init lines are preserved and resumed
// with `--resume`. `--dangerously-skip-permissions` is NEVER added unless
// the environment gate is set AND the caller (service, which enforces
// PRIVILEGED trust) passes the explicit per-session flag.

import { ProcessSupervisor } from "./supervisor";
import { capabilitiesOf } from "./providers";
import { redactText } from "./redaction";
import {
  CockpitError,
  type AgentEventSink,
  type CodingProviderAdapter,
  type DiscoveredNativeSession,
  type ProviderMessageInput,
  type ProviderProbeResult,
  type ProviderSessionHandle,
  type ProviderUsageSnapshot,
  type ResumeSessionInput,
  type StartSessionInput,
  type UnsubscribeFn,
} from "./types";

const DANGEROUS_FLAG_ENV = "PAO_CLAUDE_ALLOW_DANGEROUS_SKIP_PERMISSIONS";

interface ClaudeStreamInit {
  type: "system";
  subtype: "init";
  session_id?: string;
  model?: string;
}

interface ClaudeStreamAssistant {
  type: "assistant";
  message?: { content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> };
}

interface ClaudeStreamResult {
  type: "result";
  subtype?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  total_cost_usd?: number;
  is_error?: boolean;
  result?: string;
}

export class ClaudeCodeAdapter implements CodingProviderAdapter {
  readonly id = "claude_code";
  readonly displayName = "Claude Code";

  private supervisor: ProcessSupervisor;
  private nativeIds = new Map<string, string>();

  constructor(supervisor?: ProcessSupervisor) {
    this.supervisor = supervisor ?? new ProcessSupervisor();
  }

  private binaryName(): string {
    return process.platform === "win32" ? "claude.exe" : "claude";
  }

  async probe(): Promise<ProviderProbeResult> {
    try {
      const run = await this.supervisor.runManaged({
        workspaceId: "",
        sessionId: null,
        providerId: this.id,
        executable: this.binaryName(),
        args: ["--version"],
        cwd: process.cwd(),
        timeoutMs: 15_000,
      });
      const version = run.stdout.trim().split("\n")[0] ?? null;
      return {
        providerId: this.id,
        installed: true,
        authenticated: null,
        version,
        supportsResume: true,
        supportsStreaming: true,
        supportsUsage: true,
        detail: "claude CLI detected; authentication is verified on first turn",
      };
    } catch {
      return {
        providerId: this.id,
        installed: false,
        authenticated: null,
        version: null,
        supportsResume: false,
        supportsStreaming: false,
        supportsUsage: false,
        detail: "claude CLI not found on PATH (install Claude Code, then `claude login`)",
      };
    }
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
      mcp: true,
      usage: true,
      cost: true,
      artifacts: true,
      cancellation: false,
    });
  }

  async discoverSessions(): Promise<DiscoveredNativeSession[]> {
    // The Claude CLI has no stable session inventory command across versions;
    // report an empty inventory rather than guessing (spec: never fake).
    return [];
  }

  async startSession(input: StartSessionInput): Promise<ProviderSessionHandle> {
    return { sessionId: input.sessionId, nativeSessionId: null, processId: null };
  }

  async resumeSession(input: ResumeSessionInput): Promise<ProviderSessionHandle> {
    if (!input.nativeSessionId) {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "claude session has no native id to resume");
    }
    this.nativeIds.set(input.sessionId, input.nativeSessionId);
    return { sessionId: input.sessionId, nativeSessionId: input.nativeSessionId, processId: null };
  }

  async sendMessage(handle: ProviderSessionHandle, input: ProviderMessageInput): Promise<void> {
    const args: string[] = ["-p", buildPrompt(input.text, input.contextRefs), "--output-format", "stream-json", "--verbose"];
    const nativeId = handle.nativeSessionId ?? this.nativeIds.get(handle.sessionId) ?? null;
    if (nativeId) args.push("--resume", nativeId);
    if (input.allowDangerousSkipPermissions === true && process.env[DANGEROUS_FLAG_ENV] === "true") {
      args.push("--dangerously-skip-permissions");
    }

    const streamContext: { nativeSessionId: string | null; sink: AgentEventSink | null; toolCounter: number; textParts: string[] } = {
      nativeSessionId: nativeId,
      sink: null,
      toolCounter: 0,
      textParts: [],
    };
    // The sink is delivered by the service right after subscribe(); stash it.
    streamContext.sink = this.pendingSinks.get(handle.sessionId) ?? null;

    let run;
    try {
      run = await this.supervisor.runManaged({
        workspaceId: "",
        sessionId: handle.sessionId,
        providerId: this.id,
        executable: this.binaryName(),
        args,
        cwd: this.cwdFor(handle),
        timeoutMs: Number(process.env.PAO_CLAUDE_TURN_TIMEOUT_MS ?? 300_000),
        onStdoutLine: (line) => handleStreamLine(line, streamContext),
        onStderrLine: (line) => {
          streamContext.sink?.({ type: "ToolOutput", toolExecutionId: "stderr", output: redactText(line) });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PROCESS_NOT_INSTALLED") || message.includes("not found")) {
        throw new CockpitError("PROVIDER_NOT_INSTALLED", "claude CLI failed to launch: " + message);
      }
      throw error;
    }

    if (run.process.exitCode !== 0) {
      const detail = redactText(run.stderr.slice(-500) || "claude exited non-zero");
      if (detail.includes("not logged in") || detail.includes("Invalid API key")) {
        throw new CockpitError("PROVIDER_NOT_AUTHENTICATED", "claude CLI is not authenticated; run `claude login`");
      }
      throw new CockpitError("PROCESS_FAILED", "claude turn failed: " + detail);
    }
    if (streamContext.nativeSessionId && streamContext.nativeSessionId !== nativeId) {
      this.nativeIds.set(handle.sessionId, streamContext.nativeSessionId);
    }
    streamContext.sink?.({ type: "SessionCompleted", status: "COMPLETED", detail: "claude turn finished" });
  }

  /** Service-owned sink handoff (subscribe before sendMessage). */
  private pendingSinks = new Map<string, AgentEventSink>();

  async cancel(): Promise<void> {
    // One-shot cooperative semantics; nothing long-lived to signal.
  }

  subscribe(handle: ProviderSessionHandle, sink: AgentEventSink): UnsubscribeFn {
    this.pendingSinks.set(handle.sessionId, sink);
    return () => {
      this.pendingSinks.delete(handle.sessionId);
    };
  }

  async getUsage(): Promise<ProviderUsageSnapshot | null> {
    // Usage arrives per turn inside the result line, not via an inventory API.
    return null;
  }

  private cwdFor(handle: ProviderSessionHandle): string {
    const cwd = this.cwdOverrides.get(handle.sessionId);
    if (!cwd) throw new CockpitError("WORKSPACE_NOT_FOUND", "no workspace cwd bound for session " + handle.sessionId);
    return cwd;
  }

  private cwdOverrides = new Map<string, string>();

  bindWorkspaceCwd(sessionId: string, workspaceRoot: string): void {
    this.cwdOverrides.set(sessionId, workspaceRoot);
  }
}

function buildPrompt(text: string, contextRefs: ProviderMessageInput["contextRefs"]): string {
  if (contextRefs.length === 0) return text;
  const refLines = contextRefs.map((ref) => {
    if (ref.path) return "@file " + ref.path;
    if (ref.targetId) return "@" + ref.type + ":" + ref.targetId;
    return "@" + ref.type + " " + ref.label;
  });
  return text + "\n\n[context refs]\n" + refLines.join("\n");
}

function handleStreamLine(line: string, context: { nativeSessionId: string | null; sink: AgentEventSink | null; toolCounter: number; textParts: string[] }): void {
  let parsed: ClaudeStreamInit | ClaudeStreamAssistant | ClaudeStreamResult | { type: string } | null = null;
  try {
    parsed = JSON.parse(line) as ClaudeStreamInit | ClaudeStreamAssistant | ClaudeStreamResult;
  } catch {
    return; // non-JSON chatter on stdout is ignored, never parsed as commands
  }
  if (!parsed || typeof parsed !== "object") return;
  const sink = context.sink;
  if (!sink) return;

  if ((parsed as ClaudeStreamInit).type === "system" && (parsed as ClaudeStreamInit).subtype === "init") {
    const nativeId = (parsed as ClaudeStreamInit).session_id;
    if (nativeId) {
      context.nativeSessionId = nativeId;
      sink({ type: "SessionStarted", nativeSessionId: nativeId, detail: "claude native session initialized" });
    }
    return;
  }
  if ((parsed as ClaudeStreamAssistant).type === "assistant") {
    const content = (parsed as ClaudeStreamAssistant).message?.content ?? [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        context.textParts.push(block.text);
        sink({ type: "MessageDelta", text: redactText(block.text) });
        sink({ type: "MessageCompleted", text: redactText(block.text) });
      } else if (block.type === "tool_use") {
        context.toolCounter += 1;
        const toolExecutionId = block.id ?? "claude_tool_" + context.toolCounter;
        sink({
          type: "ToolStarted",
          toolExecutionId,
          toolName: block.name ?? "tool",
          actionType: /write|edit/i.test(block.name ?? "") ? "WRITE" : /bash|shell/i.test(block.name ?? "") ? "SHELL" : "READ",
          summary: "claude tool: " + (block.name ?? "tool"),
        });
      } else if (block.type === "tool_result") {
        sink({ type: "ToolCompleted", toolExecutionId: "claude_tool_" + context.toolCounter, status: "COMPLETED", exitCode: 0 });
      }
    }
    return;
  }
  if ((parsed as ClaudeStreamResult).type === "result") {
    const result = parsed as ClaudeStreamResult;
    sink({
      type: "UsageUpdated",
      usage: {
        model: null,
        inputTokens: result.usage?.input_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null,
        cacheReadTokens: result.usage?.cache_read_input_tokens ?? null,
        cacheWriteTokens: result.usage?.cache_creation_input_tokens ?? null,
        reasoningTokens: null,
        reportedCostUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
        source: "PROVIDER_REPORTED",
      },
    });
    if (result.is_error) {
      sink({ type: "RuntimeError", errorCode: "PROCESS_FAILED", message: redactText(result.result ?? "claude turn reported an error") });
    }
  }
}
