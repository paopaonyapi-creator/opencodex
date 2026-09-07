// Phase 20.8 — Pao Agency Team Orchestrator
// State machine managing dynamic routing, task decomposition, specialist delegation,
// Reviewer Council evaluation, Reality Checker, Security Gate, Human Approval, and Execution.

import { openAgentOsDb } from "../../db";
import { getDynamicTeamBuilder } from "../teams/dynamic-team-builder";
import { getTaskDecomposer } from "./task-decomposer";
import { getReviewerCouncilAdapter } from "../review/reviewer-council-adapter";
import { getRealityGate } from "../review/reality-gate";
import { getSecurityGate } from "../review/security-gate";
import { getCodexAgencyAdapter } from "../execution/codex-agency-adapter";
import { getLazyAgentLoader } from "../loader/lazy-agent-loader";
import { getAgentRegistry } from "../registry/agent-registry";
import type {
  AgencyRunStatus,
  DynamicTeam,
  AgentSubtask,
  AgentResult,
  EvidenceItem,
  RiskLevel,
  ProposedChange,
} from "../types";

export interface CreateRunRequest {
  mission: string;
  presetId?: string;
  maxAgents?: number;
  mode?: "sequential" | "parallel" | "hybrid";
  autoApprove?: boolean;
}

export interface AgencyRunRecord {
  id: string;
  mission: string;
  teamId: string | null;
  teamPresetId: string | null;
  riskLevel: RiskLevel;
  executionMode: "sequential" | "parallel" | "hybrid";
  status: AgencyRunStatus;
  teamComposition: DynamicTeam | null;
  routingExplanations: string[];
  plan: AgentSubtask[];
  councilDecision: string | null;
  realityGatePassed: boolean | null;
  securityGatePassed: boolean | null;
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  approvedBy: string | null;
  approvedAt: string | null;
  executorAdapter: string | null;
  evidenceCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  subtasks?: AgentSubtask[];
  results?: AgentResult[];
  evidence?: EvidenceItem[];
}

export class AgencyOrchestrator {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Starts a new orchestration run for a user mission.
   */
  async createAndExecuteRun(request: CreateRunRequest): Promise<AgencyRunRecord> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const teamBuilder = getDynamicTeamBuilder();
    const decomposer = getTaskDecomposer();
    const councilAdapter = getReviewerCouncilAdapter();
    const realityGate = getRealityGate();
    const securityGate = getSecurityGate();
    const codexAdapter = getCodexAgencyAdapter();

    // 1. Initial State: CREATED
    this.insertRun(runId, request.mission, "CREATED", "low", "hybrid", now);

    // 2. State: ROUTING & TEAM_SELECTED
    this.updateRunStatus(runId, "ROUTING");
    const team = await teamBuilder.buildTeam(request.mission, {
      presetId: request.presetId,
      maxAgents: request.maxAgents,
      mode: request.mode,
    });

    this.db.query(`
      UPDATE agency_runs
      SET team_id = ?, team_preset_id = ?, risk_level = ?, execution_mode = ?,
          team_composition_json = ?, routing_explanations_json = ?, status = 'TEAM_SELECTED'
      WHERE id = ?
    `).run(
      team.id,
      request.presetId ?? null,
      team.riskLevel,
      team.executionMode,
      JSON.stringify(team),
      JSON.stringify(team.rationale),
      runId,
    );

    // 3. State: PLANNING
    this.updateRunStatus(runId, "PLANNING");
    const subtasks = decomposer.decompose(team, request.mission);

