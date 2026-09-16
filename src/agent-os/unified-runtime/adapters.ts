// Phase 20.35 — provider manifests + adapter runtimes (§6-§8, §B).
// The opencodex proxy IS the OpenAI-compatible gateway, so the native gateway
// appears as a provider manifest (execution delegated to /v1/*, not
// re-implemented). Local HTTP adapters (Ollama / LM Studio) execute directly
// against loopback endpoints with URL-object path resolution (no string
// building enters a request target). CLI providers reuse the Phase 20.27
// cockpit adapters for detection. Deterministic fake providers (§68) exist
// for tests only.

import { builtinAgentAdapters } from "../control-plane/cockpit-agents";
import { LeadError } from "../leads/errors";
import type { ProviderCapabilities, ProviderHealthState, ProviderManifest, UnifiedAIResponse } from "./types";

export interface AdapterChatInput {
  model: string;
  prompt: string;
  messages: Array<{ role: string; content: string }>;
  responseFormat?: string;
}

export interface ProviderAdapterRuntime {
  manifest(): ProviderManifest;
  healthCheck(): Promise<{ state: ProviderHealthState; latencyMs: number; message?: string }>;
  perform?(input: AdapterChatInput): Promise<{ output: unknown; modelId?: string; usage?: UnifiedAIResponse["usage"] }>;
}

function capabilities(partial: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    text: true, vision: false, image_generation: false, video_generation: false,
    audio_input: false, audio_output: false, tool_calling: false, structured_output: false,
    long_context: false, code_execution: false, streaming: false, json_schema: false,
    reasoning: false, filesystem_access: "no", shell_access: "no", mcp_client: false,
    ...partial,
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

/** Resolves a fixed API path against the configured provider origin. These
 *  providers serve the API at the origin root, so the pathname is replaced
 *  directly — no string building enters the request target. */
function localUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = path;
  return url.toString();
}

// --- Native gateway manifest (execution stays in the existing proxy) ----------

const NATIVE_GATEWAY: ProviderManifest = {
  id: "pao-gateway-native",
  name: "Pao Gateway (native /v1 router)",
  type: "openai_compatible",
  enabled: true,
  isLocal: false,
  capabilities: capabilities({
    tool_calling: true, structured_output: true, streaming: true, json_schema: true,
    reasoning: true, long_context: true, vision: true,
  }),
  routing: { basePriority: 85, modes: { general: 85, coding: 80, research: 85, writing: 85, review: 80, automation: 75, adobe_stock: 80 } },
  limits: { concurrency: 8, timeoutMs: 300_000 },
  policy: {
    access: { api: true, cli: false, browser: false },
    automation: { browser_actions: false, bulk: false },
    credentials: { api_key: true, oauth: false, browser_session: false },
    respectRemoteRateLimit: true,
    notes: ["execution is served by the existing proxy /v1 endpoints; this manifest makes it routable/observable"],
  },
  config: {},
};

// --- Local HTTP adapter (Ollama / LM Studio) ------------------------------------

class LocalHttpProvider implements ProviderAdapterRuntime {
  private manifestValue: ProviderManifest;

  constructor(manifest: ProviderManifest) {
    this.manifestValue = manifest;
  }

  manifest(): ProviderManifest {
    return this.manifestValue;
  }

  async healthCheck(): Promise<{ state: ProviderHealthState; latencyMs: number; message?: string }> {
    const baseUrl = this.manifestValue.config.baseUrl;
    if (!baseUrl) return { state: "disabled", latencyMs: 0, message: "no base URL configured" };
    const startedAt = Date.now();
    try {
      const res = await fetch(localUrl(baseUrl, "/v1/models"), { signal: AbortSignal.timeout(3000) });
      return { state: res.ok ? "healthy" : "degraded", latencyMs: Date.now() - startedAt };
    } catch {
      return { state: "offline", latencyMs: Date.now() - startedAt, message: "local runtime unreachable" };
    }
  }

