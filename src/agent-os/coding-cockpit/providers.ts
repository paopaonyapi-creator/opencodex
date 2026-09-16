// Phase 20.39 — Provider adapter registry (spec §7, §11). Adapters are the
// ONLY place provider-specific logic lives; the UI and the service consume
// the normalized contract. Registration is deterministic and additive.

import { CockpitError, type CodingProviderAdapter, type ProviderCapabilities } from "./types";

export function capabilitiesOf(patch: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    chat: false,
    nativeSessions: false,
    resume: false,
    streaming: false,
    tools: false,
    toolInputVisibility: false,
    toolOutputVisibility: false,
    fileRead: false,
    fileWrite: false,
    shell: false,
    git: false,
    mcp: false,
    usage: false,
    cost: false,
    artifacts: false,
    cancellation: false,
    ...patch,
  };
}

export class ProviderRegistry {
  private adapters = new Map<string, CodingProviderAdapter>();

  register(adapter: CodingProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      // Re-registering the same id replaces deterministically (idempotent
      // startup); distinct adapters must not collide.
      this.adapters.set(adapter.id, adapter);
      return;
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): CodingProviderAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  require(id: string): CodingProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new CockpitError("PROVIDER_UNAVAILABLE", "provider adapter not registered: " + id);
    return adapter;
  }

  list(): CodingProviderAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  ids(): string[] {
    return this.list().map((adapter) => adapter.id);
  }
}

export function providerDisplayName(id: string): string {
  switch (id) {
    case "codex":
      return "OpenAI Codex";
    case "claude_code":
      return "Claude Code";
    case "local":
      return "Local Runtime";
    case "mock":
      return "Mock Provider";
    default:
      return id;
  }
}

export function adapterTypeFor(id: string): "codex" | "claude_code" | "local" | "mock" | "openai_optional" | "deepseek_optional" | "grok_optional" {
  switch (id) {
    case "codex":
      return "codex";
    case "claude_code":
      return "claude_code";
    case "local":
      return "local";
    case "mock":
      return "mock";
    case "openai_optional":
    case "deepseek_optional":
    case "grok_optional":
      return id;
    default:
      return "local";
  }
}