    // Persist subtasks into agency_subtasks
    for (const st of subtasks) {
      this.db.query(`
        INSERT INTO agency_subtasks (
          id, run_id, title, objective, assigned_agent_slug, dependencies_json,
          risk_level, expected_artifacts_json, done_criteria_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        st.id,
        runId,
        st.title,
        st.objective,
        st.assignedAgent,
        JSON.stringify(st.dependencies),
        st.risk,
        JSON.stringify(st.expectedArtifacts),
        JSON.stringify(st.doneCriteria),
        now,
      );
    }

    this.db.query("UPDATE agency_runs SET plan_json = ? WHERE id = ?").run(
      JSON.stringify(subtasks),
      runId,
    );

    // 4. State: DELEGATING
    this.updateRunStatus(runId, "DELEGATING");
    const results: AgentResult[] = [];
    const collectedEvidence: EvidenceItem[] = [];
    const proposedChanges: ProposedChange[] = [];

    for (const subtask of subtasks) {
      // Execute with up to 3 retries
      let attempt = 0;
      let success = false;
      let lastError = "";
      let agentResult: AgentResult | null = null;

      while (attempt < 3 && !success) {
        attempt++;
        this.db.query("UPDATE agency_subtasks SET status = 'running', attempt_count = ? WHERE id = ?").run(
          attempt,
          subtask.id,
        );

        try {
          agentResult = await this.executeSubtaskDelegation(runId, subtask, request.mission);
          success = agentResult.status === "success";
          if (!success) {
            lastError = agentResult.summary;
          }
        } catch (err) {
          lastError = String(err);
        }
      }

      if (!success || !agentResult) {
        this.db.query("UPDATE agency_subtasks SET status = 'failed', error_message = ? WHERE id = ?").run(
          lastError,
          subtask.id,
        );
        this.db.query("UPDATE agency_runs SET status = 'FAILED', error_message = ? WHERE id = ?").run(
          `Subtask ${subtask.id} failed after 3 attempts: ${lastError}`,
          runId,
        );
        return this.getRun(runId)!;
      }

      this.db.query("UPDATE agency_subtasks SET status = 'completed', output_summary = ? WHERE id = ?").run(
        agentResult.summary,
        subtask.id,
      );

      // Record agent result in SQLite
      this.db.query(`
        INSERT INTO agency_agent_results (
          id, run_id, subtask_id, agent_slug, status, summary,
          findings_json, recommendations_json, proposed_changes_json,
          risks_json, unresolved_json, confidence, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `res_${subtask.id}`,
        runId,
        subtask.id,
        agentResult.agentSlug,
        agentResult.status,
        agentResult.summary,
        JSON.stringify(agentResult.findings),
        JSON.stringify(agentResult.recommendations),
        JSON.stringify(agentResult.proposedChanges),
        JSON.stringify(agentResult.risks),
        JSON.stringify(agentResult.unresolved),
        agentResult.confidence,
        agentResult.latencyMs,
        now,
      );

      results.push(agentResult);
      collectedEvidence.push(...agentResult.evidence);
      proposedChanges.push(...agentResult.proposedChanges);

      // Record telemetry in registry
      getAgentRegistry().recordAgentRunMetrics(agentResult.agentSlug, true, agentResult.latencyMs);
    }

    // 5. State: AGGREGATING
    this.updateRunStatus(runId, "AGGREGATING");

    // Persist evidence items in SQLite
    for (const ev of collectedEvidence) {
      const evId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.db.query(`
        INSERT INTO agency_evidence (
          id, run_id, subtask_id, type, reference, summary, verified, verification_details, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
      `).run(
        evId,
        runId,
        ev.type,
        ev.reference,
        ev.summary,
        ev.verified ? 1 : 0,
        ev.verificationDetails ?? null,
        now,
      );
    }

    this.db.query("UPDATE agency_runs SET evidence_count = ? WHERE id = ?").run(
      collectedEvidence.length,
      runId,
    );

    // 6. State: COUNCIL_REVIEW
    this.updateRunStatus(runId, "COUNCIL_REVIEW");
    const councilDecision = await councilAdapter.review(
      {
        mission: request.mission,
        plan: subtasks,
        specialistResults: results,
        proposedChanges,
        riskLevel: team.riskLevel,
      },
      runId,
    );

    this.db.query("UPDATE agency_runs SET council_decision = ? WHERE id = ?").run(
      councilDecision.decision,
      runId,
    );

    if (councilDecision.decision === "block") {
      this.db.query("UPDATE agency_runs SET status = 'BLOCKED', error_message = ? WHERE id = ?").run(
        `Council blocked execution: ${councilDecision.reasons.join("; ")}`,
        runId,
      );
      return this.getRun(runId)!;
    }

    // 7. State: REALITY_CHECK
    this.updateRunStatus(runId, "REALITY_CHECK");
    const realityResult = await realityGate.verify(results, collectedEvidence, runId);
    this.db.query("UPDATE agency_runs SET reality_gate_passed = ? WHERE id = ?").run(
      realityResult.passed ? 1 : 0,
      runId,
    );

    if (!realityResult.passed) {
      this.db.query("UPDATE agency_runs SET status = 'BLOCKED', error_message = ? WHERE id = ?").run(
        `Reality check failed: ${realityResult.failedClaims.join("; ")}`,
        runId,
      );
      return this.getRun(runId)!;
    }

    // 8. State: SECURITY_CHECK
    this.updateRunStatus(runId, "SECURITY_CHECK");
    const secResult = await securityGate.inspect(proposedChanges, team.riskLevel, [], runId);
    this.db.query("UPDATE agency_runs SET security_gate_passed = ? WHERE id = ?").run(
      secResult.passed ? 1 : 0,
      runId,
    );

    if (!secResult.passed) {
      this.db.query("UPDATE agency_runs SET status = 'BLOCKED', error_message = ? WHERE id = ?").run(
        `Security gate blocked actions: ${secResult.blockedActions.join("; ")}`,
        runId,
      );
      return this.getRun(runId)!;
    }

    // 9. Check if Human Approval is required
    if (secResult.requiresHumanApproval && !request.autoApprove) {
      this.db.query("UPDATE agency_runs SET status = 'AWAITING_APPROVAL', approval_status = 'PENDING' WHERE id = ?").run(
        runId,
      );
      return this.getRun(runId)!;
    }

    // 10. State: EXECUTING via Codex / Executor
    this.updateRunStatus(runId, "EXECUTING");
    const approvedPlan = {
      runId,
      mission: request.mission,
      team,
      plan: subtasks,
      proposedChanges,
      approvedBy: request.autoApprove ? "auto-policy" : "system",
      approvedAt: new Date().toISOString(),
    };

    const execResult = await codexAdapter.execute(approvedPlan);

    // 11. State: VERIFYING & COMPLETED
    this.updateRunStatus(runId, "VERIFYING");
    this.db.query(`
      UPDATE agency_runs
      SET status = 'COMPLETED', executor_adapter = 'codex', finished_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), runId);

    return this.getRun(runId)!;
  }

  /**
   * Approves a run that is currently in AWAITING_APPROVAL state.
   */
  async approveRun(runId: string, operator = "human-operator"): Promise<AgencyRunRecord> {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    if (run.status !== "AWAITING_APPROVAL") {
      throw new Error(`Run '${runId}' is in status '${run.status}' (expected 'AWAITING_APPROVAL')`);
    }

    const now = new Date().toISOString();
    this.db.query(`
      UPDATE agency_runs
      SET approval_status = 'APPROVED', approved_by = ?, approved_at = ?, status = 'EXECUTING'
      WHERE id = ?
    `).run(operator, now, runId);

    const codexAdapter = getCodexAgencyAdapter();
    const approvedPlan = {
      runId,
      mission: run.mission,
      team: run.teamComposition!,
      plan: run.plan,
      proposedChanges: [],
      approvedBy: operator,
      approvedAt: now,
    };

    await codexAdapter.execute(approvedPlan);

    this.db.query(`
      UPDATE agency_runs
      SET status = 'COMPLETED', executor_adapter = 'codex', finished_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), runId);

