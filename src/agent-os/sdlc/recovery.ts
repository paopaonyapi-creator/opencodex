// Phase 20.2 — Crash Recovery & State Reconciliation (/resume)
//
// Recovers interrupted cycles, clears expired locks, and ensures restart resilience.

import { openAgentOsDb } from "../db";
import { SdlcStateMachine } from "./state-machine";
import type { SdlcCycle, CycleState } from "./types";

export interface RecoveryReport {
  recoveredCyclesCount: number;
  clearedLocksCount: number;
  activeCycles: string[];
}

export class RecoveryEngine {
  /**
   * Performs startup diagnostics and state recovery across all SDLC cycles.
   */
  static performStartupRecovery(): RecoveryReport {
    const db = openAgentOsDb();
    const now = Date.now();

    // 1. Clear expired locks
    const lockRes = db.run("DELETE FROM sdlc_locks WHERE expires_at <= ?", [now]);
    const clearedLocksCount = lockRes.changes;

    // 2. Query in-progress cycles that were active during process shutdown
    const activeStates: CycleState[] = [
      "SPECIFYING",
      "PLANNING",
      "TASKING",
      "IMPLEMENTING",
      "VERIFYING",
      "REVIEWING",
      "CONVERGING",
    ];
    const placeholders = activeStates.map(() => "?").join(", ");

    const rows = db.query(`
      SELECT id, status, current_stage FROM sdlc_cycles
      WHERE status IN (${placeholders})
    `).all(...activeStates) as Array<{ id: string; status: CycleState; current_stage: string }>;

    let recoveredCyclesCount = 0;
    const activeCycles: string[] = [];

    for (const r of rows) {
      activeCycles.push(r.id);

      // If interrupted during implementing, reset stuck 'in_progress' tasks to 'pending'
      if (r.status === "IMPLEMENTING") {
        db.run("UPDATE sdlc_tasks SET status = 'pending' WHERE cycle_id = ? AND status = 'in_progress'", [r.id]);
      }

      recoveredCyclesCount++;
    }

    return {
      recoveredCyclesCount,
      clearedLocksCount,
      activeCycles,
    };
  }

  /**
   * Pauses an active cycle cleanly.
   */
  static pauseCycle(cycleId: string): SdlcCycle {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const row = db.query("SELECT * FROM sdlc_cycles WHERE id = ?").get(cycleId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Cycle ${cycleId} not found`);

    const currentStatus = row.status as CycleState;
    if (SdlcStateMachine.isTerminal(currentStatus)) {
      throw new Error(`Cannot pause cycle in terminal state '${currentStatus}'`);
    }

    // Release any active locks
    db.run("DELETE FROM sdlc_locks WHERE cycle_id = ?", [cycleId]);

    db.query(`
      UPDATE sdlc_cycles
      SET status = 'PAUSED', updated_at = ?
      WHERE id = ?
    `).run(now, cycleId);

    return this.getCycle(cycleId);
  }

  /**
   * Resumes a paused or interrupted cycle.
   */
  static resumeCycle(cycleId: string): SdlcCycle {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const row = db.query("SELECT * FROM sdlc_cycles WHERE id = ?").get(cycleId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Cycle ${cycleId} not found`);

    const currentStatus = row.status as CycleState;
    if (currentStatus !== "PAUSED" && currentStatus !== "BLOCKED" && currentStatus !== "REWORK_REQUIRED") {
      return this.getCycle(cycleId);
    }

    // Resume to the recorded current_stage
    const targetStage = (row.current_stage as CycleState) || "SPECIFYING";

    db.query(`
      UPDATE sdlc_cycles
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(targetStage, now, cycleId);

    return this.getCycle(cycleId);
  }

  private static getCycle(cycleId: string): SdlcCycle {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM sdlc_cycles WHERE id = ?").get(cycleId) as Record<string, unknown>;
    return {
      id: r.id as string,
      projectId: r.project_id as string | null,
      featureKey: r.feature_key as string,
      slug: r.slug as string,
      title: r.title as string,
      summary: r.summary as string | null,
      sourceIdea: r.source_idea as string,
      status: r.status as CycleState,
      currentStage: r.current_stage as string,
      currentGate: r.current_gate as any,
      riskLevel: r.risk_level as any,
      priority: r.priority as number,
      autoRunMode: r.auto_run_mode as any,
      branchName: r.branch_name as string | null,
      baseBranch: r.base_branch as string,
      worktreePath: r.worktree_path as string | null,
      repoHeadAtStart: r.repo_head_at_start as string | null,
      latestCommitSha: r.latest_commit_sha as string | null,
      constitutionVersion: r.constitution_version as number,
      policyVersion: r.policy_version as number,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      startedAt: r.started_at as string | null,
      completedAt: r.completed_at as string | null,
      metadata: JSON.parse((r.metadata_json as string) || "{}"),
    };
  }
}
