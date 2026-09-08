// Phase 20.3 — Desktop Application Profiles
//
// Registry of application profiles (Windows Desktop, ComfyUI, Chromium Browser)
// with weighted signal matching (process name, window title, window class, UIA fingerprint).

import { openAgentOsDb } from "../db";
import type { ApplicationProfile, WindowSnapshot, ProfileConfidence } from "./types";

export const BUILTIN_WINDOWS_PROFILE: ApplicationProfile = {
  id: "windows.desktop",
  displayName: "Windows Desktop",
  version: 1,
  processMatch: {
    processNames: ["explorer.exe", "shellexperiencehost.exe", "searchhost.exe"],
    executablePaths: ["C:\\Windows\\explorer.exe"],
  },
  windowMatch: {
    titleContains: ["Program Manager", "File Explorer", "Taskbar", "Desktop"],
    className: "Progman",
  },
  security: {
    allowInput: true,
    allowClipboard: false,
    destructiveActionsRequireApproval: true,
  },
  states: [
    { id: "desktop", label: "Desktop Surface" },
    { id: "explorer", label: "File Explorer" },
    { id: "window_opened", label: "Window Opened" },
  ],
  skills: [
    "windows.launch_app",
    "windows.focus_app",
    "windows.list_windows",
    "windows.wait_for_window",
    "windows.maximize_window",
    "windows.restore_window",
    "windows.close_window_safe",
    "windows.capture_window",
    "windows.get_foreground",
  ],
  enabled: true,
};

export const BUILTIN_COMFYUI_PROFILE: ApplicationProfile = {
  id: "comfyui",
  displayName: "ComfyUI Local Studio",
  version: 1,
  processMatch: {
    processNames: ["python.exe", "pythonw.exe", "comfyui.exe", "chrome.exe", "msedge.exe", "electron.exe"],
  },
  windowMatch: {
    titleContains: ["ComfyUI"],
  },
  security: {
    allowInput: true,
    allowClipboard: false,
    destructiveActionsRequireApproval: true,
  },
  states: [
    { id: "idle", label: "ComfyUI Ready" },
    { id: "workflow_loaded", label: "Workflow Active" },
    { id: "queue_active", label: "Queue Processing" },
    { id: "generating", label: "Generating Asset" },
    { id: "error", label: "Execution Error" },
  ],
  skills: [
    "comfyui.ensure_open",
    "comfyui.focus",
    "comfyui.detect_ready",
    "comfyui.inspect_queue",
    "comfyui.open_workflow_ui",
    "comfyui.verify_workflow_loaded",
    "comfyui.queue_generation",
    "comfyui.cancel_owned_job",
    "comfyui.capture_status",
  ],
  enabled: true,
};

export const BUILTIN_CHROMIUM_PROFILE: ApplicationProfile = {
  id: "chromium",
  displayName: "Chromium Browser",
  version: 1,
  processMatch: {
    processNames: ["chrome.exe", "msedge.exe", "brave.exe"],
  },
  windowMatch: {
    titleContains: ["Google Chrome", "Microsoft Edge", "Brave"],
  },
  security: {
    allowInput: true,
    allowClipboard: false,
    destructiveActionsRequireApproval: true,
  },
  states: [
    { id: "tab_loaded", label: "Page Ready" },
    { id: "loading", label: "Navigating" },
    { id: "idle", label: "Idle Tab" },
  ],
  skills: [
    "browser.focus",
    "browser.open_url_safe",
    "browser.wait_for_page_state",
    "browser.find_text",
    "browser.click_safe_element",
    "browser.download_wait",
    "browser.capture_page_evidence",
  ],
  enabled: true,
};

export class ProfileRegistry {
  private profiles = new Map<string, ApplicationProfile>();

  constructor() {
    this.registerBuiltins();
    this.loadFromDb();
  }

  private registerBuiltins(): void {
    this.register(BUILTIN_WINDOWS_PROFILE, false);
    this.register(BUILTIN_COMFYUI_PROFILE, false);
    this.register(BUILTIN_CHROMIUM_PROFILE, false);
  }