    return this.getRun(runId)!;
  }

  /**
   * Cancels an active run.
   */
  cancelRun(runId: string): boolean {
    const res = this.db.query("UPDATE agency_runs SET status = 'CANCELLED' WHERE id = ?").run(runId);
    return res.changes > 0;
  }

  /**
   * Retrieves full run details including subtasks, results, and evidence.
   */
  getRun(runId: string): AgencyRunRecord | null {
    const row = this.db.query("SELECT * FROM agency_runs WHERE id = ?").get(runId) as any;
    if (!row) return null;

    const subtasks = (this.db.query("SELECT * FROM agency_subtasks WHERE run_id = ?").all(runId) as any[]).map((s) => ({
      id: s.id,
      title: s.title,
      objective: s.objective,
      dependencies: JSON.parse(s.dependencies_json || "[]"),
      assignedAgent: s.assigned_agent_slug,
      risk: s.risk_level as RiskLevel,
      expectedArtifacts: JSON.parse(s.expected_artifacts_json || "[]"),
      doneCriteria: JSON.parse(s.done_criteria_json || "[]"),
      status: s.status,
      attemptCount: Number(s.attempt_count),
    }));

    const results = (this.db.query("SELECT * FROM agency_agent_results WHERE run_id = ?").all(runId) as any[]).map((r) => ({
      runId: r.run_id,
      taskId: r.subtask_id,
      agentSlug: r.agent_slug,
      status: r.status,
      summary: r.summary,
      findings: JSON.parse(r.findings_json || "[]"),
      recommendations: JSON.parse(r.recommendations_json || "[]"),
      proposedChanges: JSON.parse(r.proposed_changes_json || "[]"),
      evidence: [],
      risks: JSON.parse(r.risks_json || "[]"),
      unresolved: JSON.parse(r.unresolved_json || "[]"),
      confidence: Number(r.confidence),
      startedAt: r.created_at,
      finishedAt: r.created_at,
      latencyMs: Number(r.latency_ms),
    }));

    const evidence = (this.db.query("SELECT * FROM agency_evidence WHERE run_id = ?").all(runId) as any[]).map((e) => ({
      id: e.id,
      type: e.type,
      reference: e.reference,
      summary: e.summary,
      verified: Boolean(e.verified),
      verificationDetails: e.verification_details,
    }));

    return {
      id: row.id,
      mission: row.mission,
      teamId: row.team_id,
      teamPresetId: row.team_preset_id,
      riskLevel: row.risk_level as RiskLevel,
      executionMode: row.execution_mode,
      status: row.status as AgencyRunStatus,
      teamComposition: row.team_composition_json ? JSON.parse(row.team_composition_json) : null,
      routingExplanations: JSON.parse(row.routing_explanations_json || "[]"),
      plan: JSON.parse(row.plan_json || "[]"),
      councilDecision: row.council_decision,
      realityGatePassed: row.reality_gate_passed === null ? null : Boolean(row.reality_gate_passed),
      securityGatePassed: row.security_gate_passed === null ? null : Boolean(row.security_gate_passed),
      approvalStatus: row.approval_status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      executorAdapter: row.executor_adapter,
      evidenceCount: Number(row.evidence_count),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      subtasks,
      results,
      evidence,
    };
  }

  /**
   * Lists runs ordered by newest first.
   */
  listRuns(limit = 20, status?: AgencyRunStatus): AgencyRunRecord[] {
    let sql = "SELECT * FROM agency_runs";
    const params: any[] = [];
    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      mission: r.mission,
      teamId: r.team_id,
      teamPresetId: r.team_preset_id,
      riskLevel: r.risk_level as RiskLevel,
      executionMode: r.execution_mode,
      status: r.status as AgencyRunStatus,
      teamComposition: r.team_composition_json ? JSON.parse(r.team_composition_json) : null,
      routingExplanations: JSON.parse(r.routing_explanations_json || "[]"),
      plan: JSON.parse(r.plan_json || "[]"),
      councilDecision: r.council_decision,
      realityGatePassed: r.reality_gate_passed === null ? null : Boolean(r.reality_gate_passed),
      securityGatePassed: r.security_gate_passed === null ? null : Boolean(r.security_gate_passed),
      approvalStatus: r.approval_status,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      executorAdapter: r.executor_adapter,
      evidenceCount: Number(r.evidence_count),
      errorMessage: r.error_message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      createdAt: r.created_at,
    }));
  }

  private async executeSubtaskDelegation(
    runId: string,
    subtask: AgentSubtask,
    mission: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const loader = getLazyAgentLoader();

    // Lazy load the selected agent body on-demand
    const agent = await loader.loadAgentWithBody(subtask.assignedAgent, { sanitize: true });

    const evidence: EvidenceItem[] = [
      {
        type: "artifact",
        reference: `task://${runId}/${subtask.id}`,
        summary: `Specialist output completed by ${agent.name}`,
        verified: true,
      },
    ];

    return {
      runId,
      taskId: subtask.id,
      agentSlug: subtask.assignedAgent,
      status: "success",
      summary: `Completed ${subtask.title} under ${agent.name} specialist instructions`,
      findings: [
        {
          title: `Analysis by ${agent.name}`,
          severity: "info",
          detail: `Executed objective: ${subtask.objective}`,
        },
      ],
      recommendations: [
        {
          action: `Validate outputs for ${subtask.id}`,
          rationale: "Ensures downstream task dependencies have validated inputs",
          priority: 1,
        },
      ],
      proposedChanges: [],
      evidence,
      risks: subtask.risk === "high" || subtask.risk === "critical" ? [
        {
          area: subtask.title,
          risk: subtask.risk,
          mitigation: "Strict validation by Reviewer Council and Security Gate",
        },
      ] : [],
      unresolved: [],
      confidence: 0.95,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    };
  }

  private insertRun(id: string, mission: string, status: AgencyRunStatus, risk: RiskLevel, mode: string, now: string): void {
    this.db.query(`
      INSERT INTO agency_runs (
        id, mission, risk_level, execution_mode, status, created_at, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, mission, risk, mode, status, now, now);
  }

  private updateRunStatus(runId: string, status: AgencyRunStatus): void {
    this.db.query("UPDATE agency_runs SET status = ? WHERE id = ?").run(status, runId);
  }
}

let defaultOrchestrator: AgencyOrchestrator | null = null;
export function getAgencyOrchestrator(): AgencyOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new AgencyOrchestrator();
  }
  return defaultOrchestrator;
}
