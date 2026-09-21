// Phase Navop & 21.03 — Host-Authoritative Operations Store over SQLite.

import { openAgentOsDb } from "../db";
import type {
  CcsProvider,
  CcsProviderModel,
  CcsRuntime,
  CcsCircuitBreaker,
  CcsRoute,
  CcsUsageEvent,
  CcsConfigProjection,
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

  getProvider(id: string): CcsProvider | null {
    const r = openAgentOsDb().query("SELECT * FROM ccs_providers WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
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
    };
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

  upsertRoute(route: CcsRoute): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_routes (id, name, runtime_id, routing_mode, candidates_json, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          runtime_id = excluded.runtime_id,
          routing_mode = excluded.routing_mode,
          candidates_json = excluded.candidates_json,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
      .run(
        route.id,
        route.name,
        route.runtimeId ?? null,
        route.routingMode,
        JSON.stringify(route.candidates || []),
        route.enabled ? 1 : 0,
        route.createdAt,
        route.updatedAt,
      );
  }

  getRouteByName(name: string): CcsRoute | null {
    const r = openAgentOsDb().query("SELECT * FROM ccs_routes WHERE name = ?").get(name) as any;
    return r ? this.mapRoute(r) : null;
  }

  listRoutes(): CcsRoute[] {
    const rows = openAgentOsDb().query("SELECT * FROM ccs_routes ORDER BY name ASC").all() as any[];
    return rows.map((r) => this.mapRoute(r));
  }

  getCircuit(providerId: string): CcsCircuitBreaker | null {
    const r = openAgentOsDb().query("SELECT * FROM ccs_circuit_breakers WHERE provider_id = ?").get(providerId) as any;
    return r ? this.mapCircuit(r) : null;
  }

  upsertCircuit(circuit: CcsCircuitBreaker): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_circuit_breakers (
          provider_id, state, failure_count, success_count, opened_at, half_open_at, last_failure_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id) DO UPDATE SET
          state = excluded.state,
          failure_count = excluded.failure_count,
          success_count = excluded.success_count,
          opened_at = excluded.opened_at,
          half_open_at = excluded.half_open_at,
          last_failure_at = excluded.last_failure_at,
          updated_at = excluded.updated_at
      `)
      .run(
        circuit.providerId,
        circuit.state,
        circuit.failureCount,
        circuit.successCount,
        circuit.openedAt ?? null,
        circuit.halfOpenAt ?? null,
        circuit.lastFailureAt ?? null,
        circuit.updatedAt,
      );
  }

  addUsageEvent(event: CcsUsageEvent): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_usage_events (
          id, route_id, provider_id, model_id, project_id, task_id, request_class, outcome, replayed,
          input_tokens, output_tokens, estimated_cost, latency_ms, error_code, trace_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.routeId ?? null,
        event.providerId,
        event.modelId ?? null,
        event.projectId ?? null,
        event.taskId ?? null,
        event.requestClass,
        event.outcome,
        event.replayed ? 1 : 0,
        event.inputTokens,
        event.outputTokens,
        event.estimatedCost,
        event.latencyMs ?? null,
        event.errorCode ?? null,
        event.traceId ?? null,
        event.createdAt,
      );
  }

  listUsageEvents(filter: { providerId?: string; projectId?: string; taskId?: string } = {}, limit = 100): CcsUsageEvent[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.providerId) {
      where.push("provider_id = ?");
      args.push(filter.providerId);
    }
    if (filter.projectId) {
      where.push("project_id = ?");
      args.push(filter.projectId);
    }
    if (filter.taskId) {
      where.push("task_id = ?");
      args.push(filter.taskId);
    }
    const sql = `SELECT * FROM ccs_usage_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    const rows = openAgentOsDb().query(sql).all(...args, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      routeId: r.route_id,
      providerId: r.provider_id,
      modelId: r.model_id,
      projectId: r.project_id,
      taskId: r.task_id,
      requestClass: r.request_class,
      outcome: r.outcome,
      replayed: Boolean(r.replayed),
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      estimatedCost: r.estimated_cost,
      latencyMs: r.latency_ms,
      errorCode: r.error_code,
      traceId: r.trace_id,
      createdAt: r.created_at,
    }));
  }

  private mapRoute(r: any): CcsRoute {
    return {
      id: r.id,
      name: r.name,
      runtimeId: r.runtime_id,
      routingMode: r.routing_mode,
      candidates: JSON.parse(r.candidates_json || "[]"),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCircuit(r: any): CcsCircuitBreaker {
    return {
      providerId: r.provider_id,
      state: r.state,
      failureCount: r.failure_count,
      successCount: r.success_count,
      openedAt: r.opened_at,
      halfOpenAt: r.half_open_at,
      lastFailureAt: r.last_failure_at,
      updatedAt: r.updated_at,
    };
  }

  addConfigProjection(projection: CcsConfigProjection): void {
    openAgentOsDb()
      .query(`
        INSERT INTO ccs_config_projections (
          id, runtime_id, target_path, before_hash, after_hash, before_text, after_text, drift, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        projection.id,
        projection.runtimeId,
        projection.targetPath,
        projection.beforeHash,
        projection.afterHash,
        projection.beforeText,
        projection.afterText,
        projection.drift ? 1 : 0,
        projection.status,
        projection.createdAt,
      );
  }

  latestConfigProjection(runtimeId: string, targetPath: string): CcsConfigProjection | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM ccs_config_projections WHERE runtime_id = ? AND target_path = ? ORDER BY created_at DESC LIMIT 1")
      .get(runtimeId, targetPath) as any;
    return r ? this.mapProjection(r) : null;
  }

  private mapProjection(r: any): CcsConfigProjection {
    return {
      id: r.id,
      runtimeId: r.runtime_id,
      targetPath: r.target_path,
      beforeHash: r.before_hash,
      afterHash: r.after_hash,
      beforeText: r.before_text,
      afterText: r.after_text,
      drift: Boolean(r.drift),
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
