// Phase 20.42 — MCP tools for the Teammate Workspace (spec §25, adapted to
// repo snake_case convention). Read-only tools are R0; round start is R2
// (consent-gated server-side); stop/retry R2/R3; approval decisions stay
// dashboard-only (human invariant) and are deliberately NOT exposed here.

import { getBotWorkspaceService } from "./service";
import type { WebMcpToolDefinition } from "../video/mcp-tools";

export const BOT_WORKSPACE_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "workspace_list_agents",
    description: "List named AI teammates with role/status/validation (read-only).",
    riskTier: "R0", readOnly: true,
    execute: () => {
      const service = getBotWorkspaceService();
      return service.listAgents().map((agent) => ({ ...agent, validation: service.validateAgent(agent.id) }));
    },
  },
  {
    name: "workspace_create_agent",
    description: "Create a named AI teammate with role/instructions/bindings (write).",
    riskTier: "R2", readOnly: false,
    execute: (args) => {
      const service = getBotWorkspaceService();
      return service.createAgent({
        name: String(args.name ?? ""),
        role: (typeof args.role === "string" ? args.role : "custom") as never,
        description: typeof args.description === "string" ? args.description : null,
        systemInstructions: typeof args.systemInstructions === "string" ? args.systemInstructions : null,
        defaultModel: typeof args.defaultModel === "string" ? args.defaultModel : null,
      });
    },
  },
  {
    name: "workspace_list_conversations",
    description: "List workspace conversations (direct/group) (read-only).",
    riskTier: "R0", readOnly: true,
    execute: () => getBotWorkspaceService().listConversations(),
  },
  {
    name: "workspace_get_messages",
    description: "Read conversation messages with attribution (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getBotWorkspaceService().listMessages(String(args.conversationId ?? "")),
  },
  {
    name: "workspace_start_round",
    description: "Start an ordered/parallel multi-agent round (consent-gated; returns round with resolved order) (write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const service = getBotWorkspaceService();
      return service.startGroupRound({
        conversationId: String(args.conversationId ?? ""),
        text: String(args.text ?? ""),
        agentIdsInOrder: Array.isArray(args.agentIdsInOrder) ? (args.agentIdsInOrder as string[]) : [],
        mode: (args.mode === "parallel" ? "parallel" : "ordered"),
        requireConsent: args.requireConsent !== false,
      });
    },
  },
  {
    name: "workspace_get_round",
    description: "Read a group round's executions/events timeline (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const service = getBotWorkspaceService();
      const roundId = String(args.roundId ?? "");
      const round = service.store.getRound(roundId);
      const executions = service.store.listExecutionsForRound(roundId).map((execution) => ({
        ...execution,
        events: service.store.listEvents(execution.id),
      }));
      return { round, executions };
    },
  },
  {
    name: "workspace_stop_round",
    description: "Stop a running round: cancels active execution, prevents remaining agents, preserves completed outputs (write).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getBotWorkspaceService().stopRound(String(args.roundId ?? "")),
  },
  {
    name: "workspace_run_routine",
    description: "Run Now for a routine (manual trigger; idempotent by key when provided) (write).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => getBotWorkspaceService().runRoutine(
      String(args.routineId ?? ""),
      "manual",
      typeof args.idempotencyKey === "string" ? args.idempotencyKey : null,
    ),
  },
  {
    name: "workspace_list_routines",
    description: "List routines with lifecycle status (read-only).",
    riskTier: "R0", readOnly: true,
    execute: () => getBotWorkspaceService().store.listRoutines(getBotWorkspaceService().ensureWorkspace().id),
  },
];
