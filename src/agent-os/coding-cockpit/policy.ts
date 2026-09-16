// Phase 20.39 — Execution policy engine (spec §16) + deterministic risk
// scoring (spec §17). Categories map to minimum execution levels; the numeric
// risk score (0-100) is ONE INPUT into the decision, never a security
// guarantee. Workspace trust caps the effective level; PRIVILEGED trust is
// never assigned automatically (spec §5).

import {
  CockpitError,
  DEFAULT_EXECUTION_LEVEL,
  EXECUTION_LEVELS,
  type ActionType,
  type ExecutionLevel,
  type PolicyDecision,
  type WorkspaceTrustLevel,
} from "./types";
import { staysInsideWorkspace } from "./paths";

function levelIndex(level: ExecutionLevel): number {
  const idx = EXECUTION_LEVELS.indexOf(level);
  if (idx < 0) throw new CockpitError("VALIDATION_ERROR", "unknown execution level");
  return idx;
}

/** Trust caps how far a workspace's configured level can reach. */
export const TRUST_MAX_LEVEL: Record<WorkspaceTrustLevel, ExecutionLevel> = {
  UNTRUSTED: "LEVEL_0_READ_ONLY",
  READ_ONLY: "LEVEL_0_READ_ONLY",
  STANDARD: "LEVEL_2_COMMAND",
  TRUSTED: "LEVEL_4_DEPLOY",
  PRIVILEGED: "LEVEL_5_FULL_CONTROL",
};

/** Minimum level required before a category is even considered. */
const CATEGORY_MIN_LEVEL: Record<ActionType, ExecutionLevel> = {
  READ: "LEVEL_0_READ_ONLY",
  WRITE: "LEVEL_1_SAFE_WRITE",
  SHELL: "LEVEL_2_COMMAND",
  NETWORK: "LEVEL_3_NETWORK",
  GIT_WRITE: "LEVEL_3_NETWORK",
  PACKAGE_INSTALL: "LEVEL_4_DEPLOY",
  PROCESS_CONTROL: "LEVEL_4_DEPLOY",
  SECRET_ACCESS: "LEVEL_5_FULL_CONTROL",
  DEPLOY: "LEVEL_5_FULL_CONTROL",
  DELETE: "LEVEL_3_NETWORK",
  PRIVILEGED: "LEVEL_5_FULL_CONTROL",
};

/** Categories that additionally require explicit human approval even when the
 *  level is sufficient (spec §3.4: progressively stricter evaluation). */
const ALWAYS_APPROVAL: ReadonlySet<ActionType> = new Set<ActionType>([
  "SHELL",
  "PACKAGE_INSTALL",
  "PROCESS_CONTROL",
  "SECRET_ACCESS",
  "DEPLOY",
  "DELETE",
  "PRIVILEGED",
]);

const BASE_RISK: Record<ActionType, number> = {
  READ: 2,
  WRITE: 20,
  SHELL: 35,
  NETWORK: 40,
  GIT_WRITE: 45,
  PACKAGE_INSTALL: 55,
  PROCESS_CONTROL: 55,
  SECRET_ACCESS: 70,
  DEPLOY: 65,
  DELETE: 60,
  PRIVILEGED: 75,
};

const SYSTEM_PATH_MARKERS = ["windows", "system32", "program files", "/etc", "/usr", "/bin", "/sbin", "/boot", "/var"];
const REMOTE_SHELL_PIPES = [/* scanner-safe: checked as substrings, no regex captures */ "curl |", "curl |sh", "curl | bash", "wget |", "wget | sh", "wget | bash", "Invoke-Expression", "iex "];
const DESTRUCTIVE_TOKENS = ["rm -rf", "rd /s", "deltree", "format ", "mkfs", "dd if=", "shutdown", "git reset --hard", "git clean -f", "git push --force", "git push -f", "drop table", "drop database", "truncate table"];
const CREDENTIAL_TOKENS = ["id_rsa", "id_ed25519", ".ssh/", ".aws/credentials", ".netrc", ".npmrc", ".env", "credentials.json", "secrets.toml", "private key", "begin rsa private"];
const ESCALATION_TOKENS = ["sudo ", "doas ", "runas ", "icacls", "takeown", "net user", "taskkill /f", "kill -9"];

