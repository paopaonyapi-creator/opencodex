// Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime
// Real-time Structured Audit Logger with Secret Redaction & SQLite Persistence

import { openAgentOsDb } from "../../db";
import { SecretRedactor } from "../security/secret-redactor";
import type { AuditEvent, ToolRisk } from "../types";
import { randomUUID } from "node:crypto";

export interface LogEventInput {
  runId: string;
  actor?: string;
  eventType: AuditEvent["eventType"];
  tool?: string;
  risk?: ToolRisk;
  status: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  private redactor: SecretRedactor;

  constructor(customRedactor?: SecretRedactor) {
    this.redactor = customRedactor ?? new SecretRedactor();
  }

  /**
   * Log an audit event, sanitizing all metadata before persisting to SQLite.
   */
  public logEvent(input: LogEventInput): AuditEvent {
    const id = `audit_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const actor = input.actor ?? "agent";

    // Redact metadata recursively
    const sanitizedMetadata = input.metadata
      ? (this.redactor.redactJson(input.metadata) as Record<string, unknown>)
      : {};

    const event: AuditEvent = {
      id,
      timestamp,
      runId: input.runId,
      actor,
      eventType: input.eventType,
      tool: input.tool,
      risk: input.risk,
      status: input.status,
      metadata: sanitizedMetadata,
    };

    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO desktop_agent_events (
          id, run_id, actor, event_type, tool, risk, status, metadata_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.runId,
        event.actor,
        event.eventType,
        event.tool ?? null,
        event.risk ?? null,
        event.status,
        JSON.stringify(event.metadata ?? {}),
        event.timestamp,
      );
    } catch (err) {
      // In-memory fallback or non-fatal logging
      console.warn(`[AuditLogger] Failed to persist audit event: ${err instanceof Error ? err.message : String(err)}`);
    }

    return event;
  }

  /**
   * Query all audit events for a given run ID, ordered chronologically.
   */
  public queryEvents(runId: string, limit = 200): AuditEvent[] {
    try {
      const db = openAgentOsDb();
      const rows = db.query(`
        SELECT id, run_id, actor, event_type, tool, risk, status, metadata_json, timestamp
        FROM desktop_agent_events
        WHERE run_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(runId, limit) as Array<{
        id: string;
        run_id: string;
        actor: string;
        event_type: string;
        tool: string | null;
        risk: string | null;
        status: string;
        metadata_json: string;
        timestamp: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        runId: r.run_id,
        actor: r.actor,
        eventType: r.event_type as AuditEvent["eventType"],
        tool: r.tool ?? undefined,
        risk: r.risk ? (r.risk as ToolRisk) : undefined,
        status: r.status,
        metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
        timestamp: r.timestamp,
      }));
    } catch (err) {
      console.warn(`[AuditLogger] Failed to query audit events: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * Query recent audit events across all runs.
   */
  public getRecentEvents(limit = 100): AuditEvent[] {
    try {
      const db = openAgentOsDb();
      const rows = db.query(`
        SELECT id, run_id, actor, event_type, tool, risk, status, metadata_json, timestamp
        FROM desktop_agent_events
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as Array<{
        id: string;
        run_id: string;
        actor: string;
        event_type: string;
        tool: string | null;
        risk: string | null;
        status: string;
        metadata_json: string;
        timestamp: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        runId: r.run_id,
        actor: r.actor,
        eventType: r.event_type as AuditEvent["eventType"],
        tool: r.tool ?? undefined,
        risk: r.risk ? (r.risk as ToolRisk) : undefined,
        status: r.status,
        metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
        timestamp: r.timestamp,
      }));
    } catch (err) {
      console.warn(`[AuditLogger] Failed to query recent events: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
