// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Codex Installation, Version, and Capability Detection.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexCapabilityReport, PlatformKind } from "./types";

export interface VersionCompatibilityResult {
  version: string | null;
  status: "tested" | "supported" | "experimental" | "blocked" | "unknown";
  minimumVersion: string | null;
  isAllowed: boolean;
  message: string;
}

export class CodexDetector {
  private static cachedReport: CodexCapabilityReport | null = null;

  static detectPlatform(): PlatformKind {
    const p = process.platform;
    if (p === "win32") return "windows";
    if (p === "linux") return "linux";
    if (p === "darwin") return "macos";
    return "unknown";
  }

  static getCodexBinaryPath(): string | null {
    const isWin = process.platform === "win32";

    // 1. Try PATH
    try {
      const checkCmd = isWin ? "where.exe codex" : "which codex";
      const pathOut = execSync(checkCmd, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 3000 }).trim();
      const lines = pathOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (existsSync(line)) {
          return line;
        }
      }
    } catch {
      // not in immediate where/which
    }

    // 2. Check standard cargo / user paths
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const names = isWin ? ["codex.cmd", "codex.exe", "codex.bat", "codex"] : ["codex"];
    const candidateDirs = [
      join(home, "AppData", "Roaming", "npm"),
      join(home, ".cargo", "bin"),
      join(home, ".codex", "bin"),
      join(home, "AppData", "Local", "Programs", "codex"),
      join("/usr", "local", "bin"),
      join("/usr", "bin"),
    ];

    for (const dir of candidateDirs) {
      for (const name of names) {
        const full = join(dir, name);
        if (existsSync(full)) {
          return full;
        }
      }
    }

    return null;
  }

  static probeCodexVersion(binaryPath?: string | null): string | null {
    const bin = binaryPath || this.getCodexBinaryPath();
    if (!bin) return null;

    try {
      const out = execSync(`"${bin}" --version`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
      // Expect "codex-cli 0.147.0" or "codex 0.147.0"
      const match = out.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
      return match ? match[1] : out;
    } catch {
      return null;
    }
  }

  static probePythonSdk(): boolean {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    try {
      execSync(`${pythonCmd} -c "import openai_codex"`, {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 3000,
      });
      return true;
    } catch {
      return false;
    }
  }

  static probeAppServer(binaryPath?: string | null): boolean {
    const bin = binaryPath || this.getCodexBinaryPath();
    if (!bin) return false;
    try {
      const out = execSync(`"${bin}" app-server --help`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      });
      return out.includes("app-server") || out.includes("generate-ts");
    } catch {
      return false;
    }
  }

  static probeExecServer(binaryPath?: string | null): boolean {
    const bin = binaryPath || this.getCodexBinaryPath();
    if (!bin) return false;
    try {
      const out = execSync(`"${bin}" exec-server --help`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      });
      return out.includes("exec-server") || out.includes("listen");
    } catch {
      return false;
    }
  }

  static probeDaemon(binaryPath?: string | null): boolean {
    const bin = binaryPath || this.getCodexBinaryPath();
    if (!bin) return false;
    try {
      const out = execSync(`"${bin}" app-server daemon --help`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5000,
      });
      return out.includes("daemon");
    } catch {
      return false;
    }
  }

  static checkCompatibility(version: string | null, manifestPath = "config/codex-compatibility.json"): VersionCompatibilityResult {
    if (!version) {
      return {
        version: null,
        status: "unknown",
        minimumVersion: null,
        isAllowed: false,
        message: "No Codex installation detected",
      };
    }

    try {
      if (existsSync(manifestPath)) {
        const raw = readFileSync(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as {
          minimumVersion?: string;
          testedVersions?: string[];
          blockedVersions?: string[];
        };

        if (manifest.blockedVersions?.includes(version)) {
          return {
            version,
            status: "blocked",
            minimumVersion: manifest.minimumVersion ?? null,
            isAllowed: false,
            message: `Codex version ${version} is explicitly blocked by compatibility policy`,
          };
        }

        if (manifest.testedVersions?.includes(version)) {
          return {
            version,
            status: "tested",
            minimumVersion: manifest.minimumVersion ?? null,
            isAllowed: true,
            message: `Codex version ${version} is verified and fully tested`,
          };
        }

        // Semver check if minimumVersion exists
        if (manifest.minimumVersion) {
          const minParts = manifest.minimumVersion.split(".").map(Number);
          const currentParts = version.split(".").map(Number);
          let isOlder = false;
          for (let i = 0; i < Math.min(minParts.length, currentParts.length); i++) {
            if (currentParts[i] < minParts[i]) {
              isOlder = true;
              break;
            }
            if (currentParts[i] > minParts[i]) {
              break;
            }
          }
          if (isOlder) {
            return {
              version,
              status: "blocked",
              minimumVersion: manifest.minimumVersion,
              isAllowed: false,
              message: `Codex version ${version} is older than minimum required version ${manifest.minimumVersion}`,
            };
          }
        }

        return {
          version,
          status: "supported",
          minimumVersion: manifest.minimumVersion ?? null,
          isAllowed: true,
          message: `Codex version ${version} is supported (untested revision)`,
        };
      }
    } catch {
      // Manifest error fallback
    }

    return {
      version,
      status: "supported",
      minimumVersion: null,
      isAllowed: true,
      message: `Codex version ${version} detected without manifest constraints`,
    };
  }

  static detectCapabilities(forceRefresh = false): CodexCapabilityReport {
    if (this.cachedReport && !forceRefresh) {
      return this.cachedReport;
    }

    const platform = this.detectPlatform();
    const binPath = this.getCodexBinaryPath();
    const codexInstalled = binPath !== null;
    const codexVersion = this.probeCodexVersion(binPath);
    const pythonSdkAvailable = this.probePythonSdk();
    const appServerAvailable = this.probeAppServer(binPath);
    const execServerAvailable = this.probeExecServer(binPath);
    const daemonAvailable = this.probeDaemon(binPath);
    const experimentalApiEnabled = process.env.PAO_CODEX_EXPERIMENTAL_API === "true";

    const report: CodexCapabilityReport = {
      codexInstalled,
      codexVersion,
      pythonSdkAvailable,
      appServerAvailable,
      execServerAvailable,
      daemonAvailable,
      remoteControlAvailable: experimentalApiEnabled && daemonAvailable,
      mcpAvailable: true,
      experimentalApiEnabled,
      platform,
    };

    this.cachedReport = report;
    return report;
  }

  static clearCache(): void {
    this.cachedReport = null;
  }
}
