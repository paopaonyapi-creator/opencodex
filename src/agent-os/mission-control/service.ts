// Phase 21.02 — Mission Control Service.

import { MissionControlStore, newMissionControlId, nowIso } from "./store";
import type {
  MissionControlAgent,
  MissionControlApproval,
  MissionControlAuditLog,
  MissionControlDlqItem,
  MissionControlIncident,
  MissionControlOverviewKpi,
  MissionControlQueue,
  MissionControlRun,
  MissionControlRunEvent,
  MissionControlRunStatus,
} from "./types";
import { emergencyStopActive, missionControlEnabled } from "./flags";

export class MissionControlService {
  private store = new MissionControlStore();

  assertEnabled(): void {
    if (!missionControlEnabled()) {
      throw new Error("Phase 21.02 Mission Control is disabled (PAO_MISSION_CONTROL_ENABLED=false)");
    }
  }

  // -------------------------------------------------------------------------
  // Overview & Diagnostics
  // -------------------------------------------------------------------------
  getOverview(): MissionControlOverviewKpi {
    this.assertEnabled();
    return this.store.getOverviewKpi();
  }

  // -------------------------------------------------------------------------
  // Agent Lifecycle & Supervision
  // -------------------------------------------------------------------------
  registerAgent(agent: Omit<MissionControlAgent, "createdAt" | "updatedAt">): MissionControlAgent {
    this.assertEnabled();
    const fullAgent: MissionControlAgent = {
      ...agent,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertAgent(fullAgent);
    this.audit("SYSTEM", "SYSTEM", "agent.register", "agent", fullAgent.id, null, "IDLE", "Agent registered");
    return fullAgent;
  }

  getAgent(id: string): MissionControlAgent | null {
    this.assertEnabled();
    return this.store.getAgent(id);
  }

  listAgents(): MissionControlAgent[] {
    this.assertEnabled();
    return this.store.listAgents();
  }

  pauseAgent(id: string, actor: string, reason: string): MissionControlAgent {
    this.assertEnabled();
    const agent = this.store.getAgent(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    const prev = agent.status;
    this.store.updateAgentStatus(id, "PAUSED");
    this.audit(actor, "HUMAN", "agent.pause", "agent", id, prev, "PAUSED", reason);
    return this.store.getAgent(id)!;
  }

  resumeAgent(id: string, actor: string, reason: string): MissionControlAgent {
    this.assertEnabled();
    const agent = this.store.getAgent(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    const prev = agent.status;
    this.store.updateAgentStatus(id, "IDLE");
    this.audit(actor, "HUMAN", "agent.resume", "agent", id, prev, "IDLE", reason);
    return this.store.getAgent(id)!;
  }

  quarantineAgent(id: string, actor: string, reason: string): MissionControlAgent {
    this.assertEnabled();
    const agent = this.store.getAgent(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    const prev = agent.status;
    this.store.updateAgentStatus(id, "QUARANTINED", reason);
    this.audit(actor, "HUMAN", "agent.quarantine", "agent", id, prev, "QUARANTINED", reason);
    return this.store.getAgent(id)!;
  }

  takeoverAgent(id: string, actor: string, reason: string): MissionControlAgent {
    this.assertEnabled();
    const agent = this.store.getAgent(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    agent.takeoverState = "HUMAN_CONTROL";
    agent.status = "PAUSED";
    agent.updatedAt = nowIso();
    this.store.upsertAgent(agent);
    this.audit(actor, "HUMAN", "agent.takeover", "agent", id, "AUTONOMOUS", "HUMAN_CONTROL", reason);
    return agent;
  }

  // -------------------------------------------------------------------------
  // Run Control & State Machine (§37)
  // -------------------------------------------------------------------------
  createRun(runInput: Omit<MissionControlRun, "createdAt" | "updatedAt">): MissionControlRun {
    this.assertEnabled();
    if (emergencyStopActive()) {
      throw new Error("System is under EMERGENCY STOP / LOCKDOWN: cannot create new runs");
    }
    const run: MissionControlRun = {
      ...runInput,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.createRun(run);
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: run.id,
      agentId: run.agentId,
      eventType: "run.created",
      payload: { priority: run.priority, provider: run.provider, model: run.model },
      createdAt: nowIso(),
    });
    return run;
  }

  getRun(id: string): MissionControlRun | null {
    this.assertEnabled();
    return this.store.getRun(id);
  }

  listRuns(limit = 100): MissionControlRun[] {
    this.assertEnabled();
    return this.store.listRuns(limit);
  }

  listRunTimeline(runId: string): MissionControlRunEvent[] {
    this.assertEnabled();
    return this.store.listRunEvents(runId);
  }

  pauseRun(id: string, actor: string, reason: string): MissionControlRun {
    this.assertEnabled();
    const run = this.store.getRun(id);
    if (!run) throw new Error(`Run ${id} not found`);
    if (run.status !== "RUNNING" && run.status !== "STARTING" && run.status !== "QUEUED") {
      throw new Error(`Cannot pause run in status ${run.status}`);
    }
    this.store.updateRunStatus(id, "PAUSED");
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: id,
      agentId: run.agentId,
      eventType: "run.paused",
      payload: { actor, reason },
      createdAt: nowIso(),
    });
    this.audit(actor, "HUMAN", "run.pause", "run", id, run.status, "PAUSED", reason);
    return this.store.getRun(id)!;
  }

  resumeRun(id: string, actor: string, reason: string): MissionControlRun {
    this.assertEnabled();
    const run = this.store.getRun(id);
    if (!run) throw new Error(`Run ${id} not found`);
    if (run.status !== "PAUSED") {
      throw new Error(`Cannot resume run in status ${run.status}`);
    }
    this.store.updateRunStatus(id, "RUNNING");
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: id,
      agentId: run.agentId,
      eventType: "run.resumed",
      payload: { actor, reason },
      createdAt: nowIso(),
    });
    this.audit(actor, "HUMAN", "run.resume", "run", id, "PAUSED", "RUNNING", reason);
    return this.store.getRun(id)!;
  }

