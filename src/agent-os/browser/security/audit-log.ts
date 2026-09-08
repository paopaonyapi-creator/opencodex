// Phase 20.11 — Browser Action Audit Logger
//
// Records all agent-driven browser actions in SQLite with strict redaction
// for credentials, passwords, tokens, auth headers, and session secrets.

import { openAgentOsDb } from "../../db";
import { SENSITIVE_INPUT_REGEXES } from "../config";
import type { AuditRecord } from "../types";

export class BrowserAuditLogger {
  public redactSensitiveData(obj: unknown): unknown {
    if (typeof obj === "string") {
      // Check if matches JWT or API key pattern
      if (/^(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9_-]{20,})/i.test(obj)) {
        return "[REDACTED]";
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactSensitiveData(item));
    }

    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const isSensitiveKey = SENSITIVE_INPUT_REGEXES.some((rx) => rx.test(key));
        if (isSensitiveKey) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = this.redactSensitiveData(val);
        }
      }
      return result;
    }

    return obj;
  }

  public record(record: Omit<AuditRecord, "id" | "createdAt">): number {
    const db = openAgentOsDb();
    const createdAt = Date.now();
    const sanitizedArgs = this.redactSensitiveData(record.arguments);

    const stmt = db.query(`
      INSERT INTO browser_action_logs (
        timestamp, agent, workflow_id, tab_id, session_id,
        tool, arguments_json, url, risk_level, approval_status,
        result, error, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      record.timestamp,
      record.agent,
      record.workflowId || null,
      record.tabId || null,
      record.sessionId || null,
      record.tool,
      JSON.stringify(sanitizedArgs),
      record.url || null,
      record.riskLevel,
      record.approvalStatus,
      record.result,
      record.error || null,
      record.durationMs,
      createdAt,
    );

    return Number(res.lastInsertRowid);
  }

  public getRecentLogs(limit = 50): AuditRecord[] {
    const db = openAgentOsDb();
    const rows = db.query(
      "SELECT * FROM browser_action_logs ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      agent: String(r.agent),
      workflowId: r.workflow_id ? String(r.workflow_id) : undefined,
      tabId: r.tab_id ? String(r.tab_id) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
      tool: String(r.tool),
      arguments: JSON.parse(String(r.arguments_json || "{}")),
      url: r.url ? String(r.url) : undefined,
      riskLevel: String(r.risk_level) as any,
      approvalStatus: String(r.approval_status) as any,
      result: String(r.result) as any,
      error: r.error ? String(r.error) : undefined,
      durationMs: Number(r.duration_ms),
      createdAt: Number(r.created_at),
    }));
  }
}

let auditLoggerInstance: BrowserAuditLogger | null = null;
export function getBrowserAuditLogger(): BrowserAuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new BrowserAuditLogger();
  }
  return auditLoggerInstance;
}
