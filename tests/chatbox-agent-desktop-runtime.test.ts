// Phase 20.9: Pao-hubPro x Chatbox Agent Desktop Runtime Test Suite
// Verifies Schema v15, 4 Agent Modes, Tool Registry & Namespacing, Risk Classification,
// Path Traversal Guard, Secret Redactor, Safe Sandbox, Pre-spawn MCP Security Gateway,
// AGENTS.md Hierarchy, Progressive Skills Disclosure, AI Reviewer Council & Approvals,
// Agent Runtime State Machine & Cancellation, and Management REST API Endpoints.

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  AgentModeManager,
  ModelCapabilityRegistry,
  ProviderRegistry,
  OllamaProvider,
  ToolRegistry,
  ToolRiskClassifier,
  PathGuard,
  SecretRedactor,
  SafeSandbox,
  MCPSecurityGateway,
  MCPManager,
  PolicyEngine,
  AgentsMarkdownResolver,
  SkillsRuntime,
  ReviewerCouncilBridge,
  ApprovalGateway,
  AuditLogger,
  AgentRuntime,
} from "../src/agent-os/desktop-runtime";
import { handleDesktopAgentRoutes } from "../src/server/management/desktop-agent-routes";
import type { ManagementContext } from "../src/server/management/context";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

function cleanDb() {
  const db = openAgentOsDb();
  db.run("DELETE FROM desktop_agent_events");
  db.run("DELETE FROM desktop_agent_tool_calls");
  db.run("DELETE FROM desktop_agent_approvals");
  db.run("DELETE FROM desktop_agent_runs");
  db.run("DELETE FROM desktop_agent_mcp_servers");
  db.run("DELETE FROM desktop_agent_skills");
  db.run("DELETE FROM desktop_agent_provider_configs");
  db.run("DELETE FROM desktop_agent_policies");
}

