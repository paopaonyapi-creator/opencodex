// Phase 20.98 — MCP tools definition for OpenHermit control plane.
// Exposes pao.openhermit.* tools to the platform MCP catalog with risk tiers and approval gates.

import { getOpenHermitService } from "./service";
import { DeepResearchRuntime } from "./research";
import { HermitGovernanceBridge } from "./governance-bridge";
import type { RiskClass } from "./types";

export interface OpenHermitMcpTool {
  name: string;
  description: string;
  riskTier: RiskClass;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createOpenHermitMcpTools(): OpenHermitMcpTool[] {
  const svc = getOpenHermitService();
  const research = new DeepResearchRuntime();
  const gov = new HermitGovernanceBridge();

  return [
    {
      name: "pao.openhermit.health",
      description: "Query OpenHermit runtime gateway health and compatibility report.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const compat = await svc.checkCompatibility();
        return { ok: true, compatibility: compat };
      },
    },
    {
      name: "pao.openhermit.agent.list",
      description: "List durable agents registered in the OpenHermit fleet.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: { workspaceId: { type: "string", description: "Optional workspace filter" } },
      },
      handler: async (args) => {
        const list = svc.listAgents(typeof args.workspaceId === "string" ? args.workspaceId : undefined);
        return { ok: true, agents: list, count: list.length };
      },
    },
    {
      name: "pao.openhermit.agent.create",
      description: "Register a new durable agent in the Pao platform state plane.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["workspaceId", "name", "instruction"],
        properties: {
          workspaceId: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["research", "coding-inspector", "coding", "browser", "stock-production", "operations", "custom"] },
          instruction: { type: "string" },
          actor: { type: "string" },
        },
      },
      handler: async (args) => {
        const agent = await svc.createAgent({
          workspaceId: String(args.workspaceId),
          name: String(args.name),
          kind: (args.kind as any) ?? "generalist",
          instruction: String(args.instruction),
          actor: String(args.actor ?? "mcp_caller"),
        });
        return { ok: true, agent };
      },
    },
    {
      name: "pao.openhermit.agent.start",
      description: "Start or provision an agent on the OpenHermit runtime.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: { agentId: { type: "string" }, actor: { type: "string" } },
      },
      handler: async (args) => {
        const agent = await svc.startAgent(String(args.agentId), String(args.actor ?? "mcp_caller"));
        return { ok: true, agent };
      },
    },
    {
      name: "pao.openhermit.agent.stop",
      description: "Stop a running agent on the OpenHermit runtime.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: { agentId: { type: "string" }, reason: { type: "string" }, actor: { type: "string" } },
      },
      handler: async (args) => {
        const agent = await svc.stopAgent(
          String(args.agentId),
          String(args.actor ?? "mcp_caller"),
          String(args.reason ?? "mcp_stop"),
        );
        return { ok: true, agent };
      },
    },
    {
      name: "pao.openhermit.agent.reconcile",
      description: "Reconcile desired state with actual runtime state and correct drift.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: { agentId: { type: "string" }, actor: { type: "string" } },
      },
      handler: async (args) => {
        const res = await svc.reconcileAgent(String(args.agentId), String(args.actor ?? "mcp_reconciler"));
        return { ok: true, ...res };
      },
    },
    {
      name: "pao.openhermit.approval.list",
      description: "List pending or decided approval records.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["pending", "approved", "rejected", "expired", "cancelled", "superseded"] },
          agentId: { type: "string" },
        },
      },
      handler: async (args) => {
        const list = svc.listApprovals({
          state: typeof args.state === "string" ? (args.state as any) : undefined,
          agentId: typeof args.agentId === "string" ? args.agentId : undefined,
        });
        return { ok: true, approvals: list };
      },
    },
    {
      name: "pao.openhermit.approval.decide",
      description: "Approve or reject an exact-action approval record.",
      riskTier: "R3",
      parameters: {
        type: "object",
        required: ["approvalId", "decision"],
        properties: {
          approvalId: { type: "string" },
          decision: { type: "string", enum: ["approved", "rejected"] },
          reason: { type: "string" },
          actor: { type: "string" },
        },
      },
      handler: async (args) => {
        const res = svc.decideApproval(
          String(args.approvalId),
          args.decision === "approved" ? "approved" : "rejected",
          String(args.actor ?? "operator"),
          typeof args.reason === "string" ? args.reason : undefined,
        );
        return { ok: true, approval: res };
      },
    },
    {
      name: "pao.openhermit.research.create",
      description: "Create an approval-gated deep research plan with bounded budget.",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string" },
          agentId: { type: "string" },
          actor: { type: "string" },
          maxQueries: { type: "number" },
          maxSources: { type: "number" },
        },
      },
      handler: async (args) => {
        const run = research.createRun({
          question: String(args.question),
          agentId: typeof args.agentId === "string" ? args.agentId : undefined,
          actor: String(args.actor ?? "mcp_caller"),
          budget: {
            maxQueries: typeof args.maxQueries === "number" ? args.maxQueries : undefined,
            maxSources: typeof args.maxSources === "number" ? args.maxSources : undefined,
          },
        });
        return { ok: true, run };
      },
    },
    {
      name: "pao.openhermit.research.approve",
      description: "Approve a deep research plan for execution.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["runId"],
        properties: { runId: { type: "string" }, actor: { type: "string" } },
      },
      handler: async (args) => {
        const run = research.approvePlan(String(args.runId), String(args.actor ?? "operator"));
        return { ok: true, run };
      },
    },
    {
      name: "pao.openhermit.research.execute",
      description: "Execute an approved deep research run and return verified report.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["runId"],
        properties: { runId: { type: "string" }, actor: { type: "string" } },
      },
      handler: async (args) => {
        const report = await research.executeRun(String(args.runId), String(args.actor ?? "operator"));
        return { ok: true, report };
      },
    },
    {
      name: "pao.openhermit.skill.assign",
      description: "Assign a SkillsGate-governed skill to an agent.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["agentId", "skillId"],
        properties: {
          agentId: { type: "string" },
          skillId: { type: "string" },
          version: { type: "string" },
          actor: { type: "string" },
        },
      },
      handler: async (args) => {
        const res = await gov.assignSkill({
          agentId: String(args.agentId),
          skillId: String(args.skillId),
          version: typeof args.version === "string" ? args.version : undefined,
          actor: String(args.actor ?? "mcp_caller"),
        });
        return { ok: true, skill: res };
      },
    },
    {
      name: "pao.openhermit.fleet.impact",
      description: "Calculate impact and approval requirements for a bulk fleet action.",
      riskTier: "R0",
      parameters: {
        type: "object",
        required: ["action", "agentIds"],
        properties: {
          action: { type: "string", enum: ["bulk_start", "bulk_stop", "bulk_restart"] },
          agentIds: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (args) => {
        const impact = svc.calculateFleetImpact(
          String(args.action) as any,
          Array.isArray(args.agentIds) ? args.agentIds.map(String) : [],
        );
        return { ok: true, impact };
      },
    },
  ];
}
