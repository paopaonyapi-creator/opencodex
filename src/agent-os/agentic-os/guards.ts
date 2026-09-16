// Phase 20.37 — guards (§19, §20, §28): path guard (canonical resolution +
// secret-path deny + workspace containment), command guard (reuses the Phase
// 20.27 command classifier and hard-deny list), and secret redaction (reuses
// Phase 20.35 plus .env/cookie/private-key patterns). Broken security guards
// fail CLOSED by construction: unknown => deny.

import { isAbsolute, join, resolve, sep } from "node:path";
import { classifyCommand } from "../control-plane/access-policy";
import { redactSecrets as unifiedRedact } from "../unified-runtime/security";
import type { HookDecision, HookPolicy } from "./types";

// --- Path guard (§20) --------------------------------------------------------

const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|[/\\])\.env(\.|$)/i,
  /(^|[/\\])\.env$/i,
  /id_rsa/i,
  /\.pem$/i,
  /credentials\.json$/i,
  /(^|[/\\])\.ssh([/\\]|$)/i,
];

export interface PathGuardContext {
  workspaceRoot: string;
  path: string;
}

export function guardPath(context: PathGuardContext): HookDecision {
  try {
    if (!context.path || typeof context.path !== "string") {
      return { action: "deny", reason: "path is required", code: "PATH_REQUIRED" };
    }
    const root = resolve(context.workspaceRoot);
    const candidate = isAbsolute(context.path) ? resolve(context.path) : resolve(root, context.path);
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (candidate !== root && !candidate.startsWith(prefix)) {
      return { action: "deny", reason: "outside the approved workspace", code: "PATH_OUTSIDE_WORKSPACE" };
    }
    const normalized = candidate.split(sep).join("/");
    for (const pattern of SECRET_PATH_PATTERNS) {
      if (pattern.test(normalized)) {
        return { action: "deny", reason: "secret-bearing path", code: "PATH_SECRET_DENIED" };
      }
    }
    if (normalized.includes("/.git/")) {
      return { action: "deny", reason: ".git internals are managed by Git commands only", code: "PATH_GIT_INTERNAL" };
    }
    return { action: "allow" };
  } catch {
    // Fail closed: a broken guard denies (§17 failure behavior).
    return { action: "deny", reason: "path guard failed closed", code: "PATH_GUARD_ERROR" };
  }
}

export function joinWorkspacePath(workspaceRoot: string, relative: string): string {
  return isAbsolute(relative) ? resolve(relative) : join(resolve(workspaceRoot), relative);
}

// --- Command guard (§19): classifier + hard-deny families ----------------------

const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-fd/i,
  /git\s+push\s+(-f|--force)/i,
  /\brm\s+-rf?\s+[\/\\]|rm\s+-rf?\s+~/i,
  /mkfs|dd\s+if=/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\b(sh|bash|zsh|powershell|pwsh)\s+-c\b/i, // shell -c escapes argv discipline
  /curl[^|]*\|\s*(sh|bash)/i,
  /\bchmod\s+777\b/i,
  /\b(useradd|usermod|passwd)\b/i,
  /id_rsa|\.ssh\/|\.aws\/|browser.*[Cc]ookie/i,
];

export interface CommandGuardResult {
  allowed: boolean;
  riskLevel: 0 | 1 | 2 | 3 | 4;
  category: string;
  reason: string;
}

export function guardCommand(commandText: string): CommandGuardResult {
  const trimmed = (commandText ?? "").trim();
  if (!trimmed) return { allowed: false, riskLevel: 4, category: "invalid", reason: "command is required" };
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, riskLevel: 4, category: "destructive", reason: "destructive/system-level command is never auto-run (§19)" };
    }
  }
  const category = classifyCommand(trimmed);
  switch (category) {
    case "read_only":
      return { allowed: true, riskLevel: 0, category, reason: "read-only command" };
    case "build_test":
      return { allowed: true, riskLevel: 2, category, reason: "build/test command within workspace" };
    case "git_write":
      return { allowed: true, riskLevel: 2, category, reason: "local git write (commit/stage) within workspace" };
    case "git_remote":
      return { allowed: false, riskLevel: 3, category, reason: "remote git mutation requires approval (§19)" };
    case "package_install":
      return { allowed: true, riskLevel: 2, category, reason: "lockfile-aware dependency install within workspace" };
    case "network_write":
      return { allowed: false, riskLevel: 3, category, reason: "external network mutation requires approval" };
    case "destructive":
      return { allowed: false, riskLevel: 4, category, reason: "destructive command denied" };
    default:
      // Unknown categories fail closed (§19: no arbitrary shell).
      return { allowed: false, riskLevel: 4, category: String(category), reason: "unclassified commands are denied (fail closed)" };
  }
}

