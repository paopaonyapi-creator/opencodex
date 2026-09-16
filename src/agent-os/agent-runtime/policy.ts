// Phase 20.61 — Policy-governed execution gateway (spec §10, §11).
//
// Pure rule functions with ruleIds (capability-lab precedent). Every
// tool/command request passes: capability check -> path policy -> command
// policy -> network policy -> secret policy -> risk classification ->
// approval requirement. Default-deny: anything not explicitly allowed by a
// rule is denied. Blacklists alone are not the safety mechanism — the gateway
// only executes request classes that a rule allowed.

import {
  AgentRuntimeHttpError,
  type AgentWorkerConfig,
  type CommandClass,
  type ExecutionDecision,
  type ExecutionRequest,
  type RiskLevel,
  type AgentTask,
} from "./types";

type Effect = "allow" | "deny" | "require_approval";
interface RuleResult { ruleId: string; effect: Effect; reason: string }

function rule(effect: Effect, ruleId: string, reason: string): RuleResult {
  return { ruleId, effect, reason };
}

function combine(results: RuleResult[]): ExecutionDecision {
  if (results.some((r) => r.effect === "deny")) return { effect: "deny", ruleResults: results };
  if (results.some((r) => r.effect === "require_approval")) return { effect: "require_approval", ruleResults: results };
  return { effect: "allow", ruleResults: results };
}

// --- command classes a worker capability may unlock ---

const CAPABILITY_COMMAND_CLASS: Record<CommandClass, WorkerCapabilityAlias | null> = {
  "command.safe_dev": "command.safe_dev",
  "command.test": "command.test",
  "command.readonly_git": "command.readonly_git",
  "command.write_git": "command.write_git",
  "command.package_install": "command.safe_dev",
  "command.network": "network.access",
  "command.secret": "secret.access",
  "command.dangerous": null, // no capability unlocks this; always policy+approval
};

type WorkerCapabilityAlias = AgentWorkerConfig["capabilities"][number];

/** Dangerous verb families that are always deny or require_approval (spec §10). */
const ALWAYS_DENIED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\s*sudo\b/, reason: "privilege escalation is not executable by workers" },
  { pattern: /^\s*su\b/, reason: "identity switch is not executable by workers" },
  { pattern: /:\(\)\s*\{.*\};\s*:/, reason: "shell function fork-bomb shape detected" },
  { pattern: /\bmkfs\b|\bformat\b/i, reason: "disk formatting is denied" },
  { pattern: /\bmount\b|\bumount\b/, reason: "mount operations are denied" },
  { pattern: /\bsystemctl\b|\bservice\s+/, reason: "service/system changes are denied" },
  { pattern: /\bufw\b|\biptables\b|\bnft\b/, reason: "firewall changes are denied" },
  { pattern: /\bdocker\b.*--privileged/, reason: "privileged containers are denied" },
  { pattern: /\bssh\b|\bnc\b|\bnetcat\b/, reason: "host/socket access is denied" },
];

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)/, reason: "recursive forced deletion requires approval" },
  { pattern: /\bgit\s+push\b/, reason: "git push requires approval" },
  { pattern: /\bgit\s+(push\s+.*--force|reset\s+--hard|clean\s+-[a-zA-Z]*f|rebase\b)/, reason: "force/history operations require approval" },
  { pattern: /\bgit\s+merge\b/, reason: "merge requires release-controller approval flow" },
  { pattern: /\bdrop\s+(table|database)\b/i, reason: "destructive database mutation requires approval" },
];

/** Risk classifier (spec §10). Critical/high require approval downstream. */
export function classifyRisk(request: Pick<ExecutionRequest, "commandClass" | "argv" | "network" | "secretAccess" | "paths">): RiskLevel {
  const joined = request.argv.join(" ");
  if (request.commandClass === "command.secret" || request.secretAccess) return "critical";
  if (request.commandClass === "command.dangerous") return "critical";
  if (request.commandClass === "command.network" || request.network) return "high";
  if (request.commandClass === "command.package_install") return "high";
  if (DESTRUCTIVE_PATTERNS.some((d) => d.pattern.test(joined))) return "high";
  if (request.commandClass === "command.write_git") return "medium";
  return "low";
}

/** Path policy (spec §10): every requested path must stay inside the task worktree. */
export function decidePathPolicy(input: { paths: string[]; worktreePath: string | null; additionalReadonly?: string[] }): RuleResult[] {
  const results: RuleResult[] = [];
  if (input.paths.length === 0) return [rule("allow", "agent.path.none", "no file paths requested")];
  if (!input.worktreePath) {
    return [rule("deny", "agent.path.no_worktree", "task has no isolated worktree; file operations are unavailable")];
  }
  const allowedRoots = [input.worktreePath, ...(input.additionalReadonly ?? [])];
  for (const requested of input.paths) {
    const normalized = requested.replace(/\\/g, "/");
    if (normalized.includes("..")) {
      results.push(rule("deny", "agent.path.traversal", `path traversal rejected: ${requested}`));
      continue;
    }
    const resolved = normalized.startsWith("/") ? normalized : input.worktreePath + "/" + normalized;
    const inside = allowedRoots.some((root) => resolved === root || resolved.startsWith(root.replace(/\\/g, "/") + "/"));
    if (!inside) {
      results.push(rule("deny", "agent.path.outside_scope", `path is outside the task worktree scope: ${requested}`));
    } else {
      results.push(rule("allow", "agent.path.inside_scope", `path within task scope: ${requested}`));
    }
  }
  return results;
}

