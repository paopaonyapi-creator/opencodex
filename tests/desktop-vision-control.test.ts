// tests/desktop-vision-control.test.ts
//
// Comprehensive test suite for Phase 20.3:
// Pao Desktop Vision Control MCP × Local Realtime Agent × Application Skill Engine

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import {
  createDesktopSession,
  getDesktopSession,
  listDesktopSessions,
  updateSessionStatus,
  triggerEmergencyStop,
} from "../src/agent-os/desktop/session";
import {
  createDesktopGoal,
  getDesktopGoal,
  listDesktopGoals,
  updateGoalStatus,
  cancelGoal,
  addGoalStep,
  getGoalSteps,
  updateStepStatus,
} from "../src/agent-os/desktop/goals";
import {
  getProfileRegistry,
  resetProfileRegistryForTests,
  BUILTIN_WINDOWS_PROFILE,
  BUILTIN_COMFYUI_PROFILE,
  BUILTIN_CHROMIUM_PROFILE,
} from "../src/agent-os/desktop/profiles";
import {
  getSkillRegistry,
  resetSkillRegistryForTests,
  getSkillRunner,
  BUILTIN_SKILLS,
} from "../src/agent-os/desktop/skills";
import {
  getObservationEngine,
  resetObservationEngineForTests,
  MockCaptureProvider,
  UIAAdapter,
  ChangeDetector,
  StaleGuard,
} from "../src/agent-os/desktop/observation";
import {
  getEmergencyStop,
  resetEmergencyStopForTests,
  getSafetyPolicyEvaluator,
  resetSafetyPolicyEvaluatorForTests,
  DEFAULT_SAFETY_POLICY,
} from "../src/agent-os/desktop/safety";
import {
  getMouseController,
  getKeyboardController,
  resetInputControllersForTests,
} from "../src/agent-os/desktop/input";
import {
  getActionExecutor,
  resetActionExecutorForTests,
  TIER_RANK,
} from "../src/agent-os/desktop/actions";
import { DESKTOP_MCP_TOOLS } from "../src/agent-os/desktop/mcp-tools";
import { handleDesktopRoutes } from "../src/server/management/desktop-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.3: Desktop Vision Control & Local Realtime Agent", () => {
  beforeEach(() => {
    resetProfileRegistryForTests();
    resetSkillRegistryForTests();
    resetObservationEngineForTests();
    resetEmergencyStopForTests();
    resetSafetyPolicyEvaluatorForTests();
    resetInputControllersForTests();
    resetActionExecutorForTests();
  });

  describe("1. Session Lifecycle & State Machine", () => {
    it("creates a new desktop session with default assisted mode and SQLite persistence", () => {
      const session = createDesktopSession({
        ownerUserId: "test_operator",
        dryRun: true,
      });

      expect(session.id).toBeString();
      expect(session.status).toBe("CREATED");
      expect(session.mode).toBe("ASSISTED");
      expect(session.dryRun).toBe(true);

      const retrieved = getDesktopSession(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.status).toBe("CREATED");
    });

    it("follows valid session transitions and updates database accordingly", () => {
      const session = createDesktopSession({});
      expect(session.status).toBe("CREATED");

      const s1 = updateSessionStatus(session.id, "STARTING");
      expect(s1.status).toBe("STARTING");

      const s2 = updateSessionStatus(session.id, "RUNNING");
      expect(s2.status).toBe("RUNNING");

      const s3 = updateSessionStatus(session.id, "PAUSED");
      expect(s3.status).toBe("PAUSED");

      const s4 = updateSessionStatus(session.id, "RUNNING");
      expect(s4.status).toBe("RUNNING");

      const s5 = updateSessionStatus(session.id, "STOPPING");
      expect(s5.status).toBe("STOPPING");

      const s6 = updateSessionStatus(session.id, "STOPPED");
      expect(s6.status).toBe("STOPPED");
    });

    it("rejects invalid session transitions", () => {
      const session = createDesktopSession({});
      // Cannot jump from CREATED directly to STOPPED or COMPLETED
      expect(() => updateSessionStatus(session.id, "COMPLETED")).toThrow();
    });

    it("lists sessions and filters by status", () => {
      const s1 = createDesktopSession({ ownerUserId: "user_a" });
      const s2 = createDesktopSession({ ownerUserId: "user_b" });
      updateSessionStatus(s2.id, "STARTING");
      updateSessionStatus(s2.id, "RUNNING");

      const all = listDesktopSessions();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const runningOnly = listDesktopSessions("RUNNING");
      expect(runningOnly.some((s) => s.id === s2.id)).toBe(true);
      expect(runningOnly.some((s) => s.id === s1.id)).toBe(false);
    });
  });

  describe("2. Desktop Goals & Sequential Steps", () => {
    it("creates, retrieves, and tracks high-level goals", () => {
      const session = createDesktopSession({});
      const goal = createDesktopGoal({
        sessionId: session.id,
        goalType: "render_workflow",
        title: "Render H3 Batch in ComfyUI",
        arguments: { workflow: "H3", count: 5 },
        riskLevel: "LOW",
      });

      expect(goal.id).toBeString();
      expect(goal.status).toBe("PENDING");
      expect(goal.argumentsJson.workflow).toBe("H3");

      const retrieved = getDesktopGoal(goal.id);
      expect(retrieved?.title).toBe("Render H3 Batch in ComfyUI");

      const updated = updateGoalStatus(goal.id, "READY");
      expect(updated.status).toBe("READY");

      const running = updateGoalStatus(goal.id, "RUNNING");
      expect(running.status).toBe("RUNNING");

      const completed = updateGoalStatus(goal.id, "SUCCEEDED");
      expect(completed.status).toBe("SUCCEEDED");
      expect(completed.completedAt).not.toBeNull();
    });

    it("adds steps to a goal and tracks step attempts and completion", () => {
      const session = createDesktopSession({});
      const goal = createDesktopGoal({
        sessionId: session.id,
        goalType: "browser_task",
        title: "Download Stock Report",
      });

      const step1 = addGoalStep({
        goalId: goal.id,
        sessionId: session.id,
        actionType: "APP_FOCUS",
        target: "chrome.exe",
      });

      const step2 = addGoalStep({
        goalId: goal.id,
        sessionId: session.id,
        actionType: "KEY_COMBINATION",
        target: "Ctrl+S",
      });

      expect(step1.stepIndex).toBe(0);
      expect(step2.stepIndex).toBe(1);

      const steps = getGoalSteps(goal.id);
      expect(steps.length).toBe(2);

      const finishedStep = updateStepStatus(step1.id, "SUCCEEDED");
      expect(finishedStep.status).toBe("SUCCEEDED");
      expect(finishedStep.completedAt).not.toBeNull();
    });

    it("cancels active goals gracefully with reason", () => {
      const session = createDesktopSession({});
      const goal = createDesktopGoal({
        sessionId: session.id,
        goalType: "test",
        title: "To be cancelled",
      });
      const cancelled = cancelGoal(goal.id, "Operator abort");
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.failureReason).toBe("Operator abort");
    });
  });

  describe("3. Application Profiles & Signal Matching", () => {
    it("registers built-in profiles for Windows, ComfyUI, and Chromium", () => {
      const registry = getProfileRegistry();
      expect(registry.get("windows.desktop")).not.toBeNull();
      expect(registry.get("comfyui")).not.toBeNull();
      expect(registry.get("chromium")).not.toBeNull();
      expect(registry.list().length).toBeGreaterThanOrEqual(3);
    });

    it("matches ComfyUI window with HIGH confidence based on process and title signals", () => {
      const registry = getProfileRegistry();
      const match = registry.matchWindow({
        processName: "python.exe",
        title: "ComfyUI - [H3 Studio]",
        className: "Chrome_WidgetWin_1",
      });

      expect(match.profile).not.toBeNull();
      expect(match.profile?.id).toBe("comfyui");
      expect(match.confidence).toBe("HIGH");
      expect(match.score).toBeGreaterThanOrEqual(0.7);
    });

    it("matches Windows Desktop with expected confidence", () => {
      const registry = getProfileRegistry();
      const match = registry.matchWindow({
        processName: "explorer.exe",
        title: "File Explorer",
        className: "CabinetWClass",
      });

      expect(match.profile?.id).toBe("windows.desktop");
      expect(match.confidence).toBe("HIGH");
    });

    it("returns UNKNOWN confidence for unrecognized windows", () => {
      const registry = getProfileRegistry();
      const match = registry.matchWindow({
        processName: "unknown_daemon.exe",
        title: "Background Service",
        className: "CustomClass",
      });

      expect(match.profile).toBeNull();
      expect(match.confidence).toBe("UNKNOWN");
      expect(match.score).toBeLessThan(0.2);
    });
  });

  describe("4. Application Skill Engine & Execution Runner", () => {
    it("registers built-in skills across profiles", () => {
      const registry = getSkillRegistry();
      const windowsSkills = registry.list("windows.desktop");
      const comfyuiSkills = registry.list("comfyui");
      const chromiumSkills = registry.list("chromium");

      expect(windowsSkills.length).toBeGreaterThanOrEqual(5);
      expect(comfyuiSkills.length).toBeGreaterThanOrEqual(5);
      expect(chromiumSkills.length).toBeGreaterThanOrEqual(5);

      const openWorkflow = registry.get("comfyui.open_workflow_ui");
      expect(openWorkflow).not.toBeNull();
      expect(openWorkflow?.arguments[0].name).toBe("workflowName");
      expect(openWorkflow?.arguments[0].required).toBe(true);
    });

    it("validates required skill arguments and rejects invalid types", () => {
      const registry = getSkillRegistry();
      const skill = registry.get("comfyui.open_workflow_ui")!;

      const valid = registry.validateArgs(skill, { workflowName: "H3_Upscale" });
      expect(valid.valid).toBe(true);
      expect(valid.errors).toHaveLength(0);

      const missing = registry.validateArgs(skill, {});
      expect(missing.valid).toBe(false);
      expect(missing.errors[0]).toContain("Missing required argument");

      const wrongType = registry.validateArgs(skill, { workflowName: 12345 });
      expect(wrongType.valid).toBe(false);
      expect(wrongType.errors[0]).toContain("expected string");
    });

    it("executes skill run in dryRun mode without actual OS mutation", async () => {
      const session = createDesktopSession({ dryRun: true });
      const runner = getSkillRunner();

      const result = await runner.execute({
        sessionId: session.id,
        skillId: "windows.focus_app",
        arguments: { windowTitle: "ComfyUI" },
        dryRun: true,
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(result.stepsExecuted).toBeGreaterThanOrEqual(1);

      const db = openAgentOsDb();
      const runRow = db.query("SELECT * FROM desktop_skill_runs WHERE id = ?").get(result.runId) as { status: string; dry_run: number };
      expect(runRow.status).toBe("SUCCEEDED");
      expect(runRow.dry_run).toBe(1);
    });
  });

  describe("5. Observation Engine & Screen Change Detection", () => {
    it("captures monitor topology and produces normalized observation snapshot", async () => {
      const engine = getObservationEngine();
      const snapshot = await engine.observe("test_session");

      expect(snapshot.snapshotId).toBeString();
      expect(snapshot.displayTopologyHash).toBeString();
      expect(snapshot.screenHash).toBeString();
      expect(snapshot.visibleWindows.length).toBeGreaterThan(0);
      expect(snapshot.foregroundWindow).not.toBeNull();
    });

    it("tracks window enumeration and changes active foreground window", () => {
      const engine = getObservationEngine();
      const windows = engine.listWindows();
      expect(windows.length).toBeGreaterThanOrEqual(2);

      const fg = engine.getForeground();
      expect(fg).not.toBeNull();

      const changed = engine.setForeground("win_explorer_01");
      expect(changed?.windowId).toBe("win_explorer_01");
      expect(engine.getForeground()?.windowId).toBe("win_explorer_01");
    });

    it("detects screen change and calculates stable duration", () => {
      const detector = new ChangeDetector();
      const r1 = detector.detectChange("hash_frame_1");
      expect(r1.changed).toBe(true);
      expect(r1.changeScore).toBe(1.0);

      const r2 = detector.detectChange("hash_frame_1");
      expect(r2.changed).toBe(false);
      expect(r2.changeScore).toBe(0.0);

      const r3 = detector.detectChange("hash_frame_2");
      expect(r3.changed).toBe(true);
      expect(r3.changeScore).toBe(0.85);
    });

    it("redacts sensitive fields in UIA elements", () => {
      const adapter = new UIAAdapter();
      adapter.setElements([
        {
          elementId: "el_user",
          automationId: "txtUsername",
          controlType: "Edit",
          name: "Username Input",
          valueRedacted: false,
          bounds: { x: 10, y: 10, width: 200, height: 30 },
          enabled: true,
          visible: true,
          focused: false,
          keyboardFocusable: true,
          invokeSupported: false,
          selectionSupported: false,
          textSupported: true,
          ancestorPath: ["Window", "Pane"],
          confidence: 1.0,
        },
        {
          elementId: "el_pass",
          automationId: "txtPassword",
          controlType: "Password",
          name: "Account Password",
          valueRedacted: false,
          bounds: { x: 10, y: 50, width: 200, height: 30 },
          enabled: true,
          visible: true,
          focused: false,
          keyboardFocusable: true,
          invokeSupported: false,
          selectionSupported: false,
          textSupported: true,
          ancestorPath: ["Window", "Pane"],
          confidence: 1.0,
        },
      ]);

      const user = adapter.findByAutomationId("txtUsername");
      expect(user?.valueRedacted).toBe(false);

      const pass = adapter.findByAutomationId("txtPassword");
      expect(pass?.valueRedacted).toBe(true);
    });

    it("enforces StaleGuard freshness checks on screenshots", () => {
      const freshFrame = {
        frameId: "f1",
        capturedAt: new Date().toISOString(),
        geometryHash: "geom_1080p",
        screenHash: "screen_1",
      };

      const resOk = StaleGuard.isFresh(freshFrame, "geom_1080p", 2000);
      expect(resOk.fresh).toBe(true);

      // Stale due to geometry drift
      const resGeomDrift = StaleGuard.isFresh(freshFrame, "geom_resized", 2000);
      expect(resGeomDrift.fresh).toBe(false);
      expect(resGeomDrift.error).toBe("STALE_OBSERVATION");

      // Stale due to age
      const oldFrame = {
        ...freshFrame,
        capturedAt: new Date(Date.now() - 5000).toISOString(),
      };
      const resOld = StaleGuard.isFresh(oldFrame, "geom_1080p", 1000);
      expect(resOld.fresh).toBe(false);
      expect(resOld.error).toBe("STALE_OBSERVATION");
    });
  });

  describe("6. Safety Policy, Foreground Lock & Emergency Stop", () => {
    it("allows allowlisted applications and denies blocked applications", () => {
      const safety = getSafetyPolicyEvaluator();
      expect(safety.isApplicationAllowed("python.exe")).toBe(true);
      expect(safety.isApplicationAllowed("chrome.exe")).toBe(true);
      expect(safety.isApplicationAllowed("explorer.exe")).toBe(true);

      // Blocked password manager / administrative tools
      expect(safety.isApplicationAllowed("1password.exe")).toBe(false);
      expect(safety.isApplicationAllowed("bitwarden.exe")).toBe(false);
      expect(safety.isApplicationAllowed("regedit.exe")).toBe(false);
    });

    it("detects sensitive windows by title and process", () => {
      const safety = getSafetyPolicyEvaluator();
      const safeWin = { title: "ComfyUI - [H3 Studio]", processName: "python.exe" };
      expect(safety.isWindowSensitive(safeWin).sensitive).toBe(false);

      const sensitiveWin = { title: "Windows Credential Manager", processName: "explorer.exe" };
      expect(safety.isWindowSensitive(sensitiveWin).sensitive).toBe(true);

      const uacWin = { title: "User Account Control", processName: "consent.exe" };
      expect(safety.isWindowSensitive(uacWin).sensitive).toBe(true);
    });

    it("enforces Foreground Lock and halts on drift", () => {
      const safety = getSafetyPolicyEvaluator();
      const ok = safety.verifyForegroundLock("win_comfyui", "win_comfyui");
      expect(ok.ok).toBe(true);

      const drifted = safety.verifyForegroundLock("win_comfyui", "win_other_app");
      expect(drifted.ok).toBe(false);
      expect(drifted.error).toBe("FOREGROUND_MISMATCH");
    });

    it("enforces sliding-window action and click rate limits", () => {
      const safety = getSafetyPolicyEvaluator();
      for (let i = 0; i < DEFAULT_SAFETY_POLICY.maxClicksPerSecond; i++) {
        expect(safety.checkRateLimit(true).allowed).toBe(true);
      }
      // Next click within same second should be rate limited
      const exceeded = safety.checkRateLimit(true);
      expect(exceeded.allowed).toBe(false);
      expect(exceeded.error).toBe("ACTION_DENIED");
    });

    it("triggers emergency stop and releases all virtual mouse and keyboard inputs", () => {
      const mouse = getMouseController();
      const keyboard = getKeyboardController();
      const emergency = getEmergencyStop();

      // Hold mouse button and key
      mouse.buttonDown("left");
      keyboard.keyDown("Ctrl");
      expect(mouse.getHeldButtons()).toContain("left");
      expect(keyboard.getHeldKeys()).toContain("ctrl");

      // Trigger emergency stop
      emergency.trigger(undefined, "Operator hit Ctrl+Alt+Pause");
      expect(emergency.isStopped()).toBe(true);
      expect(emergency.getStopInfo().reason).toBe("Operator hit Ctrl+Alt+Pause");

      // Inputs must be automatically released
      expect(mouse.getHeldButtons()).toHaveLength(0);
      expect(keyboard.getHeldKeys()).toHaveLength(0);

      // Subsequent input attempts must throw while emergency stop is active
      expect(() => mouse.click()).toThrow("Emergency stop active");
      expect(() => keyboard.press("Enter")).toThrow("Emergency stop active");
    });
  });

  describe("7. Control Priority Ladder & Action Executor", () => {
    it("enforces 7-tier ladder precedence (Direct API > MCP > UIA > Vision > Relative > Absolute)", () => {
      const executor = getActionExecutor();

      // Using Tier 0 (DIRECT_API) when available is allowed
      expect(executor.validateControlTierLadder("DIRECT_API", "DIRECT_API")).toBe(true);

      // Using Tier 2 (UIA) when Tier 0 is available is prohibited by ladder
      expect(executor.validateControlTierLadder("UIA", "DIRECT_API")).toBe(false);

      // Using Tier 2 (UIA) when Tier 3 (VISION) is the only alternative is allowed
      expect(executor.validateControlTierLadder("UIA", "VISION")).toBe(true);

      // Relative coord (Tier 5) is higher rank than absolute (Tier 6)
      expect(TIER_RANK["RELATIVE_COORD"]).toBeLessThan(TIER_RANK["ABSOLUTE_COORD"]);
    });

    it("executes an action, verifies postconditions, and logs attempts to SQLite", async () => {
      const session = createDesktopSession({});
      const executor = getActionExecutor();

      const action = executor.createAction({
        sessionId: session.id,
        actionType: "KEY_COMBINATION",
        arguments: { hotkey: "Ctrl+C" },
      });

      const result = await executor.execute(action, { dryRun: true });
      expect(result.status).toBe("SUCCEEDED");
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].status).toBe("SUCCEEDED");

      const db = openAgentOsDb();
      const attempts = db.query("SELECT * FROM desktop_action_attempts WHERE action_id = ?").all(action.actionId);
      expect(attempts.length).toBe(1);
    });
  });

  describe("8. 21 Desktop MCP Tools", () => {
    it("exposes all 21 canonical Desktop MCP tools with appropriate risk tiers", () => {
      expect(DESKTOP_MCP_TOOLS.length).toBe(21);

      const toolNames = DESKTOP_MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain("desktop_agent_status");
      expect(toolNames).toContain("desktop_list_profiles");
      expect(toolNames).toContain("desktop_list_skills");
      expect(toolNames).toContain("desktop_create_session");
      expect(toolNames).toContain("desktop_start_session");
      expect(toolNames).toContain("desktop_pause_session");
      expect(toolNames).toContain("desktop_resume_session");
      expect(toolNames).toContain("desktop_stop_session");
      expect(toolNames).toContain("desktop_emergency_stop");
      expect(toolNames).toContain("desktop_observe");
      expect(toolNames).toContain("desktop_list_windows");
      expect(toolNames).toContain("desktop_get_foreground");
      expect(toolNames).toContain("desktop_focus_app");
      expect(toolNames).toContain("desktop_run_skill");
      expect(toolNames).toContain("desktop_get_skill_run");
      expect(toolNames).toContain("desktop_cancel_skill_run");
      expect(toolNames).toContain("desktop_create_goal");
      expect(toolNames).toContain("desktop_get_goal");
      expect(toolNames).toContain("desktop_cancel_goal");
      expect(toolNames).toContain("desktop_capture_evidence");
      expect(toolNames).toContain("desktop_get_action_log");
    });

    it("executes desktop_agent_status and desktop_observe MCP tools successfully", async () => {
      const statusTool = DESKTOP_MCP_TOOLS.find((t) => t.name === "desktop_agent_status")!;
      const statusRes = (await statusTool.execute({})) as { status: string; agentVersion: string };
      expect(statusRes.status).toBe("HEALTHY");
      expect(statusRes.agentVersion).toBe("20.3.0");

      const observeTool = DESKTOP_MCP_TOOLS.find((t) => t.name === "desktop_observe")!;
      const obsRes = (await observeTool.execute({ sessionId: "test_mcp" })) as { screenHash: string };
      expect(obsRes.screenHash).toBeString();
    });
  });

  describe("9. REST Management API Routes (/api/desktop/*)", () => {
    function mockCtx(method: string, pathname: string, body?: unknown): ManagementContext {
      const url = new URL(`http://localhost:18080${pathname}`);
      const init: RequestInit = { method };
      if (body) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body);
      }
      return {
        req: new Request(url.toString(), init),
        url,
        config: {} as never,
        deps: {} as never,
        principal: { type: "admin" } as never,
        convergeCodexCatalog: async () => ({} as never),
        syncClaudeAgentDefsBestEffort: async () => {},
      };
    }

    it("GET /api/desktop/agent returns agent status and version", async () => {
      const ctx = mockCtx("GET", "/api/desktop/agent");
      const res = await handleDesktopRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const json = await res?.json();
      expect(json.success).toBe(true);
      expect(json.version).toBe("20.3.0");
      expect(json.status).toBe("HEALTHY");
    });

    it("GET /api/desktop/profiles and /api/desktop/skills return registry lists", async () => {
      const ctxP = mockCtx("GET", "/api/desktop/profiles");
      const resP = await handleDesktopRoutes(ctxP);
      const jsonP = await resP?.json();
      expect(jsonP.profiles.length).toBeGreaterThanOrEqual(3);

      const ctxS = mockCtx("GET", "/api/desktop/skills");
      const resS = await handleDesktopRoutes(ctxS);
      const jsonS = await resS?.json();
      expect(jsonS.skills.length).toBeGreaterThanOrEqual(10);
    });

    it("POST /api/desktop/sessions creates a session, and start/pause/stop update status", async () => {
      const createCtx = mockCtx("POST", "/api/desktop/sessions", { mode: "AUTONOMOUS_SAFE" });
      const createRes = await handleDesktopRoutes(createCtx);
      expect(createRes?.status).toBe(201);
      const { session } = await createRes?.json();
      expect(session.id).toBeString();
      expect(session.mode).toBe("AUTONOMOUS_SAFE");

      const startCtx = mockCtx("POST", `/api/desktop/sessions/${session.id}/start`);
      const startRes = await handleDesktopRoutes(startCtx);
      const startJson = await startRes?.json();
      expect(startJson.session.status).toBe("RUNNING");

      const pauseCtx = mockCtx("POST", `/api/desktop/sessions/${session.id}/pause`);
      const pauseRes = await handleDesktopRoutes(pauseCtx);
      const pauseJson = await pauseRes?.json();
      expect(pauseJson.session.status).toBe("PAUSED");

      const stopCtx = mockCtx("POST", `/api/desktop/sessions/${session.id}/stop`);
      const stopRes = await handleDesktopRoutes(stopCtx);
      const stopJson = await stopRes?.json();
      expect(stopJson.session.status).toBe("STOPPED");
    });

    it("POST /api/desktop/emergency-stop triggers emergency stop via REST", async () => {
      const ctx = mockCtx("POST", "/api/desktop/emergency-stop", { reason: "API Killswitch" });
      const res = await handleDesktopRoutes(ctx);
      expect(res?.status).toBe(200);

      const json = await res?.json();
      expect(json.emergencyStopped).toBe(true);
      expect(getEmergencyStop().isStopped()).toBe(true);
    });
  });
});
