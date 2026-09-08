// Phase 20.3 — Desktop Safety Policy & Emergency Stop Engine
//
// Enforces application allowlists, sensitive window guards, foreground lock,
// sliding-window rate limits, and emergency killswitch.

import { openAgentOsDb } from "../db";
import { recordDesktopEvent, updateSessionStatus } from "./session";
import type { WindowSnapshot, DesktopPolicy, DesktopErrorCode, DesktopRiskLevel } from "./types";

export const DEFAULT_SAFETY_POLICY: DesktopPolicy = {
  allowedApps: ["explorer.exe", "python.exe", "pythonw.exe", "comfyui.exe", "chrome.exe", "msedge.exe", "brave.exe", "electron.exe"],
  deniedApps: ["1password.exe", "keepass.exe", "bitwarden.exe", "lastpass.exe", "regedit.exe", "cmd.exe", "powershell.exe"],
  approvedExecutablePaths: ["C:\\Windows\\explorer.exe"],
  allowedTitlePatterns: ["ComfyUI", "File Explorer", "Chrome", "Edge", "Brave", "Desktop", "Program Manager"],
  deniedTitlePatterns: ["Credential Manager", "User Account Control", "Password", "Master Password", "Bank", "Transfer Confirmation", "Registry Editor"],
  sensitiveWindowPatterns: ["Password", "Security Settings", "UAC", "Pin", "Secret", "Payment"],
  maxActionsPerSecond: 5,
  maxClicksPerSecond: 3,
  maxRetriesPerStep: 3,
  actionTimeoutMs: 10000,
  skillTimeoutSeconds: 120,
  goalTimeoutSeconds: 600,
  frameMaxAgeMs: 1500,
  approvalMode: "high_risk_only",
  emergencyHotkey: "Ctrl+Alt+Pause",
};

export class EmergencyStopController {
  private stopped = false;
  private stopReason: string | null = null;
  private stoppedAt: string | null = null;
  private releaseCallbacks: (() => void)[] = [];

  public registerReleaseCallback(cb: () => void): void {
    this.releaseCallbacks.push(cb);
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public getStopInfo(): { stopped: boolean; reason: string | null; stoppedAt: string | null } {
    return {
      stopped: this.stopped,
      reason: this.stopReason,
      stoppedAt: this.stoppedAt,
    };
  }

  public trigger(sessionId?: string, reason = "Emergency stop requested"): void {
    this.stopped = true;
    this.stopReason = reason;
    this.stoppedAt = new Date().toISOString();

    // Release all active mouse and keyboard inputs immediately
    for (const release of this.releaseCallbacks) {
      try {
        release();
      } catch {
        // preserve fail-safe
      }
    }

    if (sessionId) {
      try {
        updateSessionStatus(sessionId, "EMERGENCY_STOPPED");
      } catch {
        // safe fallback
      }
      recordDesktopEvent(sessionId, "desktop.emergency_stop", { reason, timestamp: this.stoppedAt });
    }
  }

  public reset(): void {
    this.stopped = false;
    this.stopReason = null;
    this.stoppedAt = null;
  }
}

let emergencyStopInstance: EmergencyStopController | null = null;

export function getEmergencyStop(): EmergencyStopController {
  if (!emergencyStopInstance) {
    emergencyStopInstance = new EmergencyStopController();
  }
  return emergencyStopInstance;
}

export function resetEmergencyStopForTests(): void {
  emergencyStopInstance = null;
}

// ─── Safety Policy Evaluator ──────────────────────────────────────────

export class SafetyPolicyEvaluator {
  private policy: DesktopPolicy;
  private actionTimestamps: number[] = [];
  private clickTimestamps: number[] = [];

  constructor(policy: DesktopPolicy = DEFAULT_SAFETY_POLICY) {
    this.policy = policy;
  }

  public isApplicationAllowed(processName?: string): boolean {
    if (!processName) return false;
    const lower = processName.toLowerCase();

    // Explicit deny check
    if (this.policy.deniedApps.some((d) => lower.includes(d.toLowerCase()))) {
      return false;
    }

    // Explicit allow check
    return this.policy.allowedApps.some((a) => lower.includes(a.toLowerCase()));
  }

