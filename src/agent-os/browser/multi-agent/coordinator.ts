// Phase 20.13 — Pao-hubPro Browser Multi-Agent Web Operations Coordinator
//
// Orchestrates multi-agent missions across specialized browser personas:
// Research, Metadata, Upload, QA, and Reviewer Council with full lifecycle persistence,
// cross-agent handshakes, audit trails, and Human Supervisor Gates.

import { openAgentOsDb } from "../../db";
import { ResearchWebAgent } from "./agents/research-agent";
import { MetadataWebAgent } from "./agents/metadata-agent";
import { UploadWebAgent } from "./agents/upload-agent";
import { QAWebAgent } from "./agents/qa-agent";
import { ReviewerWebAgent } from "./agents/reviewer-agent";
import type {
  AgentDispatch,
  AgentRole,
  ApprovalProposal,
  HandshakeArtifactType,
  MetadataPayload,
  MissionStatus,
  MultiAgentMission,
  QAEvaluation,
  ResearchBrief,
  UploadJob,
  WebHandshake,
} from "./types";

export class BrowserMultiAgentCoordinator {
  private researchAgent: ResearchWebAgent;
  private metadataAgent: MetadataWebAgent;
  private uploadAgent: UploadWebAgent;
  private qaAgent: QAWebAgent;
  private reviewerAgent: ReviewerWebAgent;

  constructor() {
    this.researchAgent = new ResearchWebAgent();
    this.metadataAgent = new MetadataWebAgent();
    this.uploadAgent = new UploadWebAgent();
    this.qaAgent = new QAWebAgent();
    this.reviewerAgent = new ReviewerWebAgent();
  }

  // =========================================================================
  // Mission Lifecycle Management
  // =========================================================================

  /**
   * Creates and persists a new multi-agent web operations mission.
   */
  public createMission(options: {
    name: string;
    targetDomain: string;
    goal: string;
    assignedAgents?: AgentRole[];
    contextData?: Record<string, unknown>;
    evidencePackId?: string;
  }): MultiAgentMission {
    const id = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const assigned = options.assignedAgents || [
      "researcher",
      "metadata",
      "uploader",
      "qa",
      "reviewer",
    ];
    const context = options.contextData || {};

    const mission: MultiAgentMission = {
      id,
      name: options.name,
      targetDomain: options.targetDomain,
      goal: options.goal,
      status: "pending",
      assignedAgents: assigned,
      contextData: context,
      evidencePackId: options.evidencePackId,
      createdAt: now,
      updatedAt: now,
    };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_multi_agent_missions (
        id, name, target_domain, goal, status,
        assigned_agents_json, context_data_json, evidence_pack_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mission.id,
      mission.name,
      mission.targetDomain,
      mission.goal,
      mission.status,
      JSON.stringify(mission.assignedAgents),
      JSON.stringify(mission.contextData),
      mission.evidencePackId || null,
      mission.createdAt,
      mission.updatedAt,
    );

    return mission;
  }