  cancelRun(id: string, actor: string, reason: string): MissionControlRun {
    this.assertEnabled();
    const run = this.store.getRun(id);
    if (!run) throw new Error(`Run ${id} not found`);
    if (run.status === "COMPLETED" || run.status === "CANCELLED") {
      throw new Error(`Cannot cancel run already in ${run.status}`);
    }
    this.store.updateRunStatus(id, "CANCELLED");
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: id,
      agentId: run.agentId,
      eventType: "run.cancelled",
      payload: { actor, reason },
      createdAt: nowIso(),
    });
    this.audit(actor, "HUMAN", "run.cancel", "run", id, run.status, "CANCELLED", reason);
    return this.store.getRun(id)!;
  }

  retryRun(id: string, actor: string, reason: string): MissionControlRun {
    this.assertEnabled();
    const run = this.store.getRun(id);
    if (!run) throw new Error(`Run ${id} not found`);
    if (run.retryCount >= run.maxRetries) {
      // Send to Dead Letter Queue (DLQ)
      this.store.addDlqItem({
        id: newMissionControlId("mcdlq"),
        runId: run.id,
        agentId: run.agentId,
        failureReason: run.errorMessage || "Max retries exceeded",
        retryCount: run.retryCount,
        lastProvider: run.provider,
        lastModel: run.model,
        inputSnapshot: run.executionSnapshot || {},
        toolContext: {},
        policyContext: {},
        status: "OPEN",
        createdAt: nowIso(),
      });
      throw new Error(`Run ${id} exceeded max retries (${run.maxRetries}); routed to Dead Letter Queue`);
    }
    run.retryCount += 1;
    run.status = "RETRYING";
    run.updatedAt = nowIso();
    this.store.createRun(run);
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: id,
      agentId: run.agentId,
      eventType: "run.retrying",
      payload: { attempt: run.retryCount, actor, reason },
      createdAt: nowIso(),
    });
    this.audit(actor, "HUMAN", "run.retry", "run", id, "FAILED", "RETRYING", reason);
    return run;
  }

  // -------------------------------------------------------------------------
  // Approvals Inbox (§8)
  // -------------------------------------------------------------------------
  requestApproval(app: Omit<MissionControlApproval, "id" | "status" | "requestedAt">): MissionControlApproval {
    this.assertEnabled();
    const approval: MissionControlApproval = {
      ...app,
      id: newMissionControlId("mcapp"),
      status: "PENDING",
      requestedAt: nowIso(),
    };
    this.store.createApproval(approval);
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: approval.runId,
      agentId: approval.agentId,
      eventType: "approval.requested",
      payload: { approvalId: approval.id, action: approval.action, riskLevel: approval.riskLevel },
      createdAt: nowIso(),
    });
    return approval;
  }

  listApprovals(status?: string): MissionControlApproval[] {
    this.assertEnabled();
    return this.store.listApprovals(status);
  }

  resolveApproval(id: string, decision: "APPROVED" | "REJECTED" | "ESCALATED", actor: string, reason?: string): MissionControlApproval {
    this.assertEnabled();
    const app = this.store.getApproval(id);
    if (!app) throw new Error(`Approval ${id} not found`);
    this.store.resolveApproval(id, decision, actor, reason);
    this.store.addRunEvent({
      id: newMissionControlId("mcevt"),
      runId: app.runId,
      agentId: app.agentId,
      eventType: decision === "APPROVED" ? "approval.approved" : "approval.rejected",
      payload: { approvalId: id, actor, reason },
      createdAt: nowIso(),
    });
    this.audit(actor, "HUMAN", `approval.${decision.toLowerCase()}`, "approval", id, "PENDING", decision, reason);
    return this.store.getApproval(id)!;
  }

  // -------------------------------------------------------------------------
  // Queues & DLQ (§10, §11)
  // -------------------------------------------------------------------------
  listQueues(): MissionControlQueue[] {
    this.assertEnabled();
    return this.store.listQueues();
  }

  pauseQueue(id: string, actor: string): MissionControlQueue {
    this.assertEnabled();
    const queues = this.store.listQueues();
    const q = queues.find((x) => x.id === id);
    if (!q) throw new Error(`Queue ${id} not found`);
    q.status = "PAUSED";
    q.pausedAt = nowIso();
    q.updatedAt = nowIso();
    this.store.upsertQueue(q);
    this.audit(actor, "HUMAN", "queue.pause", "queue", id, "ACTIVE", "PAUSED");
    return q;
  }

  resumeQueue(id: string, actor: string): MissionControlQueue {
    this.assertEnabled();
    const queues = this.store.listQueues();
    const q = queues.find((x) => x.id === id);
    if (!q) throw new Error(`Queue ${id} not found`);
    q.status = "ACTIVE";
    q.pausedAt = null;
    q.updatedAt = nowIso();
    this.store.upsertQueue(q);
    this.audit(actor, "HUMAN", "queue.resume", "queue", id, "PAUSED", "ACTIVE");
    return q;
  }

  listDlq(): MissionControlDlqItem[] {
    this.assertEnabled();
    return this.store.listDlqItems();
  }

  // -------------------------------------------------------------------------
  // Emergency Stop & Incident Mode (§24, §25)
  // -------------------------------------------------------------------------
  triggerEmergencyStop(actor: string, reason: string): MissionControlIncident {
    this.assertEnabled();
    const incident: MissionControlIncident = {
      id: newMissionControlId("mcinc"),
      mode: "LOCKDOWN",
      title: "Emergency Stop Activated",
      description: `Manual lockdown triggered by ${actor}`,
      triggerReason: reason,
      createdBy: actor,
      createdAt: nowIso(),
    };
    this.store.setIncident(incident);
    this.audit(actor, "HUMAN", "emergency.stop", "incident", incident.id, "NORMAL", "LOCKDOWN", reason);
    return incident;
  }

  resolveIncident(id: string, actor: string, reason: string): MissionControlIncident {
    this.assertEnabled();
    const inc = this.store.getLatestIncident();
    if (!inc || inc.id !== id) throw new Error(`Incident ${id} not found`);
    inc.resolvedAt = nowIso();
    inc.resolvedBy = actor;
    inc.mode = "NORMAL";
    this.store.setIncident(inc);
    this.audit(actor, "HUMAN", "incident.resolve", "incident", id, "LOCKDOWN", "NORMAL", reason);
    return inc;
  }

  // -------------------------------------------------------------------------
  // Audit Ledger (§23)
  // -------------------------------------------------------------------------
  private audit(
    actor: string,
    actorType: "HUMAN" | "AGENT" | "SYSTEM",
    action: string,
    resourceType: string,
    resourceId: string,
    beforeState?: string | null,
    afterState?: string | null,
    reason?: string | null,
  ): void {
    this.store.addAuditLog({
      id: newMissionControlId("mcaud"),
      actor,
      actorType,
      action,
      resourceType,
      resourceId,
      beforeState,
      afterState,
      reason,
      correlationId: `corr_${Date.now()}`,
      createdAt: nowIso(),
    });
  }

  listAudit(limit = 100): MissionControlAuditLog[] {
    this.assertEnabled();
    return this.store.listAuditLogs(limit);
  }
}

let singletonService: MissionControlService | null = null;
export function getMissionControlService(): MissionControlService {
  if (!singletonService) {
    singletonService = new MissionControlService();
  }
  return singletonService;
}
