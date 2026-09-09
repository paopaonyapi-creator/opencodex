/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Multi-Vector Threat Detector: Prompt Injections, Jailbreaks, Destructive Commands & Secret Leaks
 */

import type { SecurityInspectionResult, ThreatCategory, ThreatSeverity } from "./types";

interface PatternTripwire {
  id: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  score: number;
  regex: RegExp;
  description: string;
  blockImmediate: boolean;
}

const TRIPWIRES: PatternTripwire[] = [
  // 1. Prompt Injections & Jailbreaks
  {
    id: "inj-ignore-instructions",
    category: "prompt_injection",
    severity: "high",
    score: 0.85,
    regex: /ignore\s+(?:all\s+)?(?:previous\s+|prior\s+)?instructions/i,
    description: "Detected attempt to override base instructions",
    blockImmediate: true,
  },
  {
    id: "inj-system-override",
    category: "prompt_injection",
    severity: "critical",
    score: 0.95,
    regex: /system\s*(?:prompt\s*)?override\s*:/i,
    description: "Detected explicit system prompt override syntax",
    blockImmediate: true,
  },
  {
    id: "jbk-dan-mode",
    category: "jailbreak",
    severity: "high",
    score: 0.88,
    regex: /\byou\s+are\s+now\s+dan\b|\bdo\s+anything\s+now\b/i,
    description: "Detected classic DAN jailbreak pattern",
    blockImmediate: true,
  },
  {
    id: "jbk-dev-mode-override",
    category: "jailbreak",
    severity: "high",
    score: 0.82,
    regex: /developer\s+mode\s+(?:is\s+)?(?:enabled|active|unlocked)|unrestricted\s+mode/i,
    description: "Detected developer mode bypass simulation",
    blockImmediate: true,
  },
  {
    id: "jbk-bypass-guardrails",
    category: "jailbreak",
    severity: "medium",
    score: 0.75,
    regex: /bypass\s+(?:all\s+)?(?:safety\s+filters|guardrails|protocols)/i,
    description: "Detected guardrail bypass request",
    blockImmediate: true,
  },
  {
    id: "exf-dump-env",
    category: "data_exfiltration",
    severity: "high",
    score: 0.85,
    regex: /(?:dump|reveal|print|expose)\s+(?:all\s+)?(?:environment\s+variables|env\s+vars|\.env\s+secrets)/i,
    description: "Detected attempt to dump environment secrets",
    blockImmediate: true,
  },

  // 2. Destructive Commands & Privilege Escalation
  {
    id: "cmd-rm-rf-root",
    category: "destructive_command",
    severity: "critical",
    score: 0.99,
    regex: /\brm\s+-(?:r[fv]{1,2}|f[rv]{1,2})\s+[\/\\](?:\s|$)/i,
    description: "Detected root filesystem deletion command",
    blockImmediate: true,
  },
  {
    id: "cmd-del-system-drive",
    category: "destructive_command",
    severity: "critical",
    score: 0.99,
    regex: /\b(?:del|erase)\s+\/[fsq\s]+\s+[a-z]:\\|\brmdir\s+\/s\s+\/q\s+[a-z]:\\/i,
    description: "Detected Windows system drive recursive deletion command",
    blockImmediate: true,
  },
  {
    id: "cmd-format-disk",
    category: "destructive_command",
    severity: "critical",
    score: 0.99,
    regex: /\bformat\s+[a-z]:\s*\/[yq]/i,
    description: "Detected drive format command",
    blockImmediate: true,
  },
  {
    id: "cmd-forkbomb",
    category: "destructive_command",
    severity: "critical",
    score: 0.99,
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    description: "Detected bash forkbomb attack string",
    blockImmediate: true,
  },
  {
    id: "cmd-reverse-shell",
    category: "privilege_escalation",
    severity: "critical",
    score: 0.98,
    regex: /\bnc(?:\.traditional)?\s+-e\s+|\/dev\/tcp\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d+|\bbash\s+-i\s+>&/i,
    description: "Detected reverse shell interactive socket invocation",
    blockImmediate: true,
  },
];

const SECRET_PATTERNS = [
  {
    name: "API Token (OpenAI / Generic)",
    regex: /\b(?:sk-[a-zA-Z0-9_-]{20,}|sk-proj-[a-zA-Z0-9_-]{20,})\b/g,
  },
  {
    name: "GitHub Personal Access Token",
    regex: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{30,})\b/g,
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(?:AKIA[0-9A-Z]{16})\b/g,
  },
  {
    name: "Private Key PEM Block",
    regex: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g,
  },
  {
    name: "JSON Web Token (JWT)",
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
  },
];

export class ThreatDetector {
  private tripwires: PatternTripwire[];

  constructor(customTripwires?: PatternTripwire[]) {
    this.tripwires = customTripwires ?? [...TRIPWIRES];
  }

  public getTripwiresCount(): number {
    return this.tripwires.length;
  }

  /**
   * Redacts sensitive secrets, API credentials, and private keys from any text.
   */
  public redactSecrets(text: string): { sanitized: string; detectedCount: number } {
    let sanitized = text;
    let detectedCount = 0;

    for (const pattern of SECRET_PATTERNS) {
      const matches = text.match(pattern.regex);
      if (matches) {
        detectedCount += matches.length;
        sanitized = sanitized.replace(pattern.regex, "[REDACTED_SECRET]");
      }
    }

    return { sanitized, detectedCount };
  }

  /**
   * Inspects content (prompts, tool calls, commands, or outputs) across all threat vectors.
   */
  public inspect(
    content: string,
    options: { context?: "prompt" | "command" | "output" } = {}
  ): SecurityInspectionResult {
    if (!content || typeof content !== "string") {
      return {
        safe: true,
        blocked: false,
        threatScore: 0.0,
        summary: "Empty or non-textual content passed verification.",
      };
    }

    const matchedTripwires: PatternTripwire[] = [];

    for (const tripwire of this.tripwires) {
      if (tripwire.regex.test(content)) {
        matchedTripwires.push(tripwire);
      }
    }

    const { sanitized, detectedCount } = this.redactSecrets(content);

    // If secrets were detected, evaluate secret leak threat
    let secretLeakTripwire: PatternTripwire | null = null;
    if (detectedCount > 0) {
      secretLeakTripwire = {
        id: "sec-leak-detected",
        category: "secret_leak",
        severity: detectedCount > 2 ? "critical" : "high",
        score: detectedCount > 2 ? 0.95 : 0.85,
        regex: /.*/,
        description: `Detected and redacted ${detectedCount} credential/secret pattern(s)`,
        blockImmediate: options.context === "output" ? false : true,
      };
      matchedTripwires.push(secretLeakTripwire);
    }

    if (matchedTripwires.length === 0) {
      return {
        safe: true,
        blocked: false,
        threatScore: 0.0,
        summary: "Passed zero-trust threat inspection without violations.",
        sanitizedText: sanitized,
        detectedSecretsCount: 0,
        tripwiresTriggered: [],
      };
    }

    // Determine highest severity and max threat score
    const highestScore = Math.max(...matchedTripwires.map((t) => t.score));
    const primaryTripwire = matchedTripwires.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));
    const shouldBlock = matchedTripwires.some((t) => t.blockImmediate);

    return {
      safe: false,
      blocked: shouldBlock,
      threatScore: Math.min(1.0, highestScore),
      category: primaryTripwire.category,
      severity: primaryTripwire.severity,
      summary: primaryTripwire.description,
      sanitizedText: sanitized,
      detectedSecretsCount: detectedCount,
      tripwiresTriggered: matchedTripwires.map((t) => t.id),
    };
  }
}
