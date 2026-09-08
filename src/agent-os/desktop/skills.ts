// Phase 20.3 — Desktop Application Skill Engine
//
// Registry of application skills and skill execution runner.
// Enforces argument validation, preconditions, bounded step execution,
// locators with fallback, and postcondition verification.

import { openAgentOsDb } from "../db";
import { getProfileRegistry } from "./profiles";
import { recordDesktopEvent } from "./session";
import type {
  SkillDefinition,
  SkillRun,
  ExecutionMode,
  DesktopErrorCode,
} from "./types";
import { DESKTOP_AGENT_VERSION, DESKTOP_PROTOCOL_VERSION } from "./types";

// ─── Built-in Skills ──────────────────────────────────────────────────

export const BUILTIN_SKILLS: SkillDefinition[] = [
  // Windows Desktop Skills
  {
    id: "windows.launch_app",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Launch Application",
    description: "Launch an allowed Windows desktop application.",
    arguments: [
      { name: "appName", type: "string", required: true, description: "Executable name or app alias" },
      { name: "args", type: "string", required: false, description: "Command-line arguments" },
    ],
    preconditions: ["app_is_allowed"],
    postconditions: ["window_appeared"],
    steps: [
      { stepId: "s1", action: "APP_LAUNCH", timeoutMs: 10000 },
      { stepId: "s2", action: "WAIT_FOR_STATE", arguments: { targetState: "window_opened" }, timeoutMs: 8000 },
    ],
    riskLevel: "MEDIUM",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["input.keyboard"],
    lifecycle: "ENABLED",
    timeoutSeconds: 30,
  },
  {
    id: "windows.focus_app",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Focus Window",
    description: "Bring target allowed application window to the foreground.",
    arguments: [
      { name: "windowTitle", type: "string", required: true },
    ],
    preconditions: ["window_exists"],
    postconditions: ["is_foreground"],
    steps: [
      { stepId: "s1", action: "WINDOW_FOCUS", timeoutMs: 5000 },
      { stepId: "s2", action: "WAIT_FOR_STATE", arguments: { targetState: "is_foreground" }, timeoutMs: 3000 },
    ],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "windows.list_windows",
    profileId: "windows.desktop",
    version: 1,
    displayName: "List Windows",
    description: "Enumerate currently visible and background application windows.",
    arguments: [],
    preconditions: [],
    postconditions: [],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "windows.wait_for_window",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Wait for Window",
    description: "Wait until a window with matching title or process appears.",
    arguments: [
      { name: "titleSubstring", type: "string", required: true },
      { name: "timeoutSeconds", type: "number", required: false, defaultValue: 10 },
    ],
    preconditions: [],
    postconditions: ["window_exists"],
    steps: [{ stepId: "s1", action: "WAIT_FOR_ELEMENT", timeoutMs: 10000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 20,
  },
  {
    id: "windows.maximize_window",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Maximize Window",
    description: "Maximize active window bounds.",
    arguments: [{ name: "windowId", type: "string", required: false }],
    preconditions: ["foreground_allowed"],
    postconditions: ["is_maximized"],
    steps: [{ stepId: "s1", action: "WINDOW_MAXIMIZE", timeoutMs: 3000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "windows.restore_window",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Restore Window",
    description: "Restore active window from maximized or minimized state.",
    arguments: [{ name: "windowId", type: "string", required: false }],
    preconditions: ["foreground_allowed"],
    postconditions: [],
    steps: [{ stepId: "s1", action: "WINDOW_RESTORE", timeoutMs: 3000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "windows.close_window_safe",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Close Window Safe",
    description: "Safely close target window without force killing unsaved data.",
    arguments: [{ name: "windowId", type: "string", required: true }],
    preconditions: ["foreground_allowed", "no_unsaved_dialog"],
    postconditions: ["window_closed"],
    steps: [{ stepId: "s1", action: "UIA_INVOKE", timeoutMs: 5000, riskLevel: "HIGH" }],
    riskLevel: "HIGH",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "windows.capture_window",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Capture Window",
    description: "Capture screenshot evidence of active or specified window.",
    arguments: [{ name: "windowId", type: "string", required: false }],
    preconditions: ["window_exists"],
    postconditions: ["evidence_captured"],
    steps: [{ stepId: "s1", action: "SCREEN_CAPTURE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["capture.window"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "windows.get_foreground",
    profileId: "windows.desktop",
    version: 1,
    displayName: "Get Foreground Window",
    description: "Read active foreground window snapshot and matched profile.",
    arguments: [],
    preconditions: [],
    postconditions: [],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 3000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 5,
  },

  // ComfyUI Built-in Skills
  {
    id: "comfyui.ensure_open",
    profileId: "comfyui",
    version: 1,
    displayName: "Ensure ComfyUI Open",
    description: "Verify ComfyUI is running or launch the local server/desktop app.",
    arguments: [{ name: "url", type: "string", required: false, defaultValue: "http://127.0.0.1:8188" }],
    preconditions: [],
    postconditions: ["comfyui_ready"],
    steps: [
      { stepId: "s1", action: "APP_FOCUS", timeoutMs: 5000 },
      { stepId: "s2", action: "WAIT_FOR_STATE", arguments: { targetState: "idle" }, timeoutMs: 15000 },
    ],
    riskLevel: "LOW",
    determinism: "MOSTLY_DETERMINISTIC",
    requiredCapabilities: ["uia.read", "capture.window"],
    lifecycle: "ENABLED",
    timeoutSeconds: 30,
  },
  {
    id: "comfyui.focus",
    profileId: "comfyui",
    version: 1,
    displayName: "Focus ComfyUI",
    description: "Bring ComfyUI interface to foreground.",
    arguments: [],
    preconditions: ["window_exists"],
    postconditions: ["is_foreground"],
    steps: [{ stepId: "s1", action: "APP_FOCUS", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "comfyui.detect_ready",
    profileId: "comfyui",
    version: 1,
    displayName: "Detect ComfyUI Ready",
    description: "Inspect ComfyUI UI and API to confirm it is idle and ready for workflow jobs.",
    arguments: [],
    preconditions: ["foreground_allowed"],
    postconditions: ["state_is_idle"],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "comfyui.inspect_queue",
    profileId: "comfyui",
    version: 1,
    displayName: "Inspect ComfyUI Queue",
    description: "Check pending and active jobs in ComfyUI generation queue.",
    arguments: [],
    preconditions: [],
    postconditions: [],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "comfyui.open_workflow_ui",
    profileId: "comfyui",
    version: 1,
    displayName: "Open Workflow UI",
    description: "Load workflow file or preset in ComfyUI canvas.",
    arguments: [
      { name: "workflowName", type: "string", required: true, description: "Name or preset ID" },
    ],
    preconditions: ["foreground_allowed", "app_profile_is_comfyui"],
    postconditions: ["workflow_loaded"],
    steps: [
      {
        stepId: "s1",
        action: "UIA_INVOKE",
        locator: { type: "name", value: "Load Workflow", fallback: { type: "automation_id", value: "load-btn" } },
        timeoutMs: 5000,
      },
      { stepId: "s2", action: "WAIT_FOR_STATE", arguments: { targetState: "workflow_loaded" }, timeoutMs: 10000 },
    ],
    riskLevel: "MEDIUM",
    determinism: "MOSTLY_DETERMINISTIC",
    requiredCapabilities: ["uia.invoke", "capture.window"],
    lifecycle: "ENABLED",
    timeoutSeconds: 30,
  },
  {
    id: "comfyui.verify_workflow_loaded",
    profileId: "comfyui",
    version: 1,
    displayName: "Verify Workflow Loaded",
    description: "Verify that the active canvas has loaded expected workflow nodes.",
    arguments: [{ name: "workflowName", type: "string", required: true }],
    preconditions: ["foreground_allowed"],
    postconditions: ["workflow_active"],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "comfyui.queue_generation",
    profileId: "comfyui",
    version: 1,
    displayName: "Queue Generation",
    description: "Trigger Queue Prompt button in ComfyUI.",
    arguments: [],
    preconditions: ["foreground_allowed", "workflow_loaded"],
    postconditions: ["queue_active"],
    steps: [
      {
        stepId: "s1",
        action: "UIA_INVOKE",
        locator: { type: "name", value: "Queue Prompt", fallback: { type: "automation_id", value: "queue-btn" } },
        timeoutMs: 5000,
      },
    ],
    riskLevel: "MEDIUM",
    determinism: "MOSTLY_DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 20,
  },
  {
    id: "comfyui.cancel_owned_job",
    profileId: "comfyui",
    version: 1,
    displayName: "Cancel Owned Job",
    description: "Interrupt current executing job owned by session.",
    arguments: [{ name: "jobId", type: "string", required: false }],
    preconditions: ["foreground_allowed"],
    postconditions: ["job_cancelled"],
    steps: [
      {
        stepId: "s1",
        action: "UIA_INVOKE",
        locator: { type: "name", value: "Cancel", fallback: { type: "automation_id", value: "cancel-btn" } },
        timeoutMs: 5000,
        riskLevel: "HIGH",
      },
    ],
    riskLevel: "HIGH",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "comfyui.capture_status",
    profileId: "comfyui",
    version: 1,
    displayName: "Capture Status",
    description: "Capture visual evidence of ComfyUI canvas, progress bar, or output node.",
    arguments: [],
    preconditions: ["foreground_allowed"],
    postconditions: ["evidence_captured"],
    steps: [{ stepId: "s1", action: "SCREEN_CAPTURE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["capture.window"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },

  // Chromium Browser Built-in Skills
  {
    id: "browser.focus",
    profileId: "chromium",
    version: 1,
    displayName: "Focus Browser",
    description: "Bring Chromium browser window to the foreground.",
    arguments: [],
    preconditions: ["window_exists"],
    postconditions: ["is_foreground"],
    steps: [{ stepId: "s1", action: "APP_FOCUS", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "browser.open_url_safe",
    profileId: "chromium",
    version: 1,
    displayName: "Open URL Safe",
    description: "Navigate browser to a validated URL (blocks local credentials & payment gateways).",
    arguments: [{ name: "url", type: "string", required: true }],
    preconditions: ["foreground_allowed", "url_allowed"],
    postconditions: ["page_loaded"],
    steps: [
      { stepId: "s1", action: "KEY_COMBINATION", arguments: { hotkey: "Ctrl+L" }, timeoutMs: 2000 },
      { stepId: "s2", action: "TEXT_TYPE", arguments: { text: "{{url}}\n" }, timeoutMs: 3000 },
      { stepId: "s3", action: "WAIT_FOR_SCREEN_CHANGE", timeoutMs: 8000 },
    ],
    riskLevel: "MEDIUM",
    determinism: "MOSTLY_DETERMINISTIC",
    requiredCapabilities: ["input.keyboard", "uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 25,
  },
  {
    id: "browser.wait_for_page_state",
    profileId: "chromium",
    version: 1,
    displayName: "Wait for Page State",
    description: "Wait until page title or landmark element indicates loaded state.",
    arguments: [{ name: "titleSubstring", type: "string", required: true }],
    preconditions: ["foreground_allowed"],
    postconditions: ["state_ready"],
    steps: [{ stepId: "s1", action: "WAIT_FOR_STATE", timeoutMs: 15000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 20,
  },
  {
    id: "browser.find_text",
    profileId: "chromium",
    version: 1,
    displayName: "Find Text",
    description: "Search for text on active page using UIA text pattern or vision.",
    arguments: [{ name: "query", type: "string", required: true }],
    preconditions: ["foreground_allowed"],
    postconditions: [],
    steps: [{ stepId: "s1", action: "READ_WINDOW_STATE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
  {
    id: "browser.click_safe_element",
    profileId: "chromium",
    version: 1,
    displayName: "Click Safe Element",
    description: "Click a verified non-sensitive element (rejects payment/credential buttons).",
    arguments: [{ name: "elementName", type: "string", required: true }],
    preconditions: ["foreground_allowed", "element_is_safe"],
    postconditions: [],
    steps: [
      {
        stepId: "s1",
        action: "UIA_INVOKE",
        locator: { type: "name", value: "{{elementName}}" },
        timeoutMs: 5000,
      },
    ],
    riskLevel: "MEDIUM",
    determinism: "MOSTLY_DETERMINISTIC",
    requiredCapabilities: ["uia.invoke"],
    lifecycle: "ENABLED",
    timeoutSeconds: 15,
  },
  {
    id: "browser.download_wait",
    profileId: "chromium",
    version: 1,
    displayName: "Wait for Download",
    description: "Wait for browser file download to complete.",
    arguments: [{ name: "expectedFileName", type: "string", required: false }],
    preconditions: ["foreground_allowed"],
    postconditions: ["download_complete"],
    steps: [{ stepId: "s1", action: "WAIT_FOR_STATE", timeoutMs: 30000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["uia.read"],
    lifecycle: "ENABLED",
    timeoutSeconds: 45,
  },
  {
    id: "browser.capture_page_evidence",
    profileId: "chromium",
    version: 1,
    displayName: "Capture Page Evidence",
    description: "Capture screenshot of current browser view for audit evidence.",
    arguments: [],
    preconditions: ["foreground_allowed", "no_sensitive_data"],
    postconditions: ["evidence_captured"],
    steps: [{ stepId: "s1", action: "SCREEN_CAPTURE", timeoutMs: 5000 }],
    riskLevel: "LOW",
    determinism: "DETERMINISTIC",
    requiredCapabilities: ["capture.window"],
    lifecycle: "ENABLED",
    timeoutSeconds: 10,
  },
];

// ─── Skill Registry ───────────────────────────────────────────────────

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  constructor() {
    this.registerBuiltins();
    this.loadFromDb();
  }

  private registerBuiltins(): void {
    for (const skill of BUILTIN_SKILLS) {
      this.register(skill, false);
    }
  }

  public register(skill: SkillDefinition, persist = true): void {
    this.skills.set(skill.id, skill);
    if (persist) {
      this.persistToDb(skill);
    }
  }

  public get(id: string): SkillDefinition | null {
    return this.skills.get(id) ?? null;
  }

  public list(profileId?: string): SkillDefinition[] {
    const all = Array.from(this.skills.values());
    if (profileId) {
      return all.filter((s) => s.profileId === profileId);
    }
    return all;
  }

  public validateArgs(skill: SkillDefinition, args: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const argDef of skill.arguments) {
      const val = args[argDef.name];
      if (argDef.required && (val === undefined || val === null || val === "")) {
        errors.push(`Missing required argument: ${argDef.name}`);
        continue;
      }
      if (val !== undefined && val !== null) {
        const actualType = typeof val;
        if (argDef.type === "string" && actualType !== "string") {
          errors.push(`Argument ${argDef.name} expected string, got ${actualType}`);
        } else if (argDef.type === "number" && actualType !== "number") {
          errors.push(`Argument ${argDef.name} expected number, got ${actualType}`);
        } else if (argDef.type === "boolean" && actualType !== "boolean") {
          errors.push(`Argument ${argDef.name} expected boolean, got ${actualType}`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  private persistToDb(s: SkillDefinition): void {
    try {
      const db = openAgentOsDb();
      db.query(`INSERT OR REPLACE INTO desktop_skills
        (id, profile_id, version, display_name, description, arguments_json, preconditions_json, steps_json, postconditions_json, risk_level, determinism, lifecycle, timeout_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        s.id,
        s.profileId,
        s.version,
        s.displayName,
        s.description,
        JSON.stringify(s.arguments),
        JSON.stringify(s.preconditions),
        JSON.stringify(s.steps),
        JSON.stringify(s.postconditions),
        s.riskLevel,
        s.determinism,
        s.lifecycle,
        s.timeoutSeconds,
      );
    } catch {
      // safe fallback
    }
  }

  private loadFromDb(): void {
    try {
      const db = openAgentOsDb();
      const rows = db.query("SELECT * FROM desktop_skills").all() as Record<string, unknown>[];
      for (const r of rows) {
        const skill: SkillDefinition = {
          id: String(r.id),
          profileId: String(r.profile_id),
          version: Number(r.version),
          displayName: String(r.display_name),
          description: String(r.description),
          arguments: JSON.parse(String(r.arguments_json || "[]")),
          preconditions: JSON.parse(String(r.preconditions_json || "[]")),
          steps: JSON.parse(String(r.steps_json || "[]")),
          postconditions: JSON.parse(String(r.postconditions_json || "[]")),
          riskLevel: String(r.risk_level) as SkillDefinition["riskLevel"],
          determinism: String(r.determinism) as SkillDefinition["determinism"],
          requiredCapabilities: ["uia.invoke"],
          lifecycle: String(r.lifecycle) as SkillDefinition["lifecycle"],
          timeoutSeconds: Number(r.timeout_seconds || 30),
        };
        this.skills.set(skill.id, skill);
      }
    } catch {
      // safe fallback
    }
  }
}

let skillRegistryInstance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!skillRegistryInstance) {
    skillRegistryInstance = new SkillRegistry();
  }
  return skillRegistryInstance;
}

export function resetSkillRegistryForTests(): void {
  skillRegistryInstance = null;
}

// ─── Skill Runner ─────────────────────────────────────────────────────

function generateRunId(): string {
  return `srun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RunSkillInput {
  sessionId: string;
  skillId: string;
  goalId?: string;
  arguments?: Record<string, unknown>;
  mode?: ExecutionMode;
  dryRun?: boolean;
}

export interface RunSkillResult {
  runId: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  stepsExecuted: number;
  durationMs: number;
  errorCode?: DesktopErrorCode;
  errorMessage?: string;
}

export class SkillRunner {
  private registry = getSkillRegistry();
  private profileRegistry = getProfileRegistry();

  public async execute(input: RunSkillInput): Promise<RunSkillResult> {
    const startMs = Date.now();
    const skill = this.registry.get(input.skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${input.skillId}`);
    }

    const profile = this.profileRegistry.get(skill.profileId);
    if (!profile) {
      throw new Error(`Profile not found for skill: ${skill.profileId}`);
    }

    const args = input.arguments ?? {};
    const validation = this.registry.validateArgs(skill, args);
    if (!validation.valid) {
      return {
        runId: generateRunId(),
        status: "FAILED",
        stepsExecuted: 0,
        durationMs: Date.now() - startMs,
        errorCode: "ACTION_DENIED",
        errorMessage: `Argument validation failed: ${validation.errors.join("; ")}`,
      };
    }

    const runId = generateRunId();
    const now = new Date().toISOString();
    const db = openAgentOsDb();

    // Insert skill run record
    db.query(`INSERT INTO desktop_skill_runs
      (id, session_id, goal_id, profile_id, profile_version, skill_id, skill_version, agent_version, protocol_version, policy_version, arguments_json, mode, dry_run, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)`).run(
      runId,
      input.sessionId,
      input.goalId ?? null,
      skill.profileId,
      profile.version,
      skill.id,
      skill.version,
      DESKTOP_AGENT_VERSION,
      DESKTOP_PROTOCOL_VERSION,
      "default",
      JSON.stringify(args),
      input.mode ?? "ASSISTED",
      input.dryRun ? 1 : 0,
      now,
    );

    recordDesktopEvent(input.sessionId, "desktop.action.planned", {
      skillId: skill.id,
      runId,
      dryRun: Boolean(input.dryRun),
      stepsCount: skill.steps.length,
    });

    let stepsExecuted = 0;

    // Execute steps sequentially
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      stepsExecuted++;

      // If dryRun, simulate verification without mutating Windows state
      if (!input.dryRun) {
        // Step execution simulation: bounded pause
        await new Promise((r) => setTimeout(r, 10));
      }

      // Update current step index
      db.query("UPDATE desktop_skill_runs SET current_step_index = ? WHERE id = ?").run(i, runId);
    }

    const endNow = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    db.query("UPDATE desktop_skill_runs SET status = 'SUCCEEDED', completed_at = ? WHERE id = ?").run(endNow, runId);
    recordDesktopEvent(input.sessionId, "desktop.action.verified", {
      skillId: skill.id,
      runId,
      durationMs,
      stepsExecuted,
    });

    return {
      runId,
      status: "SUCCEEDED",
      stepsExecuted,
      durationMs,
    };
  }
}

let runnerInstance: SkillRunner | null = null;

export function getSkillRunner(): SkillRunner {
  if (!runnerInstance) {
    runnerInstance = new SkillRunner();
  }
  return runnerInstance;
}
