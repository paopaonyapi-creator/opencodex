// Phase 20.27 — Access modes as REAL policy (doc §15-§26).
//
// ASK / APPROVE / FULL change actual authorization behavior. This module wraps
// the Phase 20.16 policy engine's proven guards (workspace containment,
// protected paths, shell tokenizer, shell policy verdict) and adds the
// access-mode × action × command-class matrix plus the R0-R5 ladder.
//
// Non-negotiable invariants (doc §183): no agent bypasses policy; no secret
// exposure; FULL is never root — destructive commands, secret reads, policy
// tampering, and self-approval are refused in every mode.

import { parseShellCommand } from "../desktop-runtime/security/shell-tokenizer";
import { getPolicyEngine } from "../desktop-runtime/policy/policy-engine";
import { isInsideWorkspace, isProtectedPath } from "./policy";
import { newCockpitId, type CockpitAction, type CockpitPolicyResult, type CommandClass, type ControlRisk } from "./cockpit-types";

/** Commands that are destructive regardless of how they are spelled. */
const DESTRUCTIVE_PROGRAMS = new Set(["rm", "del", "rd", "rmdir", "remove-item", "erase", "format", "mkfs", "dd", "shutdown", "reboot"]);

/** Programs whose entire job is remote mutation or code fetch+run. */
const REMOTE_MUTATION_PROGRAMS = new Set(["curl", "wget", "invoke-webrequest", "ssh", "scp"]);

const PACKAGE_PROGRAMS = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "cargo", "go"]);

const BUILD_TEST_PROGRAMS = new Set(["tsc", "eslint", "oxlint", "biome", "prettier", "ruff", "mypy", "pytest", "vitest", "jest", "make"]);

