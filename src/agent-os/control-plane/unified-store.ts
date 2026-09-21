// Phase 21.00 — Unified Control Plane Store over uap_* tables.

import { openAgentOsDb } from "../db";
import { canonicalJson } from "../agent-runtime/hash";
import type {
  UapAgent,
  UapAgentStatus,
  UapApproval,
  UapApprovalStatus,
  UapAuditEvent,
  UapHost,
  UapHostStatus,
  UapHostTrustLevel,
  UapJob,
  UapJobStatus,
  UapMcpServer,
  UapMcpTool,
  UapSkill,
} from "./unified-types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newUapId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class UnifiedControlPlaneStore {
  upsertAgent(agent: UapAgent): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_agents (agent_id, display_name, runtime_type, provider, model, host_id, sandbox_id, status, capabilities_json, skill_bindings_json, mcp_bindings_json, policy_profile_id, credential_scope_id, metadata_json, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET display_name = excluded.display_name, status = excluded.status, capabilities_json = excluded.capabilities_json, skill_bindings_json = excluded.skill_bindings_json, mcp_bindings_json = excluded.mcp_bindings_json, policy_profile_id = excluded.policy_profile_id, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at",
      )
      .run(
        agent.agentId,
        agent.displayName,
        agent.runtimeType,
        agent.provider,
        agent.model,
        agent.hostId,
        agent.sandboxId,
        agent.status,
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.skillBindings),
        JSON.stringify(agent.mcpBindings),
        agent.policyProfileId,
        agent.credentialScopeId,
        JSON.stringify(agent.metadata),
        agent.createdAt,
        agent.updatedAt,
        agent.lastSeenAt,
      );
  }

  getAgent(agentId: string): UapAgent | null {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_agents WHERE agent_id = ?");
    const r = stmt.get(agentId) as any;
    if (!r) return null;
    return {
      agentId: r.agent_id,
      displayName: r.display_name,
      runtimeType: r.runtime_type,
      provider: r.provider,
      model: r.model,
      hostId: r.host_id,
      sandboxId: r.sandbox_id,
      status: r.status,
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      skillBindings: JSON.parse(r.skill_bindings_json || "[]"),
      mcpBindings: JSON.parse(r.mcp_bindings_json || "[]"),
      policyProfileId: r.policy_profile_id,
      credentialScopeId: r.credential_scope_id,
      metadata: JSON.parse(r.metadata_json || "{}"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastSeenAt: r.last_seen_at,
    };
  }

  listAgents(): UapAgent[] {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_agents ORDER BY updated_at DESC");
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      agentId: r.agent_id,
      displayName: r.display_name,
      runtimeType: r.runtime_type,
      provider: r.provider,
      model: r.model,
      hostId: r.host_id,
      sandboxId: r.sandbox_id,
      status: r.status,
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      skillBindings: JSON.parse(r.skill_bindings_json || "[]"),
      mcpBindings: JSON.parse(r.mcp_bindings_json || "[]"),
      policyProfileId: r.policy_profile_id,
      credentialScopeId: r.credential_scope_id,
      metadata: JSON.parse(r.metadata_json || "{}"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  upsertHost(host: UapHost): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_hosts (host_id, display_name, host_type, os_family, architecture, connection_mode, tailscale_identity, ssh_profile_ref, status, trust_level, capabilities_json, labels_json, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(host_id) DO UPDATE SET display_name = excluded.display_name, status = excluded.status, trust_level = excluded.trust_level, capabilities_json = excluded.capabilities_json, labels_json = excluded.labels_json, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at",
      )
      .run(
        host.hostId,
        host.displayName,
        host.hostType,
        host.osFamily,
        host.architecture,
        host.connectionMode,
        host.tailscaleIdentity,
        host.sshProfileRef,
        host.status,
        host.trustLevel,
        JSON.stringify(host.capabilities),
        JSON.stringify(host.labels),
        host.createdAt,
        host.updatedAt,
        host.lastSeenAt,
      );
  }

  getHost(hostId: string): UapHost | null {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_hosts WHERE host_id = ?");
    const r = stmt.get(hostId) as any;
    if (!r) return null;
    return {
      hostId: r.host_id,
      displayName: r.display_name,
      hostType: r.host_type,
      osFamily: r.os_family,
      architecture: r.architecture,
      connectionMode: r.connection_mode,
      tailscaleIdentity: r.tailscale_identity,
      sshProfileRef: r.ssh_profile_ref,
      status: r.status,
      trustLevel: r.trust_level,
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      labels: JSON.parse(r.labels_json || "{}"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastSeenAt: r.last_seen_at,
    };
  }

  listHosts(): UapHost[] {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_hosts ORDER BY updated_at DESC");
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      hostId: r.host_id,
      displayName: r.display_name,
      hostType: r.host_type,
      osFamily: r.os_family,
      architecture: r.architecture,
      connectionMode: r.connection_mode,
      tailscaleIdentity: r.tailscale_identity,
      sshProfileRef: r.ssh_profile_ref,
      status: r.status,
      trustLevel: r.trust_level,
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      labels: JSON.parse(r.labels_json || "{}"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  insertJob(job: UapJob): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_jobs (job_id, correlation_id, causation_id, job_type, requested_by, agent_id, host_id, status, priority, payload_ref, policy_snapshot_id, approval_id, attempt, max_attempts, checkpoint_ref, result_ref, error_code, error_message, created_at, started_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.jobId,
        job.correlationId,
        job.causationId,
        job.jobType,
        job.requestedBy,
        job.agentId,
        job.hostId,
        job.status,
        job.priority,
        job.payloadRef,
        job.policySnapshotId,
        job.approvalId,
        job.attempt,
        job.maxAttempts,
        job.checkpointRef,
        job.resultRef,
        job.errorCode,
        job.errorMessage,
        job.createdAt,
        job.startedAt,
        job.updatedAt,
        job.finishedAt,
      );
  }

  getJob(jobId: string): UapJob | null {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_jobs WHERE job_id = ?");
    const r = stmt.get(jobId) as any;
    if (!r) return null;
    return {
      jobId: r.job_id,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      jobType: r.job_type,
      requestedBy: r.requested_by,
      agentId: r.agent_id,
      hostId: r.host_id,
      status: r.status,
      priority: r.priority,
      payloadRef: r.payload_ref,
      policySnapshotId: r.policy_snapshot_id,
      approvalId: r.approval_id,
      attempt: r.attempt,
      maxAttempts: r.max_attempts,
      checkpointRef: r.checkpoint_ref,
      resultRef: r.result_ref,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
      finishedAt: r.finished_at,
    };
  }

  updateJobState(
    jobId: string,
    updates: {
      status: UapJobStatus;
      checkpointRef?: string | null;
      resultRef?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      approvalId?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      incrementAttempt?: boolean;
    },
  ): UapJob | null {
    const cur = this.getJob(jobId);
    if (!cur) return null;

    const nextAttempt = cur.attempt + (updates.incrementAttempt ? 1 : 0);
    const now = nowIso();

    openAgentOsDb()
      .prepare(
        "UPDATE uap_jobs SET status = ?, checkpoint_ref = ?, result_ref = ?, error_code = ?, error_message = ?, approval_id = ?, started_at = ?, finished_at = ?, attempt = ?, updated_at = ? WHERE job_id = ?",
      )
      .run(
        updates.status,
        updates.checkpointRef !== undefined ? updates.checkpointRef : cur.checkpointRef,
        updates.resultRef !== undefined ? updates.resultRef : cur.resultRef,
        updates.errorCode !== undefined ? updates.errorCode : cur.errorCode,
        updates.errorMessage !== undefined ? updates.errorMessage : cur.errorMessage,
        updates.approvalId !== undefined ? updates.approvalId : cur.approvalId,
        updates.startedAt !== undefined ? updates.startedAt : cur.startedAt,
        updates.finishedAt !== undefined ? updates.finishedAt : cur.finishedAt,
        nextAttempt,
        now,
        jobId,
      );

    return this.getJob(jobId);
  }

  upsertMcpServer(server: UapMcpServer): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_mcp_servers (mcp_server_id, name, transport, endpoint_ref, auth_ref, trust_level, environment, status, tool_count, policy_profile_id, source, version, created_at, updated_at, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mcp_server_id) DO UPDATE SET name = excluded.name, status = excluded.status, tool_count = excluded.tool_count, updated_at = excluded.updated_at, last_verified_at = excluded.last_verified_at",
      )
      .run(
        server.mcpServerId,
        server.name,
        server.transport,
        server.endpointRef,
        server.authRef,
        server.trustLevel,
        server.environment,
        server.status,
        server.toolCount,
        server.policyProfileId,
        server.source,
        server.version,
        server.createdAt,
        server.updatedAt,
        server.lastVerifiedAt,
      );
  }

  upsertMcpTool(tool: UapMcpTool): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_mcp_tools (tool_id, mcp_server_id, name, description, risk_class, requires_approval, allowed_agent_classes_json, allowed_host_classes_json, input_schema_hash, output_schema_hash, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mcp_server_id, name) DO UPDATE SET description = excluded.description, risk_class = excluded.risk_class, requires_approval = excluded.requires_approval, enabled = excluded.enabled",
      )
      .run(
        tool.toolId,
        tool.mcpServerId,
        tool.name,
        tool.description,
        tool.riskClass,
        tool.requiresApproval ? 1 : 0,
        JSON.stringify(tool.allowedAgentClasses),
        JSON.stringify(tool.allowedHostClasses),
        tool.inputSchemaHash,
        tool.outputSchemaHash,
        tool.enabled ? 1 : 0,
      );
  }

  listMcpTools(): UapMcpTool[] {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_mcp_tools ORDER BY name ASC");
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      toolId: r.tool_id,
      mcpServerId: r.mcp_server_id,
      name: r.name,
      description: r.description,
      riskClass: r.risk_class,
      requiresApproval: r.requires_approval === 1,
      allowedAgentClasses: JSON.parse(r.allowed_agent_classes_json || "[]"),
      allowedHostClasses: JSON.parse(r.allowed_host_classes_json || "[]"),
      inputSchemaHash: r.input_schema_hash,
      outputSchemaHash: r.output_schema_hash,
      enabled: r.enabled === 1,
    }));
  }

  upsertSkill(skill: UapSkill): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_skills (skill_id, name, version, source, runtime, entrypoint, capability_tags_json, risk_class, required_tools_json, required_credentials_json, allowed_agents_json, allowed_hosts_json, policy_profile_id, status, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(skill_id) DO UPDATE SET version = excluded.version, status = excluded.status, updated_at = excluded.updated_at",
      )
      .run(
        skill.skillId,
        skill.name,
        skill.version,
        skill.source,
        skill.runtime,
        skill.entrypoint,
        JSON.stringify(skill.capabilityTags),
        skill.riskClass,
        JSON.stringify(skill.requiredTools),
        JSON.stringify(skill.requiredCredentials),
        JSON.stringify(skill.allowedAgents),
        JSON.stringify(skill.allowedHosts),
        skill.policyProfileId,
        skill.status,
        skill.checksum,
        skill.createdAt,
        skill.updatedAt,
      );
  }

  listSkills(): UapSkill[] {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_skills ORDER BY name ASC");
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      skillId: r.skill_id,
      name: r.name,
      version: r.version,
      source: r.source,
      runtime: r.runtime,
      entrypoint: r.entrypoint,
      capabilityTags: JSON.parse(r.capability_tags_json || "[]"),
      riskClass: r.risk_class,
      requiredTools: JSON.parse(r.required_tools_json || "[]"),
      requiredCredentials: JSON.parse(r.required_credentials_json || "[]"),
      allowedAgents: JSON.parse(r.allowed_agents_json || "[]"),
      allowedHosts: JSON.parse(r.allowed_hosts_json || "[]"),
      policyProfileId: r.policy_profile_id,
      status: r.status,
      checksum: r.checksum,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  insertApproval(appr: UapApproval): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_approvals (approval_id, correlation_id, request_type, resource_type, resource_id, risk_class, requested_by, context_hash, status, decided_by, decided_at, decision_reason, policy_snapshot_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        appr.approvalId,
        appr.correlationId,
        appr.requestType,
        appr.resourceType,
        appr.resourceId,
        appr.riskClass,
        appr.requestedBy,
        appr.contextHash,
        appr.status,
        appr.decidedBy,
        appr.decidedAt,
        appr.decisionReason,
        appr.policySnapshotId,
        appr.createdAt,
        appr.expiresAt,
      );
  }

  getApproval(approvalId: string): UapApproval | null {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_approvals WHERE approval_id = ?");
    const r = stmt.get(approvalId) as any;
    if (!r) return null;
    return {
      approvalId: r.approval_id,
      correlationId: r.correlation_id,
      requestType: r.request_type,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      riskClass: r.risk_class,
      requestedBy: r.requested_by,
      contextHash: r.context_hash,
      status: r.status,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionReason: r.decision_reason,
      policySnapshotId: r.policy_snapshot_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }

  decideApproval(approvalId: string, decision: "approved" | "rejected", decidedBy: string, reason?: string): UapApproval | null {
    openAgentOsDb()
      .prepare(
        "UPDATE uap_approvals SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE approval_id = ? AND status = 'pending'",
      )
      .run(decision, decidedBy, nowIso(), reason ?? null, approvalId);
    return this.getApproval(approvalId);
  }

  appendAudit(event: UapAuditEvent): void {
    openAgentOsDb()
      .prepare(
        "INSERT INTO uap_audit_events (event_id, correlation_id, causation_id, event_type, actor_type, actor_id, agent_id, host_id, job_id, approval_id, resource_type, resource_id, risk_class, policy_id, policy_version, outcome, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.eventId,
        event.correlationId,
        event.causationId,
        event.eventType,
        event.actorType,
        event.actorId,
        event.agentId,
        event.hostId,
        event.jobId,
        event.approvalId,
        event.resourceType,
        event.resourceId,
        event.riskClass,
        event.policyId,
        event.policyVersion,
        event.outcome,
        canonicalJson(event.metadata ?? {}),
        event.createdAt,
      );
  }

  listAuditEvents(): UapAuditEvent[] {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_audit_events ORDER BY created_at DESC LIMIT 50");
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      eventId: r.event_id,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      eventType: r.event_type,
      actorType: r.actor_type,
      actorId: r.actor_id,
      agentId: r.agent_id,
      hostId: r.host_id,
      jobId: r.job_id,
      approvalId: r.approval_id,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      riskClass: r.risk_class,
      policyId: r.policy_id,
      policyVersion: r.policy_version,
      outcome: r.outcome,
      metadata: JSON.parse(r.metadata_json || "{}"),
      createdAt: r.created_at,
    }));
  }

  getIdempotentResult(key: string): { fingerprint: string; result: unknown } | null {
    const stmt = openAgentOsDb().prepare("SELECT * FROM uap_idempotency_keys WHERE key = ?");
    const r = stmt.get(key) as any;
    if (!r) return null;
    return {
      fingerprint: String(r.operation_fingerprint),
      result: JSON.parse(String(r.result_json)),
    };
  }

  recordIdempotentResult(key: string, fingerprint: string, result: unknown): void {
    openAgentOsDb()
      .prepare("INSERT INTO uap_idempotency_keys (key, operation_fingerprint, result_json, created_at) VALUES (?, ?, ?, ?)")
      .run(key, fingerprint, JSON.stringify(result ?? null), nowIso());
  }
}
