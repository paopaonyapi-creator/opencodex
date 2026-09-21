// Phase 20.99 — MCP tools definition for Whip Mobile Operations Console.
// Exposes pao.whip.* tools to the platform MCP catalog with risk tiers and approval gates.

import { WhipApprovalEngine } from "./approval-engine";
import { DevicePairingManager, OfflineCommandQueue } from "./queue-pairing";
import { SecureTransportCore } from "./transport";
import { UnifiedFleetManager } from "./fleet";
import { RemoteFileWorkspace, TerminalGateway } from "./workspace";
import { WhipStore } from "./store";
import type { WhipRiskClass } from "./types";

export interface WhipMcpTool {
  name: string;
  description: string;
  riskTier: WhipRiskClass;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createWhipMcpTools(): WhipMcpTool[] {
  const store = new WhipStore();
  const transport = new SecureTransportCore(store);
  const fleet = new UnifiedFleetManager(store);
  const terminal = new TerminalGateway(store);
  const workspace = new RemoteFileWorkspace();
  const queue = new OfflineCommandQueue(store);
  const pairing = new DevicePairingManager(store);
  const approvals = new WhipApprovalEngine(store);

  return [
    {
      name: "pao.whip.hosts.list",
      description: "List configured SSH/Tailscale host profiles and their operational statuses.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, hosts: store.listHosts() };
      },
    },
    {
      name: "pao.whip.fleet.list",
      description: "List multi-host unified agent fleet sorted by attention priority.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          hostId: { type: "string" },
          status: { type: "string" },
        },
      },
      handler: async (args) => {
        const list = fleet.listFleet({
          hostId: typeof args.hostId === "string" ? args.hostId : undefined,
          status: typeof args.status === "string" ? (args.status as any) : undefined,
        });
        return { ok: true, fleet: list, count: list.length };
      },
    },
    {
      name: "pao.whip.transcript.get",
      description: "Retrieve native agent transcript projection bound to the active session.",
      riskTier: "R0",
      parameters: {
        type: "object",
        required: ["agentId", "sessionId"],
        properties: {
          agentId: { type: "string" },
          sessionId: { type: "string" },
          runtime: { type: "string" },
        },
      },
      handler: async (args) => {
        const tr = fleet.getOrCreateTranscript(
          String(args.agentId),
          String(args.sessionId),
          typeof args.runtime === "string" ? args.runtime : undefined,
        );
        return { ok: true, transcript: tr };
      },
    },
    {
      name: "pao.whip.terminal.open",
      description: "Open an isolated remote terminal session.",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["hostId"],
        properties: {
          hostId: { type: "string" },
          agentId: { type: "string" },
          sessionId: { type: "string" },
          cwd: { type: "string" },
        },
      },
      handler: async (args) => {
        const term = terminal.openTerminal({
          hostId: String(args.hostId),
          agentId: typeof args.agentId === "string" ? args.agentId : undefined,
          sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
        });
        return { ok: true, terminal: term };
      },
    },
    {
      name: "pao.whip.pairing.create",
      description: "Create an ephemeral QR device pairing session (CLI: pao pair mobile).",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["hostHint"],
        properties: {
          hostHint: { type: "string" },
          port: { type: "number" },
          ttlMinutes: { type: "number" },
        },
      },
      handler: async (args) => {
        const res = pairing.createPairingSession(
          String(args.hostHint),
          typeof args.port === "number" ? args.port : 22,
          typeof args.ttlMinutes === "number" ? args.ttlMinutes : 5,
        );
        return { ok: true, ...res };
      },
    },
    {
      name: "pao.whip.approval.decide",
      description: "Approve or deny a policy-governed high-risk remote action.",
      riskTier: "R3",
      parameters: {
        type: "object",
        required: ["approvalId", "decision"],
        properties: {
          approvalId: { type: "string" },
          decision: { type: "string", enum: ["approved", "denied"] },
          decidedBy: { type: "string" },
          biometricVerified: { type: "boolean" },
          reason: { type: "string" },
        },
      },
      handler: async (args) => {
        const res = approvals.decideApproval({
          approvalId: String(args.approvalId),
          decision: args.decision === "approved" ? "approved" : "denied",
          decidedBy: String(args.decidedBy ?? "operator"),
          biometricVerified: args.biometricVerified === true,
          reason: typeof args.reason === "string" ? args.reason : undefined,
        });
        return { ok: true, approval: res };
      },
    },
    {
      name: "pao.whip.files.upload",
      description: "Upload a file to remote workspace using atomic temp-sibling finalization.",
      riskTier: "R2",
      parameters: {
        type: "object",
        required: ["destinationPath", "content"],
        properties: {
          destinationPath: { type: "string" },
          content: { type: "string" },
        },
      },
      handler: async (args) => {
        const res = await workspace.uploadFile(String(args.destinationPath), String(args.content));
        return { ok: true, ...res };
      },
    },
    {
      name: "pao.whip.queue.enqueue",
      description: "Enqueue an offline intent with policy recheck upon reconnect.",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["hostId", "deviceId", "semanticAction", "payload"],
        properties: {
          hostId: { type: "string" },
          deviceId: { type: "string" },
          semanticAction: { type: "string" },
          payload: { type: "object" },
          contextRevision: { type: "number" },
          riskClass: { type: "string", enum: ["R0", "R1", "R2", "R3", "R4"] },
        },
      },
      handler: async (args) => {
        const intent = queue.enqueueIntent({
          hostId: String(args.hostId),
          deviceId: String(args.deviceId),
          targetRef: (args.targetRef as any) ?? {},
          semanticAction: String(args.semanticAction),
          payload: (args.payload as any) ?? {},
          contextRevision: typeof args.contextRevision === "number" ? args.contextRevision : 1,
          riskClass: (args.riskClass as any) ?? "R1",
        });
        return { ok: true, intent };
      },
    },
  ];
}