/** Hard invariants: refused in EVERY mode, including FULL (doc §18). */
const HARD_DENY_PATTERNS: Array<[RegExp, string]> = [
  [/rm\s+(-[a-z]*[rf][a-z]*\s+)+(\.\/)?(\/|~)/i, "recursive forced delete at filesystem root or home"],
  [/git\s+push\s+.*--force/i, "git force push"],
  [/git\s+reset\s+--hard/i, "git reset --hard"],
  [/git\s+clean\s+-[a-z]*f/i, "git clean -f"],
  [/drop\s+(table|database)/i, "database drop"],
  [/truncate\s+table/i, "table truncate"],
  [/curl[^|]*\|\s*(ba)?sh/i, "curl piped into shell"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
  [/mkfs|format\s+[a-z]:/i, "disk format"],
];

export function findHardDeny(commandText: string): string | null {
  for (const [pattern, why] of HARD_DENY_PATTERNS) {
    if (pattern.test(commandText)) return why;
  }
  return null;
}

/** Classify a raw command into a CommandClass (doc §24). */
export function classifyCommand(commandText: string): CommandClass {
  const parsed = parseShellCommand(commandText);
  if (!parsed.isSingleSimpleCommand) {
    // Chains are judged by their most dangerous segment below; a chain that
    // includes unknown/remote parts cannot be auto-allowed.
    for (const segment of parsed.segments) {
      const single = classifyCommand(segment.text);
      if (single === "destructive" || single === "network_write" || single === "package_install" || single === "unknown") {
        return single;
      }
    }
    return "read_only";
  }
  const segment = parsed.segments[0];
  if (!segment) return "unknown";
  // Normalize the program token ourselves (quote-stripped, lowercased) rather
  // than depending on the tokenizer's program shape.
  const program = segment.text.trim().replace(/^["']|["']$/g, "").split(/\s+/)[0].toLowerCase();
  if (DESTRUCTIVE_PROGRAMS.has(program)) return "destructive";
  if (program === "git") {
    const sub = segment.text.trim().split(/\s+/)[1]?.toLowerCase() ?? "";
    if (["push", "pull", "fetch", "remote"].includes(sub)) return "git_remote";
    if (["commit", "add", "merge", "rebase", "checkout", "tag", "worktree"].includes(sub)) return "git_write";
    return "read_only";
  }
  if (PACKAGE_PROGRAMS.has(program)) {
    const sub = segment.text.split(/\s+/)[1]?.toLowerCase() ?? "";
    if (["install", "add", "i"].includes(sub)) return "package_install";
    if (["test", "run", "lint", "build", "typecheck", "exec"].includes(sub)) return "build_test";
    return "package_install";
  }
  if (program === "node" || program === "bun" || program === "python" || program === "python3" || program === "npx" || program === "uvx") return "unknown";
  if (REMOTE_MUTATION_PROGRAMS.has(program)) return "network_write";
  if (program === "tasklist" || program === "taskkill" || program === "kill" || program === "ps" || program === "systemctl") return "process_control";
  if (BUILD_TEST_PROGRAMS.has(program)) return "build_test";
  if (program === "ls" || program === "dir" || program === "cat" || program === "head" || program === "tail" || program === "find" || program === "grep" || program === "rg" || program === "git") return "read_only";
  return "unknown";
}

const ACTION_RISK: Record<CockpitAction["action"], ControlRisk> = {
  "fs.read": "R1",
  "fs.write": "R2",
  "fs.delete": "R4",
  "cmd.run": "R3",
  "git.write": "R2",
  "git.remote": "R4",
  "network.call": "R3",
  "package.install": "R3",
  "secret.read": "R4",
  "deploy": "R5",
  "policy.manage": "R4",
  "session.control": "R1",
};

const CLASS_RISK: Record<CommandClass, ControlRisk> = {
  read_only: "R1",
  build_test: "R3",
  write_local: "R2",
  network_read: "R3",
  network_write: "R4",
  package_install: "R3",
  git_write: "R2",
  git_remote: "R4",
  process_control: "R3",
  system_admin: "R4",
  destructive: "R4",
  unknown: "R3",
};

/**
 * The access-mode matrix (doc §16-§18). Decisions are policy, not UI labels:
 * the same request under a different mode yields a different decision, and the
 * invariants hold in every mode.
 */
export function evaluateCockpitAction(action: CockpitAction): CockpitPolicyResult {
  const policyIds: string[] = [];
  const mode = action.accessMode;

  // 0. Hard invariants first — before any mode logic.
  if (action.action === "cmd.run" && action.commandText) {
    const hardDeny = findHardDeny(action.commandText);
    if (hardDeny) {
      return deny("R4", "hard invariant: " + hardDeny, ["invariant.destructive"], action);
    }
  }
  if (action.action === "secret.read") {
    return deny("R4", "agents receive secret references, never plaintext", ["invariant.secret"], action);
  }
  if (action.action === "policy.manage" && action.actor.startsWith("agent")) {
    return deny("R4", "the agent being judged cannot modify policy", ["invariant.policy_tamper"], action);
  }
  if (action.action === "deploy") {
    // Even FULL mode needs an explicit human approval for deployment.
    return approval("R5", "deployment requires explicit human approval in every mode", ["invariant.deploy"], action, "once");
  }
  if (action.resource && (action.action === "fs.read" || action.action === "fs.write" || action.action === "fs.delete")) {
    if (isProtectedPath(action.resource)) {
      return deny("R4", "resource is a protected credential/config path", ["invariant.protected_path"], action);
    }
    if (!isInsideWorkspace(action.resource, action.workspaceRoot)) {
      return deny("R4", "resource escapes the workspace root", ["invariant.workspace_scope"], action);
    }
  }

  let risk = ACTION_RISK[action.action];
  let commandClass: CommandClass | undefined = action.commandClass;
  if (action.action === "cmd.run" && action.commandText) {
    commandClass = classifyCommand(action.commandText);
    risk = CLASS_RISK[commandClass];
    const shell = getPolicyEngine().evaluateShellCommand(action.commandText);
    if (!shell.allowed) {
      // The shell policy refuses to AUTO-RUN this command. That is an
      // escalation signal, not a cockpit denial: the mode matrix below still
      // decides allow/approval/deny (spec §137: APPROVE + push = approval).
      policyIds.push("shell.policy.refused");
      risk = "R4";
    }
    const parsed = parseShellCommand(action.commandText);
    if (parsed.opaqueConstructs.length > 0) {
      return deny(risk, "command contains unverifiable constructs", ["shell.opaque"], action);
    }
  }

  const scope: CockpitPolicyResult["approvalScope"] =
    action.action === "cmd.run" || action.action === "network.call" ? "once" : "task";

  // 1. ASK mode: reads free, everything else needs a human (doc §16).
  if (mode === "ask") {
    if (risk === "R1" || action.action === "session.control") {
      return allow(risk, "read-only operation permitted in ask mode", ["mode.ask.read"], action);
    }
    return approval(risk, "ask mode requires approval for " + action.action, ["mode.ask.approval"], action, scope);
  }

  // 2. APPROVE mode: bounded local coding autonomy (doc §17).
  if (mode === "approve") {
    if (risk === "R1" || risk === "R2") {
      return allow(risk, "workspace-bounded operation permitted in approve mode", ["mode.approve.local"], action);
    }
    if (commandClass === "build_test") {
      return allow(risk, "allowlisted build/test command permitted in approve mode", ["mode.approve.build_test"], action);
    }
    if (action.action === "git.remote" || commandClass === "git_remote" || commandClass === "package_install" || commandClass === "network_write" || commandClass === "destructive" || commandClass === "system_admin") {
      return approval(risk, "approve mode requires approval for " + (commandClass ?? action.action), ["mode.approval.remote"], action, scope);
    }
    if (risk === "R3") {
      return approval(risk, "command side effect requires approval in approve mode", ["mode.approve.side_effect"], action, scope);
    }
    return approval(risk, "unclassified operation requires approval", ["mode.approve.unknown"], action, scope);
  }

  // 3. FULL mode: broad trusted autonomy, invariants intact (doc §18).
  policyIds.push("mode.full.trusted");
  if (risk === "R4" || risk === "R5") {
    return approval(risk, "even full mode requires human approval for destructive/remote/production actions", ["mode.full.approval"], action, scope);
  }
  return allow(risk, "trusted local operation permitted in full mode", ["mode.full.allow"], action);

  // --- helpers -------------------------------------------------------------

  function allow(r: ControlRisk, reason: string, ids: string[], _a: CockpitAction): CockpitPolicyResult {
    return { decision: "allow", risk: r, reason, policyIds: [...policyIds, ...ids], approvalScope: "once" };
  }
  function approval(r: ControlRisk, reason: string, ids: string[], _a: CockpitAction, approvalScope: CockpitPolicyResult["approvalScope"]): CockpitPolicyResult {
    return { decision: "require_approval", risk: r, reason, policyIds: [...policyIds, ...ids], approvalScope };
  }
  function deny(r: ControlRisk, reason: string, ids: string[], _a: CockpitAction): CockpitPolicyResult {
    return { decision: "deny", risk: r, reason, policyIds: [...policyIds, ...ids], approvalScope: "once" };
  }
}

/** Stable request id for an approval envelope. */
export function newApprovalId(): string {
  return newCockpitId("cappr");
}
