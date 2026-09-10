// Phase 20.16 — Multi-AI Control Plane: policy engine.
//
// This is the single gate every tool request passes through, for every AI. It
// reuses the hardened guards rather than reimplementing them:
//   - PathGuard / shell-tokenizer for filesystem and command boundaries
//   - the existing policy engine's allowlist semantics, now per simple command
//
// The rule that matters most is the last one: the identity of the CALLER never
// raises a permission. A "trusted" agent and an untrusted one are evaluated
// identically, because the whole premise of the phase is that every AI is untrusted.

import { normalize, resolve, relative, isAbsolute } from "node:path";
import {
  type RiskLevel,
  type TaskEnvelope,
  maxRisk,
  riskRank,
} from "./types";
import {
  CODE_EXECUTION_PROGRAMS,
  commandProgram,
  parseShellCommand,
} from "../desktop-runtime/security/shell-tokenizer";

export interface PolicyRequest {
  readonly task: Pick<TaskEnvelope, "task_id" | "workspace_root" | "allowed_tools" | "forbidden_tools" | "risk_level">;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly risk: RiskLevel;
  readonly requiresApproval: boolean;
  readonly reason: string;
  /** Stable rule id, so a test asserts WHY and a reviewer can trace it. */
  readonly rule: string;
}

/** Tools that only read. They imply L0 and can never write. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "project.list",
  "project.status",
  "project.get_context",
  "task.get",
  "task.list",
  "files.list",
  "files.read",
  "files.diff",
  "git.status",
  "git.diff",
  "git.branch",
  "command.plan",
  "review.get",
  "approval.get",
  "artifact.list",
  "artifact.get",
  "artifact.compare",
  "domain.health",
]);

const SANDBOX_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "files.write_sandbox",
  "artifact.register",
  "task.create",
  "review.request",
  "approval.request",
  "command.run_safe",
]);

const PROJECT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "files.apply_patch",
  "git.create_worktree",
  "git.commit",
  "media.create_brief",
  "media.generate_image",
  "media.generate_video",
  "media.upscale",
  "media.qc",
  "media.export",
  "review.submit",
]);

/** Never auto-approved, regardless of task ceiling or caller identity. */
const SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  "git.push",
  "command.run_approved",
  "approval.decide",
  "artifact.approve",
  "deploy.release",
  "secret.rotate",
  "db.migrate",
]);

/**
 * Paths that are always refused for READ, not merely for write. Agent
 * configuration, credentials, and key material have no legitimate read path
 * through a tool call, so an attempt to reach them is a policy violation rather
 * than a permission question.
 */
const PROTECTED_PATH_TOKENS: readonly string[] = [
  ".env",
  ".ssh",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".aws",
  ".gnupg",
  ".npmrc",
  ".netrc",
  "credentials",
  "secrets",
  "keystore",
  ".pem",
  ".p12",
  ".pfx",
  "admin-api-token",
  "auth.json",
];

export function isProtectedPath(targetPath: string): boolean {
  const lowered = String(targetPath ?? "").toLowerCase().replace(/\\\\/g, "/");
  return PROTECTED_PATH_TOKENS.some((token) => {
    const needle = token.replace(/\./g, "\\.");
    return new RegExp("(^|/)" + needle + "($|/|\\.)").test(lowered) || lowered.endsWith(token);
  });
}

/**
 * True when the path stays inside the workspace root, boundary-aware.
 *
 * Resolved lexically here on purpose: this is the pure check, and the caller that
 * actually touches the disk must additionally use PathGuard, which canonicalizes
 * symlinks. Keeping the two separate means a policy unit test needs no filesystem.
 */
export function isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const target = normalize(resolve(targetPath));
  const root = normalize(resolve(workspaceRoot));
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Classify a request by tool and arguments.
 *
 * Arguments matter as much as the tool name: files.write_sandbox is L1 for a
 * scratch file and L2 for a project source file, and a command tool's risk depends
 * entirely on the command it carries.
 */
