// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Secret Redaction Engine & Structured Audit Logger.

import { CodexRuntimeStore } from "./store";
import type { AuditLogEntry, RiskClassification } from "./types";

export class SecretRedactor {
  private static readonly PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    // OpenAI / Codex keys
    { regex: /sk-[a-zA-Z0-9_\-]{20,}/g, replacement: "sk-***REDACTED***" },
    { regex: /sess-[a-zA-Z0-9_\-]{20,}/g, replacement: "sess-***REDACTED***" },
    // GitHub Tokens
    { regex: /ghp_[a-zA-Z0-9]{36}/g, replacement: "ghp_***REDACTED***" },
    { regex: /github_pat_[a-zA-Z0-9_]{40,}/g, replacement: "github_pat_***REDACTED***" },
    { regex: /gho_[a-zA-Z0-9]{36}/g, replacement: "gho_***REDACTED***" },
    // Generic Bearer Tokens
    { regex: /Bearer\s+([a-zA-Z0-9\-_.~+/]+=*)/gi, replacement: "Bearer ***REDACTED***" },
    // AWS Access Key ID
    { regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "AKIA***REDACTED***" },
    // DB Connection Passwords (Postgres, MySQL, MongoDB, Redis)
    {
      regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/g,
      replacement: "$1***REDACTED***$3",
    },
    {
      regex: /(mysql:\/\/[^:]+:)([^@]+)(@)/g,
      replacement: "$1***REDACTED***$3",
    },
    {
      regex: /(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/g,
      replacement: "$1***REDACTED***$3",
    },
    {
      regex: /(redis:\/\/(?::[^@]+@)?)/g,
      replacement: "redis://***REDACTED***@",
    },
    // SSH & RSA Private Keys
    {
      regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      replacement: "-----BEGIN PRIVATE KEY----- ***REDACTED*** -----END PRIVATE KEY-----",
    },
    // Generic Password / Secret query strings or key-value pairs
    {
      regex: /((?:password|passwd|secret|token|api_key|apikey|access_token)=)([^&\s]+)/gi,
      replacement: "$1***REDACTED***",
    },
  ];

  static redactText(input: string): string {
    if (!input || typeof input !== "string") return input;
    let redacted = input;
    for (const { regex, replacement } of this.PATTERNS) {
      redacted = redacted.replace(regex, replacement);
    }
    return redacted;
  }

  static redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") {
      return this.redactText(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }
    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (
          lower.includes("secret") ||
          lower.includes("password") ||
          lower.includes("token") ||
          lower.includes("key") ||
          lower.includes("credential")
        ) {
          result[key] = "***REDACTED***";
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result as T;
    }
    return obj;
  }
}

export class CodexAuditService {
  constructor(private store = new CodexRuntimeStore()) {}

  log(entry: {
    actor?: string;
    sessionId?: string | null;
    turnId?: string | null;
    nodeId?: string | null;
    action: string;
    risk?: RiskClassification;
    result?: "ok" | "denied" | "failed" | "timed_out";
    metadata?: Record<string, unknown>;
  }): AuditLogEntry {
    const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const redactedMetadata = SecretRedactor.redactObject(entry.metadata || {});

    const record: AuditLogEntry = {
      id,
      timestamp,
      actor: entry.actor || "system",
      sessionId: entry.sessionId ?? null,
      turnId: entry.turnId ?? null,
      nodeId: entry.nodeId ?? null,
      action: SecretRedactor.redactText(entry.action),
      risk: entry.risk || "low",
      result: entry.result || "ok",
      metadata: redactedMetadata,
    };

    this.store.recordAuditLog(record);
    return record;
  }

  list(limit = 100): AuditLogEntry[] {
    return this.store.listAuditLogs(limit);
  }
}
