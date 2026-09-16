/**
 * Pao Context Control Plane — configuration (Phase 20.53).
 *
 * Strict "true" flags for security-relevant switches (inherited rule). The
 * OpenViking API key resolves from an environment variable BY NAME; the key
 * value never appears in config, logs, or audit records.
 */

export interface ContextBudgetProfile {
  readonly maxResults: number;
  readonly maxDirectories: number;
  readonly maxL2Documents: number;
  readonly maxChars: number;
  readonly maxEstimatedTokens: number;
  readonly maxLatencyMs: number;
}

export const BUDGET_PROFILES: Readonly<Record<string, ContextBudgetProfile>> = {
  fast: {
    maxResults: 5,
    maxDirectories: 3,
    maxL2Documents: 1,
    maxChars: 10_000,
    maxEstimatedTokens: 2_500,
    maxLatencyMs: 1_200,
  },
  coding: {
    maxResults: 12,
    maxDirectories: 8,
    maxL2Documents: 4,
    maxChars: 48_000,
    maxEstimatedTokens: 12_000,
    maxLatencyMs: 5_000,
  },
  deep_research: {
    maxResults: 30,
    maxDirectories: 16,
    maxL2Documents: 10,
    maxChars: 120_000,
    maxEstimatedTokens: 30_000,
    maxLatencyMs: 15_000,
  },
  automation_safe: {
    maxResults: 6,
    maxDirectories: 4,
    maxL2Documents: 2,
    maxChars: 20_000,
    maxEstimatedTokens: 5_000,
    maxLatencyMs: 2_500,
  },
};

export interface MemoryPolicyProfile {
  readonly id: string;
  readonly selfEnabled: boolean;
  readonly peerEnabled: boolean;
  readonly workingMemoryEnabled: boolean;
  readonly memoryTypes: readonly string[];
}

export const MEMORY_POLICIES: Readonly<Record<string, MemoryPolicyProfile>> = {
  no_memory: {
    id: "no_memory",
    selfEnabled: false,
    peerEnabled: false,
    workingMemoryEnabled: false,
    memoryTypes: [],
  },
  user_preferences_only: {
    id: "user_preferences_only",
    selfEnabled: true,
    peerEnabled: false,
    workingMemoryEnabled: true,
    memoryTypes: ["profile", "preferences"],
  },
  workspace_coding: {
    id: "workspace_coding",
    selfEnabled: true,
    peerEnabled: true,
    workingMemoryEnabled: true,
    memoryTypes: ["profile", "preferences", "entities", "events", "cases"],
  },
  agent_evolution_reviewed: {
    id: "agent_evolution_reviewed",
    selfEnabled: true,
    peerEnabled: true,
    workingMemoryEnabled: true,
    memoryTypes: ["profile", "preferences", "entities", "events", "experiences"],
  },
};

export interface ContextFeatureFlags {
  readonly retrievalEnabled: boolean;
  readonly memoryWriteEnabled: boolean;
  readonly peerMemoryEnabled: boolean;
  readonly agentEvolutionEnabled: boolean;
  readonly traceEnabled: boolean;
}

export interface ContextModuleConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly adminKeyEnv: string;
  readonly backendType: string;
  readonly backendBaseUrl: string;
  readonly apiKeyEnv: string;
  readonly timeoutMs: number;
  readonly defaultBudgetProfile: string;
  readonly defaultMemoryPolicy: string;
  readonly flags: ContextFeatureFlags;
  /** Default shared roots Pao will register and search. */
  readonly sharedRoots: readonly string[];
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

function envPositiveInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function loadContextConfig(): ContextModuleConfig {
  return {
    enabled: envFlag("PAO_CONTEXT_ENABLED", false),
    port: envPositiveInt("PAO_CONTEXT_MODULE_PORT", 8791, 1),
    adminKeyEnv: "PAO_CONTEXT_ADMIN_KEY",
    backendType: process.env.PAO_CONTEXT_BACKEND?.trim() || "openviking",
    backendBaseUrl:
      process.env.PAO_OPENVIKING_URL?.trim() || "http://127.0.0.1:1933",
    apiKeyEnv: process.env.PAO_OPENVIKING_API_KEY_ENV?.trim() || "PAO_OPENVIKING_API_KEY",
    timeoutMs: envPositiveInt("PAO_CONTEXT_BACKEND_TIMEOUT_MS", 10_000, 100),
    defaultBudgetProfile: process.env.PAO_CONTEXT_DEFAULT_BUDGET?.trim() || "coding",
    defaultMemoryPolicy: process.env.PAO_CONTEXT_DEFAULT_MEMORY_POLICY?.trim() || "user_preferences_only",
    flags: {
      retrievalEnabled: envFlag("PAO_CONTEXT_RETRIEVAL_ENABLED", true),
      memoryWriteEnabled: envFlag("PAO_CONTEXT_MEMORY_WRITE_ENABLED", false),
      peerMemoryEnabled: envFlag("PAO_CONTEXT_PEER_MEMORY_ENABLED", false),
      agentEvolutionEnabled: envFlag("PAO_CONTEXT_AGENT_EVOLUTION", false),
      traceEnabled: envFlag("PAO_CONTEXT_TRACE_ENABLED", true),
    },
    sharedRoots: [
      "viking://resources/pao-hubpro/project/",
      "viking://resources/pao-hubpro/phases/",
      "viking://resources/pao-hubpro/docs/",
    ],
  };
}

export function resolveBudgetProfile(name: string): ContextBudgetProfile {
  return BUDGET_PROFILES[name] ?? BUDGET_PROFILES.coding!;
}

export function resolveMemoryPolicy(name: string): MemoryPolicyProfile {
  return MEMORY_POLICIES[name] ?? MEMORY_POLICIES.user_preferences_only!;
}
