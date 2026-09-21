// Phase Navop & 21.03 — Host-Authoritative Operations Store over SQLite.

import { openAgentOsDb } from "../db";
import type {
  CcsProvider,
  CcsProviderModel,
  CcsRuntime,
  NavopApproval,
  NavopAuditEvent,
  NavopCapability,
  NavopResource,
  NavopSession,
  NavopToolInvocation,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newNavopId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class NavopStore {
  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  upsertResource(res: NavopResource): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_resources (
          id, resource_uri, resource_type, display_name, adapter_type, credential_ref, config_json, labels_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_uri) DO UPDATE SET
          display_name = excluded.display_name,
          adapter_type = excluded.adapter_type,
          credential_ref = excluded.credential_ref,
          config_json = excluded.config_json,
          labels_json = excluded.labels_json,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
      .run(
        res.id,
        res.resourceUri,
        res.resourceType,
        res.displayName,
        res.adapterType,
        res.credentialRef ?? null,
        JSON.stringify(res.config || {}),
        JSON.stringify(res.labels || {}),
        res.enabled ? 1 : 0,
        res.createdAt,
        res.updatedAt,
      );
  }

  getResourceByUri(uri: string): NavopResource | null {
    const r = openAgentOsDb().query("SELECT * FROM navop_resources WHERE resource_uri = ?").get(uri) as any;
    if (!r) return null;
    return {
      id: r.id,
      resourceUri: r.resource_uri,
      resourceType: r.resource_type,
      displayName: r.display_name,
      adapterType: r.adapter_type,
      credentialRef: r.credential_ref,
      config: JSON.parse(r.config_json || "{}"),
      labels: JSON.parse(r.labels_json || "{}"),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listResources(type?: string): NavopResource[] {
    let sql = "SELECT * FROM navop_resources";
    const params: any[] = [];
    if (type) {
      sql += " WHERE resource_type = ?";
      params.push(type);
    }
    sql += " ORDER BY resource_uri ASC";
    const rows = openAgentOsDb().query(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      resourceUri: r.resource_uri,
      resourceType: r.resource_type,
      displayName: r.display_name,
      adapterType: r.adapter_type,
      credentialRef: r.credential_ref,
      config: JSON.parse(r.config_json || "{}"),
      labels: JSON.parse(r.labels_json || "{}"),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------
  upsertCapability(cap: NavopCapability): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_capabilities (
          id, name, version, adapter_type, risk_level, mutates, supports_dry_run, input_schema_json, output_schema_json, enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          version = excluded.version,
          adapter_type = excluded.adapter_type,
          risk_level = excluded.risk_level,
          mutates = excluded.mutates,
          supports_dry_run = excluded.supports_dry_run,
          input_schema_json = excluded.input_schema_json,
          output_schema_json = excluded.output_schema_json,
          enabled = excluded.enabled
      `)
      .run(
        cap.id,
        cap.name,
        cap.version,
        cap.adapterType,
        cap.riskLevel,
        cap.mutates ? 1 : 0,
        cap.supportsDryRun ? 1 : 0,
        JSON.stringify(cap.inputSchema || {}),
        JSON.stringify(cap.outputSchema || {}),
        cap.enabled ? 1 : 0,
        cap.createdAt,
      );
  }

  getCapability(name: string): NavopCapability | null {
    const r = openAgentOsDb().query("SELECT * FROM navop_capabilities WHERE name = ?").get(name) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      adapterType: r.adapter_type,
      riskLevel: r.risk_level,
      mutates: Boolean(r.mutates),
      supportsDryRun: Boolean(r.supports_dry_run),
      inputSchema: JSON.parse(r.input_schema_json || "{}"),
      outputSchema: JSON.parse(r.output_schema_json || "{}"),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
    };
  }

  listCapabilities(): NavopCapability[] {
    const rows = openAgentOsDb().query("SELECT * FROM navop_capabilities ORDER BY name ASC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      adapterType: r.adapter_type,
      riskLevel: r.risk_level,
      mutates: Boolean(r.mutates),
      supportsDryRun: Boolean(r.supports_dry_run),
      inputSchema: JSON.parse(r.input_schema_json || "{}"),
      outputSchema: JSON.parse(r.output_schema_json || "{}"),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------
  createSession(sess: NavopSession): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_sessions (
          id, session_type, agent_key, project_id, status, policy_profile, started_at, expires_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        sess.id,
        sess.sessionType,
        sess.agentKey,
        sess.projectId ?? null,
        sess.status,
        sess.policyProfile,
        sess.startedAt,
        sess.expiresAt ?? null,
        sess.endedAt ?? null,
      );
  }

  getSession(id: string): NavopSession | null {
    const r = openAgentOsDb().query("SELECT * FROM navop_sessions WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      sessionType: r.session_type,
      agentKey: r.agent_key,
      projectId: r.project_id,
      status: r.status,
      policyProfile: r.policy_profile,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      endedAt: r.ended_at,
    };
  }

  // -------------------------------------------------------------------------
  // Tool Invocations & Approvals
  // -------------------------------------------------------------------------
  createInvocation(inv: NavopToolInvocation): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_tool_invocations (
          id, trace_id, session_id, capability_name, resource_uri, input_redacted_json, risk_level, policy_decision, approval_id, status, started_at, finished_at, result_summary_json, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        inv.id,
        inv.traceId,
        inv.sessionId ?? null,
        inv.capabilityName,
        inv.resourceUri ?? null,
        JSON.stringify(inv.inputRedacted || {}),
        inv.riskLevel,
        inv.policyDecision,
        inv.approvalId ?? null,
        inv.status,
        inv.startedAt,
        inv.finishedAt ?? null,
        inv.resultSummary ? JSON.stringify(inv.resultSummary) : null,
        inv.errorCode ?? null,
      );
  }

  createApproval(app: NavopApproval): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_approvals (
          id, trace_id, session_id, action_summary, risk_level, request_payload_json, status, decision_by, decision_note, requested_at, expires_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        app.id,
        app.traceId,
        app.sessionId ?? null,
        app.actionSummary,
        app.riskLevel,
        JSON.stringify(app.requestPayload || {}),
        app.status,
        app.decisionBy ?? null,
        app.decisionNote ?? null,
        app.requestedAt,
        app.expiresAt ?? null,
        app.decidedAt ?? null,
      );
  }

  getApproval(id: string): NavopApproval | null {
    const r = openAgentOsDb().query("SELECT * FROM navop_approvals WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      traceId: r.trace_id,
      sessionId: r.session_id,
      actionSummary: r.action_summary,
      riskLevel: r.risk_level,
      requestPayload: JSON.parse(r.request_payload_json || "{}"),
      status: r.status,
      decisionBy: r.decision_by,
      decisionNote: r.decision_note,
      requestedAt: r.requested_at,
      expiresAt: r.expires_at,
      decidedAt: r.decided_at,
    };
  }

  resolveApproval(id: string, status: "approved" | "rejected", by: string, note?: string): void {
    openAgentOsDb()
      .query("UPDATE navop_approvals SET status = ?, decision_by = ?, decision_note = ?, decided_at = ? WHERE id = ?")
      .run(status, by, note ?? null, nowIso(), id);
  }

  // -------------------------------------------------------------------------
  // Audit Ledger
  // -------------------------------------------------------------------------
  addAuditEvent(evt: NavopAuditEvent): void {
    openAgentOsDb()
      .query(`
        INSERT INTO navop_audit_events (id, trace_id, event_type, actor_type, actor_id, resource_uri, payload_redacted_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        evt.id,
        evt.traceId ?? null,
        evt.eventType,
        evt.actorType,
        evt.actorId,
        evt.resourceUri ?? null,
        JSON.stringify(evt.payloadRedacted || {}),
        evt.createdAt,
      );
  }

  listAuditEvents(limit = 100): NavopAuditEvent[] {
    const rows = openAgentOsDb().query("SELECT * FROM navop_audit_events ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      traceId: r.trace_id,
      eventType: r.event_type,
      actorType: r.actor_type,
      actorId: r.actor_id,
      resourceUri: r.resource_uri,
      payloadRedacted: JSON.parse(r.payload_redacted_json || "{}"),
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // CC-Switch Provider & Runtime Models
  // -------------------------------------------------------------------------
  upsertProvider(p: CcsProvider): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_providers (id, name, provider_family, protocol, base_url, trust_class, enabled, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          provider_family = excluded.provider_family,
          protocol = excluded.protocol,
          base_url = excluded.base_url,
          trust_class = excluded.trust_class,
          enabled = excluded.enabled,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(p.id, p.name, p.providerFamily, p.protocol, p.baseUrl ?? null, p.trustClass, p.enabled ? 1 : 0, JSON.stringify(p.metadata || {}), p.createdAt, p.updatedAt);
  }

  listProviders(): CcsProvider[] {
    const rows = openAgentOsDb().query("SELECT * FROM ccs_providers ORDER BY name ASC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      providerFamily: r.provider_family,
      protocol: r.protocol,
      baseUrl: r.base_url,
      trustClass: r.trust_class,
      enabled: Boolean(r.enabled),
      metadata: JSON.parse(r.metadata_json || "{}"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  upsertRuntime(rt: CcsRuntime): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_runtimes (id, runtime_type, display_name, executable_path, config_path, detected_version, status, last_seen_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_type) DO UPDATE SET
          display_name = excluded.display_name,
          executable_path = excluded.executable_path,
          config_path = excluded.config_path,
          detected_version = excluded.detected_version,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at,
          metadata_json = excluded.metadata_json
      `)
      .run(rt.id, rt.runtimeType, rt.displayName, rt.executablePath ?? null, rt.configPath ?? null, rt.detectedVersion ?? null, rt.status, rt.lastSeenAt ?? null, JSON.stringify(rt.metadata || {}));
  }

  listRuntimes(): CcsRuntime[] {
    const rows = openAgentOsDb().query("SELECT * FROM ccs_runtimes ORDER BY display_name ASC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      runtimeType: r.runtime_type,
      displayName: r.display_name,
      executablePath: r.executable_path,
      configPath: r.config_path,
      detectedVersion: r.detected_version,
      status: r.status,
      lastSeenAt: r.last_seen_at,
      metadata: JSON.parse(r.metadata_json || "{}"),
    }));
  }
}
