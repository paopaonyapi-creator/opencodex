// Phase 20.82 — Sensorimotor Runtime MCP Tools (CortexKit AFT contract).
//
// Exposes constrained perception and transactional action tools to agents
// using the shared handler convention. All mutations ride the transactional
// executor (checkpoint → execute → observe → rollback-on-failure); policy
// enforcement stays inside the runtime, never in the tool layer.

import type { SensorimotorService } from "./service";

export interface SensorimotorMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createSensorimotorMcpTools(service: SensorimotorService): SensorimotorMcpTool[] {
  return [
    {
      name: "pao.aft.health",
      description: "Inspect sensorimotor runtime health: policy version, active sessions, 24h action/failure counts (Phase 20.82).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ...service.health() }),
    },
    {
      name: "pao.aft.perceive",
      description: "Take a deterministic workspace snapshot (tree or symbol-aware) for a session. Read-only; never throws on unreadable paths.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          kind: { type: "string", enum: ["tree", "symbols"] },
          maxFiles: { type: "number", description: "Max files to snapshot (default 500, cap 2000)" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        const sessionId = String(args.sessionId);
        const kind = args.kind === "symbols" ? "symbols" : "tree";
        const maxFiles = typeof args.maxFiles === "number" ? args.maxFiles : undefined;
        const perception = service.perceive(sessionId, kind, maxFiles);
        return {
          ok: true,
          perceptionId: perception.perceptionId,
          sessionId: perception.sessionId,
          kind: perception.kind,
          fileCount: perception.fileCount,
          symbolCount: perception.symbolCount,
          contentHash: perception.contentHash,
        };
      },
    },
    {
      name: "pao.aft.act",
      description:
        "Execute a transactional workspace action (fs.write, fs.delete, fs.move) with automatic checkpoint, health observation, and rollback on failure. " +
        "Paths are sandbox-checked against the session workspace; policy and approval gates apply before execution.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          kind: { type: "string", enum: ["fs.write", "fs.delete", "fs.move"] },
          target: { type: "string", description: "Relative path inside the session workspace" },
          content: { type: "string", description: "New file content for fs.write" },
          destination: { type: "string", description: "Relative destination for fs.move" },
          timeoutMs: { type: "number" },
          maxAttempts: { type: "number", description: "Bounded retry attempts (default 3, cap 5)" },
        },
        required: ["sessionId", "kind", "target"],
      },
      handler: async (args) => {
        const outcome = await service.executeAction({
          sessionId: String(args.sessionId),
          kind: args.kind as "fs.write" | "fs.delete" | "fs.move",
          target: String(args.target),
          content: typeof args.content === "string" ? args.content : undefined,
          destination: typeof args.destination === "string" ? args.destination : undefined,
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
          maxAttempts: typeof args.maxAttempts === "number" ? Math.min(args.maxAttempts, 5) : undefined,
        });
        return { ok: outcome.status === "succeeded", ...outcome };
      },
    },
  ];
}
