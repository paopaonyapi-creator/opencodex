// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Audit & Secret Redaction: Zero-leakage audit trail persisted in SQLite

import { randomUUID } from "node:crypto";
import type { AuditRecord, ToolPolicyDecision, ToolRiskClass, VerificationState } from "./types";
import { EccStore } from "./store";

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
  /xox[baprs]-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /password\s*[:=]\s*["']?[^"'\s]{4,}["']?/gi,
  /client_secret\s*[:=]\s*["']?[^"'\s]{4,}["']?/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /postgres(?:ql)?:\/\/[^:]+:([^@]+)@/g,
  /mysql:\/\/[^:]+:([^@]+)@/g,
  /mongodb(?:\+srv)?:\/\/[^:]+:([^@]+)@/g,
  /AKIA[0-9A-Z]{16}/g,
];

export function redactSecrets(input: string): { text: string; redacted: boolean } {
  let text = input;
  let redacted = false;

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      redacted = true;
      text = text.replace(pattern, (match, p1) => {
        if (p1 && match.includes("://")) {
          // URL password replacement
          return match.replace(p1, "[REDACTED]");
        }
        return "[REDACTED_SECRET]";
      });
    }
  }

  return { text, redacted };
}

export function redactObject<T>(obj: T): { sanitized: T; redacted: boolean } {
  let wasRedacted = false;

  function deepWalk(val: unknown): unknown {
    if (typeof val === "string") {
      const res = redactSecrets(val);
      if (res.redacted) wasRedacted = true;
      return res.text;
    }
    if (Array.isArray(val)) {
      return val.map(deepWalk);
    }
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        // Redact known sensitive keys completely
        const lk = k.toLowerCase();
        if (
          lk.includes("password") ||
          lk.includes("secret") ||
          lk.includes("token") ||
          lk.includes("apikey") ||
          lk.includes("api_key") ||
          lk.includes("auth")
        ) {
          if (typeof v === "string" && v.length > 0) {
            wasRedacted = true;
            out[k] = "[REDACTED]";
            continue;
          }
        }
        out[k] = deepWalk(v);
      }
      return out;
    }
    return val;
  }

  const sanitized = deepWalk(obj) as T;
  return { sanitized, redacted: wasRedacted };
}

export class EccAuditLogger {
  private readonly store: EccStore;

  constructor(store?: EccStore) {
    this.store = store ?? new EccStore();
  }

  logToolExecution(params: {
    runId: string;
    parentId?: string;
    harness?: string;
    model?: string;
    agentRole: string;
    selectedSkills?: string[];
    requestedTool: string;
    riskClass: ToolRiskClass;
    policyDecision: ToolPolicyDecision;
    approvalState?: "none" | "pending" | "granted" | "rejected";
    actionSummary: string;
    filesChanged?: string[];
    testResult?: string;
    reviewResult?: string;
    finalState?: VerificationState;
  }): AuditRecord {
    const rawSummary = params.actionSummary;
    const { text: cleanSummary, redacted: summaryRedacted } = redactSecrets(rawSummary);

    const record: AuditRecord = {
      id: `audit_${randomUUID().slice(0, 12)}`,
      runId: params.runId,
      parentId: params.parentId,
      harness: params.harness ?? "codex",
      model: params.model,
      agentRole: params.agentRole,
      selectedSkills: params.selectedSkills ?? [],
      requestedTool: params.requestedTool,
      riskClass: params.riskClass,
      policyDecision: params.policyDecision.allowed
        ? params.policyDecision.requiresApproval
          ? "approval_required"
          : "allowed"
        : "denied",
      approvalState: params.approvalState ?? "none",
      actionSummary: cleanSummary,
      filesChanged: params.filesChanged ?? [],
      testResult: params.testResult,
      reviewResult: params.reviewResult,
      secretRedacted: summaryRedacted,
      timestamp: new Date().toISOString(),
      finalState: params.finalState ?? "PENDING",
    };

    this.store.recordAuditEvent(record);
    return record;
  }

  getAuditTrail(limit = 100): AuditRecord[] {
    return this.store.listAuditEvents(limit);
  }
}