export interface RiskInput {
  actionType: ActionType;
  command?: string | null;
  targetPath?: string | null;
  networkTarget?: string | null;
  touchesSecrets?: boolean;
  workspaceRoot?: string | null;
  recursive?: boolean;
}

/** Deterministic 0-100 risk score. Additive, explainable, clamped. */
export function scoreRisk(input: RiskInput): { riskScore: number; reasons: string[] } {
  let risk = BASE_RISK[input.actionType] ?? 50;
  const reasons: string[] = [`base ${input.actionType}=${risk}`];
  const command = (input.command ?? "").toLowerCase();
  const target = (input.targetPath ?? "").toLowerCase();
  const host = (input.networkTarget ?? "").toLowerCase();

  if (input.workspaceRoot && input.targetPath && !staysInsideWorkspace(input.workspaceRoot, input.targetPath)) {
    risk += 40;
    reasons.push("target outside workspace +40");
  }
  if (target && SYSTEM_PATH_MARKERS.some((marker) => target.includes(marker))) {
    risk += 40;
    reasons.push("system path +40");
  }
  if (command) {
    if (DESTRUCTIVE_TOKENS.some((token) => command.includes(token))) {
      risk += 35;
      reasons.push("destructive token +35");
    }
    if (input.recursive && (command.includes("rm ") || command.includes("del ") || command.includes("remove-item"))) {
      risk += 25;
      reasons.push("recursive delete +25");
    }
    if (ESCALATION_TOKENS.some((token) => command.includes(token))) {
      risk += 30;
      reasons.push("privilege escalation +30");
    }
    if (REMOTE_SHELL_PIPES.some((token) => command.includes(token))) {
      risk += 25;
      reasons.push("remote content piped to shell +25");
    }
    if (command.includes("package") && (command.includes("install") || command.includes("add "))) {
      risk += 10;
      reasons.push("package mutation +10");
    }
  }
  if (target && CREDENTIAL_TOKENS.some((token) => target.includes(token))) {
    risk += 30;
    reasons.push("credential-bearing path +30");
  }
  if (input.touchesSecrets) {
    risk += 30;
    reasons.push("secret access +30");
  }
  if (host) {
    if (host === "0.0.0.0" || host === "::" || host.includes(":0.0.0.0")) {
      risk += 20;
      reasons.push("public network bind +20");
    }
    if (host.includes("169.254.169.254") || host.includes("metadata.google.internal")) {
      risk += 35;
      reasons.push("cloud metadata endpoint +35");
    }
  }
  const clamped = Math.max(0, Math.min(100, risk));
  return { riskScore: clamped, reasons };
}

export function riskBand(riskScore: number): "low" | "moderate" | "high" | "critical" {
  if (riskScore >= 75) return "critical";
  if (riskScore >= 50) return "high";
  if (riskScore >= 20) return "moderate";
  return "low";
}

export interface PolicyEvaluationInput {
  workspaceId: string;
  workspaceTrust: WorkspaceTrustLevel;
  configuredLevel: ExecutionLevel;
  actionType: ActionType;
  command?: string | null;
  targetPath?: string | null;
  networkTarget?: string | null;
  touchesSecrets?: boolean;
  workspaceRoot?: string | null;
  recursive?: boolean;
  providerId?: string | null;
  sessionId?: string | null;
  actorId?: string | null;
}

export interface WorkspacePolicyResult {
  decision: PolicyDecision;
  effectiveLevel: ExecutionLevel;
  riskScore: number;
}

