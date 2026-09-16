// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// ECC Harness Adapter: Facade isolating upstream ECC details behind a stable Pao interface

import { EccDetector } from "./detector";
import { SkillsRegistry } from "./skills-registry";
import { AgentRegistry } from "./agent-registry";
import type {
  AgentDescriptor,
  CodexPluginStatus,
  ECCMode,
  ECCStatus,
  SkillDescriptor,
} from "./types";

export interface EccAdapterOptions {
  detector?: EccDetector;
  skillsRegistry?: SkillsRegistry;
  agentRegistry?: AgentRegistry;
}

export class EccAdapter {
  private readonly detector: EccDetector;
  private readonly skillsRegistry: SkillsRegistry;
  private readonly agentRegistry: AgentRegistry;

  constructor(options: EccAdapterOptions = {}) {
    this.detector = options.detector ?? new EccDetector();
    this.skillsRegistry = options.skillsRegistry ?? new SkillsRegistry();
    this.agentRegistry = options.agentRegistry ?? new AgentRegistry();
  }

  getECCStatus(): ECCStatus {
    const d = this.detector.detect();
    const warnings: string[] = [];

    let mode: ECCMode = "native-only";
    let installed = false;
    let available = true;

    if (d.duplicateInstall) {
      mode = "degraded";
      installed = true;
      available = false; // Block automated mutation until resolved
      warnings.push(
        d.duplicateDetails ??
          "Duplicate ECC installation detected (Codex native plugin + legacy sync). Automated mutations blocked.",
      );
    } else if (d.nativePluginInstalled) {
      mode = "codex-native-plugin";
      installed = true;
      available = d.nativePluginEnabled;
      if (!d.nativePluginEnabled) {
        warnings.push("ECC native Codex plugin is installed but currently disabled.");
      }
    } else if (d.localCheckoutPresent) {
      mode = "project-local";
      installed = true;
      available = true;
    } else if (d.legacySyncPresent) {
      mode = "legacy-sync";
      installed = true;
      available = true;
      warnings.push("Legacy ECC sync mode in use. Upgrading to Codex native plugin is recommended.");
    } else {
      mode = "native-only";
      installed = false;
      available = true;
    }

    if (!d.codexAvailable) {
      warnings.push("OpenAI Codex CLI was not detected on system PATH. Pao operates in native proxy mode.");
    }

    const pluginStatus: CodexPluginStatus = {
      supported: d.pluginSupport,
      marketplaceRegistered: d.nativePluginInstalled,
      pluginInstalled: d.nativePluginInstalled,
      pluginEnabled: d.nativePluginEnabled,
      version: d.nativePluginVersion,
    };

    const skills = this.skillsRegistry.listAll();
    const agents = this.agentRegistry.listAgents();

    return {
      installed,
      available,
      mode,
      version: d.nativePluginVersion ?? (d.localCheckoutPresent ? "2.2.1-local" : undefined),
      plugin: pluginStatus,
      duplicateInstallDetected: d.duplicateInstall,
      skillsIndexed: skills.length,
      agentsIndexed: agents.length,
      warnings,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  getECCVersion(): string | undefined {
    return this.getECCStatus().version;
  }

  getCodexPluginStatus(): CodexPluginStatus {
    return this.getECCStatus().plugin;
  }

  listECCSkills(): SkillDescriptor[] {
    return this.skillsRegistry.listAll().filter(s => s.source === "ecc");
  }

  listECCAgents(): AgentDescriptor[] {
    return this.agentRegistry.listAgents();
  }

  resolveSkill(id: string): SkillDescriptor | null {
    return this.skillsRegistry.getSkill(id);
  }

  resolveAgent(role: string): AgentDescriptor | null {
    return this.agentRegistry.getAgent(role);
  }

  detectDuplicateInstall(): { duplicate: boolean; details?: string } {
    const d = this.detector.detect();
    return {
      duplicate: d.duplicateInstall,
      details: d.duplicateDetails,
    };
  }

  getECCWarnings(): string[] {
    return this.getECCStatus().warnings;
  }

  runDoctorCheck(): {
    healthy: boolean;
    issues: string[];
    details: Record<string, unknown>;
  } {
    const status = this.getECCStatus();
    const issues = [...status.warnings];

    if (status.duplicateInstallDetected) {
      issues.push("CRITICAL: Conflicting ECC installations must be resolved by operator.");
    }

    const healthy = !status.duplicateInstallDetected && issues.filter(i => i.startsWith("CRITICAL")).length === 0;

    return {
      healthy,
      issues,
      details: {
        mode: status.mode,
        version: status.version,
        pluginInstalled: status.plugin.pluginInstalled,
        pluginEnabled: status.plugin.pluginEnabled,
        skillsCount: status.skillsIndexed,
        agentsCount: status.agentsIndexed,
      },
    };
  }
}
