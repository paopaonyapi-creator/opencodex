// Phase 20.3 — Desktop Agent Configuration
//
// Environment-driven config loader for all PAO_DESKTOP_* variables.
// Every setting has a safe default; nothing is hardcoded to a specific machine.

import type { ExecutionMode, DesktopRiskLevel } from "./types";
import {
  DEFAULT_EMERGENCY_HOTKEY,
  DEFAULT_FRAME_MAX_AGE_MS,
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_SKILL_TIMEOUT_SECONDS,
  DEFAULT_GOAL_TIMEOUT_SECONDS,
  DEFAULT_MAX_ACTIONS_PER_SECOND,
  DEFAULT_MAX_CLICKS_PER_SECOND,
  DEFAULT_MAX_RETRIES_PER_STEP,
} from "./types";

export interface DesktopAgentConfig {
  /** Master enable flag. Default false — disabled until operator enables. */
  enabled: boolean;
  /** Local agent listen host. Default 127.0.0.1. */
  host: string;
  /** Local agent listen port. Default 8765. */
  port: number;
  /** Default execution mode for new sessions. */
  defaultMode: ExecutionMode;
  /** Screen capture provider. 'auto' picks best available. */
  captureProvider: "auto" | "dxgi" | "graphics_capture" | "gdi" | "mock";
  /** UIA provider enabled. */
  uiaEnabled: boolean;
  /** Vision locator enabled. */
  visionEnabled: boolean;
  /** OCR enabled. */
  ocrEnabled: boolean;
  /** Max actions per second (rate limit). */
  maxActionsPerSecond: number;
  /** Max mouse clicks per second. */
  maxClicksPerSecond: number;
  /** Max retries per skill step. */
  maxRetriesPerStep: number;
  /** Individual action timeout in milliseconds. */
  actionTimeoutMs: number;
  /** Skill execution timeout in seconds. */
  skillTimeoutSeconds: number;
  /** Goal timeout in seconds. */
  goalTimeoutSeconds: number;
  /** Maximum frame age before it's considered stale (ms). */
  frameMaxAgeMs: number;
  /** Idle loop interval (ms). */
  idleIntervalMs: number;
  /** Active loop interval (ms). */
  activeIntervalMs: number;
  /** Verification loop interval (ms). */
  verifyIntervalMs: number;
  /** Whether to persist screenshots. Default false. */
  persistScreenshots: boolean;
  /** Evidence retention in days. */
  evidenceRetentionDays: number;
  /** Remote access enabled. Default false. */
  remoteAccessEnabled: boolean;
  /** Emergency stop hotkey. */
  emergencyHotkey: string;
  /** Default risk threshold for auto-approval. */
  defaultApprovalThreshold: DesktopRiskLevel;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

let cachedConfig: DesktopAgentConfig | null = null;

export function loadDesktopAgentConfig(): DesktopAgentConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    enabled: envBool("PAO_DESKTOP_AGENT_ENABLED", false),
    host: envStr("PAO_DESKTOP_AGENT_HOST", "127.0.0.1"),
    port: envInt("PAO_DESKTOP_AGENT_PORT", 8765),
    defaultMode: envStr("PAO_DESKTOP_DEFAULT_MODE", "ASSISTED") as ExecutionMode,
    captureProvider: envStr("PAO_DESKTOP_CAPTURE_PROVIDER", "auto") as DesktopAgentConfig["captureProvider"],
    uiaEnabled: envBool("PAO_DESKTOP_UIA_ENABLED", true),
    visionEnabled: envBool("PAO_DESKTOP_VISION_ENABLED", true),
    ocrEnabled: envBool("PAO_DESKTOP_OCR_ENABLED", true),
    maxActionsPerSecond: envInt("PAO_DESKTOP_MAX_ACTIONS_PER_SECOND", DEFAULT_MAX_ACTIONS_PER_SECOND),
    maxClicksPerSecond: envInt("PAO_DESKTOP_MAX_CLICKS_PER_SECOND", DEFAULT_MAX_CLICKS_PER_SECOND),
    maxRetriesPerStep: envInt("PAO_DESKTOP_MAX_RETRIES_PER_STEP", DEFAULT_MAX_RETRIES_PER_STEP),
    actionTimeoutMs: envInt("PAO_DESKTOP_ACTION_TIMEOUT_MS", DEFAULT_ACTION_TIMEOUT_MS),
    skillTimeoutSeconds: envInt("PAO_DESKTOP_SKILL_TIMEOUT_SECONDS", DEFAULT_SKILL_TIMEOUT_SECONDS),
    goalTimeoutSeconds: envInt("PAO_DESKTOP_GOAL_TIMEOUT_SECONDS", DEFAULT_GOAL_TIMEOUT_SECONDS),
    frameMaxAgeMs: envInt("PAO_DESKTOP_FRAME_MAX_AGE_MS", DEFAULT_FRAME_MAX_AGE_MS),
    idleIntervalMs: envInt("PAO_DESKTOP_IDLE_INTERVAL_MS", 1000),
    activeIntervalMs: envInt("PAO_DESKTOP_ACTIVE_INTERVAL_MS", 200),
    verifyIntervalMs: envInt("PAO_DESKTOP_VERIFY_INTERVAL_MS", 250),
    persistScreenshots: envBool("PAO_DESKTOP_PERSIST_SCREENSHOTS", false),
    evidenceRetentionDays: envInt("PAO_DESKTOP_EVIDENCE_RETENTION_DAYS", 7),
    remoteAccessEnabled: envBool("PAO_DESKTOP_REMOTE_ACCESS_ENABLED", false),
    emergencyHotkey: envStr("PAO_DESKTOP_EMERGENCY_HOTKEY", DEFAULT_EMERGENCY_HOTKEY),
    defaultApprovalThreshold: envStr("PAO_DESKTOP_APPROVAL_THRESHOLD", "HIGH") as DesktopRiskLevel,
  };

  return cachedConfig;
}

/** Test seam: reset cached config so env changes take effect. */
export function resetDesktopAgentConfig(): void {
  cachedConfig = null;
}