export function classifyRequestRisk(request: PolicyRequest): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: RiskLevel = "L0";

  const bump = (to: RiskLevel, why: string): void => {
    reasons.push(why);
    level = maxRisk(level, to);
  };

  const tool = request.tool;
  const args = request.arguments ?? {};

  if (SENSITIVE_TOOLS.has(tool)) {
    bump("L3", "Tool " + tool + " is in the sensitive set and always needs explicit approval.");
  } else if (PROJECT_WRITE_TOOLS.has(tool)) {
    bump("L2", "Tool " + tool + " writes to project state.");
  } else if (SANDBOX_WRITE_TOOLS.has(tool)) {
    bump("L1", "Tool " + tool + " writes to the sandbox.");
  } else if (READ_ONLY_TOOLS.has(tool)) {
    bump("L0", "Tool " + tool + " is read-only.");
  } else {
    // An unknown tool is not assumed harmless. Unknown means unclassified, and
    // unclassified defaults to requiring a human.
    bump("L2", "Tool " + tool + " is not classified; treating as a project write.");
  }

  const pathArgs = [args.path, args.file, args.targetPath, args.workspacePath].filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  for (const candidate of pathArgs) {
    if (isProtectedPath(candidate)) {
      bump("L3", "Path '" + candidate + "' is a protected credential or configuration path.");
    }
    if (!isInsideWorkspace(candidate, request.task.workspace_root)) {
      bump("L3", "Path '" + candidate + "' escapes the task workspace root.");
    }
  }

  // A path carried inside the command text must be judged the same way as one
  // passed as an argument; otherwise a command becomes a way around the path check.
  if (typeof args.command === "string") {
    const parsed = parseShellCommand(args.command);
    if (parsed.opaqueConstructs.length > 0) {
      bump("L3", "Command contains unverifiable constructs: " + parsed.opaqueConstructs.join(", ") + ".");
    }
    if (!parsed.isSingleSimpleCommand) {
      bump("L2", "Command chains operators; each component must be justified separately.");
    }
    for (const segment of parsed.segments) {
      const program = commandProgram(segment.text);
      if (CODE_EXECUTION_PROGRAMS.has(program)) {
        bump("L3", "Command invokes '" + program + "', which executes arbitrary code.");
      }
      if (isProtectedPath(segment.text)) {
        bump("L3", "Command references a protected path: " + segment.text + ".");
      }
    }
  }

  return { level, reasons };
}

/**
 * Decide whether a request may proceed.
 *
 * Order matters and is deliberate: tool-set membership, then risk classification,
 * then the task ceiling, then the human gate. An agent cannot widen its own
 * permission by declaring a lower risk_level on its task, because a tool's
 * intrinsic risk is compared with the ceiling independently.
 */
export function evaluateRequest(request: PolicyRequest): PolicyDecision {
  const { task } = request;

  // 1. Explicit denials win outright, before any classification work.
  if (task.forbidden_tools.includes(request.tool)) {
    return {
      allowed: false,
      risk: "L3",
      requiresApproval: false,
      reason: "Tool " + request.tool + " is explicitly forbidden for this task.",
      rule: "tool.forbidden",
    };
  }

  // 2. An allowlist, when present, is exhaustive — not advisory.
  if (task.allowed_tools.length > 0 && !task.allowed_tools.includes(request.tool)) {
    return {
      allowed: false,
      risk: "L2",
      requiresApproval: false,
      reason: "Tool " + request.tool + " is not in this task's allowed_tools.",
      rule: "tool.not_allowed",
    };
  }

  const classification = classifyRequestRisk(request);
  // The task ceiling is a MAXIMUM, not a floor. Folding the two together with
  // maxRisk would make every read on an L2 task require approval, which is both
  // wrong and corrosive: an approval queue that prompts for reading a file trains
  // the operator to approve without looking. The ceiling is consulted only to
  // REFUSE what exceeds it (check 4 below).
  const effective = classification.level;

  // 3. L3 always needs a human, whatever the task ceiling claims.
  if (riskRank(classification.level) >= riskRank("L3")) {
    return {
      allowed: false,
      risk: "L3",
      requiresApproval: true,
      reason: classification.reasons.join(" ") || "Sensitive operation requires explicit approval.",
      rule: "risk.sensitive",
    };
  }

  // 4. Anything above the ceiling the task was created with needs a human.
  if (riskRank(effective) > riskRank(task.risk_level)) {
    return {
      allowed: false,
      risk: effective,
      requiresApproval: true,
      reason:
        "Operation risk " + classification.level + " exceeds this task's ceiling " + task.risk_level + ".",
      rule: "risk.above_task_ceiling",
    };
  }

  // 5. L2 is permitted but policy-checked by the caller's approval flow; L0/L1 run free.
  if (riskRank(effective) >= riskRank("L2")) {
    return {
      allowed: true,
      risk: effective,
      requiresApproval: true,
      reason: classification.reasons.join(" ") || "Project-level write is permitted with approval.",
      rule: "risk.project_write",
    };
  }

  return {
    allowed: true,
    risk: effective,
    requiresApproval: false,
    reason: classification.reasons.join(" ") || "Read-only or sandbox-bounded operation.",
    rule: "risk.free",
  };
}
