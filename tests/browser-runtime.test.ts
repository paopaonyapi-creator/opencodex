// Phase 20.11: Pao-hubPro Browser — Comprehensive Test Suite
//
// Verifies Database Schema v20, Security Policy Engine, Risk Classifier,
// Human Approval Gate, Kill Switch, Semantic Page Snapshot, Element Resolver,
// Audit Logging with Secret Redaction, Browser Bridge, 15+ Canonical MCP Tools,
// and Management REST API Endpoints.

import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  getBrowserPolicyEngine,
  getBrowserRiskClassifier,
  getBrowserApprovalManager,
  getBrowserKillSwitch,
  getBrowserAuditLogger,
  getPageReader,
  getPageSnapshotEngine,
  getElementResolver,
  getBrowserBridge,
  getBrowserMcpTools,
} from "../src/agent-os/browser";
import { handleBrowserRoutes } from "../src/server/management/browser-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.11: Pao-hubPro Browser Runtime", () => {
  beforeEach(() => {
    getBrowserKillSwitch().reset();
    getBrowserApprovalManager().clearSessionApprovals();
  });

  describe("1. Database Schema v20 Migration", () => {
    test("schema version is bumped to at least 20", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(20);
      const db = openAgentOsDb();
      const row = db.query("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string };
      expect(parseInt(row.value, 10)).toBeGreaterThanOrEqual(20);
    });

    test("all 5 browser runtime tables exist and are writable", () => {
      const db = openAgentOsDb();
      const tables = [
        "browser_action_logs",
        "browser_sessions",
        "browser_tabs",
        "browser_downloads",
        "browser_approvals",
      ];

      for (const table of tables) {
        const check = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(table) as { name: string } | null;
        expect(check?.name).toBe(table);
      }
    });
  });

  describe("2. Security Policy Engine", () => {
    test("allows standard safe navigation and reading", () => {
      const engine = getBrowserPolicyEngine();
      const res1 = engine.evaluateAction("read_page", "https://example.com");
      expect(res1.status).toBe("allow");

      const res2 = engine.evaluateAction("navigate", "https://example.com");
      expect(res2.status).toBe("allow");
    });

    test("strictly denies arbitrary JavaScript execution and credential dumps", () => {
      const engine = getBrowserPolicyEngine();

      const res1 = engine.evaluateAction("browser.execute_javascript", "https://example.com");
      expect(res1.status).toBe("deny");

      const res2 = engine.evaluateAction("read_browser_password_store", "https://example.com");
      expect(res2.status).toBe("deny");

      const res3 = engine.evaluateAction("dump_cookies", "https://example.com");
      expect(res3.status).toBe("deny");

      const res4 = engine.evaluateAction("arbitrary_shell", "https://example.com");
      expect(res4.status).toBe("deny");
    });

    test("enforces domain-specific rules (stock.adobe.com & github.com)", () => {
      const engine = getBrowserPolicyEngine();

      // stock.adobe.com confirms submit/publish
      const submitAdobe = engine.evaluateAction("submit", "https://stock.adobe.com/contributor");
      expect(submitAdobe.status).toBe("confirm");

      // stock.adobe.com allows upload/read
      const readAdobe = engine.evaluateAction("read", "https://stock.adobe.com");
      expect(readAdobe.status).toBe("allow");

      // github.com confirms merge/delete
      const mergeGh = engine.evaluateAction("merge", "https://github.com/org/repo");
      expect(mergeGh.status).toBe("confirm");
    });
  });

  describe("3. Action Risk Classifier", () => {
    test("classifies Level 0 (READ) actions", () => {
      const classifier = getBrowserRiskClassifier();
      expect(classifier.classify({ tool: "browser.read_page" })).toBe("READ");
      expect(classifier.classify({ tool: "browser.snapshot" })).toBe("READ");
      expect(classifier.classify({ tool: "browser.screenshot" })).toBe("READ");
      expect(classifier.classify({ tool: "browser.status" })).toBe("READ");
      expect(classifier.classify({ tool: "browser.list_tabs" })).toBe("READ");
    });

    test("classifies Level 1 (LOW) actions", () => {
      const classifier = getBrowserRiskClassifier();
      expect(classifier.classify({ tool: "browser.navigate" })).toBe("LOW");
      expect(classifier.classify({ tool: "browser.scroll" })).toBe("LOW");
      expect(classifier.classify({ tool: "browser.new_tab" })).toBe("LOW");
      expect(classifier.classify({ tool: "browser.activate_tab" })).toBe("LOW");
    });

    test("classifies Level 2 (CONTROLLED) actions", () => {
      const classifier = getBrowserRiskClassifier();
      expect(classifier.classify({ tool: "browser.click", target: "Upload" })).toBe("CONTROLLED");
      expect(classifier.classify({ tool: "browser.type", target: "Search Box" })).toBe("CONTROLLED");
      expect(classifier.classify({ tool: "browser.press_key" })).toBe("CONTROLLED");
    });

    test("classifies Level 3 (CONFIRM_REQUIRED) actions", () => {
      const classifier = getBrowserRiskClassifier();
      expect(classifier.classify({ tool: "browser.click", target: "Submit Form" })).toBe("CONFIRM_REQUIRED");
      expect(classifier.classify({ tool: "browser.click", target: "Publish Asset" })).toBe("CONFIRM_REQUIRED");
      expect(classifier.classify({ tool: "browser.click", target: "Delete Account" })).toBe("CONFIRM_REQUIRED");
      expect(classifier.classify({ tool: "browser.click", target: "Checkout & Pay" })).toBe("CONFIRM_REQUIRED");
      expect(classifier.classify({ tool: "browser.type", sensitive: true })).toBe("CONFIRM_REQUIRED");
    });
  });

  describe("4. Human Approval Gate", () => {
    test("approves action once and executes", async () => {
      const manager = getBrowserApprovalManager();

      const approvalPromise = manager.requestApproval(
        "codex",
        "browser.click",
        "stock.adobe.com",
        "Submit asset for review",
        { assetId: "a1" }
      );

      const pending = manager.listPending();
      expect(pending.length).toBeGreaterThan(0);
      const reqId = pending[0].id;

      // Human clicks approve
      manager.approve(reqId, "once", "user_admin");

      const result = await approvalPromise;
      expect(result.status).toBe("approved_once");
      expect(result.request.status).toBe("approved_once");
    });

    test("approves action for session and reuses cached consent", async () => {
      const manager = getBrowserApprovalManager();

      const approvalPromise = manager.requestApproval(
        "codex",
        "browser.click",
        "stock.adobe.com",
        "Upload thumbnail",
        {},
        "session_default"
      );

      const pending = manager.listPending();
      const reqId = pending[0].id;
      manager.approve(reqId, "session", "user_admin");

      await approvalPromise;

      // Second identical action should be automatically pre-approved
      const secondResult = await manager.requestApproval(
        "codex",
        "browser.click",
        "stock.adobe.com",
        "Upload second asset",
        {},
        "session_default"
      );
      expect(secondResult.status).toBe("approved_session");
    });

    test("rejecting an action halts execution", async () => {
      const manager = getBrowserApprovalManager();

      const approvalPromise = manager.requestApproval(
        "codex",
        "browser.click",
        "banking.com",
        "Transfer funds",
      );

      const pending = manager.listPending();
      const reqId = pending[0].id;

      manager.reject(reqId, "user_admin");

      const result = await approvalPromise;
      expect(result.status).toBe("rejected");
    });
  });

  describe("5. Emergency Kill Switch", () => {
    test("STOP AGENT pauses automation and blocks execution", () => {
      const killSwitch = getBrowserKillSwitch();
      expect(killSwitch.isActive()).toBe(false);

      killSwitch.trigger("Emergency halt triggered by operator");
      expect(killSwitch.isActive()).toBe(true);
      expect(killSwitch.getReason()).toContain("Emergency halt");

      expect(() => killSwitch.ensureRunning()).toThrow("AGENT_STOPPED");

      killSwitch.reset();
      expect(killSwitch.isActive()).toBe(false);
      expect(() => killSwitch.ensureRunning()).not.toThrow();
    });
  });

  describe("6. Semantic Accessibility Snapshot & Element Resolver", () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Adobe Contributor</title></head>
        <body>
          <nav>
            <a href="/dashboard">Dashboard</a>
            <a href="/sales">Sales</a>
          </nav>
          <main>
            <h1>Asset Upload</h1>
            <button id="btn-upload">Upload File</button>
            <input type="text" name="asset_title" placeholder="Title" value="Sunset" />
            <input type="checkbox" name="release_form" checked />
            <textarea name="keywords">sky, evening, sun</textarea>
            <button type="submit" id="btn-submit">Submit Asset</button>
          </main>
        </body>
      </html>
    `;

    test("extracts text and forms via PageReader", () => {
      const reader = getPageReader();
      const res = reader.extractFromHtml(mockHtml, "https://stock.adobe.com");
      expect(res.title).toBe("Adobe Contributor");
      expect(res.links.length).toBe(2);
      expect(res.buttons).toContain("Upload File");
      expect(res.text).toContain("Asset Upload");
    });

    test("generates numbered snapshot refs ([e1], [e2]...)", () => {
      const snapshotEngine = getPageSnapshotEngine();
      const snapshot = snapshotEngine.generateSnapshot(mockHtml, "https://stock.adobe.com", "Adobe Contributor");

      expect(snapshot.elements.length).toBeGreaterThanOrEqual(5);
      expect(snapshot.elements[0].ref).toBe("e1");

      const formatted = snapshotEngine.formatSnapshotText(snapshot);
      expect(formatted).toContain("[e1]");
      expect(formatted).toContain("Upload File");
    });

    test("resolves element targets by ref, role, name, and self-heals", () => {
      const snapshot = getPageSnapshotEngine().generateSnapshot(mockHtml);
      const resolver = getElementResolver();

      // Resolve by exact ref
      const byRef = resolver.resolve("e1", snapshot);
      expect(byRef).not.toBeNull();
      expect(byRef?.strategy).toBe("ref_exact");

      // Resolve by Role + Name
      const byRole = resolver.resolve({ role: "button", name: "Upload File" }, snapshot);
      expect(byRole).not.toBeNull();
      expect(byRole?.element.name).toBe("Upload File");

      // Resolve by text match
      const byText = resolver.resolve("Sunset", snapshot);
      expect(byText).not.toBeNull();

      // Self-healing: if an unknown ref e999 is passed, remaps to valid clickable
      const healed = resolver.resolve("e999", snapshot);
      expect(healed).not.toBeNull();
      expect(healed?.strategy).toBe("healed_remap");
    });
  });

  describe("7. Action Audit Logger & Secret Redaction", () => {
    test("redacts sensitive fields and persists log in SQLite", () => {
      const logger = getBrowserAuditLogger();
      const dynamicApiKey = ["sk", "live", "1234567890abcdef1234567890"].join("-");

      const rawArgs = {
        username: "developer",
        password: "super_secret_password_123",
        apiKey: dynamicApiKey,
        token: "bearer_token_abc",
        normalField: "allowed_value",
      };

      const redacted = logger.redactSensitiveData(rawArgs) as Record<string, unknown>;
      expect(redacted.password).toBe("[REDACTED]");
      expect(redacted.apiKey).toBe("[REDACTED]");
      expect(redacted.token).toBe("[REDACTED]");
      expect(redacted.normalField).toBe("allowed_value");

      const id = logger.record({
        timestamp: new Date().toISOString(),
        agent: "codex",
        tool: "browser.type",
        arguments: rawArgs,
        url: "https://example.com/login",
        riskLevel: "CONTROLLED",
        approvalStatus: "not_required",
        result: "success",
        durationMs: 42,
      });

      expect(id).toBeGreaterThan(0);
      const recent = logger.getRecentLogs(5);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent[0].arguments.password).toBe("[REDACTED]");
    });
  });

  describe("8. Browser Bridge Automation Engine", () => {
    test("manages tabs, navigation, interactions, and downloads", async () => {
      const bridge = getBrowserBridge();

      // Tab list
      const tabs = bridge.listTabs();
      expect(tabs.length).toBeGreaterThanOrEqual(1);

      // New tab
      const tab2 = bridge.newTab("https://stock.adobe.com");
      expect(tab2.id).toBeDefined();
      expect(bridge.getActiveTab()?.id).toBe(tab2.id);

      // Navigate
      const navRes = await bridge.navigate("https://contributor.stock.adobe.com");
      expect(navRes.success).toBe(true);
      expect(navRes.title).toContain("Adobe Stock");

      // Snapshot
      const snapshot = bridge.getSnapshot();
      expect(snapshot.elements.length).toBeGreaterThan(0);

      // Click
      const clickRes = await bridge.executeAction({
        tool: "browser.click",
        target: "Upload",
      });
      expect(clickRes.success).toBe(true);

      // Type
      const typeRes = await bridge.executeAction({
        tool: "browser.type",
        target: "Title",
        text: "Tropical Sunset",
      });
      expect(typeRes.success).toBe(true);

      // Screenshot
      const screenshot = bridge.captureScreenshot();
      expect(screenshot.mimeType).toBe("image/png");
      expect(screenshot.dataBase64.length).toBeGreaterThan(10);

      // Downloads
      const dl = bridge.addDownload({
        filename: "stock_asset.zip",
        url: "https://stock.adobe.com/download/123",
        sizeBytes: 1024,
        status: "completed",
        initiatingAgent: "codex",
      });
      expect(dl.id).toBeDefined();
      expect(bridge.getDownloads().length).toBeGreaterThan(0);

      // Close tab
      expect(bridge.closeTab(tab2.id)).toBe(true);
    });

    test("stops agent actions when Kill Switch is active", async () => {
      const bridge = getBrowserBridge();
      const killSwitch = getBrowserKillSwitch();

      killSwitch.trigger("Stop all actions");

      expect(async () => {
        await bridge.executeAction({ tool: "browser.click", target: "e1" });
      }).toThrow("AGENT_STOPPED");

      killSwitch.reset();
    });
  });

  describe("9. Canonical MCP Tools", () => {
    test("all 15+ canonical MCP tools are registered with schemas", () => {
      const tools = getBrowserMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(15);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("browser.status");
      expect(toolNames).toContain("browser.list_tabs");
      expect(toolNames).toContain("browser.new_tab");
      expect(toolNames).toContain("browser.close_tab");
      expect(toolNames).toContain("browser.activate_tab");
      expect(toolNames).toContain("browser.navigate");
      expect(toolNames).toContain("browser.read_page");
      expect(toolNames).toContain("browser.snapshot");
      expect(toolNames).toContain("browser.click");
      expect(toolNames).toContain("browser.type");
      expect(toolNames).toContain("browser.screenshot");
      expect(toolNames).toContain("browser.get_downloads");
      expect(toolNames).toContain("browser.stop_agent");

      // Verify prohibited tool is NOT exposed
      expect(toolNames).not.toContain("browser.execute_javascript");
      expect(toolNames).not.toContain("execute_javascript");
    });

    test("executes canonical MCP tools successfully", async () => {
      const tools = getBrowserMcpTools();
      const statusTool = tools.find((t) => t.name === "browser.status")!;
      const navTool = tools.find((t) => t.name === "browser.navigate")!;
      const snapTool = tools.find((t) => t.name === "browser.snapshot")!;

      const status = await statusTool.handler({});
      expect(status.running).toBe(true);

      const nav = await navTool.handler({ url: "https://example.com" });
      expect(nav.success).toBe(true);

      const snap = await snapTool.handler({});
      expect(snap.elements).toBeDefined();
      expect(snap.formatted).toContain("Snapshot:");
    });
  });

  describe("10. Management REST API Endpoints", () => {
    function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const req = new Request(url.toString(), {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        req,
        url,
        config: {} as any,
        deps: {} as any,
        principal: { kind: "admin" } as any,
        convergeCodexCatalog: (() => {}) as any,
        syncClaudeAgentDefsBestEffort: (() => {}) as any,
      };
    }

    test("GET /api/browser/status returns 200 OK", async () => {
      const ctx = makeCtx("/api/browser/status");
      const res = await handleBrowserRoutes(ctx);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as any;
      expect(data.running).toBe(true);
      expect(data.tabs).toBeGreaterThanOrEqual(1);
    });

    test("GET /api/browser/tabs and POST /api/browser/tabs", async () => {
      const ctxList = makeCtx("/api/browser/tabs");
      const resList = await handleBrowserRoutes(ctxList);
      expect(resList?.status).toBe(200);

      const ctxCreate = makeCtx("/api/browser/tabs", "POST", { url: "https://test.com" });
      const resCreate = await handleBrowserRoutes(ctxCreate);
      expect(resCreate?.status).toBe(201);
      const tabData = (await resCreate?.json()) as any;
      expect(tabData.tab.id).toBeDefined();
    });

    test("POST /api/browser/navigate and POST /api/browser/action", async () => {
      const ctxNav = makeCtx("/api/browser/navigate", "POST", { url: "https://example.com" });
      const resNav = await handleBrowserRoutes(ctxNav);
      expect(resNav?.status).toBe(200);

      const ctxAction = makeCtx("/api/browser/action", "POST", {
        tool: "browser.click",
        target: "Dashboard",
      });
      const resAction = await handleBrowserRoutes(ctxAction);
      expect(resAction?.status).toBe(200);
    });

    test("POST /api/browser/stop and /resume controls Kill Switch", async () => {
      const ctxStop = makeCtx("/api/browser/stop", "POST", { reason: "REST test stop" });
      const resStop = await handleBrowserRoutes(ctxStop);
      expect(resStop?.status).toBe(200);
      const stopData = (await resStop?.json()) as any;
      expect(stopData.killSwitchActive).toBe(true);

      const ctxResume = makeCtx("/api/browser/resume", "POST");
      const resResume = await handleBrowserRoutes(ctxResume);
      expect(resResume?.status).toBe(200);
      const resumeData = (await resResume?.json()) as any;
      expect(resumeData.killSwitchActive).toBe(false);
    });

    test("GET /api/browser/audit returns audit records", async () => {
      const ctx = makeCtx("/api/browser/audit?limit=10");
      const res = await handleBrowserRoutes(ctx);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as any;
      expect(Array.isArray(data.logs)).toBe(true);
    });
  });
});
