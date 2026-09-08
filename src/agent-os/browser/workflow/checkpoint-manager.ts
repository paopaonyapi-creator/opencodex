// Phase 20.12 — Browser Workflow Checkpoint Manager
//
// Manages deterministic execution state checkpoints stored in SQLite.
// Allows long-running or interrupted workflows to resume from the last good checkpoint.

import { openAgentOsDb } from "../../db";
import type { Checkpoint } from "./types";

export class CheckpointManager {
  /**
   * Saves a checkpoint for a running workflow.
   */
  public saveCheckpoint(
    runId: string,
    stepIndex: number,
    url: string,
    variables: Record<string, unknown>,
    tabId?: string,
  ): Checkpoint {
    const db = openAgentOsDb();
    const checkpoint: Checkpoint = {
      stepIndex,
      timestamp: new Date().toISOString(),
      url,
      variables: { ...variables },
      tabId,
    };

    const runRow = db
      .query("SELECT checkpoints_json FROM browser_workflow_runs WHERE id = ?")
      .get(runId) as { checkpoints_json: string } | null;

    let list: Checkpoint[] = [];
    if (runRow && runRow.checkpoints_json) {
      try {
        list = JSON.parse(runRow.checkpoints_json);
      } catch {
        list = [];
      }
    }

    list.push(checkpoint);

    db.query(`
      UPDATE browser_workflow_runs
      SET checkpoints_json = ?, current_step_index = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(list), stepIndex, Date.now(), runId);

    return checkpoint;
  }

  /**
   * Retrieves all checkpoints for a workflow run.
   */
  public getCheckpoints(runId: string): Checkpoint[] {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT checkpoints_json FROM browser_workflow_runs WHERE id = ?")
      .get(runId) as { checkpoints_json: string } | null;

    if (!row || !row.checkpoints_json) return [];
    try {
      return JSON.parse(row.checkpoints_json);
    } catch {
      return [];
    }
  }

  /**
   * Retrieves the most recent checkpoint for a workflow run.
   */
  public getLatestCheckpoint(runId: string): Checkpoint | null {
    const list = this.getCheckpoints(runId);
    if (list.length === 0) return null;
    return list[list.length - 1];
  }

  /**
   * Checks if a run has any checkpoints to resume from.
   */
  public canResume(runId: string): boolean {
    return this.getCheckpoints(runId).length > 0;
  }
}

let checkpointManagerInstance: CheckpointManager | null = null;
export function getCheckpointManager(): CheckpointManager {
  if (!checkpointManagerInstance) {
    checkpointManagerInstance = new CheckpointManager();
  }
  return checkpointManagerInstance;
}
