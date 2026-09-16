/**
 * Sandbox gateway. Imported code is never executed on the host by default.
 * First-party runners execute in-process with a workspace jail + timeout.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CapError } from "./types";
import { FIRST_PARTY_RUNNERS, type RunnerResult } from "./runners";
import { getCapabilityLabConfig } from "./config";

export async function invokeSandboxed(input: {
  capabilityKey: string;
  args: Record<string, unknown>;
  workspaceRoot: string;
  runId: string;
  importedPython?: boolean;
}): Promise<RunnerResult> {
  const config = getCapabilityLabConfig();
  if (input.importedPython && config.sandboxBackend !== "docker") {
    throw new CapError("SANDBOX_REQUIRED", "imported Python is not executed on the host; docker sandbox is not enabled", 403);
  }
  const runner = FIRST_PARTY_RUNNERS[input.capabilityKey];
  if (!runner) {
    throw new CapError("CAPABILITY_MISSING", "no trusted runner is registered for this capability", 404);
  }
  const workspace = join(input.workspaceRoot, "runs", input.runId);
  mkdirSync(workspace, { recursive: true });
  const started = Date.now();
  const result = runner(input.args, { workspace, runId: input.runId });
  if (Date.now() - started > config.timeoutSeconds * 1000) {
    throw new CapError("TOOL_TIMEOUT", "capability exceeded timeout", 504);
  }
  return result;
}