/**
 * The full gateway decision for one execution request (spec §10 pipeline).
 * Every deny short-circuits into the combined effect; risk high/critical
 * upgrades to require_approval even when individual rules allowed.
 */
export function decideExecution(input: {
  worker: AgentWorkerConfig;
  task: AgentTask;
  request: ExecutionRequest;
  networkDefault: "deny" | "allow";
  extraPaths?: string[];
}): ExecutionDecision {
  const results: RuleResult[] = [];
  const argvText = input.request.argv.join(" ");

  // 1. identity + task scope: the worker must actually hold the claim.
  if (input.task.claimOwner !== input.worker.id) {
    results.push(rule("deny", "agent.identity.not_claim_owner", "worker does not hold the task claim"));
  } else {
    results.push(rule("allow", "agent.identity.claim_owner", "worker holds the task claim"));
  }

  // 2. capability check (per task/action, not merely per worker name — spec §5).
  const requiredCapability = CAPABILITY_COMMAND_CLASS[input.request.commandClass];
  if (requiredCapability === null) {
    results.push(rule("deny", "agent.capability.unclassifiable", "no capability can authorize this command class"));
  } else if (!input.worker.capabilities.includes(requiredCapability)) {
    results.push(rule("deny", "agent.capability.missing", `worker lacks capability ${requiredCapability}`));
  } else {
    results.push(rule("allow", "agent.capability.present", `capability ${requiredCapability} granted to worker`));
  }

  // 3. structural deny families (never executable regardless of capability).
  for (const denied of ALWAYS_DENIED_PATTERNS) {
    if (denied.pattern.test(argvText)) {
      results.push(rule("deny", "agent.command.always_denied", denied.reason));
    }
  }

  // 4. destructive / high-risk shapes: approval, never silent execution.
  for (const destructive of DESTRUCTIVE_PATTERNS) {
    if (destructive.pattern.test(argvText)) {
      results.push(rule("require_approval", "agent.command.destructive", destructive.reason));
    }
  }

  // 5. network policy: default deny.
  if (input.request.network || input.request.commandClass === "command.network") {
    results.push(input.networkDefault === "deny"
      ? rule("deny", "agent.network.default_deny", "network access is denied by the policy profile")
      : rule("require_approval", "agent.network.approval", "network access requires approval even when the profile allows it"));
  } else {
    results.push(rule("allow", "agent.network.not_requested", "no network access requested"));
  }

  // 6. secret policy: deny unless the capability was explicitly granted.
  if (input.request.secretAccess || input.request.commandClass === "command.secret") {
    results.push(input.worker.capabilities.includes("secret.access")
      ? rule("require_approval", "agent.secret.approval", "secret access requires per-request approval")
      : rule("deny", "agent.secret.denied", "worker lacks the secret.access capability"));
  }

  // 7. path policy.
  results.push(...decidePathPolicy({
    paths: input.request.paths ?? [],
    worktreePath: input.task.worktreePath,
    additionalReadonly: input.extraPaths,
  }));

  const decision = combine(results);
  // 8. risk classification upgrades the final effect.
  const risk = classifyRisk(input.request);
  if (risk === "high" || risk === "critical") {
    if (decision.effect === "allow") {
      return { effect: "require_approval", ruleResults: [...decision.ruleResults, rule("require_approval", "agent.risk.high", `risk level ${risk} requires human approval`)] };
    }
  }
  return decision;
}

/** Approval matrix for named high-level actions (spec §11). */
export function approvalRequirement(action: string): "allow" | "policy_dependent" | "restricted" | "approval_required" {
  switch (action) {
    case "repo.read":
    case "worktree.modify":
    case "run.unit_tests":
    case "run.lint_typecheck":
    case "evidence.record":
      return "allow";
    case "dependency.install":
      return "policy_dependent";
    case "network.access":
      return "restricted";
    case "secret.read":
    case "branch.push":
    case "protected.merge":
    case "production.db.write":
    case "production.deploy":
    case "data.delete":
    case "external.message":
    case "infrastructure.change":
      return "approval_required";
    default:
      return "approval_required";
  }
}

/** Guard rails around merge/deploy targets (spec §4, §28). */
export function decideMergeTarget(input: { branch: string | null; targetBranch: string; protectedBranches: string[] }): ExecutionDecision {
  const results: RuleResult[] = [];
  if (input.protectedBranches.includes(input.targetBranch)) {
    results.push(rule("require_approval", "agent.merge.protected", `merging into protected branch ${input.targetBranch} requires human approval`));
  } else {
    results.push(rule("require_approval", "agent.merge.default", "all merges require human approval in this phase"));
  }
  if (!input.branch || !input.branch.startsWith("pao/amux/")) {
    results.push(rule("deny", "agent.merge.branch_format", "merge candidates must come from a pao/amux/<task>/<role> worker branch"));
  } else {
    results.push(rule("allow", "agent.merge.branch_ok", "worker branch format verified"));
  }
  return combine(results);
}

export function requirePolicyAllowed(decision: ExecutionDecision): void {
  if (decision.effect === "deny") {
    const denied = decision.ruleResults.find((r) => r.effect === "deny");
    throw new AgentRuntimeHttpError("AGENT_POLICY_DENIED", 403, denied?.reason ?? "policy denied the operation", { ruleResults: decision.ruleResults });
  }
}
