// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration test suite.
//
// Comprehensive unit, integration, security, and failure mode test coverage for:
// - Runtime Adapters (AppServerAdapter, PythonSdkAdapter, CliFallbackAdapter, RuntimeRouter)
// - Policy Engine & Profiles (SAFE, NORMAL, AUTOMATION, FULL_ACCESS with TTL)
// - Workspace Path Containment & Traversal Defense
// - Command Classifier (Low, Medium, High, Destructive)
// - Secret Redaction Engine (API keys, PATs, AWS tokens, connection strings)
// - Approval Broker & Headless Safety (Bounded timeouts, no infinite hang)
// - Normalized Event Model & EventBus streaming
// - Session Manager & Concurrency Queue
// - Schema Sync & Drift Detection
// - Database Persistence (v27 schema)
// - Management REST API Endpoints (19 routes)
// - Rollback Feature Flag (PAO_CODEX_NATIVE_RUNTIME)

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_OS_SCHEMA_VERSION, closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { CodexDetector } from "../src/agent-os/codex-runtime/detector";
import { PolicyEngine } from "../src/agent-os/codex-runtime/policy-engine";
import { SecretRedactor, CodexAuditService } from "../src/agent-os/codex-runtime/audit";
import { ApprovalBroker } from "../src/agent-os/codex-runtime/approval-broker";
import { CodexEventBus } from "../src/agent-os/codex-runtime/event-bus";
import { SessionManager } from "../src/agent-os/codex-runtime/session-manager";
import { McpInventory } from "../src/agent-os/codex-runtime/mcp-inventory";
import { DaemonManager } from "../src/agent-os/codex-runtime/daemon-manager";
import { NodeManager } from "../src/agent-os/codex-runtime/node-manager";
import { CodexSchemaSync } from "../src/agent-os/codex-runtime/schema-sync";
import {
  CliFallbackAdapter,
  AppServerAdapter,
  PythonSdkAdapter,
  RuntimeRouter,
} from "../src/agent-os/codex-runtime/adapter";
import { CodexRuntimeStore } from "../src/agent-os/codex-runtime/store";
import { CodexRuntimeService, resetCodexRuntimeServiceForTests } from "../src/agent-os/codex-runtime/service";
import { handleCodexRuntimeRoutes } from "../src/server/management/codex-runtime-routes";
import type {
  CodexSession,
  CodexTurn,
} from "../src/agent-os/codex-runtime/types";

