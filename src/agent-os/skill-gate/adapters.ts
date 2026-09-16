// Phase 20.57 — agent adapters (spec §14-§16). Adapters are deterministic path
// resolvers: they never make policy decisions and they are the only place that
// knows where a given agent keeps its skills. New agents are added by
// registering an adapter, never by scattering path rules through the codebase.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SkillGateHttpError, type SkillScope } from "./types";

export const ADAPTER_VERSION = "sg-adapters-1";

export interface AgentAdapter {
  id: string;
  displayName: string;
  adapterVersion: string;
  supportedScopes: SkillScope[];
  /** Marker files/dirs that indicate the agent is installed on this machine. */
  detectionMarkers(homeDir: string): string[];
  userSkillsRoot(homeDir: string): string;
  projectSkillsRoot(projectPath: string): string;
}

export const AGENT_ADAPTERS: Record<string, AgentAdapter> = {
  codex: {
    id: "codex",
    displayName: "OpenAI Codex",
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["user", "project"],
    detectionMarkers: (homeDir) => [process.env.CODEX_HOME ?? join(homeDir, ".codex")],
    userSkillsRoot: (homeDir) => join(process.env.CODEX_HOME ?? join(homeDir, ".codex"), "skills"),
    projectSkillsRoot: (projectPath) => join(projectPath, ".codex", "skills"),
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["user", "project"],
    detectionMarkers: (homeDir) => [join(homeDir, ".claude")],
    userSkillsRoot: (homeDir) => join(homeDir, ".claude", "skills"),
    projectSkillsRoot: (projectPath) => join(projectPath, ".claude", "skills"),
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["user", "project"],
    detectionMarkers: (homeDir) => [join(homeDir, ".config", "opencode")],
    userSkillsRoot: (homeDir) => join(homeDir, ".config", "opencode", "skills"),
    projectSkillsRoot: (projectPath) => join(projectPath, ".opencode", "skills"),
  },
  universal: {
    id: "universal",
    displayName: "Universal agent skill root",
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["user", "project"],
    detectionMarkers: (homeDir) => [homeDir],
    userSkillsRoot: (homeDir) => join(homeDir, ".agents", "skills"),
    projectSkillsRoot: (projectPath) => join(projectPath, ".agents", "skills"),
  },
};

export function listAdapters(): AgentAdapter[] {
  return Object.values(AGENT_ADAPTERS).sort((a, b) => a.id.localeCompare(b.id));
}

export function getAdapter(agent: string): AgentAdapter {
  const adapter = AGENT_ADAPTERS[agent];
  if (!adapter) {
    throw new SkillGateHttpError("UNSUPPORTED_AGENT", 422, `no skill adapter is registered for agent: ${agent}`);
  }
  return adapter;
}

export interface TargetContext {
  /** Base home directory for user scope (tests inject a temp dir). */
  homeDir?: string;
}

export function resolveHomeDir(context: TargetContext = {}): string {
  return context.homeDir ?? process.env.PAO_SKILL_HOME ?? homedir();
}

export interface ResolvedDir {
  dir: string;
  exists: boolean;
}

export function resolveSkillsDir(input: { agent: string; scope: SkillScope; projectPath?: string | null; homeDir?: string }): ResolvedDir {
  const adapter = getAdapter(input.agent);
  if (!adapter.supportedScopes.includes(input.scope)) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 422, `agent ${adapter.id} does not support scope ${input.scope}`);
  }
  if (input.scope === "project") {
    if (!input.projectPath) {
      throw new SkillGateHttpError("VALIDATION_ERROR", 400, `scope project requires projectPath for agent ${adapter.id}`);
    }
    const dir = adapter.projectSkillsRoot(input.projectPath);
    return { dir, exists: existsSync(dir) };
  }
  const dir = adapter.userSkillsRoot(resolveHomeDir({ homeDir: input.homeDir }));
  return { dir, exists: existsSync(dir) };
}

export interface DetectionResult {
  agentType: string;
  displayName: string;
  detected: boolean;
  userSkillsRoot: string;
  userRootExists: boolean;
  projectSkillsRoot: string;
}

export function detectAgent(adapter: AgentAdapter, homeDir?: string): DetectionResult {
  const home = resolveHomeDir({ homeDir });
  const userSkillsRoot = adapter.userSkillsRoot(home);
  const markers = adapter.detectionMarkers(home);
  const markerPresent = markers.some((marker) => existsSync(marker));
  const userRootExists = existsSync(userSkillsRoot) && statSync(userSkillsRoot).isDirectory();
  return {
    agentType: adapter.id,
    displayName: adapter.displayName,
    detected: markerPresent,
    userSkillsRoot,
    userRootExists,
    projectSkillsRoot: adapter.projectSkillsRoot(join(home, "project")),
  };
}
