// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Optional App Server Daemon Manager (Experimental upstream capability).

import { execSync } from "node:child_process";
import { CodexDetector } from "./detector";

export interface DaemonStatus {
  enabled: boolean;
  running: boolean;
  version: string | null;
  platform: string;
  error?: string;
}

export class DaemonManager {
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = process.env.PAO_CODEX_DAEMON_ENABLED === "true";
  }

  getStatus(): DaemonStatus {
    const platform = CodexDetector.detectPlatform();
    if (!this.isEnabled) {
      return {
        enabled: false,
        running: false,
        version: null,
        platform,
      };
    }

    const bin = CodexDetector.getCodexBinaryPath();
    if (!bin) {
      return {
        enabled: true,
        running: false,
        version: null,
        platform,
        error: "Codex binary not found",
      };
    }

    try {
      const out = execSync(`"${bin}" app-server daemon status`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 3000,
      });
      const isRunning = out.toLowerCase().includes("running") || out.toLowerCase().includes("active");
      const version = CodexDetector.probeCodexVersion(bin);
      return {
        enabled: true,
        running: isRunning,
        version,
        platform,
      };
    } catch (err: unknown) {
      return {
        enabled: true,
        running: false,
        version: null,
        platform,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  start(): { success: boolean; message: string } {
    if (!this.isEnabled) {
      return {
        success: false,
        message: "Daemon is disabled by PAO_CODEX_DAEMON_ENABLED=false (experimental capability)",
      };
    }

    const bin = CodexDetector.getCodexBinaryPath();
    if (!bin) {
      return { success: false, message: "Codex binary not found" };
    }

    try {
      execSync(`"${bin}" app-server daemon start`, {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      });
      return { success: true, message: "Daemon start command issued" };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Failed to start daemon: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  stop(): { success: boolean; message: string } {
    if (!this.isEnabled) {
      return { success: true, message: "Daemon is not enabled" };
    }

    const bin = CodexDetector.getCodexBinaryPath();
    if (!bin) return { success: false, message: "Codex binary not found" };

    try {
      execSync(`"${bin}" app-server daemon stop`, {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      });
      return { success: true, message: "Daemon stop command issued" };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
