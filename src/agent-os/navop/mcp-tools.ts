// Phase Navop & 21.03 — Host-Authoritative Operations MCP Tools (pao.* namespace).

import { getNavopRuntimeService } from "./service";

export interface NavopMcpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: number;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createNavopMcpTools(): NavopMcpToolDef[] {
  const svc = getNavopRuntimeService();

  return [
    {
      name: "pao.resources.list",
      description: "List registered Host/VPS/File/Database resources without exposing plaintext credentials.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Filter by resource type: host | files | terminal | database" },
        },
      },
      riskLevel: 1,
      handler: async (args) => {
        const type = args.type ? String(args.type) : undefined;
        const list = svc.listResources(type);
        return { ok: true, resources: list.map(r => ({ resourceUri: r.resourceUri, type: r.resourceType, displayName: r.displayName, enabled: r.enabled })) };
      },
    },
    {
      name: "pao.capabilities.list",
      description: "List permitted Pao Runtime capabilities with risk levels and schemas.",
      parameters: { type: "object", properties: {} },
      riskLevel: 0,
      handler: async () => {
        const list = svc.listCapabilities();
        return { ok: true, capabilities: list };
      },
    },
    {
      name: "pao.agent.session.create",
      description: "Create an active execution session for an agent under a permission profile (observe | guarded | trusted | operator).",
      parameters: {
        type: "object",
        properties: {
          agentKey: { type: "string", description: "Identifier of the requesting agent" },
          profile: { type: "string", enum: ["observe", "guarded", "trusted", "operator"], description: "Permission profile" },
        },
        required: ["agentKey"],
      },
      riskLevel: 0,
      handler: async (args) => {
        const agentKey = String(args.agentKey);
        const profile = args.profile as any;
        const sess = svc.createSession(agentKey, profile);
        return { ok: true, session: sess };
      },
    },
    {
      name: "pao.execution.request",
      description: "Request execution of a capability on a target resource. Managed by Policy Engine and Human Approval Gate.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active session ID" },
          capabilityName: { type: "string", description: "Capability to invoke (e.g. pao.files.read, pao.ssh.exec)" },
          resourceUri: { type: "string", description: "Target resource URI (e.g. host://vps/main, files://project/pao)" },
          input: { type: "object", description: "Execution payload" },
          dryRun: { type: "boolean", description: "Perform dry-run without mutating state" },
        },
        required: ["sessionId", "capabilityName", "input"],
      },
      riskLevel: 2,
      handler: async (args) => {
        const res = await svc.requestExecution({
          sessionId: String(args.sessionId),
          capabilityName: String(args.capabilityName),
          resourceUri: args.resourceUri ? String(args.resourceUri) : undefined,
          input: (args.input as Record<string, unknown>) || {},
          dryRun: Boolean(args.dryRun),
        });
        return { ok: true, ...res };
      },
    },
    {
      name: "pao.approval.respond",
      description: "Human operator responds to a pending approval request.",
      parameters: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "ID of the approval" },
          decision: { type: "string", enum: ["approved", "rejected"], description: "Decision" },
          by: { type: "string", description: "Human operator identity" },
          note: { type: "string", description: "Optional decision rationale" },
        },
        required: ["approvalId", "decision", "by"],
      },
      riskLevel: 2,
      handler: async (args) => {
        const app = svc.resolveApproval(String(args.approvalId), args.decision as any, String(args.by), args.note ? String(args.note) : undefined);
        return { ok: true, approval: app };
      },
    },
    {
      name: "pao.routing.routes.list",
      description: "List inspectable CC-Switch provider routes, including ordered failover candidates.",
      parameters: { type: "object", properties: {} },
      riskLevel: 0,
      handler: async () => ({ ok: true, routes: svc.listRoutes() }),
    },
  ];
}