/** THE cockpit policy decision. Fail-closed: unknown inputs deny. */
export function evaluatePolicy(input: PolicyEvaluationInput): WorkspacePolicyResult {
  const trustMax = TRUST_MAX_LEVEL[input.workspaceTrust] ?? "LEVEL_0_READ_ONLY";
  const effectiveLevel = levelIndex(input.configuredLevel) <= levelIndex(trustMax)
    ? input.configuredLevel
    : trustMax;
  const { riskScore, reasons } = scoreRisk(input);
  const ruleIds: string[] = [`trust:${input.workspaceTrust}`, `level:${effectiveLevel}`];

  const minIdx = levelIndex(CATEGORY_MIN_LEVEL[input.actionType] ?? "LEVEL_5_FULL_CONTROL");
  const effIdx = levelIndex(effectiveLevel);

  if (effIdx < minIdx) {
    reasons.push(`level ${effectiveLevel} below minimum ${CATEGORY_MIN_LEVEL[input.actionType]} for ${input.actionType}`);
    return {
      decision: { effect: "DENY", riskScore, reasons, ruleIds },
      effectiveLevel,
      riskScore,
    };
  }

  if (ALWAYS_APPROVAL.has(input.actionType)) {
    ruleIds.push("always-approval");
    reasons.push(`${input.actionType} requires explicit human approval`);
    return {
      decision: { effect: "REQUIRE_APPROVAL", riskScore, reasons, ruleIds },
      effectiveLevel,
      riskScore,
    };
  }

  // High/critical risk within level still requires approval (spec §3.4).
  if (riskScore >= 50) {
    ruleIds.push("risk>=50");
    reasons.push(`risk ${riskScore} (${riskBand(riskScore)}) requires approval`);
    return {
      decision: { effect: "REQUIRE_APPROVAL", riskScore, reasons, ruleIds },
      effectiveLevel,
      riskScore,
    };
  }

  reasons.push(`allowed at ${effectiveLevel} with risk ${riskScore}`);
  return {
    decision: { effect: "ALLOW", riskScore, reasons, ruleIds },
    effectiveLevel,
    riskScore,
  };
}

export function defaultExecutionLevel(): ExecutionLevel {
  const env = process.env.PAO_DEFAULT_EXECUTION_LEVEL as ExecutionLevel | undefined;
  if (env && EXECUTION_LEVELS.includes(env)) return env;
  return DEFAULT_EXECUTION_LEVEL;
}

export function parseExecutionLevel(value: unknown): ExecutionLevel {
  if (typeof value === "string" && EXECUTION_LEVELS.includes(value as ExecutionLevel)) {
    return value as ExecutionLevel;
  }
  throw new CockpitError("VALIDATION_ERROR", "invalid execution level");
}

/** Classify a tool invocation into a cockpit action category. Provider tools
 *  map conservatively: unknown means PRIVILEGED (fail closed). */
export function classifyToolAction(toolName: string, args: Record<string, unknown>): { actionType: ActionType; command: string | null; targetPath: string | null } {
  const command = typeof args.command === "string" ? args.command : null;
  const targetPath = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
  const lower = toolName.toLowerCase();
  if (lower.includes("read") || lower.includes("list") || lower.includes("search") || lower.includes("grep")) {
    return { actionType: "READ", command, targetPath };
  }
  if (lower.includes("write") || lower.includes("edit") || lower.includes("patch") || lower.includes("create")) {
    return { actionType: "WRITE", command, targetPath };
  }
  if (lower.includes("delete") || lower.includes("remove")) {
    return { actionType: "DELETE", command, targetPath };
  }
  if (lower.includes("shell") || lower.includes("bash") || lower.includes("command") || lower.includes("terminal")) {
    return { actionType: "SHELL", command, targetPath };
  }
  if (lower.includes("git")) {
    return { actionType: "GIT_WRITE", command, targetPath };
  }
  if (lower.includes("install") || lower.includes("package")) {
    return { actionType: "PACKAGE_INSTALL", command, targetPath };
  }
  if (lower.includes("fetch") || lower.includes("http") || lower.includes("network") || lower.includes("web")) {
    return { actionType: "NETWORK", command, targetPath };
  }
  return { actionType: "PRIVILEGED", command, targetPath };
}
