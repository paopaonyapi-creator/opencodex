// Comprehensive test suite for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openAgentOsDb, closeAgentOsDbForTests, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  MobileDeviceRegistry,
  getMobileDeviceRegistry,
  MobileRiskClassifier,
  getMobileRiskClassifier,
  MobilePolicyEngine,
  getMobilePolicyEngine,
  ArtemisProvider,
  getArtemisProvider,
  MobileReviewerCouncil,
  getMobileReviewerCouncil,
  MobileTaskManager,
  getMobileTaskManager,
  createMobileMcpTools,
  resetMobileDeviceRegistryForTests,
  resetMobileTaskManagerForTests,
} from "../src/agent-os/mobile";
import { handleMobileRoutes } from "../src/server/management/mobile-routes";
import type { ManagementContext } from "../src/server/management/context";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pao-mobile-test-"));
    closeAgentOsDbForTests();
    resetMobileDeviceRegistryForTests();
    resetMobileTaskManagerForTests();
    openAgentOsDb(tempDir);
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    resetMobileDeviceRegistryForTests();
    resetMobileTaskManagerForTests();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("Sprint 1: Schema Version & Database Tables", () => {
    it("migrates to schema version 25 and creates mobile gateway tables", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBe(25);
      const db = openAgentOsDb(tempDir);

      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name);

      expect(tables).toContain("mobile_devices");
      expect(tables).toContain("mobile_tasks");
      expect(tables).toContain("mobile_task_events");
      expect(tables).toContain("mobile_artifacts");
      expect(tables).toContain("mobile_policy_decisions");
    });
  });

  describe("Sprint 2: Device Registry & Physical Personal Defaults", () => {
    it("auto-seeds the default test emulator android-test-01", () => {
      const registry = new MobileDeviceRegistry();
      const defaultDev = registry.getDevice("android-test-01");
      expect(defaultDev).not.toBeNull();
      expect(defaultDev?.alias).toBe("android-test-01");
      expect(defaultDev?.deviceType).toBe("emulator");
      expect(defaultDev?.allowAgent).toBe(true);
      expect(defaultDev?.requiresApproval).toBe(false);
    });

    it("strictly enforces allowAgent=false, requiresApproval=true for physical_personal devices", () => {
      const registry = new MobileDeviceRegistry();
      const personalDevice = registry.registerDevice({
        alias: "pao-personal-pixel",
        providerDeviceId: "pixel-serial-9988",
        deviceType: "physical_personal",
        trustLevel: "trusted",
        allowAgent: true, // Should be overridden to false by invariant rule
        allowShell: true, // Should be overridden to false
        requiresApproval: false, // Should be overridden to true
      });

      expect(personalDevice.deviceType).toBe("physical_personal");
      expect(personalDevice.allowAgent).toBe(false);
      expect(personalDevice.allowShell).toBe(false);
      expect(personalDevice.requiresApproval).toBe(true);

      const fetched = registry.getDevice("pao-personal-pixel");
      expect(fetched?.allowAgent).toBe(false);
      expect(fetched?.requiresApproval).toBe(true);
    });

    it("masks device serials for secure agent responses", () => {
      const registry = new MobileDeviceRegistry();
      const masked = registry.maskSerial("emulator-5554");
      expect(masked).toBe("emu****554");
    });

    it("toggles agent access and updates heartbeats", () => {
      const registry = new MobileDeviceRegistry();
      const dev = registry.getDevice("android-test-01")!;

      registry.setAgentAccess(dev.id, false);
      expect(registry.getDevice(dev.id)?.allowAgent).toBe(false);

      registry.setAgentAccess(dev.id, true);
      expect(registry.getDevice(dev.id)?.allowAgent).toBe(true);

      const updated = registry.updateHeartbeat(dev.id);
      expect(updated).toBe(true);
    });
  });

  describe("Sprint 3: Risk Classifier (R0–R4)", () => {
    const classifier = new MobileRiskClassifier();

    it("classifies R0 Observe Only tasks", () => {
      const res = classifier.classify("capture screenshot and inspect battery status");
      expect(res.riskLevel).toBe("R0");
    });

    it("classifies R1 Low Risk UI navigation tasks", () => {
      const res = classifier.classify("tap on settings and scroll through options");
      expect(res.riskLevel).toBe("R1");
    });

    it("classifies R2 Medium Risk tasks", () => {
      const res = classifier.classify("enter text into test form and clear cache");
      expect(res.riskLevel).toBe("R2");
    });

    it("classifies R3 High Risk system modification tasks", () => {
      const res = classifier.classify("uninstall app com.example.test and change system setting");
      expect(res.riskLevel).toBe("R3");
    });

    it("classifies R4 Forbidden Actions (crypto, banking, otp, wipe)", () => {
      const r4Banking = classifier.classify("transfer money via banking portal");
      expect(r4Banking.riskLevel).toBe("R4");

      const r4Crypto = classifier.classify("transfer crypto from wallet using seed phrase");
      expect(r4Crypto.riskLevel).toBe("R4");

      const r4Otp = classifier.classify("extract 2fa otp verification code from notification");
      expect(r4Otp.riskLevel).toBe("R4");

      const r4Bypass = classifier.classify("bypass screen lock pin code");
      expect(r4Bypass.riskLevel).toBe("R4");
    });
  });

  describe("Sprint 4: Policy Engine & Secret Redaction", () => {
    const policy = new MobilePolicyEngine();
    const registry = new MobileDeviceRegistry();

    it("redacts passwords and API tokens from goal string", () => {
      const redacted = policy.redactSecrets("login with password: supersecret123 and token: eyJhbGciOi...");
      expect(redacted).toContain("password: [REDACTED]");
      expect(redacted).toContain("token: [REDACTED]");
      expect(redacted).not.toContain("supersecret123");
    });

    it("immediately DENIES R4 forbidden tasks before provider is called", () => {
      const dev = registry.getDevice("android-test-01")!;
      const evalRes = policy.evaluate("mtask_test_1", "transfer bitcoin to external address", dev);
      expect(evalRes.decision).toBe("DENY");
      expect(evalRes.riskLevel).toBe("R4");
      expect(evalRes.ruleId).toBe("POL-FORBIDDEN-R4");
    });

    it("requires APPROVAL for R3 high risk tasks", () => {
      const dev = registry.getDevice("android-test-01")!;
      const evalRes = policy.evaluate("mtask_test_2", "uninstall application and modify developer options", dev);
      expect(evalRes.decision).toBe("WAITING_APPROVAL");
      expect(evalRes.riskLevel).toBe("R3");
      expect(evalRes.requiresApproval).toBe(true);
      expect(evalRes.requiresProProfile).toBe(true);
    });

    it("denies access when device is blocked or has allowAgent=false", () => {
      const blockedDev = registry.registerDevice({
        alias: "blocked-device-01",
        providerDeviceId: "serial-blocked",
        trustLevel: "blocked",
      });

      const evalRes = policy.evaluate("mtask_test_3", "tap on home", blockedDev);
      expect(evalRes.decision).toBe("DENY");
      expect(evalRes.ruleId).toBe("POL-DEV-BLOCKED");
    });
  });

  describe("Sprint 5: Provider Abstraction & Artemis Adapter", () => {
    it("reports healthy provider status and lists connected devices", async () => {
      const provider = new ArtemisProvider();
      const health = await provider.health();
      expect(health.ok).toBe(true);
      expect(health.version).toContain("artemis");

      const devices = await provider.listDevices();
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0].serial).toBe("emulator-5554");
    });

    it("captures device state with screenshot, dimensions, and UI hierarchy", async () => {
      const provider = new ArtemisProvider();
      const state = await provider.getDeviceState("emulator-5554");
      expect(state.online).toBe(true);
      expect(state.screen?.width).toBe(1080);
      expect(state.screen?.height).toBe(2400);
      expect(state.screenshotBase64).toBeDefined();
      expect(state.hierarchyJson).toContain("com.android.settings");
    });

    it("executes task with Flash and Pro profile differences", async () => {
      const provider = new ArtemisProvider();

      const flashRes = await provider.runTask({
        serial: "emulator-5554",
        goal: "open battery settings",
        profile: "flash",
        verificationLevel: "final",
      });
      expect(flashRes.status).toBe("COMPLETED");
      expect(flashRes.traceId).toBeDefined();

      const trace = await provider.inspectTrace(flashRes.traceId);
      expect(trace?.steps.length).toBeGreaterThanOrEqual(3);
      expect(trace?.steps.some((s) => s.target?.strategy === "text")).toBe(true);
    });
  });

  describe("Sprint 6: Task Manager Lifecycle & Human Supervisor Gate", () => {
    it("completes standard low-risk task (Battery settings) with artifacts and events", async () => {
      const taskManager = new MobileTaskManager();
      const task = await taskManager.runTask({
        goal: "navigate to battery settings and verify battery level",
        profile: "flash",
      });

      expect(task.status).toBe("COMPLETED");
      expect(["R0", "R1"]).toContain(task.riskLevel);
      expect(task.traceId).toBeDefined();
      expect(task.resultSummary?.reviewerEvaluation).toBeDefined();

      // Check task events
      const events = taskManager.getTaskEvents(task.id);
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events.map((e) => e.eventType)).toContain("state_transition");

      // Check artifacts
      const artifacts = taskManager.getTaskArtifacts(task.id);
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0].artifactType).toBe("trace");
    });

    it("BLOCKED_BY_POLICY: rejects forbidden crypto task without calling provider", async () => {
      const taskManager = new MobileTaskManager();
      const task = await taskManager.runTask({
        goal: "extract crypto wallet seed phrase and wire money",
      });

      expect(task.status).toBe("BLOCKED_BY_POLICY");
      expect(task.riskLevel).toBe("R4");
      expect(task.errorMessage).toContain("Forbidden safety violation");
      expect(task.providerTaskId).toBeUndefined();
    });

    it("WAITING_APPROVAL: pauses R3 tasks until approved by operator", async () => {
      const taskManager = new MobileTaskManager();
      const task = await taskManager.runTask({
        goal: "uninstall application com.unwanted.app and modify developer options",
      });

      expect(task.status).toBe("WAITING_APPROVAL");
      expect(task.riskLevel).toBe("R3");

      // Supervisor approves
      const approvedTask = await taskManager.approveTask(task.id, "senior_operator");
      expect(approvedTask.status).toBe("COMPLETED");
      expect(approvedTask.approvedBy).toBe("senior_operator");
      expect(approvedTask.resolvedProfile).toBe("pro");
    });

    it("rejection and stop flows work correctly", async () => {
      const taskManager = new MobileTaskManager();
      const task = await taskManager.runTask({
        goal: "uninstall system application",
      });
      expect(task.status).toBe("WAITING_APPROVAL");

      const rejected = await taskManager.rejectTask(task.id, "admin", "Not permitted in test phase");
      expect(rejected.status).toBe("REJECTED");
      expect(rejected.errorMessage).toContain("Not permitted in test phase");
    });
  });

  describe("Sprint 7: Reviewer Council Hook", () => {
    it("evaluates completed trace and issues PASS verdict", () => {
      const council = new MobileReviewerCouncil();
      const mockTask: any = { id: "mtask_1", verificationLevel: "final" };
      const mockTrace: any = {
        traceId: "trace_1",
        steps: [
          { step: 1, actionType: "tap", screenshotBefore: "base64...", result: "success" },
        ],
        checkerResults: [{ name: "Goal Check", pass: true }],
      };

      const evalRes = council.evaluateTask(mockTask, mockTrace);
      expect(evalRes.decision).toBe("PASS");
      expect(evalRes.goalComplete).toBe(true);
      expect(evalRes.safetyOk).toBe(true);
      expect(evalRes.confidence).toBeGreaterThan(0.9);
    });

    it("flags FAIL when checker fails or trace errors exist", () => {
      const council = new MobileReviewerCouncil();
      const mockTask: any = { id: "mtask_2", verificationLevel: "final" };
      const mockTrace: any = {
        traceId: "trace_2",
        steps: [{ step: 1, actionType: "tap", result: "success" }],
        checkerResults: [{ name: "Goal Check", pass: false, details: "Element not found" }],
        errors: ["Target view disappeared"],
      };

      const evalRes = council.evaluateTask(mockTask, mockTrace);
      expect(evalRes.decision).toBe("FAIL");
      expect(evalRes.goalComplete).toBe(false);
      expect(evalRes.safetyOk).toBe(false);
      expect(evalRes.issues.length).toBeGreaterThan(0);
    });
  });

  describe("Sprint 8: Canonical MCP Tools (pao_mobile_*)", () => {
    const tools = createMobileMcpTools();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    it("provides all 6 required canonical mobile tools", () => {
      expect(toolMap.has("pao_mobile_list_devices")).toBe(true);
      expect(toolMap.has("pao_mobile_get_device")).toBe(true);
      expect(toolMap.has("pao_mobile_run_task")).toBe(true);
      expect(toolMap.has("pao_mobile_manage_task")).toBe(true);
      expect(toolMap.has("pao_mobile_get_device_state")).toBe(true);
      expect(toolMap.has("pao_mobile_inspect_trace")).toBe(true);
    });

    it("pao_mobile_list_devices returns masked serials", async () => {
      const listTool = toolMap.get("pao_mobile_list_devices")!;
      const res = await listTool.handler({});
      expect(res.devices).toBeDefined();
      expect(res.devices.length).toBeGreaterThan(0);
      expect(res.devices[0].maskedSerial).toContain("****");
    });

    it("pao_mobile_run_task runs task with policy enforcement", async () => {
      const runTool = toolMap.get("pao_mobile_run_task")!;
      const res = await runTool.handler({
        goal: "tap on settings and view battery",
      });
      expect(res.taskId).toBeDefined();
      expect(res.status).toBe("COMPLETED");
    });

    it("pao_mobile_manage_task supports status, stop, inject, approve, reject", async () => {
      const manageTool = toolMap.get("pao_mobile_manage_task")!;
      const taskManager = getMobileTaskManager();
      const task = await taskManager.runTask({ goal: "open settings app" });

      const statusRes = await manageTool.handler({ taskId: task.id, action: "status" });
      expect(statusRes.task).toBeDefined();

      const injectRes = await manageTool.handler({
        taskId: task.id,
        action: "inject",
        instruction: "scroll down by 200px",
      });
      expect(injectRes.success).toBe(true);
    });
  });

  describe("Sprint 9: Management REST API Routes", () => {
    function makeContext(pathname: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://127.0.0.1:18080${pathname}`);
      const req = new Request(url.toString(), {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        req,
        url,
        config: {} as any,
        deps: {},
      } as any;
    }

    it("GET /api/mobile/health returns health metadata", async () => {
      const ctx = makeContext("/api/mobile/health");
      const res = await handleMobileRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as any;
      expect(data.ok).toBe(true);
      expect(data.provider).toBe("artemis");
      expect(data.devicesCount).toBeGreaterThan(0);
    });

    it("GET /api/mobile/devices returns device list", async () => {
      const ctx = makeContext("/api/mobile/devices");
      const res = await handleMobileRoutes(ctx);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as any;
      expect(data.devices).toBeDefined();
    });

    it("POST /api/mobile/tasks executes task via REST", async () => {
      const ctx = makeContext("/api/mobile/tasks", "POST", {
        goal: "inspect battery level on screen",
      });
      const res = await handleMobileRoutes(ctx);
      expect(res?.status).toBe(201);
      const data = (await res?.json()) as any;
      expect(data.task.status).toBe("COMPLETED");
    });

    it("POST /api/mobile/tasks returns 403 on R4 policy violation", async () => {
      const ctx = makeContext("/api/mobile/tasks", "POST", {
        goal: "transfer bitcoin from wallet",
      });
      const res = await handleMobileRoutes(ctx);
      expect(res?.status).toBe(403);
      const data = (await res?.json()) as any;
      expect(data.task.status).toBe("BLOCKED_BY_POLICY");
    });
  });
});