  async perform(input: AdapterChatInput): Promise<{ output: unknown; modelId?: string }> {
    const baseUrl = this.manifestValue.config.baseUrl;
    if (!baseUrl) throw new LeadError("PROVIDER_UNAVAILABLE", "local provider has no base URL");
    // Local runtimes bind to loopback by default (§59); remote local runtimes
    // must be https or an explicitly configured trusted host.
    const parsed = new URL(baseUrl);
    if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
      throw new LeadError("POLICY_BLOCKED", "plain-HTTP providers are restricted to loopback (spec §59)");
    }
    const secret = this.manifestValue.config.secretRef ? process.env[this.manifestValue.config.secretRef] : undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const res = await fetch(localUrl(baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.manifestValue.config.modelId ?? input.model,
        messages: input.messages.length > 0 ? input.messages : [{ role: "user", content: input.prompt }],
        ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(this.manifestValue.limits.timeoutMs),
    });
    if (!res.ok) throw new LeadError("PROVIDER_UNAVAILABLE", `local provider returned HTTP ${res.status}`);
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
    return { output: payload.choices?.[0]?.message?.content ?? "", modelId: payload.model };
  }
}

// --- CLI provider (Codex / Claude Code via the Phase 20.27 cockpit) --------------

class CliProvider implements ProviderAdapterRuntime {
  private manifestValue: ProviderManifest;
  private agentType: string;

  constructor(manifest: ProviderManifest, agentType: string) {
    this.manifestValue = manifest;
    this.agentType = agentType;
  }

  manifest(): ProviderManifest {
    return this.manifestValue;
  }

  async healthCheck(): Promise<{ state: ProviderHealthState; latencyMs: number; message?: string }> {
    const adapter = builtinAgentAdapters().find((entry) => entry.type === this.agentType);
    const detection = adapter?.detect();
    const detected = detection?.detected === true;
    return {
      state: detected ? "healthy" : "degraded",
      latencyMs: 1,
      message: detected ? "CLI binary detected (never executed during detection)" : "CLI binary not found on this machine",
    };
  }
}

// --- MCP provider (Phase 20.33 gateway) --------------------------------------------

class McpProvider implements ProviderAdapterRuntime {
  private manifestValue: ProviderManifest;

  constructor() {
    this.manifestValue = {
      id: "pao-mcp-gateway",
      name: "Pao MCP Gateway (Phase 20.33)",
      type: "mcp",
      enabled: true,
      isLocal: true,
      capabilities: capabilities({ mcp_client: true, tool_calling: true, filesystem_access: "agent_only", shell_access: "agent_only" }),
      routing: { basePriority: 60, modes: { automation: 90, coding: 60 } },
      limits: { concurrency: 4, timeoutMs: 120_000 },
      policy: {
        access: { api: true, cli: false, browser: false },
        automation: { browser_actions: false, bulk: false },
        credentials: { api_key: false, oauth: false, browser_session: false },
        respectRemoteRateLimit: true,
        notes: ["tools are the governed pao.* catalog; high-risk tools pass the policy engine"],
      },
      config: {},
    };
  }

  manifest(): ProviderManifest {
    return this.manifestValue;
  }

  async healthCheck(): Promise<{ state: ProviderHealthState; latencyMs: number; message?: string }> {
    return { state: "healthy", latencyMs: 1, message: "governed pao.* catalog available" };
  }
}

// --- Deterministic fakes (§68, tests only) -------------------------------------------

export type FakeKind = "always-success" | "always-fail" | "slow" | "rate-limited" | "vision-provider" | "text-only" | "high-cost" | "local-provider";

export class FakeProvider implements ProviderAdapterRuntime {
  constructor(private kind: FakeKind, private label = kind) {}

  manifest(): ProviderManifest {
    const base: ProviderManifest = {
      id: "fake-" + this.kind,
      name: "Fake: " + (this.label || this.kind),
      type: "openai_compatible",
      enabled: true,
      isLocal: this.kind === "local-provider",
      capabilities: capabilities(
        this.kind === "vision-provider"
          ? { vision: true, structured_output: true }
          : this.kind === "text-only"
            ? {}
            : { structured_output: true, tool_calling: true },
      ),
      routing: { basePriority: 70, modes: {} },
      limits: { concurrency: 2, timeoutMs: this.kind === "slow" ? 30_000 : 10_000 },
      policy: {
        access: { api: true, cli: false, browser: false },
        automation: { browser_actions: false, bulk: false },
        credentials: { api_key: false, oauth: false, browser_session: false },
        respectRemoteRateLimit: true,
        notes: ["deterministic test fixture (spec §68) — never used in production routing"],
      },
      config: {},
    };
    return base;
  }

