// Task Manager and State Machine for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { openAgentOsDb } from "../db";
import type {
  MobileArtifact,
  MobileDevice,
  MobileTask,
  MobileTaskEvent,
  MobileTaskStatus,
  MobileTrace,
  RunTaskInput,
  TaskProfile,
  VerificationLevel,
} from "./types";
import { getMobileDeviceRegistry } from "./device-registry";
import { getMobilePolicyEngine } from "./policy-engine";
import { getArtemisProvider } from "./artemis-adapter";
import { getMobileReviewerCouncil } from "./reviewer-hook";
import { getMobileConfig } from "./config";

export class MobileTaskManager {
  private deviceRegistry = getMobileDeviceRegistry();
  private policyEngine = getMobilePolicyEngine();
  private provider = getArtemisProvider();
  private reviewerCouncil = getMobileReviewerCouncil();

  public async runTask(input: RunTaskInput): Promise<MobileTask> {
    const config = getMobileConfig();
    if (!config.enabled) {
      throw new Error("Pao-hubPro Mobile Subsystem is disabled via PAO_MOBILE_ENABLED=false");
    }

    // 1. Resolve Device
    let device: MobileDevice | null = null;
    if (input.deviceId) {
      device = this.deviceRegistry.getDevice(input.deviceId);
    } else {
      // Find first ready test device
      const devices = this.deviceRegistry.listDevices();
      device = devices.find((d) => d.status === "ready" && d.allowAgent) || devices[0] || null;
    }

    const now = Date.now();
    const taskId = `mtask_${now}_${Math.random().toString(36).slice(2, 7)}`;

    if (!device) {
      const failedTask = this.insertTask({
        id: taskId,
        deviceId: input.deviceId || "unknown",
        goal: input.goal,
        profile: input.profile || config.defaultProfile,
        verificationLevel: input.verificationLevel || config.defaultVerification,
        riskLevel: "R1",
        status: "DEVICE_OFFLINE",
        requestedByType: input.requestedByType || "agent",
        requestedById: input.requestedById || "codex",
        errorMessage: "No available or online mobile device registered",
        createdAt: now,
        updatedAt: now,
      });
      return failedTask;
    }

    // 2. Insert Task in NEW state
    const task = this.insertTask({
      id: taskId,
      deviceId: device.id,
      goal: input.goal,
      profile: input.profile || config.defaultProfile,
      verificationLevel: input.verificationLevel || config.defaultVerification,
      riskLevel: "R1",
      status: "NEW",
      requestedByType: input.requestedByType || "agent",
      requestedById: input.requestedById || "codex",
      createdAt: now,
      updatedAt: now,
    });
    this.logEvent(task.id, "state_transition", { from: "NONE", to: "NEW" });

    // 3. State: VALIDATING & Policy Evaluation
    this.updateTaskStatus(task.id, "VALIDATING");
    this.logEvent(task.id, "state_transition", { from: "NEW", to: "VALIDATING" });

    this.updateTaskStatus(task.id, "CLASSIFYING_RISK");
    this.logEvent(task.id, "state_transition", { from: "VALIDATING", to: "CLASSIFYING_RISK" });

    const policyResult = this.policyEngine.evaluate(task.id, task.goal, device);
    task.riskLevel = policyResult.riskLevel;
    task.goal = policyResult.sanitizedGoal;

    // Update risk level in db
    openAgentOsDb()
      .query("UPDATE mobile_tasks SET risk_level = ?, goal = ? WHERE id = ?")
      .run(task.riskLevel, task.goal, task.id);

    // Rule: Deny Policy
    if (policyResult.decision === "DENY") {
      this.updateTaskStatus(task.id, "BLOCKED_BY_POLICY", policyResult.reason);
      this.logEvent(task.id, "policy_blocked", { reason: policyResult.reason, ruleId: policyResult.ruleId });
      task.status = "BLOCKED_BY_POLICY";
      task.errorMessage = policyResult.reason;
      return task;
    }

    // Rule: Waiting Approval
    if (policyResult.decision === "WAITING_APPROVAL") {
      this.updateTaskStatus(task.id, "WAITING_APPROVAL", policyResult.reason);
      this.logEvent(task.id, "awaiting_approval", { reason: policyResult.reason, ruleId: policyResult.ruleId });
      task.status = "WAITING_APPROVAL";
      task.errorMessage = policyResult.reason;
      return task;
    }

    // 4. Resolve Execution Profile (Auto / Flash / Pro)
    const resolvedProfile = this.resolveProfile(task.profile, task.riskLevel, policyResult.requiresProProfile);
    task.resolvedProfile = resolvedProfile;

    // 5. Execute Task
    return await this.executeTask(task, device, resolvedProfile);
  }

