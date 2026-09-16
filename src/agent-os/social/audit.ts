// Phase 20.20 — Social Intelligence audit trail (spec section 34).
//
// Dedicated append-only table, following this repository's per-subsystem audit
// convention (`gen_audit_log`, `kg_audit_events`, `br_audit`) rather than inventing a
// cross-subsystem one. Event names match the spec exactly.
//
// `detail` must never carry provider tokens, raw payloads, or personal data: callers
// pass counts, ids, reasons, and status transitions only. `recordSocialAudit` also
// drops any accidental secret-shaped string before persisting.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";

export type SocialAuditEvent =
  | "SOCIAL_REGISTRY_REFRESHED"
  | "SOCIAL_TOOL_ENABLED"
  | "SOCIAL_TOOL_DISABLED"
  | "SOCIAL_ROUTE_DECIDED"
  | "SOCIAL_APPROVAL_GRANTED"
  | "SOCIAL_PAID_RUN_STARTED"
  | "SOCIAL_RUN_COMPLETED"
  | "SOCIAL_RUN_FAILED"
  | "SOCIAL_BUDGET_BLOCKED"
  | "SOCIAL_POLICY_BLOCKED"
  | "SOCIAL_SETTINGS_CHANGED";

export interface SocialAuditRecord {
  id: string;
  event: SocialAuditEvent;
  actor: string;
  researchJobId: string | null;
  toolId: string | null;
  providerId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

const SECRET_SHAPE = /^(sk-|sapr_|ghp_|gho_|github_pat_|xoxb-|AKIA|apify_api_)/i;

/** Scrub secret-shaped values from an audit detail object, one level deep per value. */
function scrub(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "string" && SECRET_SHAPE.test(value.trim())) {
      out[key] = "***";
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" && SECRET_SHAPE.test(v.trim()) ? "***" : v));
      continue;
    }
    out[key] = value;
  }
  return out;
}

export interface RecordSocialAuditInput {
  event: SocialAuditEvent;
  actor?: string;
  researchJobId?: string | null;
  toolId?: string | null;
  providerId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Append one audit row. Never throws: an audit write failure must not abort a run that
 * otherwise succeeded, matching how this repository's other audit writers behave.
 */
export function recordSocialAudit(input: RecordSocialAuditInput): void {
  try {
    const db = openAgentOsDb();
    db.query(`INSERT INTO social_audit_events (
      id, event, actor, research_job_id, tool_id, provider_id, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `saud_${randomUUID().slice(0, 16)}`,
      input.event,
      input.actor ?? "system",
      input.researchJobId ?? null,
      input.toolId ?? null,
      input.providerId ?? null,
      JSON.stringify(scrub(input.detail ?? {})),
      new Date().toISOString(),
    );
  } catch {
    // Non-fatal by design.
  }
}

export interface SocialAuditQuery {
  event?: SocialAuditEvent;
  researchJobId?: string;
  limit?: number;
}

export function listSocialAudit(query: SocialAuditQuery = {}): SocialAuditRecord[] {
  const db = openAgentOsDb();
  const params: Array<string | number> = [];
  let sql = "SELECT * FROM social_audit_events WHERE 1=1";
  if (query.event) {
    sql += " AND event = ?";
    params.push(query.event);
  }
  if (query.researchJobId) {
    sql += " AND research_job_id = ?";
    params.push(query.researchJobId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Math.min(query.limit ?? 100, 500));

  const rows = db.query(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => {
    let detail: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.detail_json ?? "{}"));
      if (parsed && typeof parsed === "object") detail = parsed;
    } catch { /* keep empty */ }
    return {
      id: String(row.id),
      event: String(row.event) as SocialAuditEvent,
      actor: String(row.actor),
      researchJobId: (row.research_job_id as string | null) ?? null,
      toolId: (row.tool_id as string | null) ?? null,
      providerId: (row.provider_id as string | null) ?? null,
      detail,
      createdAt: String(row.created_at),
    };
  });
}
