// Phase 20.12 — Browser Workflow Execution & Replay Engine
//
// Orchestrates deterministic step execution, runtime parameter templating,
// validation gates, self-healing recovery, checkpoints, and human approval gates.

import { openAgentOsDb } from "../../db";
import { getBrowserBridge } from "../bridge/browser-bridge";
import { getBrowserApprovalManager } from "../security/approval-manager";
import { getWorkflowDslParser } from "./dsl-parser";
import { getWorkflowValidator } from "./validator";
import { getSelfHealingMatcher } from "./self-healing";
import { getCheckpointManager } from "./checkpoint-manager";
import { getTaskMemoryManager } from "./task-memory";
import type {
  StepExecutionStatus,
  StepLog,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStep,
} from "./types";

export class WorkflowExecutor {
  private pausedRuns = new Set<string>();
  private cancelledRuns = new Set<string>();

  /**
   * Runs or resumes a workflow from a given step index.
   */
  public async runWorkflow(
    workflow: WorkflowDefinition,
    initialVariables: Record<string, unknown> = {},
    options?: {
      runId?: string;
      resumeFromStep?: number;
      initiatingAgent?: string;
    },
  ): Promise<WorkflowRun> {
    const db = openAgentOsDb();
    const runId = options?.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const initiatingAgent = options?.initiatingAgent || "codex";

    // Build merged variables with defaults
    const variables: Record<string, unknown> = {};
    if (workflow.parameters) {
      for (const [key, param] of Object.entries(workflow.parameters)) {
        if (param.default !== undefined) {
          variables[key] = param.default;
        }
      }
    }
    Object.assign(variables, initialVariables);

    let startStep = options?.resumeFromStep ?? 0;

    // Ensure parent workflow exists in browser_workflows
    db.query(`
      INSERT INTO browser_workflows (id, name, description, version, dsl_json, parameters_schema_json, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        dsl_json = excluded.dsl_json,
        parameters_schema_json = excluded.parameters_schema_json,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `).run(
      workflow.id,
      workflow.name,
      workflow.description,
      workflow.version,
      JSON.stringify(workflow.steps),
      JSON.stringify(workflow.parameters || {}),
      JSON.stringify(workflow.tags || []),
      workflow.createdAt,
      now,
    );

    // Check if run already exists in DB
    const existing = db
      .query("SELECT * FROM browser_workflow_runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | null;

    if (!existing) {
      db.query(`
        INSERT INTO browser_workflow_runs (id, workflow_id, status, current_step_index, variables_json, checkpoints_json, initiating_agent, created_at, updated_at)
        VALUES (?, ?, 'running', ?, ?, '[]', ?, ?, ?)
      `).run(
        runId,
        workflow.id,
        startStep,
        JSON.stringify(variables),
        initiatingAgent,
        now,
        now,
      );
    } else {
      if (options?.resumeFromStep === undefined) {
        startStep = Number(existing.current_step_index || 0);
      }
      db.query(`
        UPDATE browser_workflow_runs
        SET status = 'running', current_step_index = ?, updated_at = ?
        WHERE id = ?
      `).run(startStep, now, runId);
    }

    this.pausedRuns.delete(runId);
    this.cancelledRuns.delete(runId);

    const bridge = getBrowserBridge();
    const dslParser = getWorkflowDslParser();
    const validator = getWorkflowValidator();
    const selfHealer = getSelfHealingMatcher();
    const checkpointMgr = getCheckpointManager();

    for (let i = startStep; i < workflow.steps.length; i++) {
      // 1. Check for cancel or pause flags
      if (this.cancelledRuns.has(runId)) {
        return this.updateRunStatus(runId, "cancelled", i, variables, "Workflow run cancelled by user.");
      }
      if (this.pausedRuns.has(runId)) {
        return this.updateRunStatus(runId, "paused", i, variables);
      }

      const rawStep = workflow.steps[i];
      const stepStartTime = Date.now();

      // 2. Interpolate step arguments with variables
      const interpolatedArgs = dslParser.interpolate(
        rawStep.arguments || {},
        variables,
      ) as Record<string, unknown>;

      let stepStatus: StepExecutionStatus = "running";
      let stepResult: Record<string, unknown> = {};
      let stepError: string | undefined;
      let validationResult: ReturnType<typeof validator["validateRule"]> | undefined;

      try {
        // 3. Handle step actions
        if (rawStep.action === "approval" || rawStep.action === "human_confirm") {
          const reason = String(interpolatedArgs.reason || `Approval required for step ${rawStep.name}`);
          const approval = await getBrowserApprovalManager().requestApproval(
            initiatingAgent,
            "browser.workflow.approval",
            bridge.getActiveTab()?.url || "workflow://action",
            reason,
            interpolatedArgs,
          );

          if (approval.status === "rejected") {
            throw new Error(`APPROVAL_REJECTED: Supervisor rejected step '${rawStep.name}'.`);
          }
          stepResult = { approved: true, status: approval.status };
          stepStatus = "success";
        } else if (rawStep.action === "checkpoint") {
          const activeTab = bridge.getActiveTab();
          checkpointMgr.saveCheckpoint(
            runId,
            i,
            activeTab?.url || "about:blank",
            variables,
            activeTab?.id,
          );
          stepResult = { checkpointSaved: true, stepIndex: i };
          stepStatus = "success";
        } else if (rawStep.action === "delay" || rawStep.action === "sleep") {
          const ms = Number(interpolatedArgs.ms || interpolatedArgs.duration || 1000);
          await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10000)));
          stepResult = { delayedMs: ms };
          stepStatus = "success";
        } else if (rawStep.action === "set_variable") {
          Object.assign(variables, interpolatedArgs);
          stepResult = { variablesUpdated: Object.keys(interpolatedArgs) };
          stepStatus = "success";
        } else if (rawStep.action === "browser.navigate") {
          const targetUrl = String(interpolatedArgs.url || "about:blank");
          const navRes = await bridge.navigate(targetUrl);
          stepResult = navRes;
          stepStatus = "success";
        } else if (rawStep.action === "browser.screenshot") {
          const shot = bridge.captureScreenshot();
          stepResult = { captured: true, mimeType: shot.mimeType };
          stepStatus = "success";
        } else if (rawStep.action === "browser.extract" || rawStep.action === "browser.read") {
          const pageData = bridge.readPage();
          stepResult = { extracted: true, title: pageData.title };
          stepStatus = "success";
        } else {
          // General browser action dispatch (browser.click, browser.type, browser.select, etc.)
          let actionAttempt = 0;
          const maxRetries = rawStep.maxRetries ?? 2;
          let actionExecuted = false;

          while (actionAttempt <= maxRetries && !actionExecuted) {
            actionAttempt++;
            try {
              const res = await bridge.executeAction({
                tool: rawStep.action,
                target: interpolatedArgs.target as any,
                text: (interpolatedArgs.text ?? interpolatedArgs.value) !== undefined ? String(interpolatedArgs.text ?? interpolatedArgs.value) : undefined,
                agent: initiatingAgent,
              });
              stepResult = res;
              actionExecuted = true;
              stepStatus = actionAttempt > 1 ? "retried" : "success";
            } catch (err: any) {
              const errMsg = String(err.message || err);
              // Check if candidate for self-healing (element not found)
              if (
                (errMsg.includes("ELEMENT_NOT_FOUND") || errMsg.includes("not resolve target")) &&
                interpolatedArgs.target
              ) {
                const activeTab = bridge.getActiveTab();
                if (activeTab) {
                  const snapshot = bridge.getSnapshot(activeTab.id);
                  const domain = activeTab.url;
                  const healRes = selfHealer.heal(interpolatedArgs.target as any, snapshot, domain);

                  if (healRes.healed) {
                    interpolatedArgs.target = healRes.healedTarget;
                    const healedExec = await bridge.executeAction({
                      tool: rawStep.action,
                      target: healRes.healedTarget,
                      text: (interpolatedArgs.text ?? interpolatedArgs.value) !== undefined ? String(interpolatedArgs.text ?? interpolatedArgs.value) : undefined,
                      agent: initiatingAgent,
                    });
                    stepResult = { ...healedExec, healed: true, healedFrom: healRes.originalTarget };
                    actionExecuted = true;
                    stepStatus = "healed";
                    break;
                  }
                }
              }

              if (actionAttempt > maxRetries) {
                throw err;
              }
              // Short backoff before retry
              await new Promise((r) => setTimeout(r, 500 * actionAttempt));
            }
          }
        }

        // 4. Perform postcondition validations if present
        if (rawStep.validations && rawStep.validations.length > 0) {
          const valRes = await validator.validate(rawStep.validations);
          if (!valRes.passed) {
            validationResult = valRes as any;
            throw new Error(`VALIDATION_FAILED: ${valRes.message}`);
          }
          validationResult = { passed: true } as any;
        }

        // 5. Automatic checkpoint saving if marked on step
        if (rawStep.isCheckpoint) {
          const activeTab = bridge.getActiveTab();
          checkpointMgr.saveCheckpoint(
            runId,
            i,
            activeTab?.url || "about:blank",
            variables,
            activeTab?.id,
          );
        }
      } catch (err: any) {
        stepError = String(err.message || err);
        const recovery = rawStep.recoveryStrategy || "heal";

        if (recovery === "skip") {
          stepStatus = "skipped";
          stepResult = { error: stepError, skipped: true };
        } else {
          stepStatus = "failed";
          // Record step log before failing
          this.logStep(runId, i, rawStep.name, rawStep.action, interpolatedArgs, { error: stepError }, stepStatus, Date.now() - stepStartTime, validationResult);
          return this.updateRunStatus(runId, "failed", i, variables, stepError);
        }
      }