function mockCtx(urlPath: string, method = "GET", body?: unknown, headers?: Record<string, string>): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${urlPath}`);
  const req = new Request(url.toString(), {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: { role: "admin", isLoopback: true } as never, deps: {} as never };
}

describe("Phase 20.9: Pao-hubPro x Chatbox Agent Desktop Runtime", () => {
  beforeEach(() => {
    cleanDb();
  });

  // --------------------------------------------------------------------------
  // 1. Database Schema v15
  // --------------------------------------------------------------------------
  describe("1. Database Schema v15", () => {
    it("verifies AGENT_OS_SCHEMA_VERSION is at least 15", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(15);
    });

    it("verifies all 8 Phase 20.9 tables exist and can be queried", () => {
      const db = openAgentOsDb();
      const tables = [
        "desktop_agent_runs",
        "desktop_agent_events",
        "desktop_agent_tool_calls",
        "desktop_agent_approvals",
        "desktop_agent_mcp_servers",
        "desktop_agent_skills",
        "desktop_agent_provider_configs",
        "desktop_agent_policies",
      ];

      for (const table of tables) {
        const count = db.query(`SELECT count(*) as c FROM ${table}`).get() as { c: number };
        expect(count.c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Agent Mode Manager & Permission Evaluation
  // --------------------------------------------------------------------------
  describe("2. Agent Mode Manager & Permission Evaluation", () => {
    it("evaluates permissions correctly across all 4 modes", () => {
      const modeManager = new AgentModeManager();

      // Mode OFF: blocks all actions
      modeManager.setMode("off");
      expect(modeManager.getMode()).toBe("off");
      expect(modeManager.evaluatePermission("off", "read_only").allowed).toBe(false);
      expect(modeManager.evaluatePermission("off", "medium").allowed).toBe(false);

      // Mode ASK: read_only allowed, all other tiers require human approval
      modeManager.setMode("ask");
      expect(modeManager.evaluatePermission("ask", "read_only").allowed).toBe(true);
      expect(modeManager.evaluatePermission("ask", "read_only").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("ask", "low").requiresApproval).toBe(true);
      expect(modeManager.evaluatePermission("ask", "medium").requiresApproval).toBe(true);
      expect(modeManager.evaluatePermission("ask", "critical").requiresApproval).toBe(true);

      // Mode SAFE_AUTO: read_only and low auto-approved, medium/high/critical require approval
      modeManager.setMode("safe_auto");
      expect(modeManager.evaluatePermission("safe_auto", "read_only").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("safe_auto", "low").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("safe_auto", "medium").requiresApproval).toBe(true);
      expect(modeManager.evaluatePermission("safe_auto", "high").requiresApproval).toBe(true);
      expect(modeManager.evaluatePermission("safe_auto", "critical").requiresApproval).toBe(true);

      // Mode FULL_AUTO: read_only, low, medium, high auto-approved; CRITICAL ALWAYS requires approval
      modeManager.setMode("full_auto");
      expect(modeManager.evaluatePermission("full_auto", "read_only").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("full_auto", "low").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("full_auto", "medium").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("full_auto", "high").requiresApproval).toBe(false);
      expect(modeManager.evaluatePermission("full_auto", "critical").requiresApproval).toBe(true);
    });

    it("supports session approval for medium risk, but strictly forbids it for critical risk", () => {
      const modeManager = new AgentModeManager();
      modeManager.setMode("ask");

      // Before approval
      expect(modeManager.evaluatePermission("ask", "medium", "builtin__fs_write").requiresApproval).toBe(true);

      // Grant session approval for medium risk
      const granted = modeManager.grantSessionApproval("builtin__fs_write", "medium");
      expect(granted).toBe(true);
      expect(modeManager.hasSessionApproval("builtin__fs_write")).toBe(true);
      expect(modeManager.evaluatePermission("ask", "medium", "builtin__fs_write").requiresApproval).toBe(false);

      // Attempting session approval for critical risk returns false and fails to bypass approval
      const critGranted = modeManager.grantSessionApproval("builtin__shell_exec", "critical");
      expect(critGranted).toBe(false);
      expect(modeManager.evaluatePermission("ask", "critical", "builtin__shell_exec").requiresApproval).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Model Capabilities & Provider Registry
  // --------------------------------------------------------------------------
  describe("3. Model Capabilities & Provider Registry", () => {
    it("correctly resolves model capabilities by model family heuristics", () => {
      const registry = new ModelCapabilityRegistry();

      const gpt4o = registry.resolveCapabilities("gpt-4o", "openai");
      expect(gpt4o.tools).toBe(true);
      expect(gpt4o.vision).toBe(true);
      expect(gpt4o.structuredOutput).toBe(true);
      expect(gpt4o.reasoning).toBe(false);

      const o3Mini = registry.resolveCapabilities("o3-mini", "openai");
      expect(o3Mini.reasoning).toBe(true);

      const claude35 = registry.resolveCapabilities("claude-3-5-sonnet-20241022", "anthropic");
      expect(claude35.tools).toBe(true);
      expect(claude35.vision).toBe(true);

      const deepseekR1 = registry.resolveCapabilities("deepseek-reasoner", "deepseek");
      expect(deepseekR1.reasoning).toBe(true);
    });

    it("allows registering, querying, and managing provider configurations", () => {
      const providerReg = new ProviderRegistry();

      providerReg.registerProvider(new OllamaProvider("http://127.0.0.1:11434"));

      const providers = providerReg.listProviders();
      expect(providers.length).toBeGreaterThanOrEqual(1);
      const ollama = providerReg.getProvider("ollama");
      expect(ollama).toBeDefined();
      expect(ollama?.name).toContain("Ollama");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Tool Registry, Namespacing & Risk Classifier
  // --------------------------------------------------------------------------
  describe("4. Tool Registry, Namespacing & Risk Classifier", () => {
    it("enforces tool isolation namespacing and risk classification", () => {
      const classifier = new ToolRiskClassifier();

      expect(classifier.classify("builtin__read_file", { path: "foo.txt" })).toBe("read_only");
      expect(classifier.classify("builtin__list_dir", { path: "src" })).toBe("read_only");
      expect(classifier.classify("builtin__write_file", { path: "foo.txt" })).toBe("medium");
      expect(classifier.classify("builtin__delete_file", { path: "foo.txt" })).toBe("high");

      // Shell execution risk scaling based on command pattern
      expect(classifier.classify("builtin__run_test")).toBe("low");
      expect(classifier.classify("builtin__shell_exec", { command: "rm -rf /" })).toBe("critical");
      expect(classifier.classify("builtin__shell_exec", { command: "format c:" })).toBe("critical");
      expect(classifier.classify("builtin__shell_exec", { command: "git push --force" })).toBe("critical");
    });

    it("registers built-in tools with correct namespaces and filters visible tools", () => {
      const registry = new ToolRegistry();
      const allTools = registry.listTools();

      // Check standard 7 built-ins
      const names = allTools.map((t) => t.id);
      expect(names).toContain("builtin__read_file");
      expect(names).toContain("builtin__write_file");
      expect(names).toContain("builtin__search_workspace");
      expect(names).toContain("builtin__list_dir");
      expect(names).toContain("builtin__run_lint");
      expect(names).toContain("builtin__run_typecheck");
      expect(names).toContain("builtin__run_test");

      // In safe_auto, tools are listed
      const visible = registry.getVisibleTools("safe_auto");
      expect(visible.length).toBeGreaterThanOrEqual(7);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Path Traversal Guard, Secret Redactor & Safe Sandbox
  // --------------------------------------------------------------------------
  describe("5. Path Traversal Guard, Secret Redactor & Safe Sandbox", () => {
    it("PathGuard strictly prevents directory traversal attacks and UNC access", () => {
      const tmpDir = os.tmpdir();
      const workspace = path.join(tmpDir, "ocx-test-workspace");
      if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

      const guard = new PathGuard([workspace]);

      // Valid path within workspace
      const validPath = path.join(workspace, "sub", "test.txt");
      expect(guard.validatePath(validPath).valid).toBe(true);

      // Traversal attempt
      const traversalPath = path.join(workspace, "..", "..", "etc", "passwd");
      expect(guard.validatePath(traversalPath).valid).toBe(false);

      // UNC path attempt
      expect(guard.validatePath("\\\\attacker-smb\\share\\exploit.bat").valid).toBe(false);

      // Non-allowed absolute path
      const outsidePath = process.platform === "win32" ? "C:\\Windows\\System32\\calc.exe" : "/etc/shadow";
      expect(guard.validatePath(outsidePath).valid).toBe(false);
    });

    it("SecretRedactor masks credentials and API tokens in strings and JSON", () => {
      const redactor = new SecretRedactor();

      const testAntKey = ["sk-ant-api03", "abcdef1234567890abcdef"].join("-");
      const testJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const testBearer = ["Bearer", testJwt].join(" ");
      const testGhToken = ["ghp", "1234567890abcdefghijklmnopqrstuvwxyz"].join("_");

      const raw = `Here is my key: ${testAntKey} and ${testBearer}`;
      const result = redactor.redact(raw);

      expect(result.redacted).not.toContain(testAntKey);
      expect(result.redacted).not.toContain(testJwt);
      expect(result.redacted).toContain("[REDACTED:ANTHROPIC_KEY]");
      expect(result.redacted).toContain("Bearer [REDACTED:TOKEN]");

      // Object redaction
      const obj = {
        name: "Test",
        token: testGhToken,
        nested: { password: "secret_password_123" },
      };
      const redactedObj = redactor.redactJson(obj);
      expect(redactedObj.token).toContain("[REDACTED");
      expect(redactedObj.nested.password).toContain("[REDACTED");
    });

    it("SafeSandbox executes commands with timeout and output limits", async () => {
      const sandbox = new SafeSandbox();
      const session = await sandbox.createSession({ workspaceRoot: process.cwd() });
      const isWin = process.platform === "win32";
      const result = await sandbox.exec(session.id, {
        command: isWin ? "cmd.exe" : "echo",
        args: isWin ? ["/c", "echo Hello Safe Sandbox"] : ["Hello Safe Sandbox"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello Safe Sandbox");
      expect(result.timedOut).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Pre-spawn MCP Security Gateway & MCP Manager
  // --------------------------------------------------------------------------
  describe("6. Pre-spawn MCP Security Gateway & MCP Manager", () => {
    it("validates binary allowlist and rejects disallowed executables before spawn", () => {
      const gateway = new MCPSecurityGateway();

      // Allowed executables
      expect(gateway.validateConfig({ id: "1", name: "valid-node", transport: "stdio", command: "node", args: ["server.js"] }).allowed).toBe(true);
      expect(gateway.validateConfig({ id: "2", name: "valid-bun", transport: "stdio", command: "bun", args: ["run", "index.ts"] }).allowed).toBe(true);
      expect(gateway.validateConfig({ id: "3", name: "valid-python", transport: "stdio", command: "python", args: ["main.py"] }).allowed).toBe(true);
      expect(gateway.validateConfig({ id: "4", name: "valid-npx", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] }).allowed).toBe(true);

      // Disallowed dangerous binaries
      expect(gateway.validateConfig({ id: "5", name: "bad-bash", transport: "stdio", command: "bash", args: ["-c", "rm -rf /"] }).allowed).toBe(false);
      expect(gateway.validateConfig({ id: "6", name: "bad-sh", transport: "stdio", command: "sh", args: ["exploit.sh"] }).allowed).toBe(false);
      expect(gateway.validateConfig({ id: "7", name: "bad-rm", transport: "stdio", command: "rm", args: ["-rf", "*"] }).allowed).toBe(false);
      expect(gateway.validateConfig({ id: "8", name: "bad-powershell", transport: "stdio", command: "powershell.exe", args: ["-Command", "ls"] }).allowed).toBe(false);

      // Dangerous flags on allowed binaries (e.g., node -e)
      expect(gateway.validateConfig({ id: "9", name: "bad-eval", transport: "stdio", command: "node", args: ["-e", "process.exit()"] }).allowed).toBe(false);
    });

    it("persists MCP servers and checks status", async () => {
      const mcpManager = new MCPManager();

      const created = await mcpManager.registerServer({
        id: "mcp-test-1",
        name: "Test Echo Server",
        transport: "stdio",
        command: "node",
        args: ["./echo.js"],
        trustLevel: "untrusted",
        enabled: true,
      });

      expect(created.success).toBe(true);

      const list = mcpManager.listServers();
      expect(list.some((s) => s.id === "mcp-test-1")).toBe(true);

      const health = await mcpManager.checkHealth("mcp-test-1");
      expect(health.status).toBeDefined();

      mcpManager.deleteServer("mcp-test-1");
      expect(mcpManager.getServer("mcp-test-1")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Policy Engine & Hierarchical AGENTS.md Resolver
  // --------------------------------------------------------------------------
  describe("7. Policy Engine & Hierarchical AGENTS.md Resolver", () => {
    it("PolicyEngine enforces hard boundaries over user or model preference", () => {
      const engine = new PolicyEngine({
        allowedRoots: [process.cwd()],
        gitPolicy: { allowPush: false, allowForcePush: false },
      });

      // Allowed read inside workspace
      expect(engine.evaluateAction({ actionType: "builtin__read_file", targetPath: path.join(process.cwd(), "package.json") }).allowed).toBe(true);

      // Disallowed traversal
      expect(engine.evaluateAction({ actionType: "builtin__read_file", targetPath: "../../../../etc/shadow" }).allowed).toBe(false);

      // Git push blocked by policy
      expect(engine.evaluateAction({ actionType: "builtin__shell_exec", command: "git push origin main" }).allowed).toBe(false);
      expect(engine.evaluateAction({ actionType: "builtin__shell_exec", command: "git push --force" }).allowed).toBe(false);
    });

    it("AgentsMarkdownResolver resolves hierarchical instructions without Lab leakage", () => {
      const resolver = new AgentsMarkdownResolver();
      const resolved = resolver.resolveHierarchy(process.cwd());

      expect(resolved.rootInstruction).toBeDefined();
      expect(resolved.combinedInstructionText).toContain("opencodex");
      // Must not leak Lab code or violating pathways
      expect(resolved.combinedInstructionText).not.toContain("CompatibilityLabCoreViolation");
    });
  });

  // --------------------------------------------------------------------------
  // 8. Progressive Skills Runtime
  // --------------------------------------------------------------------------
  describe("8. Progressive Skills Runtime", () => {
    it("provides stage 1 lightweight descriptors and stage 2 on-demand instructions with security disclaimers", async () => {
      const skills = new SkillsRuntime();

      // Stage 1: Minimal descriptors
      const stage1 = skills.getStage1Descriptors();
      expect(stage1.length).toBeGreaterThan(0);
      const first = stage1[0];
      expect(first.name).toBeDefined();
      expect(first.description).toBeDefined();

      // Stage 2: On-demand instruction loading
      const body = await skills.loadSkillBody(first.name);
      expect(body).toBeDefined();
      expect(body).toContain("NOTICE: Skill instructions are advisory only");
    });
  });

  // --------------------------------------------------------------------------
  // 9. Reviewer Council Bridge & Approval Gateway
  // --------------------------------------------------------------------------
  describe("9. Reviewer Council Bridge & Approval Gateway", () => {
    it("ReviewerCouncil evaluates safety consensus for high/critical tool proposals", async () => {
      const council = new ReviewerCouncilBridge();

      const safeVerdict = await council.evaluate({
        runId: "run-safe",
        model: "gpt-4o",
        toolName: "builtin__fs_read",
        risk: "read_only",
        arguments: { path: "src/index.ts" },
      });
      expect(safeVerdict.decision).toBe("approve");

      const dangerousVerdict = await council.evaluate({
        runId: "run-crit",
        model: "gpt-4o",
        toolName: "builtin__shell_exec",
        risk: "critical",
        arguments: { command: "rm -rf / --no-preserve-root" },
      });
      expect(dangerousVerdict.decision).toBe("human_review");
    });

    it("ApprovalGateway creates approval cards, handles approval, and blocks critical session-approvals", () => {
      const gateway = new ApprovalGateway();

      const card = gateway.requestApproval({
        runId: "run-test-123",
        toolCall: {
          id: "tc-1",
          toolId: "builtin__fs_write",
          name: "fs_write",
          namespace: "builtin",
          risk: "medium",
          arguments: { path: "out.txt", content: "data" },
        },
        model: "gpt-4o",
      });

      expect(card.id).toBeDefined();

      // Approve once
      const result = gateway.decide(card.id, "approve_once");
      expect(result.decision).toBe("approve_once");

      // Critical action cannot be session approved
      const critCard = gateway.requestApproval({
        runId: "run-test-123",
        toolCall: {
          id: "tc-2",
          toolId: "builtin__shell_exec",
          name: "shell_exec",
          namespace: "builtin",
          risk: "critical",
          arguments: { command: "sudo reboot" },
        },
        model: "gpt-4o",
      });

      expect(() => {
        gateway.decide(critCard.id, "approve_session");
      }).toThrow(/Critical risk actions cannot be approved for entire session/i);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Agent Runtime Orchestrator Lifecycle & Execution
  // --------------------------------------------------------------------------
  describe("10. Agent Runtime Orchestrator Lifecycle & Execution", () => {
    it("runs mission through state machine and logs audit events", async () => {
      const runtime = new AgentRuntime();

      const run = await runtime.runMission({
        mission: "Read package.json and summarize configuration",
        agentMode: "safe_auto",
        maxSteps: 2,
      });

      expect(run.id).toBeDefined();
      expect(run.status).toBe("COMPLETED");

      const fetched = runtime.getRun(run.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(run.id);

      const runs = runtime.listRuns(5);
      expect(runs.some((r) => r.id === run.id)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 11. Management REST API Endpoints
  // --------------------------------------------------------------------------
  describe("11. Management REST API Endpoints (/api/desktop-agent/*)", () => {
    it("serves /api/desktop-agent/status", async () => {
      const res = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/status"));
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(data.activeMode).toBeDefined();
      expect(data.version).toBe("20.9.0");
    });

    it("serves /api/desktop-agent/modes (GET and POST)", async () => {
      // GET
      const getRes = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/modes"));
      expect(getRes?.status).toBe(200);
      const getData = await getRes?.json();
      expect(getData.availableModes).toContain("safe_auto");

      // POST
      const postRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/modes", "POST", { mode: "safe_auto" })
      );
      expect(postRes?.status).toBe(200);
      const postData = await postRes?.json();
      expect(postData.activeMode).toBe("safe_auto");
    });

    it("serves /api/desktop-agent/tools", async () => {
      const res = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/tools"));
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.some((t: { id: string }) => t.id === "builtin__read_file")).toBe(true);
    });

    it("serves /api/desktop-agent/skills", async () => {
      const res = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/skills"));
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(Array.isArray(data.skills)).toBe(true);
    });

    it("serves /api/desktop-agent/policies (GET and POST)", async () => {
      // GET
      const getRes = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/policies"));
      expect(getRes?.status).toBe(200);
      const getData = await getRes?.json();
      expect(getData.policy).toBeDefined();

      // POST
      const postRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/policies", "POST", {
          allowedRoots: [process.cwd()],
          gitPolicy: { allowPush: false, allowForcePush: false },
        })
      );
      expect(postRes?.status).toBe(200);
    });

    it("serves /api/desktop-agent/mcp/servers CRUD", async () => {
      // Create
      const postRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/mcp/servers", "POST", {
          name: "REST MCP Test",
          transport: "stdio",
          command: "node",
          args: ["./test-server.js"],
          trustLevel: "trusted",
        })
      );
      expect(postRes?.status).toBe(201);
      const postData = await postRes?.json();
      const serverId = postData.server.id;

      // List
      const listRes = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/mcp/servers"));
      expect(listRes?.status).toBe(200);
      const listData = await listRes?.json();
      expect(listData.servers.some((s: { id: string }) => s.id === serverId)).toBe(true);

      // Delete
      const delRes = await handleDesktopAgentRoutes(
        mockCtx(`/api/desktop-agent/mcp/servers/${serverId}`, "DELETE")
      );
      expect(delRes?.status).toBe(200);
    });

    it("serves /api/desktop-agent/runs lifecycle via API", async () => {
      // Create run
      const postRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/runs", "POST", {
          mission: "Test run via REST API",
          mode: "safe_auto",
        })
      );
      expect(postRes?.status).toBe(200);
      const postData = await postRes?.json();
      const runId = postData.run.id;

      // Get run
      const getRes = await handleDesktopAgentRoutes(mockCtx(`/api/desktop-agent/runs/${runId}`));
      expect(getRes?.status).toBe(200);
      const getData = await getRes?.json();
      expect(getData.run.id).toBe(runId);

      // Cancel run
      const cancelRes = await handleDesktopAgentRoutes(
        mockCtx(`/api/desktop-agent/runs/${runId}/cancel`, "POST", { reason: "REST cancel" })
      );
      expect(cancelRes?.status).toBe(200);
    });

    it("serves /api/desktop-agent/governance/* endpoints", async () => {
      // 1. GET governance status
      const statusRes = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/governance/status"));
      expect(statusRes?.status).toBe(200);
      const statusData = await statusRes?.json();
      expect(statusData.success).toBe(true);
      expect(statusData.config).toBeDefined();

      // 2. POST evaluate task
      const evalRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/governance/evaluate", "POST", {
          taskPrompt: "Fix typo in status badge",
          subagentType: "bugfix",
        })
      );
      expect(evalRes?.status).toBe(200);
      const evalData = await evalRes?.json();
      expect(evalData.success).toBe(true);
      expect(evalData.decision).toBeDefined();
      expect(evalData.decision.taskType).toBe("bugfix");

      // 3. POST evaluate dependency
      const depRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/governance/dependency", "POST", {
          packageName: "chalk",
          justification: "Want colors in terminal output",
        })
      );
      expect(depRes?.status).toBe(200);
      const depData = await depRes?.json();
      expect(depData.success).toBe(true);
      expect(depData.decision.allowed).toBe(false);

      // 4. GET & POST debt
      const postDebtRes = await handleDesktopAgentRoutes(
        mockCtx("/api/desktop-agent/governance/debt", "POST", {
          area: "testing",
          shortcut: "Temporary utility function",
          reason: "Rapid prototype shortcut",
          risk: "low",
          owner: "test-agent",
        })
      );
      expect(postDebtRes?.status).toBe(201);
      const postDebtData = await postDebtRes?.json();
      expect(postDebtData.success).toBe(true);
      expect(postDebtData.debt.id).toBeDefined();

      const getDebtRes = await handleDesktopAgentRoutes(mockCtx("/api/desktop-agent/governance/debt"));
      expect(getDebtRes?.status).toBe(200);
      const getDebtData = await getDebtRes?.json();
      expect(getDebtData.success).toBe(true);
      expect(Array.isArray(getDebtData.debts)).toBe(true);
      expect(getDebtData.debts.some((d: any) => d.id === postDebtData.debt.id)).toBe(true);
    });
  });
});

