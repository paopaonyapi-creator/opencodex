// Phase 21.01 — Parley MCP tools catalog.
// Exposes pao.parley.* tools to the central registry.

import { ParleyRoomEngine } from "./room-engine";
import { ParleyStore } from "./store";

export interface ParleyMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createParleyMcpTools(): ParleyMcpTool[] {
  const store = new ParleyStore();
  const engine = new ParleyRoomEngine(store);

  return [
    {
      name: "pao.parley.rooms.list",
      description: "List active Multi-Agent Work Rooms.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return { ok: true, rooms: engine.listRooms() };
      },
    },
    {
      name: "pao.parley.rooms.create",
      description: "Create a new Multi-Agent Work Room bound to a workspace directory.",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["name", "workspacePath"],
        properties: {
          name: { type: "string" },
          workspacePath: { type: "string" },
          mode: { type: "string", enum: ["TALK", "WORK", "REVIEW", "RESEARCH", "AUTOPILOT"] },
          permissionProfile: { type: "string", enum: ["read-only", "workspace-write", "reviewer", "admin-approved"] },
        },
      },
      handler: async (args) => {
        const room = engine.createRoom({
          name: String(args.name),
          workspacePath: String(args.workspacePath),
          mode: (args.mode as any) ?? "WORK",
          permissionProfile: (args.permissionProfile as any) ?? "workspace-write",
        });
        return { ok: true, room };
      },
    },
    {
      name: "pao.parley.message.send",
      description: "Send message to room with explicit agent addressing (@codex, @claude, @both).",
      riskTier: "R1",
      parameters: {
        type: "object",
        required: ["roomId", "content"],
        properties: {
          roomId: { type: "string" },
          content: { type: "string" },
          senderId: { type: "string" },
          senderDisplayName: { type: "string" },
        },
      },
      handler: async (args) => {
        const res = engine.postMessage({
          roomId: String(args.roomId),
          senderType: "user",
          senderId: String(args.senderId ?? "user_mcp"),
          senderDisplayName: String(args.senderDisplayName ?? "Operator"),
          content: String(args.content),
        });
        return { ok: true, ...res };
      },
    },
    {
      name: "pao.parley.inspector.get",
      description: "Retrieve comprehensive Run Inspector data (timeline, tools, files, commands, routing).",
      riskTier: "R0",
      parameters: {
        type: "object",
        required: ["runId"],
        properties: { runId: { type: "string" } },
      },
      handler: async (args) => {
        const inspector = engine.getRunInspector(String(args.runId));
        return { ok: true, inspector };
      },
    },
    {
      name: "pao.parley.transcript.export",
      description: "Export room conversation and execution timeline in Markdown format.",
      riskTier: "R0",
      parameters: {
        type: "object",
        required: ["roomId"],
        properties: { roomId: { type: "string" } },
      },
      handler: async (args) => {
        const md = engine.exportTranscriptMarkdown(String(args.roomId));
        return { ok: true, markdown: md };
      },
    },
  ];
}
