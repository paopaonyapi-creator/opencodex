// Phase 20.12: Pao-hubPro Browser Workflow Intelligence — Comprehensive Test Suite
//
// Verifies Database Schema v21, Workflow DSL & Template Interpolation,
// Postcondition & Semantic Validation, Self-Healing Element Matcher, Task Memory,
// Checkpoint Persistence, Interactive Recording, Deterministic Replay Engine,
// Canonical MCP Tools, and Management REST API Endpoints.

import { describe, expect, test, beforeEach } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  getBrowserBridge,
  getBrowserKillSwitch,
  getBrowserApprovalManager,
} from "../src/agent-os/browser";
import {
  getWorkflowDslParser,
  getWorkflowValidator,
  getSelfHealingMatcher,
  getTaskMemoryManager,
  getCheckpointManager,
  getWorkflowRecorder,
  getWorkflowExecutor,
  getWorkflowMcpTools,
  type WorkflowDefinition,
} from "../src/agent-os/browser/workflow";
import { handleWorkflowRoutes } from "../src/server/management/workflow-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.12: Pao-hubPro Browser Workflow Intelligence", () => {
  beforeEach(() => {
    getBrowserKillSwitch().reset();
    getBrowserApprovalManager().clearSessionApprovals();
  });

  describe("1. Database Schema v21 Migration", () => {
    test("schema version is bumped to at least 21", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(21);
      const db = openAgentOsDb();
      const row = db.query("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string };
      expect(parseInt(row.value, 10)).toBeGreaterThanOrEqual(21);
    });

    test("all 4 new workflow intelligence tables exist and are queryable", () => {
      const db = openAgentOsDb();
      const tables = [
        "browser_workflows",
        "browser_workflow_runs",
        "browser_step_logs",
        "browser_task_memories",
      ];

      for (const table of tables) {
        const check = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        ).get(table) as { name: string } | null;
        expect(check?.name).toBe(table);
      }
    });
  });

  describe("2. Workflow DSL Parser & Variable Interpolation", () => {
    const parser = getWorkflowDslParser();

    test("interpolates simple and dot-notation variables", () => {
      const template = {
        title: "{{asset.title}}",
        tags: ["{{tags.0}}", "{{tags.1}}"],
        desc: "Asset {{asset.id}} by {{author}}",
      };

      const vars = {
        asset: { id: "A101", title: "Sunset in Bangkok" },
        tags: ["nature", "city"],
        author: "Pao",
      };

      const result = parser.interpolate(template, vars);
      expect(result.title).toBe("Sunset in Bangkok");
      expect(result.tags).toEqual(["nature", "city"]);
      expect(result.desc).toBe("Asset A101 by Pao");
    });

    test("handles missing variables gracefully", () => {
      const template = "Hello {{missing.key}}!";
      const result = parser.interpolate(template, {});
      expect(result).toBe("Hello !");
    });

    test("parses and normalizes JSON workflow definition", () => {
      const raw = {
        name: "Upload Photo",
        steps: [
          { action: "browser.navigate", arguments: { url: "https://stock.adobe.com" } },
          { action: "browser.type", arguments: { target: "input[name='title']", text: "Photo" } },
        ],
      };

      const wf = parser.parse(raw);
      expect(wf.name).toBe("Upload Photo");
      expect(wf.steps.length).toBe(2);
      expect(wf.steps[0].action).toBe("browser.navigate");
      expect(wf.steps[0].maxRetries).toBe(2);
      expect(wf.steps[1].id).toBe("step_2");
    });

    test("parses simple YAML format", () => {
      const yaml = `
name: Simple Replay
description: A basic flow
- browser.navigate:
    url: https://example.com
- browser.click:
    target: "#btn"
      `;

      const wf = parser.parse(yaml);
      expect(wf.name).toBe("Simple Replay");
      expect(wf.steps.length).toBe(2);
      expect(wf.steps[0].action).toBe("browser.navigate");
      expect(wf.steps[0].arguments.url).toBe("https://example.com");
      expect(wf.steps[1].action).toBe("browser.click");
    });
  });

  describe("3. Postcondition & Semantic Validation Engine", () => {
    const validator = getWorkflowValidator();

    test("evaluates url_contains and url_matches", () => {
      const mockSnapshot: any = { elements: [] };

      const res1 = validator.validateRule(
        { type: "url_contains", expected: "adobe" },
        "https://stock.adobe.com/contributor",
        mockSnapshot,
      );
      expect(res1.passed).toBe(true);

      const res2 = validator.validateRule(
        { type: "url_contains", expected: "shutterstock" },
        "https://stock.adobe.com/contributor",
        mockSnapshot,
      );
      expect(res2.passed).toBe(false);

      const res3 = validator.validateRule(
        { type: "url_matches", expected: "^https://[a-z]+\\.adobe\\.com/.*$" },
        "https://stock.adobe.com/contributor",
        mockSnapshot,
      );
      expect(res3.passed).toBe(true);
    });

    test("evaluates text_visible and element_present", () => {
      const mockSnapshot: any = {
        title: "Adobe Stock Contributor",
        elements: [
          { ref: "e1", role: "button", name: "Submit", text: "Submit Asset", value: "" },
          { ref: "e2", role: "textbox", name: "Title", text: "", value: "My Bangkok Shot" },
        ],
      };

      const res1 = validator.validateRule(
        { type: "text_visible", expected: "Submit Asset" },
        "https://stock.adobe.com",
        mockSnapshot,
      );
      expect(res1.passed).toBe(true);

      const res2 = validator.validateRule(
        { type: "element_present", expected: "Submit" },
        "https://stock.adobe.com",
        mockSnapshot,
      );
      expect(res2.passed).toBe(true);

      const res3 = validator.validateRule(
        { type: "element_value", ref: "e2", expected: "Bangkok" },
        "https://stock.adobe.com",
        mockSnapshot,
      );
      expect(res3.passed).toBe(true);
    });
  });

  describe("4. Advanced Self-Healing Element Matcher", () => {
    const healer = getSelfHealingMatcher();

    test("remaps displaced element with confidence >= 0.60 based on role and text", () => {
      const snapshot: any = {
        url: "https://stock.adobe.com/portal",
        elements: [
          { ref: "e99", role: "button", name: "Submit Artwork", tag: "button", text: "Submit Artwork", selector: "#btn-submit-v2" },
          { ref: "e100", role: "link", name: "Cancel", tag: "a", text: "Cancel", selector: "#btn-cancel" },
        ],
      };

      // Searching for old target "#submit-btn" or "Submit"
      const result = healer.heal("Submit Artwork", snapshot, "stock.adobe.com");
      expect(result.healed).toBe(true);
      expect(result.healedTarget).toBe("e99");
      expect(result.confidence).toBeGreaterThanOrEqual(0.60);
      expect(result.strategy).toBe("multi_signal_similarity");
    });

    test("fails to heal when no candidate matches confidence threshold", () => {
      const snapshot: any = {
        url: "https://stock.adobe.com/portal",
        elements: [
          { ref: "e1", role: "checkbox", name: "Terms & Conditions", tag: "input" },
        ],
      };

      const result = healer.heal("Complete Purchase Now", snapshot);
      expect(result.healed).toBe(false);
      expect(result.confidence).toBeLessThan(0.60);
    });
  });

  describe("5. Task Memory Manager", () => {
    const memory = getTaskMemoryManager();

    test("records and retrieves learned element signatures for a domain", () => {
      memory.clearMemory("test-domain.com");

      memory.recordSuccess("https://test-domain.com/upload", "upload_task", "submit_button", {
        role: "button",
        name: "Publish Now",
        tag: "button",
        selector: "#publish-btn-v3",
      });

      const remembered = memory.getSignature("test-domain.com", "submit_button");
      expect(remembered).not.toBeNull();
      expect(remembered?.selector).toBe("#publish-btn-v3");

      const list = memory.listMemory("test-domain.com");
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].domain).toBe("test-domain.com");
    });

    test("adjusts success rate on failure", () => {
      memory.recordSuccess("test-domain.com", "upload_task", "btn", { role: "button" });
      memory.recordFailure("test-domain.com", "upload_task");
      const list = memory.listMemory("test-domain.com");
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].successRate).toBeLessThan(1.0);
    });
  });

  describe("6. Checkpoint Persistence", () => {
    const cpMgr = getCheckpointManager();
    const db = openAgentOsDb();

    test("saves and retrieves execution state checkpoints", () => {
      const now = Date.now();
      db.query(`
        INSERT INTO browser_workflows (id, name, description, version, dsl_json, parameters_schema_json, tags_json, created_at, updated_at)
        VALUES ('wf_test', 'Test Workflow', '', 1, '[]', '{}', '[]', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(now, now);

      const runId = `test_run_${Date.now()}`;
      db.query(`
        INSERT INTO browser_workflow_runs (id, workflow_id, status, current_step_index, variables_json, checkpoints_json, created_at, updated_at)
        VALUES (?, 'wf_test', 'running', 0, '{}', '[]', ?, ?)
      `).run(runId, now, now);

      const cp = cpMgr.saveCheckpoint(runId, 2, "https://stock.adobe.com/step2", { uploaded: true });
      expect(cp.stepIndex).toBe(2);
      expect(cp.url).toBe("https://stock.adobe.com/step2");

      const list = cpMgr.getCheckpoints(runId);
      expect(list.length).toBe(1);
      expect(list[0].variables.uploaded).toBe(true);

      const latest = cpMgr.getLatestCheckpoint(runId);
      expect(latest?.stepIndex).toBe(2);
      expect(cpMgr.canResume(runId)).toBe(true);
    });
  });

  describe("7. Interactive Workflow Recorder", () => {
    const recorder = getWorkflowRecorder();

    test("records navigation and manual actions and compiles template", async () => {
      const start = recorder.startRecording("Recorded Test Flow", "Description of test flow");
      expect(recorder.isRecording()).toBe(true);

      recorder.recordAction("browser.navigate", { url: "https://stock.adobe.com" }, {
        name: "Go to Adobe Stock",
        validations: [{ type: "url_contains", expected: "adobe" }],
      });

      recorder.recordAction("browser.click", { target: "#upload-btn" }, {
        name: "Click Upload",
        isCheckpoint: true,
      });

      expect(recorder.getCurrentSteps().length).toBe(2);

      const wf = recorder.stopRecording({ tags: ["test", "recorded"] });
      expect(recorder.isRecording()).toBe(false);
      expect(wf.name).toBe("Recorded Test Flow");
      expect(wf.steps.length).toBe(2);
      expect(wf.steps[1].isCheckpoint).toBe(true);
      expect(wf.tags).toContain("recorded");

      // Verify saved in SQLite
      const db = openAgentOsDb();
      const saved = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(wf.id) as Record<string, unknown> | null;
      expect(saved).not.toBeNull();
      expect(saved?.name).toBe("Recorded Test Flow");
    });
  });

  describe("8. Deterministic Replay & Execution Engine", () => {
    const executor = getWorkflowExecutor();
    const bridge = getBrowserBridge();

    test("executes multi-step workflow with variable interpolation", async () => {
      const wf: WorkflowDefinition = {
        id: `wf_exec_${Date.now()}`,
        name: "Simple Execution",
        description: "Executes navigate and extraction",
        version: 1,
        steps: [
          {
            id: "s1",
            name: "Navigate to Adobe",
            action: "browser.navigate",
            arguments: { url: "https://stock.adobe.com" },
            validations: [{ type: "url_contains", expected: "adobe" }],
          },
          {
            id: "s2",
            name: "Set Variable",
            action: "set_variable",
            arguments: { myStatus: "ready" },
          },
          {
            id: "s3",
            name: "Type Title",
            action: "browser.type",
            arguments: { target: "input[name='asset_title']", text: "{{titlePrefix}} - Artwork" },
          },
          {
            id: "s4",
            name: "Checkpoint",
            action: "checkpoint",
            arguments: {},
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const run = await executor.runWorkflow(wf, { titlePrefix: "Sunset" });
      expect(run.status).toBe("completed");
      expect(run.currentStepIndex).toBe(4);
      expect(run.variables.myStatus).toBe("ready");

      // Verify step logs
      const logs = executor.getStepLogs(run.id);
      expect(logs.length).toBe(4);
      expect(logs[0].status).toBe("success");
      expect(logs[2].arguments.text).toBe("Sunset - Artwork");
    });

    test("supports pause, cancel, and resume", async () => {
      const wf: WorkflowDefinition = {
        id: `wf_ctrl_${Date.now()}`,
        name: "Control Flow",
        description: "Test pause and resume",
        version: 1,
        steps: [
          { id: "c1", name: "Nav", action: "browser.navigate", arguments: { url: "https://example.com" } },
          { id: "c2", name: "Delay", action: "delay", arguments: { ms: 50 } },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const db = openAgentOsDb();
      const now = Date.now();
      db.query(`
        INSERT INTO browser_workflows (id, name, description, version, dsl_json, parameters_schema_json, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, ?)
      `).run(wf.id, wf.name, wf.description, wf.version, JSON.stringify(wf.steps), now, now);

      const run = await executor.runWorkflow(wf);
      expect(run.status).toBe("completed");

      // Pause a mock run
      const pauseRunId = `run_pause_${Date.now()}`;
      db.query(`
        INSERT INTO browser_workflow_runs (id, workflow_id, status, current_step_index, variables_json, checkpoints_json, created_at, updated_at)
        VALUES (?, ?, 'running', 1, '{}', '[]', ?, ?)
      `).run(pauseRunId, wf.id, now, now);

      const paused = await executor.pauseRun(pauseRunId);
      expect(paused.status).toBe("paused");

      const resumed = await executor.resumeRun(pauseRunId);
      expect(resumed.status).toBe("completed");
    });
  });

  describe("9. Canonical MCP Tools (browser.workflow.*)", () => {
    const tools = getWorkflowMcpTools();

    test("exposes all 14 browser.workflow.* tools", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("browser.workflow.create");
      expect(names).toContain("browser.workflow.list");
      expect(names).toContain("browser.workflow.get");
      expect(names).toContain("browser.workflow.delete");
      expect(names).toContain("browser.workflow.run");
      expect(names).toContain("browser.workflow.status");
      expect(names).toContain("browser.workflow.pause");
      expect(names).toContain("browser.workflow.resume");
      expect(names).toContain("browser.workflow.cancel");
      expect(names).toContain("browser.workflow.record.start");
      expect(names).toContain("browser.workflow.record.action");
      expect(names).toContain("browser.workflow.record.stop");
      expect(names).toContain("browser.workflow.memory.list");
      expect(names).toContain("browser.workflow.memory.clear");
      expect(tools.length).toBeGreaterThanOrEqual(14);
    });

    test("browser.workflow.create, list, get, and delete via MCP handlers", async () => {
      const createTool = tools.find((t) => t.name === "browser.workflow.create")!;
      const listTool = tools.find((t) => t.name === "browser.workflow.list")!;
      const getTool = tools.find((t) => t.name === "browser.workflow.get")!;
      const delTool = tools.find((t) => t.name === "browser.workflow.delete")!;

      const created = await createTool.handler({
        name: "MCP Created Workflow",
        description: "Testing MCP tool creation",
        steps: [{ action: "browser.navigate", arguments: { url: "https://example.com" } }],
        tags: ["mcp-test"],
      });
      expect(created.success).toBe(true);
      const wfId = created.workflow.id;

      const listRes = await listTool.handler({ tag: "mcp-test" });
      expect(listRes.workflows.some((w: any) => w.id === wfId)).toBe(true);

      const getRes = await getTool.handler({ id: wfId });
      expect(getRes.workflow.name).toBe("MCP Created Workflow");

      const delRes = await delTool.handler({ id: wfId });
      expect(delRes.success).toBe(true);
    });
  });

  describe("10. Management REST API Routes (/api/browser/workflows/*)", () => {
    function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const init: RequestInit = { method };
      if (body) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const req = new Request(url.toString(), init);
      return {
        url,
        req,
        pathname: url.pathname,
        principal: { type: "admin" } as any,
        adminToken: "test-token",
        config: {} as any,
      };
    }

    test("POST & GET /api/browser/workflows", async () => {
      const createCtx = makeCtx("/api/browser/workflows", "POST", {
        name: "REST Created Flow",
        description: "Created via REST API",
        steps: [{ action: "browser.navigate", arguments: { url: "https://example.com" } }],
        tags: ["rest-test"],
      });
      const createRes = await handleWorkflowRoutes(createCtx);
      expect(createRes?.status).toBe(201);
      const createData = await createRes?.json();
      expect(createData.success).toBe(true);
      const wfId = createData.workflow.id;

      const listCtx = makeCtx("/api/browser/workflows?tag=rest-test", "GET");
      const listRes = await handleWorkflowRoutes(listCtx);
      expect(listRes?.status).toBe(200);
      const listData = await listRes?.json();
      expect(listData.workflows.some((w: any) => w.id === wfId)).toBe(true);

      const singleCtx = makeCtx(`/api/browser/workflows/${wfId}`, "GET");
      const singleRes = await handleWorkflowRoutes(singleCtx);
      expect(singleRes?.status).toBe(200);

      // Run workflow via REST
      const runCtx = makeCtx(`/api/browser/workflows/${wfId}/run`, "POST", { variables: {} });
      const runRes = await handleWorkflowRoutes(runCtx);
      expect(runRes?.status).toBe(200);
      const runData = await runRes?.json();
      expect(runData.success).toBe(true);
      expect(runData.run.status).toBe("completed");

      // List runs
      const runsCtx = makeCtx(`/api/browser/workflows/runs?workflowId=${wfId}`, "GET");
      const runsRes = await handleWorkflowRoutes(runsCtx);
      expect(runsRes?.status).toBe(200);
      const runsData = await runsRes?.json();
      expect(runsData.runs.length).toBeGreaterThan(0);

      // Delete workflow
      const delCtx = makeCtx(`/api/browser/workflows/${wfId}`, "DELETE");
      const delRes = await handleWorkflowRoutes(delCtx);
      expect(delRes?.status).toBe(200);
    });

    test("Recording routes /api/browser/workflows/record/*", async () => {
      const startCtx = makeCtx("/api/browser/workflows/record/start", "POST", {
        name: "API Recorded Flow",
      });
      const startRes = await handleWorkflowRoutes(startCtx);
      expect(startRes?.status).toBe(200);

      const actCtx = makeCtx("/api/browser/workflows/record/action", "POST", {
        action: "browser.navigate",
        arguments: { url: "https://example.com" },
      });
      const actRes = await handleWorkflowRoutes(actCtx);
      expect(actRes?.status).toBe(200);

      const statusCtx = makeCtx("/api/browser/workflows/record/status", "GET");
      const statusRes = await handleWorkflowRoutes(statusCtx);
      const statusData = await statusRes?.json();
      expect(statusData.recording).toBe(true);
      expect(statusData.steps.length).toBe(1);

      const stopCtx = makeCtx("/api/browser/workflows/record/stop", "POST", {
        tags: ["api-recorded"],
      });
      const stopRes = await handleWorkflowRoutes(stopCtx);
      expect(stopRes?.status).toBe(200);
      const stopData = await stopRes?.json();
      expect(stopData.workflow.name).toBe("API Recorded Flow");
    });
  });
});
