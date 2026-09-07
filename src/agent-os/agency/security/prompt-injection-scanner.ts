// Phase 20.8 — Prompt Injection Heuristic Scanner
// Inspects upstream or custom agent markdown content for suspicious override patterns.
// Categorizes content into: clean, warning, or blocked.

import type { PromptSafetyStatus } from "../types";

export interface PromptScanResult {
  status: PromptSafetyStatus;
  findings: string[];
}

interface ThreatRule {
  id: string;
  pattern: RegExp;
  level: "warning" | "blocked";
  reason: string;
}

const THREAT_RULES: ThreatRule[] = [
  {
    id: "override_previous_instructions",
    pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    level: "blocked",
    reason: "Attempts to override previous instructions or system context",
  },
  {
    id: "disable_safety",
    pattern: /disable\s+(all\s+)?(safety|guardrails|policies|security|filters)/i,
    level: "blocked",
    reason: "Attempts to disable system safety or guardrails",
  },
  {
    id: "reveal_credentials",
    pattern: /(reveal|leak|exfiltrate|send|dump|print)\s+(all\s+)?(secrets|credentials|tokens|keys|passwords|env\s+vars)/i,
    level: "blocked",
    reason: "Attempts to reveal, dump or exfiltrate secrets or credentials",
  },
  {
    id: "bypass_approval",
    pattern: /bypass\s+(all\s+)?(approvals?|permission\s+checks?|gates?)/i,
    level: "blocked",
    reason: "Attempts to bypass approval gates or permission checks",
  },
  {
    id: "arbitrary_destructive_fs",
    pattern: /(rm\s+-rf\s+\/|del\s+\/[sfq]|format\s+[a-z]:|delete\s+arbitrary\s+files)/i,
    level: "blocked",
    reason: "Contains destructive filesystem deletion instructions",
  },
  {
    id: "disable_logging",
    pattern: /(disable|suppress|do\s+not)\s+(log|audit|track|record)/i,
    level: "warning",
    reason: "Attempts to suppress logging or audit trails",
  },
  {
    id: "override_system_prompt",
    pattern: /(override|replace)\s+(the\s+)?system\s+(policy|prompt|instructions)/i,
    level: "blocked",
    reason: "Attempts to override system policy or instructions",
  },
  {
    id: "direct_shell_execution",
    pattern: /execute\s+arbitrary\s+shell\s+without\s+validation/i,
    level: "warning",
    reason: "Mentions arbitrary shell execution without safety validation",
  },
];

export function scanAgentPromptSafety(content: string): PromptScanResult {
  const findings: string[] = [];
  let highestLevel: PromptSafetyStatus = "clean";

  for (const rule of THREAT_RULES) {
    if (rule.pattern.test(content)) {
      findings.push(`[${rule.id}] ${rule.reason}`);
      if (rule.level === "blocked") {
        highestLevel = "blocked";
      } else if (highestLevel !== "blocked") {
        highestLevel = "warning";
      }
    }
  }

  return {
    status: highestLevel,
    findings,
  };
}

export const scanPromptInjection = scanAgentPromptSafety;

