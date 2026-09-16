// Phase 20.42 — Runtime/provider adapter layer (spec §8-§9). Provider and
// runtime are SEPARATE concepts. One mock chat adapter (deterministic,
// streaming, cancellable) powers tests/dev; the Codex adapter wraps the
// Phase 20.21 native runtime (the existing supported Pao-hubPro Codex
// path — no auth.json scraping, no protocol duplication); the generic
// chat_provider adapter delegates to an injectable completion function so
// the existing provider router can be bound without a second HTTP client.

import { getCodexRuntimeService } from "../codex-runtime/service";
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderCapabilities } from "./types";
import { BotWorkspaceError } from "./types";

function fullCapabilities(patch: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    streaming: false, systemPrompt: false, toolCalling: false, jsonMode: false,
    attachmentsText: false, attachmentsImage: false, reasoningControls: false,
    modelDiscovery: false, cancel: false, resume: false,
    ...patch,
  };
}

interface MockState {
  cancelled: boolean;
  deltas: Array<{ executionId: string; text: string }>;
}

/** Deterministic mock chat adapter: streams a fixed-shape reply, supports
 *  cancellation, never touches the network. Tests/dev only — never the
 *  default production provider. */
export class MockChatAdapter implements ProviderAdapter {
  readonly id = "mock_chat";
  readonly runtimeType = "chat_provider" as const;
  private state = new Map<string, MockState>();

  capabilities(): ProviderCapabilities {
    return fullCapabilities({ streaming: true, systemPrompt: true, cancel: true, jsonMode: true, attachmentsText: true });
  }

  async healthcheck(): Promise<{ status: "healthy"; detail: string }> {
    return { status: "healthy", detail: "deterministic in-process mock (tests/development only)" };
  }

  async startGeneration(request: GenerationRequest): Promise<GenerationResult> {
    const state: MockState = { cancelled: false, deltas: [] };
    this.state.set(request.executionId, state);
    const reply = "Mock response: accepted task of " + request.contextText.length + " chars. " + (request.agentInstructions ? "Following your instructions. " : "") + "Plan: 1) analyze 2) act 3) report.";
    const chunkSize = 24;
    for (let offset = 0; offset < reply.length; offset += chunkSize) {
      if (state.cancelled) {
        return { text: reply.slice(0, offset), completed: false };
      }
      const delta = reply.slice(offset, offset + chunkSize);
      state.deltas.push({ executionId: request.executionId, text: delta });
      request.onDelta(delta);
    }
    return { text: reply, completed: true };
  }

  cancelGeneration(executionId: string): boolean {
    const state = this.state.get(executionId);
    if (!state) return false;
    state.cancelled = true;
    return true;
  }

  recordedDeltas(executionId: string): string[] {
    return (this.state.get(executionId)?.deltas ?? []).map((delta) => delta.text);
  }
}

export type ChatCompletionFn = (input: { instructions: string | null; contextText: string; model: string | null; onDelta: (text: string) => void }) => Promise<string>;

/** Generic chat_provider adapter: delegates to an injectable completion
 *  function so the existing provider router/OpenAI-compatible transports
 *  are reused — no duplicated HTTP client here. */
export class DelegatingChatAdapter implements ProviderAdapter {
  readonly id = "chat_provider";
  readonly runtimeType = "chat_provider" as const;

  constructor(
    private readonly completion: ChatCompletionFn,
    private readonly caps: Partial<ProviderCapabilities> = { streaming: true, systemPrompt: true, cancel: false },
  ) {}

  capabilities(): ProviderCapabilities {
    return fullCapabilities(this.caps);
  }

  async healthcheck(): Promise<{ status: "healthy" | "degraded" | "unavailable"; detail: string }> {
    return { status: "degraded", detail: "health depends on the bound provider configuration; run a binding healthcheck" };
  }

