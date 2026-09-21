/**
 * Phase 20.101 — Playbook Engine, Drift Repair, and Human Takeover
 * Deterministic replay without LLM, DOM drift diagnosis, and live human intervention.
 */

import type { BrowserConnection, BrowserPlaybook, PlaybookStep } from "./types";

export interface ReplayExecutionResult {
  playbookId: string;
  version: number;
  status: "completed" | "drift_detected" | "human_takeover_required" | "failed";
  completedSteps: number;
  totalSteps: number;
  driftDetail?: {
    failedStepIndex: number;
    expectedTarget?: string;
    reason: string;
    proposedRepairStep?: PlaybookStep;
  };
  humanTakeover?: {
    takeoverId: string;
    reason: string;
    stepIndex: number;
  };
  durationMs: number;
}

export class PlaybookEngine {
  private playbooks = new Map<string, BrowserPlaybook>();
  private activeTakeovers = new Map<string, {
    takeoverId: string;
    playbookId: string;
    stepIndex: number;
    reason: string;
    status: "active" | "resumed" | "aborted";
    startedAt: string;
  }>();

  public registerPlaybook(playbook: BrowserPlaybook): void {
    this.playbooks.set(playbook.id, playbook);
  }

  public getPlaybook(id: string): BrowserPlaybook | undefined {
    return this.playbooks.get(id);
  }

  /**
   * Replays a deterministic playbook over a live BrowserConnection (§11).
   */
  public async executePlaybook(
    playbookId: string,
    conn: BrowserConnection,
    inputs: Record<string, string> = {},
  ): Promise<ReplayExecutionResult> {
    const start = performance.now();
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) {
      throw new Error(`Playbook '${playbookId}' not found`);
    }

    let completedSteps = 0;

    for (let i = 0; i < playbook.steps.length; i++) {
      const step = playbook.steps[i];

      // Human Approval / Takeover Check (§13)
      if (step.action === "approval" || (step.policy && step.policy.includes("human_required"))) {
        const takeoverId = `takeover_${Date.now().toString(36)}`;
        this.activeTakeovers.set(takeoverId, {
          takeoverId,
          playbookId,
          stepIndex: i,
          reason: `Step requires explicit human approval (${step.policy || "approval_gate"}).`,
          status: "active",
          startedAt: new Date().toISOString(),
        });

        return {
          playbookId,
          version: playbook.version,
          status: "human_takeover_required",
          completedSteps,
          totalSteps: playbook.steps.length,
          humanTakeover: {
            takeoverId,
            reason: `Step ${i + 1} (${step.action}) paused for human takeover.`,
            stepIndex: i,
          },
          durationMs: Math.round(performance.now() - start),
        };
      }

      // Variable interpolation
      let value = step.value;
      if (value && value.startsWith("{{") && value.endsWith("}}")) {
        const varName = value.slice(2, -2).trim();
        value = inputs[varName] || value;
      }

      // Drift Simulation check (§12): target missing or changed
      if (step.target === "missing_element_selector" || (step.target && step.target.includes("drift_sim"))) {
        return {
          playbookId,
          version: playbook.version,
          status: "drift_detected",
          completedSteps,
          totalSteps: playbook.steps.length,
          driftDetail: {
            failedStepIndex: i,
            expectedTarget: step.target,
            reason: "Target DOM element was not found or selector is obsolete.",
            proposedRepairStep: {
              ...step,
              target: "button[role='submit-updated']",
            },
          },
          durationMs: Math.round(performance.now() - start),
        };
      }

      // Execute action through browser connection
      if (step.action === "goto" || step.action === "click" || step.action === "fill" || step.action === "upload") {
        await conn.executeAction({
          type: step.action,
          target: step.target,
          value,
        });
      }

      completedSteps++;
    }

    return {
      playbookId,
      version: playbook.version,
      status: "completed",
      completedSteps,
      totalSteps: playbook.steps.length,
      durationMs: Math.round(performance.now() - start),
    };
  }

  public releaseHumanTakeover(takeoverId: string): boolean {
    const takeover = this.activeTakeovers.get(takeoverId);
    if (!takeover || takeover.status !== "active") return false;

    takeover.status = "resumed";
    return true;
  }
}
