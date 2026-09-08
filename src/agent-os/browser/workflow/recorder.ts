// Phase 20.12 — Interactive Browser Workflow Recorder
//
// Records live browser navigation and interactions, translating human or agent
// actions into reusable parameterized workflow definitions with auto-synthesized validations.

import { getBrowserBridge } from "../bridge/browser-bridge";
import { openAgentOsDb } from "../../db";
import type { ValidationRule, WorkflowDefinition, WorkflowStep } from "./types";

export interface RecordingSession {
  workflowId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  startedAt: number;
  autoCheckpoint: boolean;
}

export class WorkflowRecorder {
  private activeSession: RecordingSession | null = null;
  private bridgeListenersBound = false;

  private onNavigationCompleted = (data: { id: string; url: string; title: string }) => {
    if (!this.activeSession) return;
    this.recordAction(
      "browser.navigate",
      { url: data.url },
      {
        name: `Navigate to ${data.title || data.url}`,
        validations: [{ type: "url_contains", expected: data.url }],
        isCheckpoint: this.activeSession.autoCheckpoint,
      },
    );
  };

  /**
   * Starts a new interactive recording session.
   */
  public startRecording(
    name: string,
    description = "",
    options?: { autoCheckpoint?: boolean; workflowId?: string },
  ): { workflowId: string; startedAt: number } {
    const workflowId =
      options?.workflowId || `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = Date.now();

    this.activeSession = {
      workflowId,
      name,
      description,
      steps: [],
      startedAt,
      autoCheckpoint: options?.autoCheckpoint ?? true,
    };

    this.bindBridgeListeners();

    return { workflowId, startedAt };
  }

  /**
   * Records an explicit interaction step into the active recording session.
   */
  public recordAction(
    action: string,
    args: Record<string, unknown>,
    options?: {
      name?: string;
      validations?: ValidationRule[];
      isCheckpoint?: boolean;
      recoveryStrategy?: "abort" | "retry" | "heal" | "skip";
    },
  ): WorkflowStep {
    if (!this.activeSession) {
      throw new Error("NO_ACTIVE_RECORDING: No workflow recording session is currently active.");
    }

    const stepIndex = this.activeSession.steps.length + 1;
    const step: WorkflowStep = {
      id: `step_${stepIndex}`,
      name: options?.name || `Step ${stepIndex}: ${action}`,
      action,
      arguments: { ...args },
      validations: options?.validations,
      recoveryStrategy: options?.recoveryStrategy || "heal",
      maxRetries: 2,
      isCheckpoint: options?.isCheckpoint ?? (this.activeSession.autoCheckpoint && stepIndex % 3 === 0),
      timeoutMs: 15000,
    };

    this.activeSession.steps.push(step);
    return step;
  }

  /**
   * Stops the active recording session, compiles the workflow, saves it to SQLite,
   * and returns the resulting WorkflowDefinition.
   */
  public stopRecording(options?: {
    tags?: string[];
    parameters?: WorkflowDefinition["parameters"];
  }): WorkflowDefinition {
    if (!this.activeSession) {
      throw new Error("NO_ACTIVE_RECORDING: No workflow recording session is currently active.");
    }

    const session = this.activeSession;
    this.unbindBridgeListeners();
    this.activeSession = null;

    const now = Date.now();
    const workflow: WorkflowDefinition = {
      id: session.workflowId,
      name: session.name,
      description: session.description,
      version: 1,
      steps: session.steps,
      parameters: options?.parameters || {},
      tags: options?.tags || ["recorded"],
      createdAt: session.startedAt,
      updatedAt: now,
    };

    const db = openAgentOsDb();
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
      workflow.updatedAt,
    );

    return workflow;
  }

  public isRecording(): boolean {
    return this.activeSession !== null;
  }

  public getActiveSession(): RecordingSession | null {
    return this.activeSession;
  }

  public getCurrentSteps(): WorkflowStep[] {
    return this.activeSession ? [...this.activeSession.steps] : [];
  }

  private bindBridgeListeners(): void {
    if (this.bridgeListenersBound) return;
    const bridge = getBrowserBridge();
    bridge.on("navigation.completed", this.onNavigationCompleted);
    this.bridgeListenersBound = true;
  }

  private unbindBridgeListeners(): void {
    if (!this.bridgeListenersBound) return;
    const bridge = getBrowserBridge();
    bridge.off("navigation.completed", this.onNavigationCompleted);
    this.bridgeListenersBound = false;
  }
}

let recorderInstance: WorkflowRecorder | null = null;
export function getWorkflowRecorder(): WorkflowRecorder {
  if (!recorderInstance) {
    recorderInstance = new WorkflowRecorder();
  }
  return recorderInstance;
}
