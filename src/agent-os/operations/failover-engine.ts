/**
 * Phase 23 — Pao Autonomous Operations: Failover Engine
 * Detects node dropouts and autonomously migrates in-flight tasks using state checkpoints.
 */

import { FleetManager } from "./fleet-manager";
import type { FailoverEvent, FleetJob, JobPriority, JobStatus } from "./types";

export interface EnqueueJobInput {
  id?: string;
  taskType: string;
  priority?: JobPriority;
  payload: Record<string, unknown>;
  requiredCapabilities?: string[];
  maxRetries?: number;
}

export class FailoverEngine {
  private jobs: Map<string, FleetJob> = new Map();
  private failoverEvents: FailoverEvent[] = [];
  private fleetManager: FleetManager;

  constructor(fleetManager: FleetManager) {
    this.fleetManager = fleetManager;
  }

  /**
   * Enqueue a new fleet job
   */
  public enqueueJob(input: EnqueueJobInput): FleetJob {
    const id = input.id ?? `job-${input.taskType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const job: FleetJob = {
      id,
      taskType: input.taskType,
      priority: input.priority ?? "P1",
      payload: input.payload,
      requiredCapabilities: input.requiredCapabilities ?? [],
      status: "queued",
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Dispatch job to the best available healthy node
   */
  public dispatchJob(jobId: string): { dispatched: boolean; job: FleetJob; nodeId?: string } {
    const job = this.mustGetJob(jobId);
    const targetNode = this.fleetManager.selectBestNode(job.requiredCapabilities);

    if (!targetNode) {
      return { dispatched: false, job };
    }

    job.assignedNodeId = targetNode.id;
    job.status = "dispatched";
    job.updatedAt = Date.now();
    targetNode.activeJobs += 1;

    return { dispatched: true, job, nodeId: targetNode.id };
  }

  /**
   * Update checkpoint data for safe failover recovery
   */
  public updateCheckpoint(jobId: string, checkpointData: Record<string, unknown>): FleetJob {
    const job = this.mustGetJob(jobId);
    job.checkpointData = { ...job.checkpointData, ...checkpointData };
    job.status = "running";
    job.updatedAt = Date.now();
    return job;
  }

  /**
   * Complete a job
   */
  public completeJob(jobId: string): FleetJob {
    const job = this.mustGetJob(jobId);
    job.status = "completed";
    job.updatedAt = Date.now();

    if (job.assignedNodeId) {
      const node = this.fleetManager.getNode(job.assignedNodeId);
      if (node && node.activeJobs > 0) {
        node.activeJobs -= 1;
      }
    }

    return job;
  }

  /**
   * Mark a job as failed
   */
  public failJob(jobId: string, error: string): FleetJob {
    const job = this.mustGetJob(jobId);
    job.status = "failed";
    job.error = error;
    job.updatedAt = Date.now();

    if (job.assignedNodeId) {
      const node = this.fleetManager.getNode(job.assignedNodeId);
      if (node && node.activeJobs > 0) {
        node.activeJobs -= 1;
      }
    }

    return job;
  }

  /**
   * Trigger automated failover for all active jobs on a degraded or offline node
   */
  public triggerFailover(failedNodeId: string, reason: string): FailoverEvent {
    const affectedJobs = Array.from(this.jobs.values()).filter(
      (j) => j.assignedNodeId === failedNodeId && (j.status === "dispatched" || j.status === "running")
    );

    const migratedJobIds: string[] = [];
    let recoveredAll = true;

    for (const job of affectedJobs) {
      if (job.retryCount < job.maxRetries) {
        job.status = "migrating";
        job.retryCount += 1;

        // Find alternative node (excluding the failed node)
        const altNode = this.fleetManager.selectBestNode(job.requiredCapabilities);
        if (altNode && altNode.id !== failedNodeId) {
          job.assignedNodeId = altNode.id;
          job.status = "running";
          job.updatedAt = Date.now();
          altNode.activeJobs += 1;
          migratedJobIds.push(job.id);
        } else {
          // If no immediate alternative node, re-queue
          job.assignedNodeId = undefined;
          job.status = "queued";
          job.updatedAt = Date.now();
          migratedJobIds.push(job.id);
        }
      } else {
        job.status = "failed";
        job.error = `Failover aborted: exceeded max retries (${job.maxRetries})`;
        job.updatedAt = Date.now();
        recoveredAll = false;
      }
    }

    const event: FailoverEvent = {
      id: `failover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      failedNodeId,
      targetNodeId: migratedJobIds.length > 0 ? "dynamic_reassigned" : "none",
      migratedJobIds,
      reason,
      timestamp: Date.now(),
      recoveredSuccessfully: recoveredAll,
    };

    this.failoverEvents.unshift(event);
    return event;
  }

  public getJob(id: string): FleetJob | undefined {
    return this.jobs.get(id);
  }

  public listJobs(statusFilter?: JobStatus): FleetJob[] {
    const all = Array.from(this.jobs.values());
    if (statusFilter) {
      return all.filter((j) => j.status === statusFilter);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  public listFailoverEvents(): FailoverEvent[] {
    return this.failoverEvents;
  }

  private mustGetJob(id: string): FleetJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`FleetJob '${id}' not found`);
    }
    return job;
  }
}
