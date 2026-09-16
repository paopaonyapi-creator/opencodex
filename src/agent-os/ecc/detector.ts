// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Non-destructive detector for Codex, ECC native plugin, legacy sync, and duplicate installation risk

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ECCDetectionResult, CodexPluginStatus } from "./types";

export interface DetectorOptions {
  workspaceRoot?: string;
  codexHome?: string;
  execTimeoutMs?: number;
  mockPluginListJson?: string;
  mockCodexVersion?: string;
  mockAgentShieldVersion?: string;
}

export class EccDetector {
  private readonly workspaceRoot: string;
  private readonly codexHome: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: DetectorOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
    this.timeoutMs = options.execTimeoutMs ?? 5000;
  }

  detect(): ECCDetectionResult {
    const codexVersion = this.detectCodexVersion();
    const codexAvailable = codexVersion !== null;

    const pluginStatus = this.detectPluginStatus(codexAvailable);
    const localCheckout = this.detectLocalCheckout();
    const legacySync = this.detectLegacySync();
    const agentshield = this.detectAgentShield();

    // Duplicate installation rule (Section 2 & 6):
    // Never combine Codex native plugin + legacy sync in the same active environment.
    let duplicateInstall = false;
    let duplicateDetails: string | undefined;

    if (pluginStatus.pluginInstalled && legacySync.present) {
      duplicateInstall = true;
      duplicateDetails =
        "Conflict detected: ECC is installed as a Codex native plugin AND legacy ECC sync artifacts were found in ~/.codex. Stacking installation modes is unsafe and degrades stability.";
    } else if (localCheckout.present && pluginStatus.pluginInstalled) {
      // Local checkout + native plugin is a developer warning, noted but permitted with advice
      duplicateDetails = "Notice: Both native plugin and project-local ECC checkout detected.";
    }

    return {
      codexAvailable,
      codexVersion: codexVersion ?? undefined,
      pluginSupport: pluginStatus.supported,
      nativePluginInstalled: pluginStatus.pluginInstalled,
      nativePluginEnabled: pluginStatus.pluginEnabled,
      nativePluginVersion: pluginStatus.version,
      localCheckoutPresent: localCheckout.present,
      localCheckoutPath: localCheckout.path,
      legacySyncPresent: legacySync.present,
      legacySyncPath: legacySync.path,
      duplicateInstall,
      duplicateDetails,
      agentshieldInstalled: agentshield.installed,
      agentshieldVersion: agentshield.version,
    };
  }

  detectCodexVersion(): string | null {
    if (this.options.mockCodexVersion !== undefined) {
      return this.options.mockCodexVersion;
    }
    try {
      const out = execSync("codex --version", {
        timeout: this.timeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();
      // Expecting output like "codex-cli 0.147.0"
      const match = out.match(/codex-cli\s+([\d.]+)/i) || out.match(/([\d.]+)/);
      return match ? match[1] : out || null;
    } catch {
      return null;
    }
  }

  detectPluginStatus(codexAvailable: boolean): CodexPluginStatus {
    if (!codexAvailable) {
      return {
        supported: false,
        marketplaceRegistered: false,
        pluginInstalled: false,
        pluginEnabled: false,
      };
    }

    let rawJson: string | null = this.options.mockPluginListJson ?? null;
    if (rawJson === null) {
      try {
        rawJson = execSync("codex plugin list --json", {
          timeout: this.timeoutMs,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        }).trim();
      } catch {
        rawJson = null;
      }
    }

    if (!rawJson) {
      return {
        supported: true,
        marketplaceRegistered: false,
        pluginInstalled: false,
        pluginEnabled: false,
      };
    }

    try {
      const parsed = JSON.parse(rawJson);
      const installedList: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.installed)
        ? parsed.installed
        : Array.isArray(parsed?.plugins)
        ? parsed.plugins
        : [];

      let eccPlugin: Record<string, unknown> | null = null;
      for (const item of installedList) {
        if (!item || typeof item !== "object") continue;
        const p = item as Record<string, unknown>;
        const id = String(p.pluginId || p.id || "").toLowerCase();
        const name = String(p.name || "").toLowerCase();
        const marketplace = String(p.marketplaceName || "").toLowerCase();

        if (
          id.includes("ecc") ||
          name === "ecc" ||
          marketplace.includes("ecc") ||
          id.includes("affaan-m/ecc")
        ) {
          eccPlugin = p;
          break;
        }
      }

      if (eccPlugin) {
        return {
          supported: true,
          marketplaceRegistered: true,
          pluginInstalled: Boolean(eccPlugin.installed ?? true),
          pluginEnabled: Boolean(eccPlugin.enabled ?? true),
          version: typeof eccPlugin.version === "string" ? eccPlugin.version : undefined,
          pluginId: typeof eccPlugin.pluginId === "string" ? eccPlugin.pluginId : undefined,
          sourcePath: typeof (eccPlugin.source as any)?.path === "string" ? (eccPlugin.source as any).path : undefined,
        };
      }

      return {
        supported: true,
        marketplaceRegistered: false,
        pluginInstalled: false,
        pluginEnabled: false,
      };
    } catch {
      return {
        supported: true,
        marketplaceRegistered: false,
        pluginInstalled: false,
        pluginEnabled: false,
      };
    }
  }

  detectLocalCheckout(): { present: boolean; path?: string } {
    const candidatePaths = [
      join(this.workspaceRoot, "vendor", "ecc-reference"),
      join(this.workspaceRoot, "vendor", "ecc"),
      join(this.workspaceRoot, "ecc"),
    ];

    for (const p of candidatePaths) {
      try {
        if (existsSync(p)) {
          const pkgPath = join(p, "package.json");
          if (existsSync(pkgPath)) {
            const raw = readFileSync(pkgPath, "utf8");
            if (raw.toLowerCase().includes("ecc") || raw.toLowerCase().includes("claude code")) {
              return { present: true, path: p };
            }
          }
          return { present: true, path: p };
        }
      } catch {
        // Continue
      }
    }
    return { present: false };
  }

  detectLegacySync(): { present: boolean; path?: string } {
    try {
      if (!existsSync(this.codexHome)) return { present: false };
      // Check for legacy ECC sync traces (e.g. .ecc-sync, ecc-skills, or config mentions)
      const legacyIndicators = [
        join(this.codexHome, ".ecc-sync"),
        join(this.codexHome, "ecc-sync.json"),
        join(this.codexHome, "ecc.json"),
        join(this.codexHome, "ecc"),
        join(this.codexHome, "skills", "ecc"),
      ];

      for (const p of legacyIndicators) {
        if (existsSync(p)) return { present: true, path: p };
      }

      // Check config.toml for legacy manual ECC paths
      const configTomlPath = join(this.codexHome, "config.toml");
      if (existsSync(configTomlPath)) {
        const toml = readFileSync(configTomlPath, "utf8");
        if (toml.includes("affaan-m/ECC/legacy") || toml.includes("ecc-sync-marker")) {
          return { present: true, path: configTomlPath };
        }
      }
    } catch {
      // Continue
    }
    return { present: false };
  }

  detectAgentShield(): { installed: boolean; version?: string } {
    if (this.options.mockAgentShieldVersion !== undefined) {
      return {
        installed: this.options.mockAgentShieldVersion !== "",
        version: this.options.mockAgentShieldVersion || undefined,
      };
    }
    try {
      const out = execSync("agentshield --version", {
        timeout: this.timeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();
      return {
        installed: true,
        version: out || "unknown",
      };
    } catch {
      return { installed: false };
    }
  }
}
