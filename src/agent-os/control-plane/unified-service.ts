// Phase 21.00 — Unified Agent Operations Control Plane Service.
// Binds OpenHermit (Phase 20.98), Whip (Phase 20.99), and Pao-hubPro Core
// under one operational, policy, approval, and audit model.

import { sha256Hex } from "../agent-runtime/hash";
import { newUapId, nowIso, UnifiedControlPlaneStore } from "./unified-store";
import {
  type UapAgent,
  type UapAgentStatus,
  type UapApproval,
  type UapAuditEvent,
  type UapHost,
  type UapHostTrustLevel,
  type UapJob,
  type UapJobStatus,
  type UapMcpServer,
  type UapMcpTool,
  type UapRiskClass,
  type UapSkill,
  UapError,
} from "./unified-types";

export interface RegisterAgentInput {
  agentId?: string;
  displayName: string;
  runtimeType: UapAgent["runtimeType"];
  provider: string;
  model?: string | null;
  hostId: string;
  capabilities?: string[];
  policyProfileId?: string;
}

export interface RegisterHostInput {
  hostId?: string;
  displayName: string;
  hostType: UapHost["hostType"];
  osFamily: UapHost["osFamily"];
  architecture: UapHost["architecture"];
  connectionMode: UapHost["connectionMode"];
  tailscaleIdentity?: string | null;
  trustLevel?: UapHostTrustLevel;
  capabilities?: string[];
}

export interface SubmitJobInput {
  jobType: string;
  requestedBy: string;
  agentId?: string | null;
  hostId: string;
  correlationId?: string;
  causationId?: string | null;
  priority?: number;
  payload?: Record<string, unknown>;
  riskClass?: UapRiskClass;
  idempotencyKey?: string;
}

export class UnifiedAgentOperationsControlPlane {
  private readonly store: UnifiedControlPlaneStore;

  constructor(store?: UnifiedControlPlaneStore) {
    this.store = store ?? new UnifiedControlPlaneStore();
  }

  // -------------------------------------------------------------------------
  // Agent Lifecycle & Federation (§6.1, §6.3)
  // -------------------------------------------------------------------------