  public register(profile: ApplicationProfile, persist = true): void {
    this.profiles.set(profile.id, profile);
    if (persist) {
      this.persistToDb(profile);
    }
  }

  public get(id: string): ApplicationProfile | null {
    return this.profiles.get(id) ?? null;
  }

  public list(): ApplicationProfile[] {
    return Array.from(this.profiles.values());
  }

  public matchWindow(win: Partial<WindowSnapshot>): {
    profile: ApplicationProfile | null;
    confidence: ProfileConfidence;
    score: number;
  } {
    let bestProfile: ApplicationProfile | null = null;
    let highestScore = 0;

    const procName = win.processName?.toLowerCase() ?? "";
    const title = win.title?.toLowerCase() ?? "";
    const cls = win.className?.toLowerCase() ?? "";

    for (const profile of this.profiles.values()) {
      if (!profile.enabled) continue;
      let score = 0;

      // 1. Process match: weight 0.35
      const procMatches = profile.processMatch.processNames.some(
        (p) => procName === p.toLowerCase() || procName.includes(p.toLowerCase()),
      );
      if (procMatches) score += 0.35;

      // 2. Title match: weight 0.35
      if (profile.windowMatch.titleContains) {
        const titleMatches = profile.windowMatch.titleContains.some((t) =>
          title.includes(t.toLowerCase()),
        );
        if (titleMatches) score += 0.35;
      } else if (profile.windowMatch.titleRegex) {
        try {
          const re = new RegExp(profile.windowMatch.titleRegex, "i");
          if (re.test(title)) score += 0.35;
        } catch {
          // ignore malformed regex
        }
      }

      // 3. Class name match: weight 0.15
      if (profile.windowMatch.className && cls) {
        if (cls.includes(profile.windowMatch.className.toLowerCase())) {
          score += 0.15;
        }
      }

      // 4. Baseline presence / enabled weight: 0.15
      if (score > 0) {
        score += 0.15;
      }

      if (score > highestScore) {
        highestScore = score;
        bestProfile = profile;
      }
    }

    let confidence: ProfileConfidence = "UNKNOWN";
    if (highestScore >= 0.7) confidence = "HIGH";
    else if (highestScore >= 0.45) confidence = "MEDIUM";
    else if (highestScore >= 0.2) confidence = "LOW";

    return {
      profile: highestScore >= 0.2 ? bestProfile : null,
      confidence,
      score: Math.min(1, highestScore),
    };
  }

  private persistToDb(p: ApplicationProfile): void {
    try {
      const db = openAgentOsDb();
      db.query(`INSERT OR REPLACE INTO desktop_profiles
        (id, display_name, version, process_match_json, window_match_json, security_json, states_json, skills_json, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        p.id,
        p.displayName,
        p.version,
        JSON.stringify(p.processMatch),
        JSON.stringify(p.windowMatch),
        JSON.stringify(p.security),
        JSON.stringify(p.states),
        JSON.stringify(p.skills),
        p.enabled ? 1 : 0,
      );
    } catch {
      // safe fallback if DB not ready
    }
  }

  private loadFromDb(): void {
    try {
      const db = openAgentOsDb();
      const rows = db.query("SELECT * FROM desktop_profiles").all() as Record<string, unknown>[];
      for (const row of rows) {
        const profile: ApplicationProfile = {
          id: String(row.id),
          displayName: String(row.display_name),
          version: Number(row.version),
          processMatch: JSON.parse(String(row.process_match_json || "{}")),
          windowMatch: JSON.parse(String(row.window_match_json || "{}")),
          security: JSON.parse(String(row.security_json || "{}")),
          states: JSON.parse(String(row.states_json || "[]")),
          skills: JSON.parse(String(row.skills_json || "[]")),
          enabled: Boolean(row.enabled),
        };
        this.profiles.set(profile.id, profile);
      }
    } catch {
      // safe fallback if table not migrated yet
    }
  }
}

let registryInstance: ProfileRegistry | null = null;

export function getProfileRegistry(): ProfileRegistry {
  if (!registryInstance) {
    registryInstance = new ProfileRegistry();
  }
  return registryInstance;
}

export function resetProfileRegistryForTests(): void {
  registryInstance = null;
}
