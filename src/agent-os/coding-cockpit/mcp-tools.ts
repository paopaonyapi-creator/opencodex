// Phase 20.39 — WebMCP tools for the coding cockpit (spec §40). MCP tools
// NEVER bypass policy because they are "trusted": mutating tools route
// through runToolAction (policy → approval → lock → audit) or the service
// session pipeline. Human-governed decisions (approvals, trust) are
// excluded from the tool surface entirely.

import { getCockpitService } from "./service";
import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { CockpitError } from "./types";

function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new CockpitError("VALIDATION_ERROR", "field '" + field + "' is required");
  }
  return value;
}

export const COCKPIT_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "cockpit_list_workspaces",
    description: "List registered coding workspaces with trust level and git metadata.",
    riskTier: "R0", readOnly: true,
    execute: () => getCockpitService().store.listWorkspaces(),
  },
  {
    name: "cockpit_register_workspace",
    description: "Register a local workspace root (canonicalized; duplicates rejected; PRIVILEGED never auto-assigned).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getCockpitService().registerWorkspace({
      rootPath: requireString(args, "rootPath"),
      name: typeof args.name === "string" ? args.name : undefined,
      actor: "operator",
    }),
  },
  {
    name: "cockpit_list_providers",
    description: "List cockpit provider adapters and their normalized capabilities.",
    riskTier: "R0", readOnly: true,
    execute: () => getCockpitService().providers.list().map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: adapter.getCapabilities(),
    })),
  },
  {
    name: "cockpit_probe_provider",
    description: "Probe one provider adapter for installation/auth/version and persist the capability snapshot.",
    riskTier: "R1", readOnly: false,
    execute: (args) => getCockpitService().probeProvider(requireString(args, "providerId")),
  },
  {
    name: "cockpit_start_session",
    description: "Start a unified session (probe → capabilities → writer lock when mutating → native start → stream).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getCockpitService().startSession({
      workspaceId: requireString(args, "workspaceId"),
      providerId: requireString(args, "providerId"),
      title: typeof args.title === "string" ? args.title : undefined,
      mode: (typeof args.mode === "string" ? args.mode : "CHAT") as never,
      actor: "operator",
    }),
  },
  {
    name: "cockpit_send_message",
    description: "Send a message through the session pipeline (slash parse → context resolve → policy → provider).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getCockpitService().sendMessage({
      sessionId: requireString(args, "sessionId"),
      text: requireString(args, "text"),
      actor: "operator",
      contextRefs: Array.isArray(args.contextRefs) ? (args.contextRefs as never) : undefined,
    }),
  },
  {
    name: "cockpit_cancel_session",
    description: "Cancel a running session and release its writer lease.",
    riskTier: "R2", readOnly: false,
    execute: (args) => getCockpitService().cancelSession(requireString(args, "sessionId"), "operator"),
  },
  {
    name: "cockpit_discover_sessions",
    description: "Scan provider adapters for native sessions in a workspace (native ids preserved).",
    riskTier: "R1", readOnly: false,
    execute: (args) => getCockpitService().scanDiscovery(
      requireString(args, "workspaceId"),
      typeof args.providerId === "string" ? args.providerId : null,
    ),
  },
  {
    name: "cockpit_import_session",
    description: "Import a discovered native session into the unified registry without losing its native id.",
    riskTier: "R2", readOnly: false,
    execute: (args) => getCockpitService().importDiscoveredSession(
      requireString(args, "providerId"),
      requireString(args, "nativeSessionId"),
      requireString(args, "workspaceId"),
      "operator",
    ),
  },
  {
    name: "cockpit_run_tool_action",
    description: "Run a workspace-bounded tool action (read_file / run_command) through policy → approval → lock → audit.",
    riskTier: "R3", readOnly: false,
    execute: (args) => getCockpitService().runToolAction({
      sessionId: requireString(args, "sessionId"),
      toolName: requireString(args, "toolName"),
      actionInput: (args.actionInput && typeof args.actionInput === "object" ? args.actionInput : {}) as Record<string, unknown>,
      actor: "operator",
    }),
  },
  {
    name: "cockpit_usage_summary",
    description: "Aggregate usage (reported vs estimated kept separate; unknown stays unknown).",
    riskTier: "R0", readOnly: true,
    execute: () => getCockpitService().usageSummary(),
  },
  {
    name: "cockpit_reconcile",
    description: "Reconcile stale sessions, expired locks/approvals, dead processes, duplicate native ids (never deletes history).",
    riskTier: "R1", readOnly: false,
    execute: () => getCockpitService().reconcile(),
  },
  {
    name: "cockpit_audit",
    description: "Read the cockpit audit trail (redacted).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getCockpitService().store.listAudit({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
      workspaceId: typeof args.workspaceId === "string" ? args.workspaceId : undefined,
      limit: typeof args.limit === "number" ? args.limit : 100,
    }),
  },
];
