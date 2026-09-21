/**
 * Phase 20.87 — P2P Artifact Transfer MCP Tools
 * Exposes policy-governed data movement tools to AI agents.
 */

import { TransferOrchestrator } from "./orchestrator";
import { verifyArtifactIntegrity } from "./manifest";

export interface TransferMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createTransferMcpTools(): TransferMcpTool[] {
  const orchestrator = new TransferOrchestrator();

  return [
    {
      name: "artifact_transfer.status",
      description: "Inspect status, progress, and cryptographic verification of an artifact transfer session.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Transfer session ID" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        const session = orchestrator.getSession(String(args.sessionId));
        if (!session) return { ok: false, error: "Session not found" };
        return {
          ok: true,
          sessionId: session.sessionId,
          state: session.state,
          manifest: session.manifest,
          targets: session.targets,
          totalBytesTransferred: session.totalBytesTransferred,
          policyDecision: session.policyDecision,
        };
      },
    },
    {
      name: "artifact_transfer.create",
      description: "Create a new P2P artifact transfer session governed by trust zone policies and manifest checks.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          data: { type: "string", description: "Base64 or UTF-8 payload data" },
          sourceZone: { type: "string", enum: ["LOCAL_PRIVATE", "MANAGED_VPS", "CLOUD_GPU", "TRUSTED_PEER", "EXTERNAL_UNTRUSTED"] },
          targetNodeId: { type: "string" },
          targetZone: { type: "string", enum: ["LOCAL_PRIVATE", "MANAGED_VPS", "CLOUD_GPU", "TRUSTED_PEER", "EXTERNAL_UNTRUSTED"] },
        },
        required: ["filename", "data", "sourceZone", "targetNodeId", "targetZone"],
      },
      handler: async (args) => {
        const session = orchestrator.createSession({
          sourceNodeId: "local_node",
          sourceZone: (args.sourceZone as never) || "LOCAL_PRIVATE",
          filename: String(args.filename),
          data: String(args.data),
          targets: [
            {
              targetId: "target_1",
              peerId: `peer_${args.targetNodeId}`,
              nodeId: String(args.targetNodeId),
              zone: (args.targetZone as never) || "TRUSTED_PEER",
            },
          ],
        });

        return {
          ok: true,
          sessionId: session.sessionId,
          state: session.state,
          sha256: session.manifest.sha256,
          policyDecision: session.policyDecision,
        };
      },
    },
    {
      name: "artifact_transfer.start",
      description: "Start or resume WebRTC chunk streaming for a prepared transfer session.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        try {
          const session = await orchestrator.startTransfer(String(args.sessionId));
          return {
            ok: true,
            sessionId: session.sessionId,
            state: session.state,
            totalBytesTransferred: session.totalBytesTransferred,
          };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
    },
    {
      name: "artifact_transfer.cancel",
      description: "Cancel an ongoing or pending transfer session.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        orchestrator.cancelSession(String(args.sessionId));
        return { ok: true, sessionId: args.sessionId, state: "CANCELLED" };
      },
    },
  ];
}