  public async approveTask(taskId: string, approvedBy = "supervisor"): Promise<MobileTask> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "WAITING_APPROVAL") {
      throw new Error(`Task ${taskId} is not in WAITING_APPROVAL status (currently ${task.status})`);
    }

    const device = this.deviceRegistry.getDevice(task.deviceId);
    if (!device) throw new Error(`Device ${task.deviceId} for task ${taskId} not found`);

    task.approvedBy = approvedBy;
    task.errorMessage = undefined;
    openAgentOsDb()
      .query("UPDATE mobile_tasks SET approved_by = ?, error_message = NULL WHERE id = ?")
      .run(approvedBy, taskId);
    this.logEvent(taskId, "task_approved", { approvedBy });

    const resolvedProfile = this.resolveProfile(task.profile, task.riskLevel, true);
    task.resolvedProfile = resolvedProfile;

    return await this.executeTask(task, device, resolvedProfile);
  }

  public async rejectTask(taskId: string, rejectedBy = "supervisor", reason = "Operator rejected"): Promise<MobileTask> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    this.updateTaskStatus(taskId, "REJECTED", reason);
    this.logEvent(taskId, "task_rejected", { rejectedBy, reason });
    task.status = "REJECTED";
    task.errorMessage = reason;
    return task;
  }

  public async stopTask(taskId: string): Promise<boolean> {
    const task = this.getTask(taskId);
    if (!task) return false;

    if (task.providerTaskId) {
      await this.provider.stopTask(task.providerTaskId);
    }

    this.updateTaskStatus(taskId, "CANCELLED", "User requested stop");
    this.logEvent(taskId, "task_cancelled", { at: Date.now() });
    return true;
  }

  public async injectInstruction(taskId: string, instruction: string): Promise<boolean> {
    const task = this.getTask(taskId);
    if (!task || !task.providerTaskId) return false;

    const ok = await this.provider.injectInstruction(task.providerTaskId, instruction);
    if (ok) {
      this.logEvent(taskId, "instruction_injected", { instruction });
    }
    return ok;
  }

  private async executeTask(task: MobileTask, device: MobileDevice, profile: "flash" | "pro"): Promise<MobileTask> {
    // Transition to QUEUED then RUNNING
    this.updateTaskStatus(task.id, "QUEUED");
    this.logEvent(task.id, "state_transition", { from: task.status, to: "QUEUED" });

    this.updateTaskStatus(task.id, "RUNNING");
    this.logEvent(task.id, "state_transition", { from: "QUEUED", to: "RUNNING" });
    const startedAt = Date.now();
    openAgentOsDb().query("UPDATE mobile_tasks SET started_at = ? WHERE id = ?").run(startedAt, task.id);

    try {
      const providerRes = await this.provider.runTask({
        serial: device.providerDeviceId,
        goal: task.goal,
        profile,
        verificationLevel: task.verificationLevel,
        evidence: { screenshot: true, trace: true, hierarchy: true },
      });

      task.providerTaskId = providerRes.providerTaskId;
      task.traceId = providerRes.traceId;

      // Transition to VERIFYING
      this.updateTaskStatus(task.id, "VERIFYING");
      this.logEvent(task.id, "state_transition", { from: "RUNNING", to: "VERIFYING" });

      // Fetch trace and run Reviewer Council evaluation
      const trace = await this.provider.inspectTrace(providerRes.traceId);
      const reviewerEval = this.reviewerCouncil.evaluateTask(task, trace);

      // Persist artifact records
      if (trace) {
        this.saveArtifact(task.id, "trace", `trace:${trace.traceId}`, JSON.stringify(trace));
      }

      const finishedAt = Date.now();
      const finalSummary = {
        ...providerRes.resultSummary,
        reviewerEvaluation: reviewerEval,
      };

      const finalStatus: MobileTaskStatus = reviewerEval.decision === "FAIL" ? "FAILED" : "COMPLETED";

      openAgentOsDb()
        .query(`
          UPDATE mobile_tasks
          SET status = ?, provider_task_id = ?, trace_id = ?,
              result_summary_json = ?, finished_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          finalStatus,
          task.providerTaskId,
          task.traceId,
          JSON.stringify(finalSummary),
          finishedAt,
          finishedAt,
          task.id,
        );

      this.logEvent(task.id, "state_transition", { from: "VERIFYING", to: finalStatus });
      this.deviceRegistry.updateHeartbeat(device.id);

      task.status = finalStatus;
      task.resultSummary = finalSummary;
      task.finishedAt = finishedAt;

      return task;
    } catch (err: any) {
      const finishedAt = Date.now();
      this.updateTaskStatus(task.id, "PROVIDER_ERROR", err.message || "Provider error");
      this.logEvent(task.id, "provider_error", { error: err.message });
      task.status = "PROVIDER_ERROR";
      task.errorMessage = err.message;
      task.finishedAt = finishedAt;
      return task;
    }
  }

  private resolveProfile(profile: TaskProfile, risk: string, requiresPro: boolean): "flash" | "pro" {
    if (requiresPro || risk === "R3" || profile === "pro") return "pro";
    return "flash";
  }

  private updateTaskStatus(taskId: string, status: MobileTaskStatus, errorMessage?: string): void {
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      UPDATE mobile_tasks
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage || null, now, taskId);
  }

  private logEvent(taskId: string, eventType: string, payload: Record<string, unknown>): void {
    const db = openAgentOsDb();
    const id = `mevt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.query(`
      INSERT INTO mobile_task_events (id, task_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, taskId, eventType, JSON.stringify(payload), Date.now());
  }

  private saveArtifact(taskId: string, artifactType: "screenshot" | "trace" | "hierarchy" | "report", storageKey: string, content: string): void {
    const db = openAgentOsDb();
    const id = `mart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    const sha256 = hasher.digest("hex");

    db.query(`
      INSERT INTO mobile_artifacts (id, task_id, artifact_type, storage_key, sha256, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, taskId, artifactType, storageKey, sha256, "application/json", Buffer.byteLength(content), Date.now());
  }

  public getTask(id: string): MobileTask | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM mobile_tasks WHERE id = ? LIMIT 1").get(id) as any;
    if (!row) return null;
    return this.mapTaskRow(row);
  }

  public listTasks(limit = 50): MobileTask[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM mobile_tasks ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => this.mapTaskRow(r));
  }

  public getTaskEvents(taskId: string): MobileTaskEvent[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM mobile_task_events WHERE task_id = ? ORDER BY created_at ASC").all(taskId) as any[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json || "{}"),
      createdAt: r.created_at,
    }));
  }

  public getTaskArtifacts(taskId: string): MobileArtifact[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM mobile_artifacts WHERE task_id = ? ORDER BY created_at ASC").all(taskId) as any[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      artifactType: r.artifact_type,
      storageKey: r.storage_key,
      sha256: r.sha256,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    }));
  }

  public async getTrace(taskId: string): Promise<MobileTrace | null> {
    const task = this.getTask(taskId);
    if (!task || !task.traceId) return null;
    return await this.provider.inspectTrace(task.traceId);
  }

  private insertTask(data: Partial<MobileTask> & { id: string; deviceId: string; goal: string; createdAt: number; updatedAt: number }): MobileTask {
    const db = openAgentOsDb();
    const task: MobileTask = {
      id: data.id,
      deviceId: data.deviceId,
      goal: data.goal,
      profile: data.profile || "auto",
      resolvedProfile: data.resolvedProfile,
      verificationLevel: data.verificationLevel || "final",
      riskLevel: data.riskLevel || "R1",
      status: data.status || "NEW",
      providerTaskId: data.providerTaskId,
      traceId: data.traceId,
      requestedByType: data.requestedByType || "agent",
      requestedById: data.requestedById || "codex",
      approvedBy: data.approvedBy,
      errorMessage: data.errorMessage,
      resultSummary: data.resultSummary || {},
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };

    db.query(`
      INSERT INTO mobile_tasks (
        id, device_id, goal, profile, verification_level, risk_level, status,
        provider_task_id, trace_id, requested_by_type, requested_by_id, approved_by,
        error_message, result_summary_json, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.deviceId,
      task.goal,
      task.profile,
      task.verificationLevel,
      task.riskLevel,
      task.status,
      task.providerTaskId || null,
      task.traceId || null,
      task.requestedByType,
      task.requestedById,
      task.approvedBy || null,
      task.errorMessage || null,
      JSON.stringify(task.resultSummary || {}),
      task.startedAt || null,
      task.finishedAt || null,
      task.createdAt,
      task.updatedAt,
    );

    return task;
  }

  private mapTaskRow(row: any): MobileTask {
    return {
      id: row.id,
      deviceId: row.device_id,
      goal: row.goal,
      profile: row.profile,
      verificationLevel: row.verification_level,
      riskLevel: row.risk_level,
      status: row.status,
      providerTaskId: row.provider_task_id,
      traceId: row.trace_id,
      requestedByType: row.requested_by_type,
      requestedById: row.requested_by_id,
      approvedBy: row.approved_by,
      errorMessage: row.error_message,
      resultSummary: JSON.parse(row.result_summary_json || "{}"),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let taskManagerInstance: MobileTaskManager | null = null;
export function getMobileTaskManager(): MobileTaskManager {
  if (!taskManagerInstance) {
    taskManagerInstance = new MobileTaskManager();
  }
  return taskManagerInstance;
}

export function resetMobileTaskManagerForTests(): void {
  taskManagerInstance = null;
}