  registerAgent(input: RegisterAgentInput): UapAgent {
    const id = input.agentId ?? newUapId("uap_ag");
    const agent: UapAgent = {
      agentId: id,
      displayName: input.displayName,
      runtimeType: input.runtimeType,
      provider: input.provider,
      model: input.model ?? null,
      hostId: input.hostId,
      sandboxId: null,
      status: "ready",
      capabilities: input.capabilities ?? [],
      skillBindings: [],
      mcpBindings: [],
      policyProfileId: input.policyProfileId ?? "default",
      credentialScopeId: null,
      metadata: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    this.store.upsertAgent(agent);
    this.recordAudit({
      correlationId: `corr_reg_${id}`,
      causationId: null,
      eventType: "agent.registered.v1",
      actorType: "system",
      actorId: "control_plane",
      agentId: id,
      hostId: input.hostId,
      jobId: null,
      approvalId: null,
      resourceType: "agent",
      resourceId: id,
      riskClass: "R1_LOW_RISK",
      policyId: "default",
      policyVersion: "1.0",
      outcome: "success",
      metadata: { displayName: agent.displayName, provider: agent.provider },
    });
    return agent;
  }

  getAgent(id: string): UapAgent | null {
    return this.store.getAgent(id);
  }

  listAgents(): UapAgent[] {
    return this.store.listAgents();
  }

  setAgentStatus(agentId: string, status: UapAgentStatus, actor = "operator"): UapAgent {
    const ag = this.store.getAgent(agentId);
    if (!ag) throw new UapError("NOT_FOUND", `agent not found: ${agentId}`);
    ag.status = status;
    ag.updatedAt = nowIso();
    this.store.upsertAgent(ag);

    this.recordAudit({
      correlationId: `corr_status_${agentId}`,
      causationId: null,
      eventType: "agent.status_changed.v1",
      actorType: "user",
      actorId: actor,
      agentId,
      hostId: ag.hostId,
      jobId: null,
      approvalId: null,
      resourceType: "agent",
      resourceId: agentId,
      riskClass: status === "quarantined" ? "R3_SENSITIVE" : "R1_LOW_RISK",
      policyId: "default",
      policyVersion: "1.0",
      outcome: "success",
      metadata: { previousStatus: ag.status, nextStatus: status },
    });
    return ag;
  }

  // -------------------------------------------------------------------------
  // Host Registry & Quarantine (§6.2, §25)
  // -------------------------------------------------------------------------

  registerHost(input: RegisterHostInput): UapHost {
    const id = input.hostId ?? newUapId("uap_host");
    const host: UapHost = {
      hostId: id,
      displayName: input.displayName,
      hostType: input.hostType,
      osFamily: input.osFamily,
      architecture: input.architecture,
      connectionMode: input.connectionMode,
      tailscaleIdentity: input.tailscaleIdentity ?? null,
      sshProfileRef: null,
      status: "online",
      trustLevel: input.trustLevel ?? "MANAGED_REMOTE",
      capabilities: input.capabilities ?? [],
      labels: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    this.store.upsertHost(host);
    return host;
  }

  getHost(hostId: string): UapHost | null {
    return this.store.getHost(hostId);
  }

  listHosts(): UapHost[] {
    return this.store.listHosts();
  }

  setHostTrust(hostId: string, trustLevel: UapHostTrustLevel, actor = "security_officer"): UapHost {
    const host = this.store.getHost(hostId);
    if (!host) throw new UapError("NOT_FOUND", `host not found: ${hostId}`);
    host.trustLevel = trustLevel;
    if (trustLevel === "QUARANTINED") {
      host.status = "quarantined";
    }
    host.updatedAt = nowIso();
    this.store.upsertHost(host);
    return host;
  }

  // -------------------------------------------------------------------------
  // Durable Job State Machine & Idempotency (§7, §8, §21)
  // -------------------------------------------------------------------------

  async submitJob(input: SubmitJobInput): Promise<UapJob> {
    const correlationId = input.correlationId ?? `corr_job_${Date.now()}`;
    const host = this.store.getHost(input.hostId);
    if (!host) throw new UapError("HOST_OFFLINE", `target host ${input.hostId} not found`);
    if (host.trustLevel === "QUARANTINED") {
      throw new UapError("HOST_QUARANTINED", `target host ${input.hostId} is quarantined`);
    }

    if (input.agentId) {
      const ag = this.store.getAgent(input.agentId);
      if (!ag) throw new UapError("NOT_FOUND", `assigned agent ${input.agentId} not found`);
      if (ag.status === "quarantined") {
        throw new UapError("AGENT_QUARANTINED", `assigned agent ${input.agentId} is quarantined`);
      }
    }

    // Idempotency check (§21)
    if (input.idempotencyKey) {
      const existing = this.store.getIdempotentResult(input.idempotencyKey);
      if (existing) {
        return existing.result as UapJob;
      }
    }

    const risk: UapRiskClass = input.riskClass ?? "R1_LOW_RISK";
    const jobId = newUapId("uap_job");
    const now = nowIso();

    const job: UapJob = {
      jobId,
      correlationId,
      causationId: input.causationId ?? null,
      jobType: input.jobType,
      requestedBy: input.requestedBy,
      agentId: input.agentId ?? null,
      hostId: input.hostId,
      status: "queued",
      priority: input.priority ?? 5,
      payloadRef: input.payload ? `payload_${jobId}` : null,
      policySnapshotId: "policy_v1",
      approvalId: null,
      attempt: 0,
      maxAttempts: 3,
      checkpointRef: null,
      resultRef: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
    };

    // Policy & Approval Gating (§9, §11, §12)
    if (risk === "R3_SENSITIVE" || risk === "R4_PRIVILEGED") {
      const apprId = newUapId("uap_appr");
      const contextHash = sha256Hex(JSON.stringify({ jobType: input.jobType, hostId: input.hostId, payload: input.payload }));
      const approval: UapApproval = {
        approvalId: apprId,
        correlationId,
        requestType: "job_execution",
        resourceType: "job",
        resourceId: jobId,
        riskClass: risk,
        requestedBy: input.requestedBy,
        contextHash,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
        policySnapshotId: "policy_v1",
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      this.store.insertApproval(approval);

      job.status = "awaiting_approval";
      job.approvalId = apprId;
      this.store.insertJob(job);

      if (input.idempotencyKey) {
        this.store.recordIdempotentResult(input.idempotencyKey, contextHash, job);
      }
      return job;
    }

    // Auto-advance low-risk jobs to running
    job.status = "running";
    job.startedAt = now;
    this.store.insertJob(job);

    if (input.idempotencyKey) {
      const fingerprint = sha256Hex(JSON.stringify({ jobType: input.jobType, hostId: input.hostId }));
      this.store.recordIdempotentResult(input.idempotencyKey, fingerprint, job);
    }
    return job;
  }

  getJob(jobId: string): UapJob | null {
    return this.store.getJob(jobId);
  }

  // -------------------------------------------------------------------------
  // Approvals & Context-Recheck Replay (§12, §14)
  // -------------------------------------------------------------------------

  decideApproval(approvalId: string, decision: "approved" | "rejected", decidedBy: string, reason?: string): UapApproval {
    const appr = this.store.getApproval(approvalId);
    if (!appr) throw new UapError("NOT_FOUND", `approval not found: ${approvalId}`);
    if (appr.status !== "pending") {
      throw new UapError("INVALID_INPUT", `approval already in status '${appr.status}'`);
    }

    const updated = this.store.decideApproval(approvalId, decision, decidedBy, reason)!;

    // If approved, advance linked job to approved / running
    const job = this.store.getJob(appr.resourceId);
    if (job && job.status === "awaiting_approval") {
      this.store.updateJobState(job.jobId, {
        status: decision === "approved" ? "approved" : "cancelled",
      });
    }

    return updated;
  }

  /**
   * Recheck offline or queued replay against current context (spec §5.4, §14.1).
   * Context mismatch on R3/R4 operations strictly transitions to needs_review.
   */
  evaluateReplay(jobId: string, currentContext: { hostId: string; payload: Record<string, unknown> }): { canReplay: boolean; status: UapJobStatus; reason?: string } {
    const job = this.store.getJob(jobId);
    if (!job) throw new UapError("NOT_FOUND", `job not found: ${jobId}`);

    if (job.hostId !== currentContext.hostId) {
      this.store.updateJobState(jobId, {
        status: "needs_review",
        errorMessage: "host identity changed while offline",
      });
      return { canReplay: false, status: "needs_review", reason: "host identity mismatch" };
    }

    if (job.approvalId) {
      const appr = this.store.getApproval(job.approvalId);
      if (appr && (appr.riskClass === "R3_SENSITIVE" || appr.riskClass === "R4_PRIVILEGED")) {
        const expectedHash = sha256Hex(JSON.stringify({ jobType: job.jobType, hostId: currentContext.hostId, payload: currentContext.payload }));
        if (appr.contextHash !== expectedHash) {
          this.store.updateJobState(jobId, {
            status: "needs_review",
            errorMessage: "context hash changed after approval was granted; replay blocked",
          });
          return { canReplay: false, status: "needs_review", reason: "context hash mismatch on high-risk job" };
        }
      }
    }

    return { canReplay: true, status: job.status };
  }

  // -------------------------------------------------------------------------
  // MCP & Skill Registries (§9, §10)
  // -------------------------------------------------------------------------

  registerMcpServer(server: UapMcpServer): void {
    this.store.upsertMcpServer(server);
  }

  registerMcpTool(tool: UapMcpTool): void {
    this.store.upsertMcpTool(tool);
  }

  listMcpTools(): UapMcpTool[] {
    return this.store.listMcpTools();
  }

  registerSkill(skill: UapSkill): void {
    this.store.upsertSkill(skill);
  }

  listSkills(): UapSkill[] {
    return this.store.listSkills();
  }

  // -------------------------------------------------------------------------
  // Audit Stream (§17, §18)
  // -------------------------------------------------------------------------

  recordAudit(event: Omit<UapAuditEvent, "eventId" | "createdAt">): UapAuditEvent {
    const full: UapAuditEvent = {
      ...event,
      eventId: newUapId("uap_aud"),
      createdAt: nowIso(),
    };
    this.store.appendAudit(full);
    return full;
  }

  listAuditEvents(_correlationId?: string): UapAuditEvent[] {
    return this.store.listAuditEvents();
  }
}

let singletonPlane: UnifiedAgentOperationsControlPlane | null = null;

export function getUnifiedControlPlane(): UnifiedAgentOperationsControlPlane {
  if (!singletonPlane) {
    singletonPlane = new UnifiedAgentOperationsControlPlane();
  }
  return singletonPlane;
}

export function resetUnifiedControlPlaneForTests(): void {
  singletonPlane = null;
}