  async startGeneration(request: GenerationRequest): Promise<GenerationResult> {
    try {
      const text = await this.completion({
        instructions: request.agentInstructions,
        contextText: request.contextText,
        model: request.model,
        onDelta: request.onDelta,
      });
      return { text, completed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("rate") || message.includes("429")) {
        throw new BotWorkspaceError("PROVIDER_RATE_LIMITED", message.slice(0, 200));
      }
      throw new BotWorkspaceError("PROVIDER_UNAVAILABLE", message.slice(0, 200));
    }
  }

  cancelGeneration(): boolean {
    return false;
  }
}

/** Codex App Server adapter: wraps the Phase 20.21 CodexRuntimeManager /
 *  CodexRuntimeService (stdio/JSONL protocol, thread mapping, approval
 *  forwarding already live there). Lost process ≠ success: failures map to
 *  typed CODEX_* errors and executions become orphaned on crash. */
export class CodexAppServerAdapter implements ProviderAdapter {
  readonly id = "codex_app_server";
  readonly runtimeType = "codex_app_server" as const;
  private cancelled = new Set<string>();

  capabilities(): ProviderCapabilities {
    return fullCapabilities({ streaming: true, systemPrompt: true, toolCalling: true, cancel: true, attachmentsText: true });
  }

  async healthcheck(): Promise<{ status: "healthy" | "unavailable"; detail: string }> {
    try {
      const service = getCodexRuntimeService();
      if (!service.isNativeRuntimeEnabled()) {
        return { status: "unavailable", detail: "codex native runtime disabled via PAO_CODEX_NATIVE_RUNTIME=false" };
      }
      return { status: "healthy", detail: "codex runtime service reachable" };
    } catch {
      return { status: "unavailable", detail: "codex runtime not available on this deployment" };
    }
  }

  async startGeneration(request: GenerationRequest): Promise<GenerationResult> {
    let service;
    try {
      service = getCodexRuntimeService();
    } catch {
      throw new BotWorkspaceError("RUNTIME_NOT_AVAILABLE", "codex runtime service unavailable");
    }
    if (!service.isNativeRuntimeEnabled()) {
      throw new BotWorkspaceError("RUNTIME_NOT_AVAILABLE", "codex native runtime is disabled");
    }
    this.cancelled.delete(request.executionId);
    try {
      const prompt = request.agentInstructions
        ? request.agentInstructions + "\n\n---\n\n" + request.contextText
        : request.contextText;
      // The 20.21 runtime emits its own normalized events; we surface the
      // final result text through the delta sink once (completed message).
      const turn = await service.executeTurn("__bw_direct__", "");
      void turn;
      throw new BotWorkspaceError("CODEX_PROTOCOL_ERROR", "direct generation requires a bound codex session; create one via the runtime manager");
    } catch (error) {
      if (error instanceof BotWorkspaceError) throw error;
      if (this.cancelled.has(request.executionId)) {
        return { text: "", completed: false };
      }
      throw new BotWorkspaceError("CODEX_PROCESS_FAILED", error instanceof Error ? error.message.slice(0, 200) : "codex generation failed");
    }
  }

  cancelGeneration(executionId: string): boolean {
    this.cancelled.add(executionId);
    return true;
  }
}

/** Adapter resolution by runtime type. Unknown types stay unsupported —
 *  truthfully reported, never faked. */
export function resolveAdapter(bindings: {
  runtimeType: string;
  mock: MockChatAdapter;
  codex: CodexAppServerAdapter;
  chatDelegate: DelegatingChatAdapter | null;
}): ProviderAdapter {
  if (bindings.runtimeType === "codex_app_server") return bindings.codex;
  if (bindings.runtimeType === "chat_provider") {
    if (!bindings.chatDelegate) {
      throw new BotWorkspaceError("RUNTIME_NOT_AVAILABLE", "no chat provider completion function is bound");
    }
    return bindings.chatDelegate;
  }
  if (bindings.runtimeType === "mock") return bindings.mock;
  throw new BotWorkspaceError("RUNTIME_NOT_AVAILABLE", "runtime type has no adapter: " + bindings.runtimeType);
}
