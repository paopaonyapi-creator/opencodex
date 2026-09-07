// Phase 20.8 — Security & Approval Gate
// Enforces sandbox isolation, path traversal guards, command denylists, and human approval for critical risk operations.

import { openAgentOsDb } from "../../db";
import type { SecurityGateResult, RiskLevel, ProposedChange } from "../types";

const DENIED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+[\/\\]/i,
  /format\s+[a-z]:/i,
  /del\s+\/[sfa-z]*\s+c:[\/\\]/i,
  /curl\s+.*\|\s*(bash|sh|powershell)/i,
  /wget\s+.*\|\s*(bash|sh|powershell)/i,
  /chmod\s+-R\s+777\s+[\/\\]/i,
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN\s+PRIVATE\s+KEY-----/,
];

export class SecurityGate {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Performs automated security inspection over proposed actions and changes.
   */
  async inspect(
    proposedChanges: ProposedChange[] = [],
    riskTier: RiskLevel,
    plannedCommands: string[] = [],
    runId?: string,
  ): Promise<SecurityGateResult> {
    const blockedActions: string[] = [];
    const findings: string[] = [];

    // 1. Check planned commands against denylist
    for (const cmd of plannedCommands) {
      for (const pattern of DENIED_COMMAND_PATTERNS) {
        if (pattern.test(cmd)) {
          blockedActions.push(`Forbidden shell command: ${cmd}`);
          findings.push(`Dangerous destructive pattern detected in command: ${pattern}`);
        }
      }
    }

    // 2. Check proposed file changes
    for (const change of proposedChanges) {
      // Path traversal check
      if (change.path.includes("..") || change.path.startsWith("/") || (change.path.length > 2 && change.path[1] === ":")) {
        // Only allow workspace paths
        const normalized = change.path.replace(/\\/g, "/");
        if (normalized.includes("/../") || normalized.startsWith("../") || normalized.includes("windows/system32")) {
          blockedActions.push(`Path traversal or root escape: ${change.path}`);
          findings.push(`File path attempts escape outside workspace boundary: ${change.path}`);
        }
      }

      // Secret leakage check in diffs
      if (change.diff) {
        for (const secretPattern of SECRET_PATTERNS) {
          if (secretPattern.test(change.diff)) {
            blockedActions.push(`Potential secret exposure in diff: ${change.path}`);
            findings.push(`Diff contains potential plaintext API key or credential: ${change.path}`);
          }
        }
      }
    }

    // 3. Determine if Human Approval is required
    const requiresHumanApproval =
      riskTier === "critical" ||
      (riskTier === "high" && proposedChanges.some((p) => p.action === "delete")) ||
      blockedActions.length > 0;

    const passed = blockedActions.length === 0;

    const gateResult: SecurityGateResult = {
      passed,
      blockedActions,
      riskTier,
      requiresHumanApproval,
      findings,
    };

    // 4. Persist review in SQLite if runId provided
    if (runId) {
      const reviewId = `rev_sec_${Date.now()}`;
      this.db.query(`
        INSERT INTO agency_reviews (
          id, run_id, reviewer_type, decision, score, consensus,
          reasons_json, conflicts_json, required_changes_json, details_json, evaluated_at
        ) VALUES (?, ?, 'security_gate', ?, ?, 1.0, ?, ?, ?, ?, ?)
      `).run(
        reviewId,
        runId,
        passed ? (requiresHumanApproval ? "human_review" : "approve") : "block",
        passed ? 0.95 : 0.0,
        JSON.stringify(gateResult.findings),
        JSON.stringify(gateResult.blockedActions),
        JSON.stringify(requiresHumanApproval ? ["Human operator authorization required"] : []),
        JSON.stringify({ riskTier, requiresHumanApproval }),
        new Date().toISOString(),
      );
    }

    return gateResult;
  }
}

let defaultSecurityGate: SecurityGate | null = null;
export function getSecurityGate(): SecurityGate {
  if (!defaultSecurityGate) {
    defaultSecurityGate = new SecurityGate();
  }
  return defaultSecurityGate;
}