      // Record step log
      const durationMs = Date.now() - stepStartTime;
      this.logStep(
        runId,
        i,
        rawStep.name,
        rawStep.action,
        interpolatedArgs,
        stepResult,
        stepStatus,
        durationMs,
        validationResult,
      );

      // Update current step index in DB
      db.query("UPDATE browser_workflow_runs SET current_step_index = ?, variables_json = ?, updated_at = ? WHERE id = ?").run(
        i + 1,
        JSON.stringify(variables),
        Date.now(),
        runId,
      );
    }

    return this.updateRunStatus(runId, "completed", workflow.steps.length, variables);
  }

  public async pauseRun(runId: string): Promise<WorkflowRun> {
    this.pausedRuns.add(runId);
    const run = this.getRun(runId);
    if (!run) throw new Error(`RUN_NOT_FOUND: ${runId}`);
    return this.updateRunStatus(runId, "paused", run.currentStepIndex, run.variables);
  }

  public async resumeRun(runId: string): Promise<WorkflowRun> {
    const run = this.getRun(runId);
    if (!run) throw new Error(`RUN_NOT_FOUND: ${runId}`);
    if (run.status !== "paused" && run.status !== "failed") {
      throw new Error(`CANNOT_RESUME: Run is in status '${run.status}'`);
    }

    const db = openAgentOsDb();
    const wfRow = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(run.workflowId) as Record<string, unknown> | null;
    if (!wfRow) throw new Error(`WORKFLOW_NOT_FOUND: ${run.workflowId}`);

    const workflow: WorkflowDefinition = {
      id: String(wfRow.id),
      name: String(wfRow.name),
      description: String(wfRow.description),
      version: Number(wfRow.version),
      steps: JSON.parse(String(wfRow.dsl_json || "[]")),
      parameters: JSON.parse(String(wfRow.parameters_schema_json || "{}")),
      tags: JSON.parse(String(wfRow.tags_json || "[]")),
      createdAt: Number(wfRow.created_at),
      updatedAt: Number(wfRow.updated_at),
    };

    return this.runWorkflow(workflow, run.variables, {
      runId: run.id,
      resumeFromStep: run.currentStepIndex,
      initiatingAgent: run.initiatingAgent,
    });
  }

  public async cancelRun(runId: string): Promise<WorkflowRun> {
    this.cancelledRuns.add(runId);
    const run = this.getRun(runId);
    if (!run) throw new Error(`RUN_NOT_FOUND: ${runId}`);
    return this.updateRunStatus(runId, "cancelled", run.currentStepIndex, run.variables, "Cancelled by user");
  }

  public getRun(runId: string): WorkflowRun | null {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM browser_workflow_runs WHERE id = ?").get(runId) as Record<string, unknown> | null;
    if (!r) return null;

    return {
      id: String(r.id),
      workflowId: String(r.workflow_id),
      status: String(r.status) as WorkflowRunStatus,
      currentStepIndex: Number(r.current_step_index),
      variables: JSON.parse(String(r.variables_json || "{}")),
      checkpoints: JSON.parse(String(r.checkpoints_json || "[]")),
      error: r.error ? String(r.error) : undefined,
      initiatingAgent: r.initiating_agent ? String(r.initiating_agent) : undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  public listRuns(workflowId?: string): WorkflowRun[] {
    const db = openAgentOsDb();
    let rows: Record<string, unknown>[];
    if (workflowId) {
      rows = db.query("SELECT * FROM browser_workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC").all(workflowId) as Record<string, unknown>[];
    } else {
      rows = db.query("SELECT * FROM browser_workflow_runs ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[];
    }

    return rows.map((r) => ({
      id: String(r.id),
      workflowId: String(r.workflow_id),
      status: String(r.status) as WorkflowRunStatus,
      currentStepIndex: Number(r.current_step_index),
      variables: JSON.parse(String(r.variables_json || "{}")),
      checkpoints: JSON.parse(String(r.checkpoints_json || "[]")),
      error: r.error ? String(r.error) : undefined,
      initiatingAgent: r.initiating_agent ? String(r.initiating_agent) : undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  public getStepLogs(runId: string): StepLog[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM browser_step_logs WHERE run_id = ? ORDER BY id ASC").all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      runId: String(r.run_id),
      stepIndex: Number(r.step_index),
      stepName: String(r.step_name),
      actionTool: String(r.action_tool),
      arguments: JSON.parse(String(r.arguments_json || "{}")),
      result: JSON.parse(String(r.result_json || "{}")),
      status: String(r.status) as StepExecutionStatus,
      durationMs: Number(r.duration_ms),
      validationResult: r.validation_result_json ? JSON.parse(String(r.validation_result_json)) : undefined,
      createdAt: Number(r.created_at),
    }));
  }

  private logStep(
    runId: string,
    stepIndex: number,
    stepName: string,
    actionTool: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
    status: StepExecutionStatus,
    durationMs: number,
    validationResult?: any,
  ): void {
    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_step_logs (run_id, step_index, step_name, action_tool, arguments_json, result_json, status, duration_ms, validation_result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      stepIndex,
      stepName,
      actionTool,
      JSON.stringify(args),
      JSON.stringify(result),
      status,
      durationMs,
      validationResult ? JSON.stringify(validationResult) : "{}",
      Date.now(),
    );
  }

  private updateRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    stepIndex: number,
    variables: Record<string, unknown>,
    error?: string,
  ): WorkflowRun {
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      UPDATE browser_workflow_runs
      SET status = ?, current_step_index = ?, variables_json = ?, error = ?, updated_at = ?
      WHERE id = ?
    `).run(status, stepIndex, JSON.stringify(variables), error || null, now, runId);

    const updated = this.getRun(runId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated run: ${runId}`);
    }
    return updated;
  }
}

let workflowExecutorInstance: WorkflowExecutor | null = null;
export function getWorkflowExecutor(): WorkflowExecutor {
  if (!workflowExecutorInstance) {
    workflowExecutorInstance = new WorkflowExecutor();
  }
  return workflowExecutorInstance;
}
