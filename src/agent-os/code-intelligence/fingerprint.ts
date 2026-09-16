// Phase 20.62 — Working-tree fingerprints (spec §21, §35).
//
// Evidence and approvals bind to a repository/worktree fingerprint, not just
// a Git SHA: Graft represents uncommitted working-tree state, so the
// fingerprint mixes HEAD with `git status --porcelain` output. A material
// change after analysis invalidates prior evidence/approvals.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function workingTreeFingerprint(cwd: string): Promise<string> {
  let head = "no-git";
  let status = "";
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 10_000, windowsHide: true });
    head = stdout.trim();
  } catch {
    // Not a git repository — fingerprint degrades to the status scan below.
  }
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000, windowsHide: true });
    status = stdout;
  } catch {
    status = "status-unavailable";
  }
  return "wt_" + createHash("sha256").update(head + "\n" + status).digest("hex").slice(0, 24);
}

export function fingerprintOfText(text: string): string {
  return "fp_" + createHash("sha256").update(text).digest("hex").slice(0, 24);
}
