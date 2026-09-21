// Phase 21.00 — MCP Tools for Unified Agent Operations Control Plane.
// Exposes pao.uap.* tools to the central registry with risk tiers and approval gates.

import { getUnifiedControlPlane } from "./unified-service";
import type { UapRiskClass } from "./unified-types";

export interface UapMcpToolDescriptor {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createUnifiedControlPlaneMcpTools(): UapMcpToolDescriptor[] {
  const uap = getUnifiedControlPlane();

  return [
    {
      name: "pao.uap.agents.list",
      description: "List all operational agents in the unified agent registry across runtimes.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, agents: uap.listAgents() };
      },
    },
    {
      name: "pao.uap.hosts.list",
      description: "List all federated execution hosts and their trust levels.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, hosts: uap.listHosts() };
      },
    },
    {
      name: "pao.uap.jobs.submit",
      description: "Submit a durable job to the unified control plane with policy and approval gates.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["jobType", "hostId", "requestedBy"],
        properties: {
          jobType: { type: "string" },
          hostId: { type: "string" },
          requestedBy: { type: "string" },
          agentId: { type: "string" },
          priority: { type: "number" },
          payload: { type: "object" },
          riskClass: { type: "string", enum: ["R0_READ_ONLY", "R1_LOW_RISK", "R2_CONTROLLED_WRITE", "R3_SENSITIVE", "R4_PRIVILEGED"] },
        },
      },
      handler: async (args) => {
        const job = await uap.submitJob({
          jobType: String(args.jobType),
          hostId: String(args.hostId),
          requestedBy: String(args.requestedBy),
          agentId: typeof args.agentId === "string" ? args.agentId : null,
          priority: typeof args.priority === "number" ? args.priority : 5,
          payload: (args.payload as any) ?? {},
          riskClass: args.riskClass as any,
        });
        return { ok: true, job };
      },
    },
    {
      name: "pao.uap.approvals.decide",
      description: "Approve or reject a high-risk operational action in the unified approval fabric.",
      riskTier: "R3",
      parameters: {
        type: "object",
        required: ["approvalId", "decision", "decidedBy"],
        properties: {
          approvalId: { type: "string" },
          decision: { type: "string", enum: ["approved", "rejected"] },
          decidedBy: { type: "string" },
          reason: { type: "string" },
        },
      },
      handler: async (args) => {
        const appr = uap.decideApproval(
          String(args.approvalId),
          args.decision === "approved" ? "approved" : "rejected",
          String(args.decidedBy),
          typeof args.reason === "string" ? args.reason : undefined,
        );
        return { ok: true, approval: appr };
      },
    },
    {
      name: "pao.uap.mcp.tools",
      description: "List centralized MCP tools and their risk classifications.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, tools: uap.listMcpTools() };
      },
    },
    {
      name: "pao.uap.skills.list",
      description: "List verified skills in the central governance registry.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, skills: uap.listSkills() };
      },
    },
    {
      name: "pao.uap.audit.list",
      description: "Query unified operations audit events by correlation ID.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: { correlationId: { type: "string" } },
      },
      handler: async (args) => {
        const events = uap.listAuditEvents(typeof args.correlationId === "string" ? args.correlationId : undefined);
        return { ok: true, events, count: events.length };
      },
    },
  ];
}
