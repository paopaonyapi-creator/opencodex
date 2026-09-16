// Phase 20.63 — Pao-owned MCP tools for the External Capability Registry.
//
// Admin operations (approve/revoke) are deliberately NOT exposed to agents —
// they stay dashboard/API-only (spec §46, §Q). Generated per-operation tools
// are separate and disabled until human enablement.

import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { getExternalApiService } from "./service";

function service() {
  return getExternalApiService();
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("missing required string argument: " + key);
  }
  return value;
}

export const EXTERNAL_API_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "external_api_search_capabilities",
    description: "Search the governed external capability registry with explainable ranking (approval/health/trust/auth). Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => service().searchCapabilities(requireString(args, "query"), {
      authFreeOnly: args.auth_free_only === true,
      approvedOnly: args.approved_only === true,
      actorId: "agent",
    }),
  },
  {
    name: "external_api_list_providers",
    description: "List registered external API providers, optionally filtered by lifecycle. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ providers: service().store.listProviders({ lifecycle: typeof args.lifecycle === "string" ? args.lifecycle : undefined }) }),
  },
  {
    name: "external_api_get_provider",
    description: "Read one provider with lifecycle, health, trust/risk scores, and provenance evidence. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ provider: service().store.getProvider(requireString(args, "provider_id")) }),
  },
  {
    name: "external_api_list_operations",
    description: "List classified operations for a provider with risk and capability evidence. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ operations: service().store.listOperations(requireString(args, "provider_id")) }),
  },
  {
    name: "external_api_get_health",
    description: "Read recent health-check evidence for a provider. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ checks: service().store.recentHealthChecks(requireString(args, "provider_id"), 10) }),
  },
  {
    name: "external_api_request_tool_generation",
    description: "Request generation of a disabled MCP tool for a classified operation of an approved provider. Mutating but non-executing; tools stay disabled until human enablement.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => service().generateTool(requireString(args, "operation_id"), "agent"),
  },
  {
    name: "external_api_execute_approved",
    description: "Execute one approved, enabled operation through the API Execution Gateway. High-impact: full policy/egress/rate-limit chain; binds to the registry operation ID, never an agent URL.",
    riskTier: "R3",
    readOnly: false,
    execute: async (args) => await service().executeApproved({
      operationId: requireString(args, "operation_id"),
      actorType: "agent",
      actorId: typeof args.actor_id === "string" ? args.actor_id : "agent",
      toolId: typeof args.tool_id === "string" ? args.tool_id : null,
      arguments: args.arguments && typeof args.arguments === "object" ? args.arguments as Record<string, unknown> : {},
      credentialProfileId: typeof args.credential_profile_id === "string" ? args.credential_profile_id : null,
    }),
  },
];
