// Phase 20.33 — governance providers backing the pao.* catalog (doc §6.2, §G).
// The local fs provider ships with the Phase 20.28 gateway; this module adds
// the governed argv-only shell executor, the read-only Reviewer Council
// performer, and the health meta performer. Everything delegates to existing
// infrastructure (runProcessSafely allowlist, ReviewerCouncilBridge) — no new
// policy engine is invented here.

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { runProcessSafely } from "../media-acquisition/process-runner";
import { ReviewerCouncilBridge } from "../orchestration/reviewer-council";
import type { ActionRequest, CapabilityGrant, GovernanceProvider } from "../governance-gateway/types";

/** Hard-denied binaries: shells and shell-adjacent interpreters that would
 *  circumvent argv discipline. Everything else still needs a capability grant
 *  AND human approval (execute effect) before this provider ever runs. */
const SHELL_INTERPRETER_BINARIES = new Set([
  "sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
]);

const MAX_SHELL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_PREVIEW = 64 * 1024;

export function workspaceRoots(): string[] {
  const raw = process.env.PAO_ALLOWED_WORKSPACE_ROOTS;
  const roots = raw
    ? raw.split(/[,;]/).map((root) => root.trim()).filter(Boolean)
    : [process.cwd()];
  return roots.map((root) => resolve(root));
}

function insideApprovedRoots(candidate: string): boolean {
  const roots = workspaceRoots();
  return roots.some((root) => {
    const prefix = root.endsWith(sep) ? root : root + sep;
    let real = candidate;
    try {
      real = existsSync(candidate) ? realpathSync(candidate) : candidate;
    } catch {
      return false;
    }
    return real === root || real.startsWith(prefix);
  });
}

export class PaoShellProvider implements GovernanceProvider {
  readonly id = "pao-shell";
  readonly capabilities = ["shell.execute"];
  readonly available = true;

  async perform(action: ActionRequest, _grant: CapabilityGrant): Promise<{ output: unknown }> {
    const args = (action.arguments && typeof action.arguments === "object" ? action.arguments : {}) as Record<string, unknown>;
    const binary = typeof args.binary === "string" ? args.binary : "";
    if (!binary || SHELL_INTERPRETER_BINARIES.has(binary.toLowerCase())) {
      throw new Error("SHELL_BINARY_DENIED: shell interpreters are never executable through pao.shell.execute");
    }
    let argv: string[];
    try {
      const parsed = JSON.parse(typeof args.args === "string" ? args.args : "[]");
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("not a string array");
      argv = parsed as string[];
    } catch {
      throw new Error("SHELL_ARGS_INVALID: args must be a JSON-encoded array of strings (argv discipline, no shell interpolation)");
    }
    const cwd = typeof args.cwd === "string" && args.cwd.trim() ? resolve(args.cwd) : resolve(process.cwd());
    if (!insideApprovedRoots(cwd)) {
      throw new Error("SHELL_CWD_OUT_OF_SCOPE: cwd must be inside PAO_ALLOWED_WORKSPACE_ROOTS");
    }
    const requested = Number.parseInt(typeof args.timeout_seconds === "string" ? args.timeout_seconds : "", 10);
    const timeoutMs = Math.min(Number.isFinite(requested) && requested > 0 ? requested * 1000 : MAX_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS);
    const result = await runProcessSafely({ binary, args: argv, cwd, timeoutMs, maxBufferBytes: 1024 * 1024 });
    return {
      output: {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, MAX_OUTPUT_PREVIEW),
        stderr: result.stderr.slice(0, MAX_OUTPUT_PREVIEW),
        durationMs: result.durationMs,
        timedOut: result.killedDueToTimeout,
      },
    };
  }
}

export class PaoReviewProvider implements GovernanceProvider {
  readonly id = "pao-review";
  readonly capabilities = ["review.council"];
  readonly available = true;

  async perform(action: ActionRequest, _grant: CapabilityGrant): Promise<{ output: unknown }> {
    const args = (action.arguments && typeof action.arguments === "object" ? action.arguments : {}) as Record<string, unknown>;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(typeof args.args_json === "string" ? args.args_json : "{}") as Record<string, unknown>;
    } catch {
      parsedArgs = {};
    }
    const bridge = new ReviewerCouncilBridge();
    const verdict = await bridge.evaluateAction({
      toolName: typeof args.tool_name === "string" ? args.tool_name : "unknown",
      args: parsedArgs,
      riskLevel: typeof args.risk_level === "string" ? args.risk_level : "R0",
      reason: typeof args.reason === "string" ? args.reason : "",
    });
    return { output: verdict };
  }
}