  /**
   * Fetches a mission by ID.
   */
  public getMission(id: string): MultiAgentMission | null {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM browser_multi_agent_missions WHERE id = ? LIMIT 1")
      .get(id) as Record<string, unknown> | null;

    if (!row) return null;

    let assignedAgents: AgentRole[] = [];
    let contextData: Record<string, unknown> = {};

    try {
      assignedAgents = JSON.parse(String(row.assigned_agents_json || "[]"));
    } catch {
      assignedAgents = [];
    }

    try {
      contextData = JSON.parse(String(row.context_data_json || "{}"));
    } catch {
      contextData = {};
    }

    return {
      id: String(row.id),
      name: String(row.name),
      targetDomain: String(row.target_domain),
      goal: String(row.goal),
      status: row.status as MissionStatus,
      assignedAgents,
      contextData,
      evidencePackId: row.evidence_pack_id ? String(row.evidence_pack_id) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  /**
   * Lists missions filtered by target domain or status.
   */
  public listMissions(filter?: {
    targetDomain?: string;
    status?: MissionStatus;
    limit?: number;
  }): MultiAgentMission[] {
    const db = openAgentOsDb();
    const limit = filter?.limit || 50;
    let query = "SELECT * FROM browser_multi_agent_missions WHERE 1=1";
    const params: (string | number)[] = [];

    if (filter?.targetDomain) {
      query += " AND target_domain = ?";
      params.push(filter.targetDomain);
    }
    if (filter?.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...params) as Record<string, unknown>[];

    return rows.map((row) => {
      let assignedAgents: AgentRole[] = [];
      let contextData: Record<string, unknown> = {};
      try {
        assignedAgents = JSON.parse(String(row.assigned_agents_json || "[]"));
      } catch {
        assignedAgents = [];
      }
      try {
        contextData = JSON.parse(String(row.context_data_json || "{}"));
      } catch {
        contextData = {};
      }

      return {
        id: String(row.id),
        name: String(row.name),
        targetDomain: String(row.target_domain),
        goal: String(row.goal),
        status: row.status as MissionStatus,
        assignedAgents,
        contextData,
        evidencePackId: row.evidence_pack_id ? String(row.evidence_pack_id) : undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    });
  }

  /**
   * Updates mission status and context data.
   */
  public updateMissionStatus(
    id: string,
    status: MissionStatus,
    newContext?: Record<string, unknown>,
  ): MultiAgentMission {
    const existing = this.getMission(id);
    if (!existing) {
      throw new Error(`MISSION_NOT_FOUND: Mission '${id}' does not exist.`);
    }

    const mergedContext = newContext
      ? { ...existing.contextData, ...newContext }
      : existing.contextData;
    const now = Date.now();

    const db = openAgentOsDb();
    db.query(`
      UPDATE browser_multi_agent_missions
      SET status = ?, context_data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(status, JSON.stringify(mergedContext), now, id);

    return {
      ...existing,
      status,
      contextData: mergedContext,
      updatedAt: now,
    };
  }

  /**
   * Pauses an active mission.
   */
  public pauseMission(id: string, reason = "Manual pause by supervisor"): MultiAgentMission {
    return this.updateMissionStatus(id, "pending", { pauseReason: reason, pausedAt: Date.now() });
  }

  /**
   * Resumes a paused mission.
   */
  public resumeMission(id: string): MultiAgentMission {
    return this.updateMissionStatus(id, "executing", { resumedAt: Date.now() });
  }

  /**
   * Cancels a mission.
   */
  public cancelMission(id: string, reason = "Cancelled by supervisor"): MultiAgentMission {
    return this.updateMissionStatus(id, "cancelled", {
      cancelReason: reason,
      cancelledAt: Date.now(),
    });
  }

  /**
   * Deletes a mission and cascades associated dispatches, handshakes, and QA evaluations.
   */
  public deleteMission(id: string): boolean {
    const db = openAgentOsDb();
    db.query("DELETE FROM browser_multi_agent_missions WHERE id = ?").run(id);
    return true;
  }

  // =========================================================================
  // Dispatch Tracking
  // =========================================================================

  /**
   * Creates and registers a new agent dispatch.
   */
  public createDispatch(options: {
    missionId: string;
    agentRole: AgentRole;
    tabId?: string;
    inputPayload?: Record<string, unknown>;
  }): AgentDispatch {
    const id = `dsp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const input = options.inputPayload || {};

    const dispatch: AgentDispatch = {
      id,
      missionId: options.missionId,
      agentRole: options.agentRole,
      status: "running",
      tabId: options.tabId,
      inputPayload: input,
      outputPayload: {},
      durationMs: 0,
      createdAt: now,
    };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_agent_dispatches (
        id, mission_id, agent_role, status, tab_id,
        input_payload_json, output_payload_json, error, duration_ms,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dispatch.id,
      dispatch.missionId,
      dispatch.agentRole,
      dispatch.status,
      dispatch.tabId || null,
      JSON.stringify(dispatch.inputPayload),
      JSON.stringify(dispatch.outputPayload),
      null,
      0,
      dispatch.createdAt,
      null,
    );

    return dispatch;
  }

  /**
   * Completes an agent dispatch.
   */
  public completeDispatch(
    id: string,
    outputPayload: Record<string, unknown>,
    durationMs: number,
  ): void {
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      UPDATE browser_agent_dispatches
      SET status = 'completed', output_payload_json = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(outputPayload), durationMs, now, id);
  }

  /**
   * Fails an agent dispatch with error message.
   */
  public failDispatch(id: string, error: string, durationMs: number): void {
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      UPDATE browser_agent_dispatches
      SET status = 'failed', error = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(error, durationMs, now, id);
  }

  /**
   * Lists all dispatches recorded for a given mission.
   */
  public listDispatches(missionId: string): AgentDispatch[] {
    const db = openAgentOsDb();
    const rows = db
      .query(
        "SELECT * FROM browser_agent_dispatches WHERE mission_id = ? ORDER BY created_at ASC",
      )
      .all(missionId) as Record<string, unknown>[];

    return rows.map((r) => {
      let inputPayload: Record<string, unknown> = {};
      let outputPayload: Record<string, unknown> = {};
      try {
        inputPayload = JSON.parse(String(r.input_payload_json || "{}"));
      } catch {
        inputPayload = {};
      }
      try {
        outputPayload = JSON.parse(String(r.output_payload_json || "{}"));
      } catch {
        outputPayload = {};
      }

      return {
        id: String(r.id),
        missionId: String(r.mission_id),
        agentRole: r.agent_role as AgentRole,
        status: r.status as any,
        tabId: r.tab_id ? String(r.tab_id) : undefined,
        inputPayload,
        outputPayload,
        error: r.error ? String(r.error) : undefined,
        durationMs: Number(r.duration_ms || 0),
        createdAt: Number(r.created_at),
        completedAt: r.completed_at ? Number(r.completed_at) : undefined,
      };
    });
  }

  // =========================================================================
  // Cross-Agent Handshakes
  // =========================================================================

  /**
   * Sends and records a cross-agent handshake artifact.
   */
  public sendHandshake(options: {
    missionId: string;
    fromAgent: AgentRole;
    toAgent: AgentRole;
    artifactType: HandshakeArtifactType;
    payload: Record<string, unknown>;
  }): WebHandshake {
    const id = `hnd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const handshake: WebHandshake = {
      id,
      missionId: options.missionId,
      fromAgent: options.fromAgent,
      toAgent: options.toAgent,
      artifactType: options.artifactType,
      payload: options.payload,
      createdAt: now,
    };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_web_handshakes (
        id, mission_id, from_agent, to_agent, artifact_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      handshake.id,
      handshake.missionId,
      handshake.fromAgent,
      handshake.toAgent,
      handshake.artifactType,
      JSON.stringify(handshake.payload),
      handshake.createdAt,
    );

    return handshake;
  }

  /**
   * Retrieves all handshakes for a mission.
   */
  public getHandshakes(missionId: string): WebHandshake[] {
    const db = openAgentOsDb();
    const rows = db
      .query(
        "SELECT * FROM browser_web_handshakes WHERE mission_id = ? ORDER BY created_at ASC",
      )
      .all(missionId) as Record<string, unknown>[];

    return rows.map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(r.payload_json || "{}"));
      } catch {
        payload = {};
      }

      return {
        id: String(r.id),
        missionId: String(r.mission_id),
        fromAgent: r.from_agent as AgentRole,
        toAgent: r.to_agent as AgentRole,
        artifactType: r.artifact_type as HandshakeArtifactType,
        payload,
        createdAt: Number(r.created_at),
      };
    });
  }

  // =========================================================================
  // QA Evaluations
  // =========================================================================

  /**
   * Records a QA evaluation into the database.
   */
  public recordQAEvaluation(evaluation: QAEvaluation): void {
    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_qa_evaluations (
        id, mission_id, step_index, url, screenshot_b64,
        checks_json, verdict, issues_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        step_index = excluded.step_index,
        url = excluded.url,
        screenshot_b64 = excluded.screenshot_b64,
        checks_json = excluded.checks_json,
        verdict = excluded.verdict,
        issues_json = excluded.issues_json,
        created_at = excluded.created_at
    `).run(
      evaluation.id,
      evaluation.missionId,
      evaluation.stepIndex,
      evaluation.url,
      evaluation.screenshotB64 || null,
      JSON.stringify(evaluation.checks),
      evaluation.verdict,
      JSON.stringify(evaluation.issues),
      evaluation.createdAt,
    );
  }

  /**
   * Retrieves all QA evaluations for a mission.
   */
  public getQAEvaluations(missionId: string): QAEvaluation[] {
    const db = openAgentOsDb();
    const rows = db
      .query(
        "SELECT * FROM browser_qa_evaluations WHERE mission_id = ? ORDER BY step_index ASC, created_at ASC",
      )
      .all(missionId) as Record<string, unknown>[];

    return rows.map((r) => {
      let checks: any[] = [];
      let issues: string[] = [];
      try {
        checks = JSON.parse(String(r.checks_json || "[]"));
      } catch {
        checks = [];
      }
      try {
        issues = JSON.parse(String(r.issues_json || "[]"));
      } catch {
        issues = [];
      }

      return {
        id: String(r.id),
        missionId: String(r.mission_id),
        stepIndex: Number(r.step_index || 0),
        url: String(r.url),
        screenshotB64: r.screenshot_b64 ? String(r.screenshot_b64) : undefined,
        checks,
        verdict: r.verdict as any,
        issues,
        createdAt: Number(r.created_at),
      };
    });
  }

  // =========================================================================
  // Coordinated Operations Pipeline
  // =========================================================================

  /**
   * Executes the research step using the ResearchWebAgent.
   */
  public async runResearchStep(
    missionId: string,
    url: string,
    topic?: string,
    tabId?: string,
  ): Promise<ResearchBrief> {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const start = Date.now();
    const dispatch = this.createDispatch({
      missionId,
      agentRole: "researcher",
      tabId,
      inputPayload: { url, topic },
    });

    try {
      this.updateMissionStatus(missionId, "researching");
      const brief = await this.researchAgent.conductResearch(url, topic, tabId);
      const duration = Date.now() - start;

      this.completeDispatch(dispatch.id, brief as unknown as Record<string, unknown>, duration);

      // Handshake to metadata agent
      this.sendHandshake({
        missionId,
        fromAgent: "researcher",
        toAgent: "metadata",
        artifactType: "research_brief",
        payload: brief as unknown as Record<string, unknown>,
      });

      this.updateMissionStatus(missionId, "drafting", { researchBrief: brief });
      return brief;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.failDispatch(dispatch.id, err.message, duration);
      this.updateMissionStatus(missionId, "failed", { error: err.message });
      throw err;
    }
  }

  /**
   * Executes the metadata synthesis step using the MetadataWebAgent.
   */
  public async runMetadataStep(
    missionId: string,
    assetConcept: string,
    options?: { maxKeywords?: number; category?: string; autofillTabId?: string },
  ): Promise<MetadataPayload> {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const start = Date.now();
    const dispatch = this.createDispatch({
      missionId,
      agentRole: "metadata",
      tabId: options?.autofillTabId,
      inputPayload: { assetConcept, options },
    });

    try {
      this.updateMissionStatus(missionId, "drafting");

      // Check if research brief exists from previous handshakes
      const handshakes = this.getHandshakes(missionId);
      const researchHandshake = handshakes.find((h) => h.artifactType === "research_brief");
      const research = researchHandshake ? (researchHandshake.payload as unknown as ResearchBrief) : undefined;

      const payload = this.metadataAgent.generateMetadata(assetConcept, research, options);

      // If autofill tab specified, autofill into DOM
      if (options?.autofillTabId) {
        await this.metadataAgent.autofillForm(payload, options.autofillTabId);
      }

      const duration = Date.now() - start;
      this.completeDispatch(dispatch.id, payload as unknown as Record<string, unknown>, duration);

      // Handshake to coordinator and reviewer
      this.sendHandshake({
        missionId,
        fromAgent: "metadata",
        toAgent: "reviewer",
        artifactType: "metadata_payload",
        payload: payload as unknown as Record<string, unknown>,
      });

      this.updateMissionStatus(missionId, "drafting", { metadataPayload: payload });
      return payload;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.failDispatch(dispatch.id, err.message, duration);
      this.updateMissionStatus(missionId, "failed", { error: err.message });
      throw err;
    }
  }

  /**
   * Executes the asset upload step using the UploadWebAgent.
   */
  public async runUploadStep(
    missionId: string,
    filePaths: string[],
    targetSelector?: string,
    tabId?: string,
  ): Promise<UploadJob> {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const start = Date.now();
    const dispatch = this.createDispatch({
      missionId,
      agentRole: "uploader",
      tabId,
      inputPayload: { filePaths, targetSelector },
    });

    try {
      this.updateMissionStatus(missionId, "uploading");
      const job = await this.uploadAgent.executeUpload(filePaths, targetSelector, tabId);
      const duration = Date.now() - start;

      this.completeDispatch(dispatch.id, job as unknown as Record<string, unknown>, duration);

      this.sendHandshake({
        missionId,
        fromAgent: "uploader",
        toAgent: "qa",
        artifactType: "upload_receipt",
        payload: job as unknown as Record<string, unknown>,
      });

      this.updateMissionStatus(missionId, "qa_evaluating", { uploadJob: job });
      return job;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.failDispatch(dispatch.id, err.message, duration);
      this.updateMissionStatus(missionId, "failed", { error: err.message });
      throw err;
    }
  }

  /**
   * Executes the QA evaluation step using the QAWebAgent.
   */
  public async runQAStep(
    missionId: string,
    stepIndex = 1,
    tabId?: string,
  ): Promise<QAEvaluation> {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const start = Date.now();
    const dispatch = this.createDispatch({
      missionId,
      agentRole: "qa",
      tabId,
      inputPayload: { stepIndex },
    });

    try {
      this.updateMissionStatus(missionId, "qa_evaluating");
      const evaluation = await this.qaAgent.evaluateFormState(missionId, stepIndex, tabId);
      this.recordQAEvaluation(evaluation);
      const duration = Date.now() - start;

      this.completeDispatch(dispatch.id, evaluation as unknown as Record<string, unknown>, duration);

      this.sendHandshake({
        missionId,
        fromAgent: "qa",
        toAgent: "reviewer",
        artifactType: "qa_report",
        payload: evaluation as unknown as Record<string, unknown>,
      });

      this.updateMissionStatus(missionId, "awaiting_approval", { qaEvaluation: evaluation });
      return evaluation;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.failDispatch(dispatch.id, err.message, duration);
      this.updateMissionStatus(missionId, "failed", { error: err.message });
      throw err;
    }
  }

  /**
   * Executes the review and proposal formulation step using the ReviewerWebAgent.
   */
  public async runReviewStep(
    missionId: string,
    action: string,
    url: string,
    affectedData: Record<string, unknown>,
  ): Promise<ApprovalProposal> {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const start = Date.now();
    const dispatch = this.createDispatch({
      missionId,
      agentRole: "reviewer",
      inputPayload: { action, url, affectedData },
    });

    try {
      // Fetch latest QA report if available
      const qaList = this.getQAEvaluations(missionId);
      const latestQa = qaList.length > 0 ? qaList[qaList.length - 1] : undefined;

      const proposal = this.reviewerAgent.evaluateAction(action, url, affectedData, latestQa);
      const duration = Date.now() - start;

      this.completeDispatch(dispatch.id, proposal as unknown as Record<string, unknown>, duration);

      this.sendHandshake({
        missionId,
        fromAgent: "reviewer",
        toAgent: "coordinator",
        artifactType: "approval_proposal",
        payload: proposal as unknown as Record<string, unknown>,
      });

      this.updateMissionStatus(missionId, "awaiting_approval", { approvalProposal: proposal });
      return proposal;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.failDispatch(dispatch.id, err.message, duration);
      this.updateMissionStatus(missionId, "failed", { error: err.message });
      throw err;
    }
  }

  /**
   * Records human supervisor decision on a mission awaiting approval.
   */
  public submitApproval(
    missionId: string,
    decision: "approve" | "reject" | "stop_agent",
    scope: "once" | "session" = "once",
  ): MultiAgentMission {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    const now = Date.now();
    if (decision === "approve") {
      return this.updateMissionStatus(missionId, "completed", {
        approvalDecision: "approved",
        approvalScope: scope,
        approvedAt: now,
      });
    } else if (decision === "stop_agent") {
      return this.updateMissionStatus(missionId, "cancelled", {
        approvalDecision: "stopped",
        stopReason: "Human supervisor emergency stop",
        stoppedAt: now,
      });
    } else {
      return this.updateMissionStatus(missionId, "failed", {
        approvalDecision: "rejected",
        rejectedAt: now,
      });
    }
  }

  /**
   * Orchestrates an entire multi-agent web operation end-to-end.
   */
  public async executeFullMission(
    missionId: string,
    options: {
      url: string;
      assetConcept: string;
      files?: string[];
      targetSelector?: string;
      tabId?: string;
    },
  ): Promise<{
    mission: MultiAgentMission;
    research: ResearchBrief;
    metadata: MetadataPayload;
    upload?: UploadJob;
    qa: QAEvaluation;
    proposal: ApprovalProposal;
  }> {
    // 1. Research Step
    const research = await this.runResearchStep(
      missionId,
      options.url,
      options.assetConcept,
      options.tabId,
    );

    // 2. Metadata Step (with autofill)
    const metadata = await this.runMetadataStep(missionId, options.assetConcept, {
      autofillTabId: options.tabId,
    });

    // 3. Upload Step (if files provided)
    let upload: UploadJob | undefined;
    if (options.files && options.files.length > 0) {
      upload = await this.runUploadStep(
        missionId,
        options.files,
        options.targetSelector,
        options.tabId,
      );
    }

    // 4. QA Audit Step
    const qa = await this.runQAStep(missionId, 1, options.tabId);

    // 5. Reviewer Council Audit & Approval Proposal
    const proposal = await this.runReviewStep(
      missionId,
      "submit_asset_listing",
      options.url,
      {
        title: metadata.title,
        keywordsCount: metadata.keywords.length,
        filesCount: options.files?.length || 0,
      },
    );

    const updatedMission = this.getMission(missionId)!;

    return {
      mission: updatedMission,
      research,
      metadata,
      upload,
      qa,
      proposal,
    };
  }
}

let coordinatorInstance: BrowserMultiAgentCoordinator | null = null;

export function getBrowserMultiAgentCoordinator(): BrowserMultiAgentCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new BrowserMultiAgentCoordinator();
  }
  return coordinatorInstance;
}