  public isWindowSensitive(window: Partial<WindowSnapshot>): {
    sensitive: boolean;
    reason?: string;
  } {
    const title = window.title?.toLowerCase() ?? "";
    const proc = window.processName?.toLowerCase() ?? "";

    for (const pattern of this.policy.deniedTitlePatterns) {
      if (title.includes(pattern.toLowerCase())) {
        return { sensitive: true, reason: `Matches denied title pattern: ${pattern}` };
      }
    }

    for (const pattern of this.policy.sensitiveWindowPatterns) {
      if (title.includes(pattern.toLowerCase())) {
        return { sensitive: true, reason: `Matches sensitive window pattern: ${pattern}` };
      }
    }

    for (const deniedApp of this.policy.deniedApps) {
      if (proc.includes(deniedApp.toLowerCase())) {
        return { sensitive: true, reason: `Matches denied application: ${deniedApp}` };
      }
    }

    return { sensitive: false };
  }

  public verifyForegroundLock(
    expectedWindowId: string,
    currentWindowId?: string | null,
  ): { ok: boolean; error?: DesktopErrorCode; reason?: string } {
    if (getEmergencyStop().isStopped()) {
      return { ok: false, error: "EMERGENCY_STOPPED", reason: "System is in emergency stop state" };
    }

    if (!currentWindowId || currentWindowId !== expectedWindowId) {
      return {
        ok: false,
        error: "FOREGROUND_MISMATCH",
        reason: `Active window drifted (expected ${expectedWindowId}, actual ${currentWindowId ?? "none"})`,
      };
    }

    return { ok: true };
  }

  public checkRateLimit(isClick = false): { allowed: boolean; error?: DesktopErrorCode; reason?: string } {
    const now = Date.now();
    const oneSecAgo = now - 1000;

    // Prune old timestamps
    this.actionTimestamps = this.actionTimestamps.filter((t) => t > oneSecAgo);
    this.clickTimestamps = this.clickTimestamps.filter((t) => t > oneSecAgo);

    if (this.actionTimestamps.length >= this.policy.maxActionsPerSecond) {
      return {
        allowed: false,
        error: "ACTION_DENIED",
        reason: `Rate limit exceeded: max ${this.policy.maxActionsPerSecond} actions/sec`,
      };
    }

    if (isClick && this.clickTimestamps.length >= this.policy.maxClicksPerSecond) {
      return {
        allowed: false,
        error: "ACTION_DENIED",
        reason: `Click rate limit exceeded: max ${this.policy.maxClicksPerSecond} clicks/sec`,
      };
    }

    this.actionTimestamps.push(now);
    if (isClick) {
      this.clickTimestamps.push(now);
    }

    return { allowed: true };
  }

  public evaluateRisk(
    actionType: string,
    targetApp?: string,
    isDestructive = false,
  ): { riskLevel: DesktopRiskLevel; requiresApproval: boolean } {
    if (isDestructive) {
      return { riskLevel: "HIGH", requiresApproval: true };
    }

    const highRiskActions = ["UIA_SET_VALUE", "KEY_PRESS", "TEXT_TYPE", "MOUSE_DRAG"];
    if (highRiskActions.includes(actionType)) {
      return { riskLevel: "MEDIUM", requiresApproval: false };
    }

    return { riskLevel: "LOW", requiresApproval: false };
  }

  public sanitizeUntrustedInput(rawPrompt: string): string {
    // Defense against prompt injection in window titles or OCR
    // Strips malicious override directives
    return rawPrompt
      .replace(/ignore\s+previous\s+instructions/gi, "[REDACTED_DIRECTIVE]")
      .replace(/system:\s*override/gi, "[REDACTED_DIRECTIVE]");
  }
}

let evaluatorInstance: SafetyPolicyEvaluator | null = null;

export function getSafetyPolicyEvaluator(): SafetyPolicyEvaluator {
  if (!evaluatorInstance) {
    evaluatorInstance = new SafetyPolicyEvaluator();
  }
  return evaluatorInstance;
}

export function resetSafetyPolicyEvaluatorForTests(): void {
  evaluatorInstance = null;
}
