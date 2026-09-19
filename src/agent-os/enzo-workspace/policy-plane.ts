// Phase 20.94 — policy-governed execution plane (R0–R4).
// Complements Phase 05 evaluateCapability; does not replace it.

import { randomUUID } from "node:crypto";
import type { PolicyDecision, PolicyEffect, PolicyProfile, RiskClass } from "./types";

export interface PolicyRequest {
  runId: string;
  action: string;
  profile?: PolicyProfile;
  irreversible?: boolean;
  replay?: boolean;
}

const ACTION_RISK: Array<{ test: RegExp; risk: RiskClass }> = [
  { test: /secret|credential|vault|rotate/i, risk: "R4" },
  { test: /deploy|production|destroy|delete persistent|rm -rf/i, risk: "R4" },
  { test: /send|publish|email|message|browser.submit|form fill/i, risk: "R3" },
  { test: /write|edit|apply|filesystem.write|shell/i, risk: "R2" },
  { test: /search|fetch|retrieve|mcp.resource/i, risk: "R1" },
  { test: /read|recall|list|inspect|plan/i, risk: "R0" },
];

export function classifyActionRisk(action: string): RiskClass {
  for (const row of ACTION_RISK) {
    if (row.test.test(action)) return row.risk;
  }
  return "R0";
}

export function decidePolicy(req: PolicyRequest): PolicyDecision {
  const profile = req.profile ?? "safe-personal";
  const risk = classifyActionRisk(req.action);
  const rules: string[] = ["profile:" + profile, "risk:" + risk];
  let decision: PolicyEffect = "allow";
  let reason = "default allow for " + risk;
  const restrictions: string[] = [];

  if (req.replay && (risk === "R3" || risk === "R4" || req.irreversible)) {
    decision = "require_approval";
    reason = "replay cannot silently repeat irreversible actions";
    rules.push("replay-guard");
  } else if (risk === "R4") {
    decision = "require_approval";
    reason = "R4 destructive/credential/deploy requires human approval";
  } else if (risk === "R3") {
    decision = profile === "automation-strict" ? "deny" : "require_approval";
    reason = profile === "automation-strict"
      ? "automation-strict denies external side effects"
      : "R3 external side effects require approval";
  } else if (risk === "R2") {
    if (profile === "automation-strict") {
      decision = "allow_with_restrictions";
      restrictions.push("workspace_only");
      reason = "scoped workspace writes only";
    } else if (profile === "safe-personal" && /source|repo|apply/i.test(req.action)) {
      decision = "require_approval";
      reason = "safe-personal requires review before source edits";
    } else {
      decision = "allow";
      reason = "scoped local writes allowed";
    }
  } else if (risk === "R1") {
    decision = "allow";
    reason = "read-only retrieval allowed within policy";
  }

  if (decision === "deny" && /untrusted|quarantine/i.test(req.action)) {
    reason = "untrusted skill or MCP server is denied";
  }

  return {
    decisionId: "pol_" + randomUUID().slice(0, 12),
    runId: req.runId,
    action: req.action,
    risk,
    decision,
    rulesMatched: rules,
    reason,
    restrictions: restrictions.length ? restrictions : undefined,
  };
}

export function isAllowed(decision: PolicyDecision): boolean {
  return decision.decision === "allow" || decision.decision === "allow_with_restrictions";
}
