// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Comprehensive Test Suite

import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  getOrchestrationService,
  resetOrchestrationServiceForTests,
  runtimeRegistry,
  RuntimeRegistry,
  ModelRouter,
  McpToolProvider,
  ToolPolicyEngine,
  SafeguardMiddleware,
  CheckpointManager,
  ApprovalBridge,
  StructuredOutputValidator,
  CodexDelegationBridge,
  ReviewerCouncilBridge,
  LangChainAgentRuntime,
  NativeAgentRuntime,
  OrchestrationStore,
} from "../src/agent-os/orchestration";
import { handleOrchestrationRoutes } from "../src/server/management/orchestration-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.22 — Agent Orchestration Subsystem", () => {
  beforeEach(() => {
    resetOrchestrationServiceForTests();
  });

  // ── Database Schema v28 ──────────────────────────────────────────────
  describe("Database Schema v28", () => {
    test("schema version is at least 28", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(28);
    });

    test("all 6 orchestration tables are queryable in SQLite", () => {
      const db = openAgentOsDb();
      const tables = [
        "orchestration_runs",
        "orchestration_events",
        "orchestration_checkpoints",
        "orchestration_approvals",
        "orchestration_tool_calls",
        "orchestration_mcp_servers",
      ];
      for (const table of tables) {
        const row = db.query(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
        expect(typeof row.cnt).toBe("number");
      }
    });
  });

  // ── Runtime Registry ─────────────────────────────────────────────────
  describe("Runtime Registry & Contract", () => {
    test("registers and resolves runtimes by type", () => {
      const registry = new RuntimeRegistry();
      const native = new NativeAgentRuntime();
      registry.registerRuntime(native);

      expect(registry.hasRuntime("native")).toBe(true);
      expect(registry.getRuntime("native")).toBe(native);
      expect(registry.listRegisteredTypes()).toContain("native");
    });

    test("falls back gracefully when runtime not found", () => {
      const registry = new RuntimeRegistry();
      const native = new NativeAgentRuntime();
      registry.registerRuntime(native);

      const resolved = registry.getRuntime("langchain");
      expect(resolved.type).toBe("native");
    });
  });

  // ── Model Router ─────────────────────────────────────────────────────
  describe("Model Router & Fallback Chain", () => {
    test("resolves primary and fallback model chain", () => {
      const router = new ModelRouter("claude-3-7-sonnet", "gpt-4o-mini");
      const chain = router.resolveModelChain();
      expect(chain.primary).toBe("claude-3-7-sonnet");
      expect(chain.fallback).toBe("gpt-4o-mini");
    });

    test("calculates token and monetary cost correctly", () => {
      const router = new ModelRouter();
      const cost = router.calculateCost("claude-3-7-sonnet", 1000, 1000);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBe(0.018); // (1000/1000)*0.003 + (1000/1000)*0.015
    });

    test("invokes model and returns structured response", async () => {
      const router = new ModelRouter();
      const res = await router.invokeModel({
        model: "claude-3-7-sonnet",
        messages: [{ role: "user", content: "Hello world" }],
      });
      expect(res.modelUsed).toBe("claude-3-7-sonnet");
      expect(res.usage.inputTokens).toBeGreaterThan(0);
      expect(res.fellBack).toBe(false);
    });
  });

  // ── MCP Tool Provider ────────────────────────────────────────────────
  describe("MCP Tool Provider", () => {
    test("catalogs built-in tools with risk and trust ratings", () => {
      const mcp = new McpToolProvider();
      const tools = mcp.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(4);

      const readFile = mcp.findToolByName("read_file");
      expect(readFile).toBeDefined();
      expect(readFile?.riskLevel).toBe("R0");
      expect(readFile?.trustLevel).toBe("trusted_internal");
    });

    test("filters tools by trust level", () => {
      const mcp = new McpToolProvider();
      mcp.registerTool({
        name: "external_untrusted_tool",
        serverName: "untrusted_server",
        description: "External tool",
        parameters: {},
        riskLevel: "R3",
        trustLevel: "untrusted_external",
      });

      const approvedTools = mcp.listTools("approved_third_party");
      expect(approvedTools.some((t) => t.name === "external_untrusted_tool")).toBe(false);
    });

    test("prepares filtered tools for model dispatch", () => {
      const mcp = new McpToolProvider();
      const filtered = mcp.filterToolsForModel(["read_file", "write_file"]);
      expect(filtered.length).toBe(2);
      expect(filtered.map((t) => t.name)).toEqual(["read_file", "write_file"]);
    });
  });

  // ── Tool Policy Engine ───────────────────────────────────────────────
  describe("Tool Policy Engine", () => {
    const policy = new ToolPolicyEngine();

    test("classifies tool risks from R0 to R4 correctly", () => {
      expect(policy.classifyTool("read_file", {})).toBe("R0");
      expect(policy.classifyTool("search_web", {})).toBe("R1");
      expect(policy.classifyTool("write_file", {})).toBe("R2");
      expect(policy.classifyTool("run_shell_command", {})).toBe("R3");
      expect(policy.classifyTool("kill_process", {})).toBe("R4");
    });

    test("verifies workspace containment and blocks directory traversal", () => {
      const cwd = process.cwd();
      expect(policy.verifyWorkspaceContainment("src/index.ts", cwd).allowed).toBe(true);
      expect(policy.verifyWorkspaceContainment("../../../etc/passwd", cwd).allowed).toBe(false);
      expect(policy.verifyWorkspaceContainment(".env", cwd).allowed).toBe(false);
      expect(policy.verifyWorkspaceContainment(".ssh/id_rsa", cwd).allowed).toBe(false);
    });

    test("blocks dangerous shell commands", () => {
      const res = policy.evaluateTool({
        toolName: "run_shell_command",
        serverName: "terminal",
        args: { command: "rm -rf /" },
      });
      expect(res.decision).toBe("DENY");
      expect(res.riskLevel).toBe("R4");
    });

    test("redacts sensitive credentials and tokens", () => {
      const fakeSk3 = "sk-" + "c3".repeat(12);
      const fakeGhp3 = "ghp_" + "z3".repeat(12);
      const raw = `Tokens: ${fakeSk3} and ${fakeGhp3} and AKIA1234567890123456`;
      const redacted = policy.redactSecrets(raw);
      expect(redacted).not.toContain(fakeSk3);
      expect(redacted).not.toContain(fakeGhp3);
      expect(redacted).not.toContain("AKIA1234567890");
      expect(redacted).toContain("[REDACTED");
    });
  });

  // ── Safeguard Middleware ─────────────────────────────────────────────
  describe("Safeguard Middleware", () => {
    test("enforces model call limits", () => {
      const mw = new SafeguardMiddleware({ maxModelCalls: 2 });
      const tracker = mw.createStateTracker();
      mw.checkModelCallLimit(tracker);
      mw.checkModelCallLimit(tracker);
      expect(() => mw.checkModelCallLimit(tracker)).toThrow(/Exceeded maximum allowed model calls/);
    });

    test("enforces tool call limits", () => {
      const mw = new SafeguardMiddleware({ maxToolCalls: 2 });
      const tracker = mw.createStateTracker();
      mw.checkToolCallLimit(tracker);
      mw.checkToolCallLimit(tracker);
      expect(() => mw.checkToolCallLimit(tracker)).toThrow(/Exceeded maximum allowed tool calls/);
    });

    test("detects loop oscillation on repeated identical tool calls", () => {
      const mw = new SafeguardMiddleware({ maxConsecutiveIdenticalTools: 3 });
      const tracker = mw.createStateTracker();
      mw.recordAndCheckToolOscillation(tracker, "check_status", { id: "1" });
      mw.recordAndCheckToolOscillation(tracker, "check_status", { id: "1" });
      expect(() => {
        mw.recordAndCheckToolOscillation(tracker, "check_status", { id: "1" });
      }).toThrow(/infinite loop \/ oscillation/);
    });
  });

  // ── Checkpoint Manager ───────────────────────────────────────────────
  describe("Checkpoint Manager", () => {
    test("saves state snapshot with sha256 hash and restores it", () => {
      const store = new OrchestrationStore();
      const runId = `chk_test_${Date.now()}`;
      store.upsertRun({
        id: runId,
        runtimeType: "langchain",
        status: "running",
        prompt: "test",
        primaryModel: "claude-3-7-sonnet",
        modelCallCount: 0,
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        maxModelCalls: 25,
        maxToolCalls: 50,
        timeoutMs: 300000,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mgr = new CheckpointManager(store);
      const chk = mgr.saveStep(runId, 1, { count: 42, step: "init" });
      expect(chk.stateHash).toBeDefined();
      expect(chk.stateHash.length).toBe(64); // sha256 hex length

      const restored = mgr.restoreStep(runId, 1);
      expect(restored).not.toBeNull();
      expect(restored?.state.count).toBe(42);
    });
  });

  // ── Approval Bridge ──────────────────────────────────────────────────
  describe("Approval Bridge & Headless Safety", () => {
    test("creates pending approval and resolves it", () => {
      const store = new OrchestrationStore();
      const runId = `appr_test_${Date.now()}`;
      store.upsertRun({
        id: runId,
        runtimeType: "langchain",
        status: "running",
        prompt: "test",
        primaryModel: "claude-3-7-sonnet",
        modelCallCount: 0,
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        maxModelCalls: 25,
        maxToolCalls: 50,
        timeoutMs: 300000,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const bridge = new ApprovalBridge(store, 1000);
      const app = bridge.requestApproval(runId, "drop_table", "R4", "Drop table", { table: "temp" });
      expect(app.status).toBe("pending");

      const resolved = bridge.resolve(app.id, true, "operator", "Approved for test");
      expect(resolved.status).toBe("approved");
      expect(resolved.decidedBy).toBe("operator");
    });

    test("auto-denies on TTL expiration (headless safety)", async () => {
      const store = new OrchestrationStore();
      const runId = `appr_exp_${Date.now()}`;
      store.upsertRun({
        id: runId,
        runtimeType: "langchain",
        status: "running",
        prompt: "test",
        primaryModel: "claude-3-7-sonnet",
        modelCallCount: 0,
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        maxModelCalls: 25,
        maxToolCalls: 50,
        timeoutMs: 300000,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const bridge = new ApprovalBridge(store, 50); // 50ms TTL
      const app = bridge.requestApproval(runId, "deploy", "R3", "Deploy to prod", {});
      await new Promise((r) => setTimeout(r, 60));

      const expired = bridge.checkPendingExpirations();
      expect(expired.some((a) => a.id === app.id)).toBe(true);

      const after = store.getApproval(app.id);
      expect(after?.status).toBe("timed_out");
    });
  });

  // ── Structured Output Validator ──────────────────────────────────────
  describe("Structured Output Validator", () => {
    test("extracts JSON from plain text, markdown blocks, and raw brackets", () => {
      const validator = new StructuredOutputValidator();

      // Plain JSON
      const res1 = validator.parseJsonFromText('{"status": "ok"}');
      expect(res1.found).toBe(true);

      // Markdown code block
      const res2 = validator.parseJsonFromText('Here is the data:\n```json\n{"score": 98}\n```\nDone.');
      expect(res2.found).toBe(true);

      // Embedded JSON
      const res3 = validator.parseJsonFromText('Result is {"valid": true} as evaluated.');
      expect(res3.found).toBe(true);
    });

    test("validates parsed payload with Zod schema", () => {
      const validator = new StructuredOutputValidator();
      const schema = z.object({
        task: z.string(),
        completed: z.boolean(),
      });

      const valid = validator.validateWithZod(schema, { task: "deploy", completed: true });
      expect(valid.success).toBe(true);

      const invalid = validator.validateWithZod(schema, { task: 123 });
      expect(invalid.success).toBe(false);
    });
  });

  // ── Reviewer Council & Codex Delegation ──────────────────────────────
  describe("Reviewer Council & Codex Delegation", () => {
    test("Reviewer Council bridge evaluates safe vs destructive action", async () => {
      const council = new ReviewerCouncilBridge();
      const safeVerdict = await council.evaluateAction({
        toolName: "read_file",
        args: { path: "package.json" },
        riskLevel: "R0",
        reason: "Harmless read",
      });
      expect(safeVerdict.approved).toBe(true);
      expect(safeVerdict.verdict).toBe("APPROVED");

      const destructiveVerdict = await council.evaluateAction({
        toolName: "drop_database",
        args: { action: "drop all" },
        riskLevel: "R4",
        reason: "Destructive",
      });
      expect(destructiveVerdict.approved).toBe(false);
      expect(destructiveVerdict.verdict).toBe("REJECTED");
    });

    test("Codex delegation bridge is callable", () => {
      const codex = new CodexDelegationBridge();
      expect(typeof codex.delegateCodingTask).toBe("function");
    });
  });

  // ── LangChain Agent Runtime ──────────────────────────────────────────
  describe("LangChain Agent Runtime", () => {
    test("executes end-to-end run and produces completed status", async () => {
      const runtime = new LangChainAgentRuntime();
      const run = await runtime.run("Inspect code quality and report summary");
      expect(run.status).toBe("completed");
      expect(run.outputText).toBeDefined();
      expect(run.modelCallCount).toBeGreaterThanOrEqual(1);
    });

    test("cancels a running task properly", async () => {
      const store = new OrchestrationStore();
      const runId = `cancel_test_${Date.now()}`;
      store.upsertRun({
        id: runId,
        runtimeType: "langchain",
        status: "running",
        prompt: "test cancel",
        primaryModel: "claude-3-7-sonnet",
        modelCallCount: 0,
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        maxModelCalls: 25,
        maxToolCalls: 50,
        timeoutMs: 300000,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const runtime = new LangChainAgentRuntime({ store });
      const cancelled = await runtime.cancel(runId, "User requested cancel");
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.errorText).toBe("User requested cancel");
    });

    test("pauses on tool approval required and resumes on approval", async () => {
      const store = new OrchestrationStore();
      const runtime = new LangChainAgentRuntime({ store });

      // Run with prompt that requests execution tool
      const run = await runtime.run("Please execute command npm test");
      expect(run.status).toBe("waiting_approval");

      const pending = store.listApprovals("pending");
      const app = pending.find((a) => a.runId === run.id);
      expect(app).toBeDefined();

      const resumed = await runtime.resume(run.id, {
        approvalId: app!.id,
        approved: true,
        reason: "Test approved",
      });
      expect(resumed.status).toBe("completed");
    });
  });

  // ── Native Agent Runtime ─────────────────────────────────────────────
  describe("Native Agent Runtime", () => {
    test("executes lightweight zero-dependency run", async () => {
      const native = new NativeAgentRuntime();
      const run = await native.run("Quick native task");
      expect(run.status).toBe("completed");
      expect(run.runtimeType).toBe("native");
      expect(run.outputText).toContain("[Native Runtime]");
    });
  });

  // ── Central Orchestration Service ────────────────────────────────────
  describe("Orchestration Service Facade", () => {
    test("reports comprehensive status summary", async () => {
      const service = getOrchestrationService();
      const status = await service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.activeRuntimeType).toBe("langchain");
      expect(status.registeredRuntimes).toContain("langchain");
      expect(status.registeredRuntimes).toContain("native");
    });

    test("respects rollback toggle PAO_LANGCHAIN_ENABLED=0", () => {
      const original = process.env.PAO_LANGCHAIN_ENABLED;
      try {
        process.env.PAO_LANGCHAIN_ENABLED = "0";
        const service = getOrchestrationService();
        expect(service.isLangchainEnabled()).toBe(false);
        expect(service.getActiveRuntimeType()).toBe("native");
      } finally {
        if (original === undefined) {
          delete process.env.PAO_LANGCHAIN_ENABLED;
        } else {
          process.env.PAO_LANGCHAIN_ENABLED = original;
        }
      }
    });
  });

  // ── Management REST API Routes ───────────────────────────────────────
  describe("Management REST API Handlers", () => {
    const makeCtx = (method: string, path: string, body?: unknown): ManagementContext => {
      const url = new URL(`http://localhost:4040${path}`);
      const req = new Request(url.toString(), {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        url,
        req,
        clientIp: "127.0.0.1",
        bodyPromise: body ? Promise.resolve(body) : undefined,
      };
    };

    test("GET /api/agent-os/orchestration/status returns status", async () => {
      const ctx = makeCtx("GET", "/api/agent-os/orchestration/status");
      const res = await handleOrchestrationRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(json.status.enabled).toBe(true);
    });

    test("GET /api/agent-os/orchestration/runs returns list of runs", async () => {
      const ctx = makeCtx("GET", "/api/agent-os/orchestration/runs");
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(Array.isArray(json.runs)).toBe(true);
    });

    test("POST /api/agent-os/orchestration/runs starts new run", async () => {
      const ctx = makeCtx("POST", "/api/agent-os/orchestration/runs", {
        prompt: "Analyze repository dependencies",
      });
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(json.run.status).toBe("completed");
    });

    test("GET /api/agent-os/orchestration/approvals returns approvals", async () => {
      const ctx = makeCtx("GET", "/api/agent-os/orchestration/approvals");
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(Array.isArray(json.approvals)).toBe(true);
    });

    test("GET /api/agent-os/orchestration/mcp/servers returns servers", async () => {
      const ctx = makeCtx("GET", "/api/agent-os/orchestration/mcp/servers");
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(Array.isArray(json.servers)).toBe(true);
      expect(json.servers.length).toBeGreaterThan(0);
    });

    test("POST /api/agent-os/orchestration/mcp/servers registers new server", async () => {
      const ctx = makeCtx("POST", "/api/agent-os/orchestration/mcp/servers", {
        serverName: "test_mcp_server",
        trustLevel: "approved_third_party",
        endpointOrCommand: "npx -y test-server",
      });
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(json.result).toBe("ok");
    });

    test("GET /api/agent-os/orchestration/policies returns policy rules", async () => {
      const ctx = makeCtx("GET", "/api/agent-os/orchestration/policies");
      const res = await handleOrchestrationRoutes(ctx);
      expect(res?.status).toBe(200);
      const json = await res?.json();
      expect(json.policies.r0).toBeDefined();
      expect(json.policies.r4).toBeDefined();
    });
  });
});
