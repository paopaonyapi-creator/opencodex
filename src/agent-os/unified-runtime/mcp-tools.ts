// Phase 20.35 — WebMCP tools for the unified runtime control plane (§24, §F).
// Spec namespace pao.router/providers/contexts/workspaces/reviewers/health;
// safety metadata follows the repo's R0-R4 WebMcpToolDefinition convention.
// The spec's ProviderAdapter.execute / gateway execute map to `routeRequest`
// / `perform` here to keep the repo's injection-safe call vocabulary.

import { getUnifiedRuntimeService } from "./control-plane";
import type { WebMcpToolDefinition } from "../video/mcp-tools";
import type { ProviderCapability, UnifiedAIRequest } from "./types";

function requestFrom(args: Record<string, unknown>): UnifiedAIRequest {
  return {
    model: typeof args.model === "string" ? args.model : "pao/general",
    prompt: typeof args.prompt === "string" ? args.prompt : undefined,
    messages: Array.isArray(args.messages)
      ? (args.messages as Array<{ role: string; content: string }>).filter((message) => typeof message?.role === "string" && typeof message?.content === "string").slice(0, 64)
      : undefined,
    mode: args.mode as UnifiedAIRequest["mode"],
    tools: args.tools === true,
    responseFormat: args.responseFormat as UnifiedAIRequest["responseFormat"],
    execution: {
      class: args.executionClass === "agent_mode" ? "agent_mode" : "provider_mode",
      workspaceId: typeof args.workspaceId === "string" ? args.workspaceId : undefined,
    },
    routing: {
      requiredCapabilities: Array.isArray(args.requiredCapabilities) ? (args.requiredCapabilities as ProviderCapability[]) : undefined,
      preferLocal: args.preferLocal === true,
    },
  };
}

export const UNIFIED_RUNTIME_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "pao_providers_list",
    description: "List unified runtime providers with capability manifests, mode affinities and health (no secrets).",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      return getUnifiedRuntimeService().providers().map((provider) => ({
        id: provider.id, name: provider.name, type: provider.type, enabled: provider.enabled,
        isLocal: provider.isLocal, capabilities: provider.capabilities, modes: provider.routing.modes,
        health: provider.health,
      }));
    },
  },
  {
    name: "pao_providers_health",
    description: "Run a health check against one unified provider (bounded; never performs paid inference).",
    riskTier: "R1",
    readOnly: true,
    execute: async (args) => getUnifiedRuntimeService().testProvider(String(args.providerId ?? ""), typeof args.actor === "string" ? args.actor : "agent"),
  },
  {
    name: "pao_router_preview",
    description: "Route preview: intent/mode, capability requirements, selected provider, fallback order and policy decisions with reasons.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const preview = getUnifiedRuntimeService().preview(requestFrom(args));
      return {
        mode: preview.mode,
        requirements: preview.requirements,
        selected: preview.selected,
        fallbacks: preview.fallbacks,
        excluded: preview.excluded.map((entry) => ({ providerId: entry.providerId, reasons: entry.reasons })),
        policyDecisions: preview.policyDecisions,
        executionClass: preview.executionClass,
      };
    },
  },
  {
    name: "pao_router_execute",
    description: "Route an AI request through the unified runtime (capability/policy filtered, circuit-broken, audited).",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const outcome = await getUnifiedRuntimeService().routeRequest(requestFrom(args));
      if ("blocked" in outcome) {
        return { blocked: true, reason: outcome.reason, selected: outcome.preview.selected, mode: outcome.preview.mode };
      }
      return {
        id: outcome.id, providerId: outcome.providerId, mode: outcome.routing.mode,
        output: typeof outcome.output === "string" ? outcome.output.slice(0, 4000) : outcome.output,
        usage: outcome.usage, timing: outcome.timing, fallbacksTried: outcome.routing.fallbacksTried,
      };
    },
  },
  {
    name: "pao_context_inspect",
    description: "Context firewall preview: which context items would be dropped or redacted before dispatch to the selected provider.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const preview = getUnifiedRuntimeService().preview(requestFrom(args));
      return {
        selectedProvider: preview.selected,
        dropped: preview.contextPreview?.dropped ?? [],
        redactions: preview.contextPreview?.redactions ?? 0,
        transmittedItems: preview.contextPreview?.envelope.items.map((item) => ({ key: item.key, sensitivity: item.sensitivity })) ?? [],
      };
    },
  },
  {
    name: "pao_workspace_permissions",
    description: "Read or (human actors only) update workspace permission grants. Default deny.",
    riskTier: "R3",
    readOnly: false,
    execute: (args) => {
      const service = getUnifiedRuntimeService();
      const workspaceId = String(args.workspaceId ?? "default");
      if (args.grants && typeof args.grants === "object") {
        return service.setGrants(workspaceId, args.grants as Record<string, boolean>, typeof args.actor === "string" ? args.actor : "dashboard");
      }
      return service.getGrants(workspaceId) ?? { workspaceId, grants: {}, note: "no grants recorded — default deny applies" };
    },
  },
  {
    name: "pao_health_summary",
    description: "Aggregate health snapshot of the unified runtime: providers, circuit states and recent route executions.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      const service = getUnifiedRuntimeService();
      return {
        providers: service.providers().map((provider) => ({ id: provider.id, state: provider.health.state, circuit: provider.health.circuitState })),
        usage: service.usageSummary(),
      };
    },
  },
];
