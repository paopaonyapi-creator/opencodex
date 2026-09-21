// Phase 21.01 — Pao-hubPro × Parley Multi-Agent Work Room Test Suite.
// Tests:
// - Schema v71 & parley_* tables existence
// - Room creation & workspace binding
// - Multi-agent addressing: @codex, @claude, @both, @all, @reviewers, @builders
// - Runtime Identity Badge & Immutable Run Snapshot (never LLM self-reported)
// - 4-Level Tool Execution Policy (L0 Safe, L1 Workspace, L2 Network, L3 Dangerous)
// - Run Inspector transparency (tool calls, file diff events, commands, routing chain)
// - Multi-Agent Handoff chain (Codex builder → Claude reviewer)
// - Markdown Transcript Export
// - MCP Tools registration

import { beforeEach, describe, expect, it } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import { ParleyStore } from "../src/agent-os/parley/store";
import { ParleyRoomEngine } from "../src/agent-os/parley/room-engine";
import { createParleyMcpTools } from "../src/agent-os/parley/mcp-tools";

describe("Phase 21.01 — Parley Multi-Agent Work Room", () => {
  let store: ParleyStore;
  let engine: ParleyRoomEngine;

  beforeEach(() => {
    store = new ParleyStore();
    engine = new ParleyRoomEngine(store);
  });

  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§21)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version 71", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBe(71);
    });

    it("verifies all parley_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "parley_rooms",
        "parley_room_agents",
        "parley_messages",
        "parley_runs",
        "parley_tool_calls",
        "parley_file_events",
        "parley_command_events",
        "parley_handoffs",
      ];
      for (const t of tables) {
        const row = db.query(`SELECT count(*) as c FROM ${t}`).get() as { c: number };
        expect(row.c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Room Management & Multi-Agent Addressing (§4, §5)
  // -------------------------------------------------------------------------
  describe("Room Management & Addressing", () => {
    it("creates work room bound to workspace and adds agents with authoritative metadata", () => {
      const room = engine.createRoom({
        name: "Ninja-Shippuden-TH",
        workspacePath: "C:\\Users\\PC\\Desktop\\Ninja-Shippuden-TH",
        mode: "WORK",
        permissionProfile: "workspace-write",
      });
      expect(room.id.startsWith("room_")).toBe(true);

      const codex = engine.addAgentToRoom(room.id, {
        agentId: "codex-primary",
        displayName: "Codex",
        role: "builder",
        provider: "openai",
        actualModelId: "gpt-4o-2026-08-06",
      });
      expect(codex.actualModelId).toBe("gpt-4o-2026-08-06");

      const claude = engine.addAgentToRoom(room.id, {
        agentId: "claude-reviewer",
        displayName: "Claude",
        role: "reviewer",
        provider: "anthropic",
        actualModelId: "claude-3-5-sonnet-20241022",
      });
      expect(claude.role).toBe("reviewer");

      const agents = engine.listRoomAgents(room.id);
      expect(agents).toHaveLength(2);
    });

    it("routes explicit @mentions to targeted agents (@both, @codex, @claude, @reviewers)", () => {
      const room = engine.createRoom({
        name: "Routing Room",
        workspacePath: "/work",
      });
      engine.addAgentToRoom(room.id, {
        agentId: "codex",
        displayName: "Codex",
        role: "builder",
        provider: "openai",
        actualModelId: "gpt-4o",
      });
      engine.addAgentToRoom(room.id, {
        agentId: "claude",
        displayName: "Claude",
        role: "reviewer",
        provider: "anthropic",
        actualModelId: "claude-3-5",
      });

      // @both
      const resBoth = engine.postMessage({
        roomId: room.id,
        senderType: "user",
        senderId: "u1",
        senderDisplayName: "User",
        content: "@both please inspect this repo",
      });
      expect(resBoth.message.addressedTo).toBe("@both");
      expect(resBoth.routedAgents).toHaveLength(2);

      // @reviewers
      const resRev = engine.postMessage({
        roomId: room.id,
        senderType: "user",
        senderId: "u1",
        senderDisplayName: "User",
        content: "@reviewers review the diff",
      });
      expect(resRev.routedAgents).toHaveLength(1);
      expect(resRev.routedAgents[0].role).toBe("reviewer");

      // @codex
      const resCodex = engine.postMessage({
        roomId: room.id,
        senderType: "user",
        senderId: "u1",
        senderDisplayName: "User",
        content: "@codex implement login flow",
      });
      expect(resCodex.routedAgents).toHaveLength(1);
      expect(resCodex.routedAgents[0].agentId).toBe("codex");
    });
  });

  // -------------------------------------------------------------------------
  // 3. 4-Level Tool Execution Policy (§11)
  // -------------------------------------------------------------------------
  describe("4-Level Tool Execution Policy", () => {
    it("classifies commands accurately into L0, L1, L2, and L3", () => {
      expect(engine.classifyCommand("git status").riskLevel).toBe(0); // L0 Safe
      expect(engine.classifyCommand("npm test").riskLevel).toBe(0); // L0 Safe
      expect(engine.classifyCommand("npm run build").riskLevel).toBe(1); // L1 Workspace
      expect(engine.classifyCommand("npm install sharp").riskLevel).toBe(2); // L2 Network / Dependency
      expect(engine.classifyCommand("rm -rf / --no-preserve-root").riskLevel).toBe(3); // L3 Dangerous
    });
  });

  // -------------------------------------------------------------------------
  // 4. Run Inspector & Immutable Runtime Snapshot (§6, §7, §8, §39, §56)
  // -------------------------------------------------------------------------
  describe("Run Inspector & Runtime Snapshot", () => {
    it("captures immutable snapshot and logs timeline of tools, files, and commands", () => {
      const room = engine.createRoom({
        name: "Inspector Room",
        workspacePath: "C:\\work",
        permissionProfile: "workspace-write",
      });
      const agent = engine.addAgentToRoom(room.id, {
        agentId: "codex-1",
        displayName: "Codex",
        role: "builder",
        provider: "openai",
        actualModelId: "gpt-4o-real-runtime-id",
      });

      // Start run
      const run = engine.startRun(room.id, agent, { inputTokens: 200, estimatedCostUsd: 0.015 });
      expect(run.status).toBe("running");
      expect(run.actualModelId).toBe("gpt-4o-real-runtime-id"); // Authoritative!

      // Record tool execution
      engine.recordToolExecution(run.id, "fs.read", "read_package_json", 0, { file: "package.json" }, "package.json inspected");

      // Record file modification
      engine.recordFileEvent(run.id, "src/app.ts", "modify", "--- a/src/app.ts\n+++ b/src/app.ts\n+ console.log('fixed');");

      // Record command execution
      engine.recordCommandEvent(run.id, "npm test", "C:\\work", 0, "4 tests passed");

      // Record handoff to Claude
      engine.recordHandoff({
        roomId: room.id,
        fromRunId: run.id,
        fromAgentId: "codex-1",
        toAgentId: "claude-reviewer",
        reason: "implementation complete, request review",
      });

      // Finish run
      const completed = engine.finishRun(run.id, 250);
      expect(completed.status).toBe("completed");

      // Query Run Inspector
      const inspector = engine.getRunInspector(run.id);
      expect(inspector.run.actualModelId).toBe("gpt-4o-real-runtime-id");
      expect(inspector.toolCalls).toHaveLength(1);
      expect(inspector.fileEvents).toHaveLength(1);
      expect(inspector.commandEvents).toHaveLength(1);
      expect(inspector.handoffs).toHaveLength(1);
      expect(inspector.runtimeSnapshot.model).toBe("gpt-4o-real-runtime-id");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Transcript Export & MCP Tools Catalog (§19, §51)
  // -------------------------------------------------------------------------
  describe("Transcript Export & MCP Tools", () => {
    it("exports room conversation and run history in Markdown", () => {
      const room = engine.createRoom({ name: "Export Room", workspacePath: "/work" });
      engine.postMessage({
        roomId: room.id,
        senderType: "user",
        senderId: "u1",
        senderDisplayName: "Dev",
        content: "Please build the feature",
      });

      const md = engine.exportTranscriptMarkdown(room.id);
      expect(md).toContain("# Work Room Transcript: Export Room");
      expect(md).toContain("Please build the feature");
    });

    it("registers pao.parley.* MCP tools", () => {
      const tools = createParleyMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(5);
      const names = tools.map((t) => t.name);
      expect(names).toContain("pao.parley.rooms.list");
      expect(names).toContain("pao.parley.rooms.create");
      expect(names).toContain("pao.parley.message.send");
      expect(names).toContain("pao.parley.inspector.get");
      expect(names).toContain("pao.parley.transcript.export");
    });
  });
});
