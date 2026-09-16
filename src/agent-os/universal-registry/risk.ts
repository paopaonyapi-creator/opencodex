// Phase 20.25 — Risk & permission model (doc §21-§24).
//
// Policy lives OUTSIDE the LLM and outside the planner: `evaluate()` is a pure
// function over the tool record. Reuses the Phase 20.22 ToolPolicyEngine for
// workspace containment and dangerous-command checks so the two policy layers
// can never disagree about what counts as destructive.

import type { Capability, } from "./taxonomy";
import type { PermissionClass, RegistryRiskLevel, ToolRecord } from "./types";
import { ToolPolicyEngine } from "../orchestration/tool-policy";

/** Capability → permission class. Unmapped capabilities default to read_only. */
const CAPABILITY_PERMISSION: Partial<Record<Capability, PermissionClass>> = {
  "web.search": "network_read",
  "web.scrape": "network_read",
  "web.crawl": "network_read",
  "social.search": "network_read",
  "social.tiktok": "network_read",
  "social.youtube": "network_read",
  "social.instagram": "network_read",
  "social.x": "network_read",
  "research.discover": "network_read",
  "research.extract": "network_read",
  "research.summarize": "read_only",
  "research.analyze": "read_only",
  "image.generate": "read_only",
  "image.edit": "read_only",
  "image.upscale": "read_only",
  "image.remove_background": "read_only",
  "video.generate": "read_only",
  "video.extend": "read_only",
  "video.upscale": "read_only",
  "video.audio_generate": "read_only",
  "llm.reason": "read_only",
  "llm.code": "read_only",
  "llm.review": "read_only",
  "llm.translate": "read_only",
  "code.generate": "read_only",
  "code.review": "read_only",
  "code.modify": "file_write",
  "code.execute": "code_execute",
  "repo.inspect": "read_only",
  "test.run": "code_execute",
  "migration.generate": "read_only",
  "filesystem.read": "read_only",
  "filesystem.write": "file_write",
  "filesystem.move": "file_write",
  "filesystem.delete": "delete",
  "shell.execute": "shell_execute",
  "process.start": "code_execute",
  "git.status": "read_only",
  "git.diff": "read_only",
  "git.commit": "file_write",
  "browser.navigate": "network_read",
  "browser.click": "network_write",
  "browser.type": "network_write",
  "browser.fill": "network_write",
  "browser.download": "file_write",
  "browser.screenshot": "read_only",
  "browser.extract": "network_read",
  "stock.keyword": "network_read",
  "stock.metadata": "read_only",
  "stock.quality_review": "read_only",
  "stock.export": "publish",
  "stock.idea": "read_only",
  "notification.discord": "network_write",
  "notification.telegram": "network_write",
  "notification.email": "network_write",
  "media.download": "file_write",
  "media.transcribe": "read_only",
  "data.transform": "read_only",
  "export.package": "file_write",
  "agent.execute": "read_only",
};

/** Permission class → base risk level (doc §22). */
const PERMISSION_RISK: Record<PermissionClass, RegistryRiskLevel> = {
  read_only: 0,
  network_read: 0,
  file_write: 1,
  network_write: 2,
  shell_execute: 3,
  code_execute: 3,
  account_action: 2,
  delete: 4,
  financial_action: 4,
  publish: 2,
};

/** Risk levels that always require a human decision before execution. */
const APPROVAL_RISK_THRESHOLD: RegistryRiskLevel = 3;

export function permissionClassFor(capability: string): PermissionClass {
  return CAPABILITY_PERMISSION[capability as Capability] ?? "read_only";
}

export function riskLevelFor(capability: string): RegistryRiskLevel {
  const cls = permissionClassFor(capability);
  if (cls === "shell_execute" && /sudo|rm\s+-rf|format|admin/i.test(capability)) return 4;
  return PERMISSION_RISK[cls];
}

export function requiresApprovalFor(riskLevel: RegistryRiskLevel): boolean {
  return riskLevel >= APPROVAL_RISK_THRESHOLD;
}

export interface PermissionCheckInput {
  tool: Pick<ToolRecord, "id" | "name" | "status" | "risk" | "executable">;
  capability: string;
  /** Summarized action, e.g. "run_shell_command(npm install)". */
  action?: string;
  /** Raw arguments when the caller wants command/path policy checks. */
  args?: Record<string, unknown>;
  workspaceRoot?: string;
  /** A previously approved (run, step, tool) action key. */
  approved?: boolean;
}

export interface PermissionCheckResult {
  decision: "allowed" | "approval_required" | "denied";
  riskLevel: RegistryRiskLevel;
  reason: string;
}

/**
 * Pure policy evaluation. The LLM/planner may REQUEST an action; only this
 * engine (plus a human approval) can allow it. Always fails closed.
 */
export function evaluatePermission(input: PermissionCheckInput): PermissionCheckResult {
  const cls = permissionClassFor(input.capability);
  const risk = Math.max(input.tool.risk.level, riskLevelFor(input.capability)) as RegistryRiskLevel;

  if (input.tool.status === "disabled") {
    return { decision: "denied", riskLevel: 4, reason: `tool ${input.tool.id} is disabled` };
  }

  // Command safety (doc §63) — delegated to the existing Phase 20.22 engine.
  if (input.args) {
    const policy = new ToolPolicyEngine(input.workspaceRoot);
    const commandArg = (input.args.command as string) || (input.args.cmd as string) || (input.action?.match(/\((.*)\)$/)?.[1] ?? "");
    if (commandArg && cls === "shell_execute") {
      const dangerous = DANGEROUS_SNAPSHOT(commandArg);
      if (dangerous) return { decision: "denied", riskLevel: 4, reason: dangerous };
    }
    const pathArg = (input.args.path as string) || (input.args.file as string) || (input.args.targetPath as string);
    if (pathArg && input.workspaceRoot) {
      const containment = policy.verifyWorkspaceContainment(pathArg, input.workspaceRoot);
      if (!containment.allowed) return { decision: "denied", riskLevel: 4, reason: containment.reason };
    }
  }

  if (input.approved) {
    return { decision: "allowed", riskLevel: risk, reason: "operator approved this action" };
  }

  if (requiresApprovalFor(risk)) {
    return {
      decision: "approval_required",
      riskLevel: risk,
      reason: `${cls} action (risk ${risk}) requires human approval`,
    };
  }

  return { decision: "allowed", riskLevel: risk, reason: `${cls} within policy` };
}

function DANGEROUS_SNAPSHOT(command: string): string | null {
  const policy = new ToolPolicyEngine();
  const result = policy.evaluateTool({
    toolName: "shell",
    serverName: "universal-registry",
    args: { command },
  });
  return result.decision === "DENY" ? result.reason : null;
}
