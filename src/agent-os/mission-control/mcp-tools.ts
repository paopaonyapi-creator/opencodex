// Phase 21.02 — Pao-hubPro Multi-Agent Mission Control MCP Tools.

import { getMissionControlService } from "./service";

export interface MissionControlMcpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: number; // 0: safe, 1: workspace, 2: network, 3: dangerous
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createMissionControlMcpTools(): MissionControlMcpToolDef[] {
  const svc = getMissionControlService();

  return [
    {
      name: "pao.mission_control.overview",
      description: "Get high-level Mission Control KPIs (active agents, running runs, pending approvals, queue depth, cost today, incident mode).",
      parameters: {
        type: "object",
        properties: {},
      },
      riskLevel: 0,
      handler: async () => {
        return { ok: true, kpis: svc.getOverview() };
      },
    },
    {
      name: "pao.mission_control.list_agents",
      description: "List all agents across the fleet with runtime status, host, model, and active tools.",
      parameters: {
        type: "object",
        properties: {},
      },
      riskLevel: 0,
      handler: async () => {
        return { ok: true, agents: svc.listAgents() };
      },
    },
    {
      name: "pao.mission_control.control_run",
      description: "Control an agent run: pause, resume, cancel, or retry.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "ID of the run to control" },
          action: { type: "string", enum: ["pause", "resume", "cancel", "retry"], description: "Control action" },
          reason: { type: "string", description: "Audit reason for control action" },
          actor: { type: "string", description: "Human or operator identifier" },
        },
        required: ["runId", "action", "reason"],
      },
      riskLevel: 1,
      handler: async (args) => {
        const runId = String(args.runId);
        const action = String(args.action);
        const reason = String(args.reason);
        const actor = String(args.actor || "operator");
        let updated;
        switch (action) {
          case "pause":
            updated = svc.pauseRun(runId, actor, reason);
            break;
          case "resume":
            updated = svc.resumeRun(runId, actor, reason);
            break;
          case "cancel":
            updated = svc.cancelRun(runId, actor, reason);
            break;
          case "retry":
            updated = svc.retryRun(runId, actor, reason);
            break;
          default:
            throw new Error(`Unsupported action ${action}`);
        }
        return { ok: true, run: updated };
      },
    },
    {
      name: "pao.mission_control.resolve_approval",
      description: "Approve or reject a pending human approval in the Mission Control Inbox.",
      parameters: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "ID of the approval item" },
          decision: { type: "string", enum: ["APPROVED", "REJECTED", "ESCALATED"], description: "Resolution decision" },
          actor: { type: "string", description: "Resolver identifier" },
          reason: { type: "string", description: "Resolution rationale" },
        },
        required: ["approvalId", "decision"],
      },
      riskLevel: 2,
      handler: async (args) => {
        const approvalId = String(args.approvalId);
        const decision = args.decision as "APPROVED" | "REJECTED" | "ESCALATED";
        const actor = String(args.actor || "operator");
        const reason = args.reason ? String(args.reason) : undefined;
        const res = svc.resolveApproval(approvalId, decision, actor, reason);
        return { ok: true, approval: res };
      },
    },
    {
      name: "pao.mission_control.emergency_stop",
      description: "Trigger or resolve system Emergency Stop / Lockdown mode across all agents.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["TRIGGER", "RESOLVE"], description: "Emergency action" },
          incidentId: { type: "string", description: "Incident ID (required for RESOLVE)" },
          actor: { type: "string", description: "Operator identity" },
          reason: { type: "string", description: "Reason for trigger/resolution" },
        },
        required: ["action", "reason"],
      },
      riskLevel: 3,
      handler: async (args) => {
        const action = String(args.action);
        const actor = String(args.actor || "operator");
        const reason = String(args.reason);
        if (action === "TRIGGER") {
          const inc = svc.triggerEmergencyStop(actor, reason);
          return { ok: true, incident: inc };
        } else if (action === "RESOLVE") {
          const incId = String(args.incidentId || "");
          const inc = svc.resolveIncident(incId, actor, reason);
          return { ok: true, incident: inc };
        }
        throw new Error(`Unsupported emergency stop action ${action}`);
      },
    },
  ];
}