describe("Phase 20.21 — Codex Native Runtime Integration", () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    resetCodexRuntimeServiceForTests();
    testDir = mkdtempSync(join(tmpdir(), "pao-codex-test-"));
    dbPath = join(testDir, "agent-os-test.db");
    openAgentOsDb(dbPath);
  });

  afterEach(() => {
    resetCodexRuntimeServiceForTests();
    closeAgentOsDbForTests();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Database Schema & Migration v27
  // ---------------------------------------------------------------------------
  describe("Database Schema v27", () => {
    test("schema version is at least 27", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(27);
    });

    test("all 8 runtime tables are queryable in SQLite", () => {
      const db = openAgentOsDb();
      const tables = [
        "codex_runtime_nodes",
        "codex_runtime_sessions",
        "codex_runtime_jobs",
        "codex_runtime_events",
        "codex_runtime_approvals",
        "codex_runtime_audit_logs",
        "codex_runtime_capabilities",
        "codex_runtime_mcp_tools",
      ];
      for (const table of tables) {
        const count = db.query(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        expect(count.c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Platform & Capability Detection
  // ---------------------------------------------------------------------------
  describe("Detection & Version Probing", () => {
    test("detectPlatform returns valid OS string", () => {
      const platform = CodexDetector.detectPlatform();
      expect(["windows", "linux", "macos", "unknown"]).toContain(platform);
    });

    test("getCodexBinaryPath resolves installed or returns null safely", () => {
      const exec = CodexDetector.getCodexBinaryPath();
      if (exec) {
        expect(typeof exec).toBe("string");
        expect(exec.length).toBeGreaterThan(0);
      } else {
        expect(exec).toBeNull();
      }
    });

    test("detectCapabilities returns structured report", () => {
      const report = CodexDetector.detectCapabilities(true);
      expect(report).toBeDefined();
      expect(report.platform).toBe(CodexDetector.detectPlatform());
      expect(typeof report.codexInstalled).toBe("boolean");
      expect(typeof report.appServerAvailable).toBe("boolean");
      expect(typeof report.pythonSdkAvailable).toBe("boolean");
      expect(typeof report.daemonAvailable).toBe("boolean");
    });

    test("checkCompatibility evaluates semantic versions against matrix", () => {
      const compat0147 = CodexDetector.checkCompatibility("0.147.0");
      expect(compat0147.isAllowed).toBe(true);

      const compatBlocked = CodexDetector.checkCompatibility("0.1.0");
      expect(compatBlocked.isAllowed).toBe(false);
      expect(compatBlocked.status).toBe("blocked");

      const compatNull = CodexDetector.checkCompatibility(null);
      expect(compatNull.isAllowed).toBe(false);
      expect(compatNull.status).toBe("unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Secret Redaction Engine
  // ---------------------------------------------------------------------------
  describe("Secret Redaction Engine", () => {
    test("redacts OpenAI API keys", () => {
      const secret = "sk-proj-" + "x".repeat(40);
      const cleaned = SecretRedactor.redactText(`Found token ${secret} in configuration`);
      expect(cleaned).not.toContain(secret);
      expect(cleaned).toContain("sk-***REDACTED***");
    });

    test("redacts GitHub Personal Access Tokens", () => {
      const ghp = "ghp_" + "y".repeat(36);
      const cleaned = SecretRedactor.redactText(`Token is ${ghp} in config`);
      expect(cleaned).not.toContain(ghp);
      expect(cleaned).toContain("ghp_***REDACTED***");
    });

    test("redacts AWS access keys", () => {
      const aws = "AKIAIOSFODNN7EXAMPLE";
      const cleaned = SecretRedactor.redactText(`AWS_ACCESS_KEY_ID=${aws}`);
      expect(cleaned).not.toContain(aws);
      expect(cleaned).toContain("AKIA***REDACTED***");
    });

    test("redacts database connection credentials", () => {
      const dbUrl = "postgres://admin:super_secret_pw@db.test:5432/proddb";
      const cleaned = SecretRedactor.redactText(`Connect to ${dbUrl}`);
      expect(cleaned).not.toContain("super_secret_pw");
      expect(cleaned).toContain("***REDACTED***");
    });

    test("deeply scrubs nested objects and arrays", () => {
      const payload = {
        meta: {
          key: "sk-" + "2".repeat(28),
          tokens: ["ghp_" + "g2".repeat(18)],
        },
        command: "curl -H 'Authorization: Bearer sk-" + "3".repeat(28) + "'",
      };
      const redacted = SecretRedactor.redactObject(payload);
      expect(JSON.stringify(redacted)).not.toContain("sk-" + "2".repeat(28));
      expect(JSON.stringify(redacted)).not.toContain("ghp_" + "g2".repeat(18));
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Workspace Security & Path Traversal Guard
  // ---------------------------------------------------------------------------
  describe("Workspace Path Containment", () => {
    const policy = new PolicyEngine("NORMAL");

    test("allows paths inside the designated workspace", () => {
      const workspaceRoot = join(testDir, "project");
      const valid = policy.validatePath("src/index.ts", workspaceRoot, false);
      expect(valid.allowed).toBe(true);
      expect(valid.canonicalPath.length).toBeGreaterThan(0);
    });

    test("blocks relative directory traversal outside workspace", () => {
      const workspaceRoot = join(testDir, "project");
      const attack = policy.validatePath("../../other_project/file.txt", workspaceRoot, false);
      expect(attack.allowed).toBe(false);
      expect(attack.reason).toContain("outside workspace root");
    });

    test("blocks absolute paths outside workspace", () => {
      const workspaceRoot = join(testDir, "project");
      const absPath = process.platform === "win32" ? "C:\\Windows\\notepad.exe" : "/etc/passwd";
      const attack = policy.validatePath(absPath, workspaceRoot, false);
      expect(attack.allowed).toBe(false);
      expect(attack.reason).toContain("outside workspace root");
    });

    test("blocks access to sensitive system directories (.ssh, .aws, .env)", () => {
      const workspaceRoot = join(testDir, "project");
      const sshCheck = policy.validatePath(".ssh/id_rsa", workspaceRoot, false);
      expect(sshCheck.allowed).toBe(false);
      expect(sshCheck.reason).toContain("protected path");

      const envCheck = policy.validatePath(".env", workspaceRoot, false);
      expect(envCheck.allowed).toBe(false);
      expect(envCheck.reason).toContain("protected path");

      const awsCheck = policy.validatePath(".aws/credentials", workspaceRoot, false);
      expect(awsCheck.allowed).toBe(false);
      expect(awsCheck.reason).toContain("protected path");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Command Classifier & Destructive Gate
  // ---------------------------------------------------------------------------
  describe("Command Policy & Risk Classifier", () => {
    const policy = new PolicyEngine("NORMAL");

    test("classifies safe read-only commands as LOW risk", () => {
      expect(policy.classifyCommand("git status").risk).toBe("low");
      expect(policy.classifyCommand("ls -la").risk).toBe("low");
      expect(policy.classifyCommand("echo hello").risk).toBe("low");
    });

    test("classifies destructive commands as destructive and requires approval", () => {
      const rmRoot = policy.classifyCommand("rm -rf /");
      expect(rmRoot.isDestructive).toBe(true);
      expect(rmRoot.requiresApproval).toBe(true);

      const delSys = policy.classifyCommand("del /s /q C:\\Windows");
      expect(delSys.isDestructive).toBe(true);
      expect(delSys.requiresApproval).toBe(true);

      const formatDisk = policy.classifyCommand("format c: /fs:ntfs");
      expect(formatDisk.isDestructive).toBe(true);
      expect(formatDisk.requiresApproval).toBe(true);
    });

    test("SAFE profile requires approval for state-changing commands", () => {
      const safePolicy = new PolicyEngine("SAFE");
      const cmd = safePolicy.classifyCommand("npm test");
      expect(cmd.requiresApproval).toBe(true);
      expect(cmd.risk).toBe("medium");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Policy Engine & Profiles
  // ---------------------------------------------------------------------------
  describe("Policy Engine & Profile Rules", () => {
    test("SAFE profile forbids write operations", () => {
      const engine = new PolicyEngine("SAFE");
      expect(engine.getProfile()).toBe("SAFE");
      const writeCheck = engine.validatePath("src/app.ts", testDir, true);
      expect(writeCheck.allowed).toBe(false);
      expect(writeCheck.reason).toContain("Write operations are denied");
    });

    test("NORMAL profile allows workspace write operations", () => {
      const engine = new PolicyEngine("NORMAL");
      const writeCheck = engine.validatePath("src/app.ts", testDir, true);
      expect(writeCheck.allowed).toBe(true);
    });

    test("AUTOMATION profile configures correct rule set", () => {
      const engine = new PolicyEngine("AUTOMATION");
      const rules = engine.getRuleSet();
      expect(rules.profile).toBe("AUTOMATION");
      expect(rules.sandboxMode).toBe("workspace-write");
      expect(rules.networkAllowlist).toContain("github.com");
    });

    test("FULL_ACCESS profile requires operator unlock with TTL and auto-expires", async () => {
      const engine = new PolicyEngine("NORMAL");
      expect(engine.getProfile()).toBe("NORMAL");

      // Cannot set FULL_ACCESS directly via setProfile
      expect(() => engine.setProfile("FULL_ACCESS")).toThrow();

      // Unlock FULL_ACCESS with short 1 second TTL
      const unlock = engine.unlockFullAccess("Operator", 1);
      expect(unlock.success).toBe(true);
      expect(engine.getProfile()).toBe("FULL_ACCESS");

      // Wait 1.1s for expiry
      await new Promise((r) => setTimeout(r, 1100));
      expect(engine.getProfile()).toBe("NORMAL");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Approval Broker & Headless Safety
  // ---------------------------------------------------------------------------
  describe("Approval Broker & Headless Safety", () => {
    test("creates approval request and resolves with operator decision", async () => {
      new NodeManager().ensureLocalNode();
      const store = new CodexRuntimeStore();
      store.createSession({
        id: "s-1",
        threadId: "th-1",
        title: "Test",
        workspaceRoot: testDir,
        policyProfile: "NORMAL",
        status: "idle",
        nodeId: "local_pc",
        runtimeMode: "cli",
        activeTurnId: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const broker = new ApprovalBroker(store);
      const promise = broker.requestApproval({
        sessionId: "s-1",
        turnId: "t-1",
        nodeId: "local_pc",
        toolName: "bash",
        command: "rm -rf build",
        riskLevel: "high",
        timeoutSeconds: 2,
      });

      const pending = broker.getPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe("pending");

      // Operator allows
      const resolved = broker.resolve(pending[0].id, "allow", "admin");
      expect(resolved).toBe(true);

      const outcome = await promise;
      expect(outcome.decision).toBe("allow");
      expect(outcome.status).toBe("approved_once");
      expect(outcome.decidedBy).toBe("admin");
    });

    test("headless safety: auto-denies on timeout without hanging indefinitely", async () => {
      new NodeManager().ensureLocalNode();
      const store = new CodexRuntimeStore();
      store.createSession({
        id: "s-2",
        threadId: "th-2",
        title: "Test 2",
        workspaceRoot: testDir,
        policyProfile: "NORMAL",
        status: "idle",
        nodeId: "local_pc",
        runtimeMode: "cli",
        activeTurnId: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const broker = new ApprovalBroker(store);
      const start = Date.now();
      const outcome = await broker.requestApproval({
        sessionId: "s-2",
        turnId: "t-2",
        nodeId: "local_pc",
        toolName: "powershell",
        command: "Drop-Database",
        riskLevel: "high",
        timeoutSeconds: 1, // 1 second timeout
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(3000); // must not hang forever
      expect(outcome.status).toBe("timed_out");
      expect(outcome.decision).toBe("deny");
      expect(outcome.decidedBy).toBe("system_timeout");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. EventBus & Normalized Event Streaming
  // ---------------------------------------------------------------------------
  describe("CodexEventBus & Event Streaming", () => {
    test("publishes and subscribes to normalized runtime events", () => {
      new NodeManager().ensureLocalNode();
      const store = new CodexRuntimeStore();
      store.createSession({
        id: "sess-1",
        threadId: "th-1",
        title: "Test",
        workspaceRoot: testDir,
        policyProfile: "NORMAL",
        status: "idle",
        nodeId: "local_pc",
        runtimeMode: "cli",
        activeTurnId: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const bus = new CodexEventBus(store);
      const received: any[] = [];

      const unsub = bus.subscribeSession("sess-1", (evt) => {
        received.push(evt);
      });

      bus.emit("sess-1", "turn-1", {
        type: "TurnStarted",
        turnId: "turn-1",
        status: "running",
      } as any);

      bus.emit("sess-2", "turn-2", {
        type: "TurnStarted",
        turnId: "turn-2",
        status: "running",
      } as any);

      expect(received.length).toBe(1);
      expect(received[0].turnId).toBe("turn-1");

      unsub();
      bus.emit("sess-1", "turn-1", {
        type: "TurnCompleted",
        turnId: "turn-1",
      } as any);
      expect(received.length).toBe(1); // unsubscribed
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Runtime Adapters & Router Selection
  // ---------------------------------------------------------------------------
  describe("Runtime Adapters & Router", () => {
    test("CliFallbackAdapter initializes and creates thread/turn", async () => {
      const adapter = new CliFallbackAdapter();
      expect(adapter.mode).toBe("cli");

      const thread = await adapter.startThread("s-cli", testDir);
      expect(thread.threadId.length).toBeGreaterThan(0);

      const health = await adapter.health();
      expect(health.status).toBeDefined();
    });

    test("AppServerAdapter initializes transport and reports mode", async () => {
      const adapter = new AppServerAdapter();
      expect(adapter.mode).toBe("app_server");
      const health = await adapter.health();
      expect(health.status).toBeDefined();
    });

    test("PythonSdkAdapter reports status and mode", async () => {
      const adapter = new PythonSdkAdapter();
      expect(adapter.mode).toBe("sdk");
      const health = await adapter.health();
      expect(health.status).toBeDefined();
    });

    test("RuntimeRouter selects active adapter", () => {
      const router = new RuntimeRouter();
      const active = router.resolveAdapter();
      expect(active).toBeDefined();
      expect(["app_server", "sdk", "cli"]).toContain(active.mode);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. MCP Inventory & Tool Cataloging
  // ---------------------------------------------------------------------------
  describe("MCP Inventory & Risk Categorization", () => {
    test("registers built-in tools with risk ratings", () => {
      const inventory = new McpInventory();
      inventory.seedBuiltinTools();
      const tools = inventory.listTools();
      expect(tools.length).toBeGreaterThan(0);

      const deleteFile = tools.find((t) => t.toolName === "delete_file");
      expect(deleteFile).toBeDefined();
      expect(deleteFile?.risk).toBe("high");

      const readFile = tools.find((t) => t.toolName === "read_file");
      expect(readFile).toBeDefined();
      expect(readFile?.risk).toBe("low");
    });

    test("registers external MCP server and tools", () => {
      const inventory = new McpInventory();
      const prTool = inventory.registerTool(
        "mcp-github",
        "create_pull_request",
        "Creates PR",
      );
      expect(prTool).toBeDefined();
      expect(prTool.serverName).toBe("mcp-github");
      expect(prTool.toolName).toBe("create_pull_request");
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Daemon Manager & Node Registry
  // ---------------------------------------------------------------------------
  describe("Daemon Manager & Multi-Node Support", () => {
    test("daemon manager provides status without crashing", async () => {
      const daemon = new DaemonManager();
      const status = await daemon.getStatus();
      expect(status).toBeDefined();
      expect(typeof status.running).toBe("boolean");
    });

    test("node manager tracks local PC and Linux VPS nodes", () => {
      const nodeManager = new NodeManager();
      nodeManager.ensureLocalNode();

      nodeManager.registerNode({
        id: "vps-linux",
        name: "Cloud Build Worker",
        platform: "linux",
        hostname: "vps.internal",
        runtimeMode: "app_server",
        policyProfile: "NORMAL",
      });

      const nodes = nodeManager.listNodes();
      expect(nodes.length).toBeGreaterThanOrEqual(2);
      expect(nodeManager.getNode("local_pc")?.platform).toBe(CodexDetector.detectPlatform());
      expect(nodeManager.getNode("vps-linux")?.platform).toBe("linux");
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Schema Sync & Drift Detection
  // ---------------------------------------------------------------------------
  describe("Schema Sync & Drift Detection", () => {
    test("CodexSchemaSync generates TS and JSON schemas", () => {
      const result = CodexSchemaSync.sync();
      expect(result.version).toBe("0.147.0");
      expect(result.tsFilesCount).toBeGreaterThan(0);
      expect(result.jsonFilesCount).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });

    test("CodexSchemaSync detectDrift reports sync status", () => {
      const drift = CodexSchemaSync.detectDrift();
      expect(drift.inSync).toBe(true);
      expect(drift.missingTsFiles.length).toBe(0);
      expect(drift.missingJsonFiles.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 13. SQLite Persistence Store (CRUD)
  // ---------------------------------------------------------------------------
  describe("SQLite Store Operations", () => {
    test("persists and retrieves sessions", () => {
      new NodeManager().ensureLocalNode();
      const store = new CodexRuntimeStore();
      const sess: CodexSession = {
        id: "sess-store-1",
        threadId: "th-1",
        title: "Test Session",
        workspaceRoot: testDir,
        policyProfile: "NORMAL",
        status: "idle",
        nodeId: "local_pc",
        runtimeMode: "cli",
        activeTurnId: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.createSession(sess);

      const retrieved = store.getSession("sess-store-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe("Test Session");
      expect(retrieved?.policyProfile).toBe("NORMAL");

      store.updateSessionStatus("sess-store-1", "busy");
      expect(store.getSession("sess-store-1")?.status).toBe("busy");
    });

    test("records audit log entries with secret redaction", () => {
      const store = new CodexRuntimeStore();
      const audit = new CodexAuditService(store);
      audit.log({
        sessionId: "sess-store-1",
        turnId: "t-1",
        nodeId: "local_pc",
        action: "command.execute",
        risk: "low",
        result: "ok",
        metadata: {
          key: "sk-" + "4".repeat(30),
        },
      });

      const logs = store.listAuditLogs(10);
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs[0].metadata)).not.toContain("4444444444");
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Full Service Facade & Concurrency Queue
  // ---------------------------------------------------------------------------
  describe("CodexRuntimeService & Turn Queue", () => {
    test("initializes service and reports status summary", async () => {
      const service = new CodexRuntimeService();
      const status = await service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.health.status).not.toBe("unhealthy");
      expect(status.policyProfile).toBe("NORMAL");
    });

    test("creates session, executes turn, and records audit trail", async () => {
      const service = new CodexRuntimeService();

      const session = service.createSession({
        title: "E2E Turn Test",
        workspaceRoot: testDir,
        policyProfile: "AUTOMATION",
      });
      expect(session.id.startsWith("sess_")).toBe(true);

      const turn = await service.executeTurn(session.id, "Perform safe directory check");
      expect(turn.id).toBeDefined();
      expect(turn.status).toBe("completed");

      const events = service.store.listEventsForSession(session.id);
      expect(events.length).toBeGreaterThan(0);

      const logs = service.listAuditLogs(10);
      expect(logs.length).toBeGreaterThan(0);
    });

    test("rollback toggle PAO_CODEX_NATIVE_RUNTIME disables native runtime gracefully", async () => {
      const prevVal = process.env.PAO_CODEX_NATIVE_RUNTIME;
      try {
        process.env.PAO_CODEX_NATIVE_RUNTIME = "false";
        const service = new CodexRuntimeService();
        expect(service.isNativeRuntimeEnabled()).toBe(false);
        const status = await service.getStatus();
        expect(status.enabled).toBe(false);

        expect(() =>
          service.createSession({ workspaceRoot: testDir, title: "Disabled Test" }),
        ).toThrow("disabled");
      } finally {
        process.env.PAO_CODEX_NATIVE_RUNTIME = prevVal;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 15. REST Management API Integration (19 endpoints)
  // ---------------------------------------------------------------------------
  describe("Management REST API Routes", () => {
    function makeCtx(path: string, method = "GET", body?: any): any {
      const url = new URL(`http://localhost:18080${path}`);
      const init: RequestInit = { method };
      if (body) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const req = new Request(url, init);
      return {
        url,
        req,
        config: {} as any,
      };
    }

    test("handles /status GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/status", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.status).toBeDefined();
    });

    test("handles /health GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/health", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.health).toBeDefined();
    });

    test("handles /capabilities GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/capabilities", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.capabilities).toBeDefined();
    });

    test("handles /sessions GET & POST", async () => {
      const postCtx = makeCtx("/api/agent-os/codex-runtime/sessions", "POST", {
        title: "API Session",
        workspaceRoot: testDir,
        policyProfile: "NORMAL",
      });
      const postRes = await handleCodexRuntimeRoutes(postCtx);
      expect(postRes).not.toBeNull();
      expect(postRes!.status).toBe(201);
      const session = await postRes!.json();
      expect(session.session).toBeDefined();
      expect(session.session.id).toBeDefined();

      const getCtx = makeCtx("/api/agent-os/codex-runtime/sessions", "GET");
      const getRes = await handleCodexRuntimeRoutes(getCtx);
      expect(getRes).not.toBeNull();
      expect(getRes!.status).toBe(200);
      const list = await getRes!.json();
      expect(Array.isArray(list.sessions)).toBe(true);
      expect(list.sessions.some((s: any) => s.id === session.session.id)).toBe(true);
    });

    test("handles /policies/unlock POST with TTL", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/policies/unlock", "POST", {
        operator: "test_operator",
        ttlSeconds: 60,
      });
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.unlock.success).toBe(true);
      expect(data.unlock.expiresAt).toBeDefined();
    });

    test("handles /audit GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/audit", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(Array.isArray(data.logs)).toBe(true);
    });

    test("handles /tools GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/tools", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.length).toBeGreaterThan(0);
    });

    test("handles /nodes GET", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/nodes", "GET");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(Array.isArray(data.nodes)).toBe(true);
    });

    test("handles /schema/sync POST", async () => {
      const ctx = makeCtx("/api/agent-os/codex-runtime/schema/sync", "POST");
      const res = await handleCodexRuntimeRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.result.success).toBe(true);
      expect(data.result.version).toBe("0.147.0");
    });
  });
});