// --- Hook engine (§17): priority-ordered policy dispatch -------------------------

export interface HookContext {
  event: HookPolicy["event"];
  workspaceRoot: string;
  riskLevel: number;
  path?: string;
  command?: string;
  verificationPassed?: boolean;
  insideWorkspace?: boolean;
}

export interface HookOutcome {
  decision: HookDecision;
  matchedPolicyId: string | null;
  auditEvents: string[];
}

function policyMatches(policy: HookPolicy, context: HookContext): boolean {
  if (policy.event !== context.event) return false;
  const when = policy.when;
  if (when.riskGte !== undefined && context.riskLevel < when.riskGte) return false;
  if (when.pathMatches && context.path) {
    const normalized = context.path.split(sep).join("/");
    const hit = when.pathMatches.some((pattern) => {
      const regex = new RegExp("^" + pattern.replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*") + "$", "i");
      return regex.test(normalized);
    });
    if (!hit) return false;
  }
  if (when.commandMatches && context.command) {
    const hit = when.commandMatches.some((needle) => context.command!.toLowerCase().includes(needle.toLowerCase()));
    if (!hit) return false;
  }
  if (when.outsideWorkspace !== undefined && context.insideWorkspace !== undefined) {
    if (when.outsideWorkspace !== !context.insideWorkspace) return false;
  }
  if (when.verificationNotPassed !== undefined && context.verificationPassed !== undefined) {
    if (when.verificationNotPassed !== !context.verificationPassed) return false;
  }
  return true;
}

/** Evaluates ordered hook policies for one lifecycle event. Security bands
 *  (deny/require_approval) fail closed when the policy itself throws. */
export function runHookPolicies(policies: HookPolicy[], context: HookContext): HookOutcome {
  const auditEvents: string[] = [];
  const ordered = [...policies]
    .filter((policy) => policy.mode !== "disabled")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const policy of ordered) {
    let matched = false;
    try {
      matched = policyMatches(policy, context);
    } catch {
      matched = policy.action === "deny" || policy.action === "require_approval";
    }
    if (!matched) continue;
    switch (policy.action) {
      case "deny":
        return { decision: { action: "deny", reason: policy.message, code: "HOOK_DENY:" + policy.id }, matchedPolicyId: policy.id, auditEvents };
      case "require_approval":
        return { decision: { action: "require_approval", reason: policy.message, riskLevel: Math.max(policy.when.riskGte ?? 3, context.riskLevel) }, matchedPolicyId: policy.id, auditEvents };
      case "warn":
        auditEvents.push(`warn:${policy.id}: ${policy.message}`);
        break;
      case "emit_audit":
        auditEvents.push(`audit:${policy.id}`);
        break;
      case "allow":
        return { decision: { action: "allow" }, matchedPolicyId: policy.id, auditEvents };
    }
  }
  return { decision: { action: "allow" }, matchedPolicyId: null, auditEvents };
}

// Patch the optional flag used by the commit-gate policy without widening the
// public manifest type everywhere.
declare module "./types" {
  interface HookConditionExtras {
    verificationNotPassedGuard?: boolean;
  }
}

// --- Redaction (§28): unified redaction + env/cookie/private-key patterns --------

export function redactAuditText(text: string, maxChars = 4000): string {
  const redacted = unifiedRedact(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]")
    .replace(/(^|\n)\s*[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|COOKIE)[A-Z_]*\s*=\s*[^\n]+/gi, "$1[REDACTED:env-assignment]")
    .replace(/(cookie\s*:\s*)[^\n]+/gi, "$1[REDACTED:cookie]");
  return redacted.length > maxChars ? redacted.slice(0, maxChars) + "…[truncated]" : redacted;
}
