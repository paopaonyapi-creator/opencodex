/**
 * Phase 20.56 — deterministic risk scoring. Fail closed on dangerous combinations.
 */

import type { AnalysisSignals, RiskLevel } from "./types";

export function scoreRisk(signals: AnalysisSignals): {
  score: number;
  level: RiskLevel;
  reasons: string[];
  permissions: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  const permissions: string[] = [];
  const add = (n: number, reason: string, perm?: string) => {
    score += n;
    reasons.push(reason);
    if (perm) permissions.push(perm);
  };

  if (signals.filesystem) add(5, "workspace file access", "filesystem.workspace.read");
  if (signals.network) add(10, "network outbound", "network.outbound");
  if (signals.envRead) add(8, "environment read");
  if (signals.secrets) add(15, "secret-shaped material");
  if (signals.subprocess) add(15, "subprocess spawn", "process.spawn");
  if (signals.shell) add(25, "shell execution", "process.shell");
  if (signals.evalExec) add(30, "dynamic eval/exec");
  if (signals.gui) add(8, "interactive GUI");
  if (signals.device) add(20, "device control");
  if (signals.destructive) add(25, "destructive filesystem");
  if (signals.dynamicImport) add(12, "dynamic import");

  if (signals.shell && signals.network && signals.secrets) {
    score = Math.max(score, 90);
    reasons.push("hard-rule: shell+network+secrets");
  }
  if (signals.evalExec && (signals.network || signals.subprocess)) {
    score = Math.max(score, 80);
    reasons.push("hard-rule: eval with network/process");
  }

  const level: RiskLevel = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  return { score: Math.min(100, score), level, reasons, permissions: [...new Set(permissions)] };
}