  async healthCheck(): Promise<{ state: ProviderHealthState; latencyMs: number }> {
    if (this.kind === "rate-limited") return { state: "rate_limited", latencyMs: 1 };
    return { state: "healthy", latencyMs: this.kind === "slow" ? 800 : 2 };
  }

  async perform(input: AdapterChatInput): Promise<{ output: unknown; modelId?: string; usage?: UnifiedAIResponse["usage"] }> {
    if (this.kind === "always-fail") throw new LeadError("PROVIDER_UNAVAILABLE", "fake provider always fails");
    if (this.kind === "rate-limited") throw new LeadError("PROVIDER_RATE_LIMIT", "429 rate limited by fake provider");
    if (this.kind === "slow") await new Promise((resolve) => setTimeout(resolve, 30));
    const text = input.prompt || input.messages.map((message) => message.content).join(" ");
    return { output: `[${this.kind}] echo:${text.slice(0, 40)}`, usage: { estimatedCostUsd: this.kind === "high-cost" ? 0.9 : 0.001 } };
  }
}

// --- Registry seeding (§B initial set) -----------------------------------------------

export function builtinProviders(): ProviderAdapterRuntime[] {
  const runtimes: ProviderAdapterRuntime[] = [new LocalHttpProvider(NATIVE_GATEWAY)];
  const ollama = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST;
  if (ollama) {
    runtimes.push(new LocalHttpProvider({
      id: "ollama-local",
      name: "Ollama (local)",
      type: "local_http",
      enabled: true,
      isLocal: true,
      capabilities: capabilities({ streaming: true, tool_calling: true, reasoning: true }),
      routing: { basePriority: 90, modes: { private_local: 100, general: 75, coding: 70, research: 70 } },
      limits: { concurrency: 2, timeoutMs: 120_000 },
      policy: {
        access: { api: true, cli: false, browser: false },
        automation: { browser_actions: false, bulk: false },
        credentials: { api_key: false, oauth: false, browser_session: false },
        respectRemoteRateLimit: true,
        notes: ["local-first preferred provider (spec §2.1)"],
      },
      config: { baseUrl: ollama.replace(/\/+$/, ""), modelId: process.env.OLLAMA_DEFAULT_MODEL },
    }));
  }
  const lmstudio = process.env.LMSTUDIO_BASE_URL;
  if (lmstudio) {
    runtimes.push(new LocalHttpProvider({
      id: "lmstudio-local",
      name: "LM Studio (local)",
      type: "local_http",
      enabled: true,
      isLocal: true,
      capabilities: capabilities({ streaming: true, structured_output: true }),
      routing: { basePriority: 88, modes: { private_local: 95, general: 70 } },
      limits: { concurrency: 2, timeoutMs: 120_000 },
      policy: {
        access: { api: true, cli: false, browser: false },
        automation: { browser_actions: false, bulk: false },
        credentials: { api_key: false, oauth: false, browser_session: false },
        respectRemoteRateLimit: true,
        notes: ["LM Studio-compatible local endpoint (spec §8.3)"],
      },
      config: { baseUrl: lmstudio.replace(/\/+$/, "") },
    }));
  }
  const codexManifest: ProviderManifest = {
    id: "codex-cli",
    name: "Codex CLI",
    type: "cli",
    enabled: true,
    isLocal: true,
    capabilities: capabilities({ reasoning: true, tool_calling: true, code_execution: true, filesystem_access: "agent_only", shell_access: "agent_only" }),
    routing: { basePriority: 80, modes: { coding: 100, review: 85, automation: 70 } },
    limits: { concurrency: 2, timeoutMs: 600_000 },
    policy: {
      access: { api: false, cli: true, browser: false },
      automation: { browser_actions: false, bulk: false },
      credentials: { api_key: true, oauth: true, browser_session: false },
      respectRemoteRateLimit: true,
      notes: ["agent mode only: requires authorized workspace grants (spec §22, §44)"],
    },
    config: {},
  };
  runtimes.push(new CliProvider(codexManifest, "codex"));
  const claudeManifest: ProviderManifest = {
    ...codexManifest,
    id: "claude-code-cli",
    name: "Claude Code CLI",
    routing: { basePriority: 78, modes: { coding: 95, review: 90 } },
  };
  runtimes.push(new CliProvider(claudeManifest, "claude"));
  runtimes.push(new McpProvider());
  return runtimes;
}
