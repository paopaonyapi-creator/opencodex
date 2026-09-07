// Phase 20.1 — Scale-In & Idle Pod Reaping Controller
//
// Detects reduced backlog and safely drains and scales down cloud pods without interrupting
// active jobs or destroying model locality prematurely.

import type { CloudLifecycleManager } from "../cloud/lifecycle-manager";
import type { RunPodPodRecord } from "../types";

export interface ScaleInOptions {
  scaleDownCooldownSeconds?: number;     // default: 300s (5 minutes)
  scaleDownStableWindowSeconds?: number; // default: 120s (2 minutes)
}

export class ScaleInController {
  readonly scaleDownCooldownSeconds: number;
  readonly scaleDownStableWindowSeconds: number;

  private lastScaleDownTimeMs = 0;
  private stableSinceMs: number | null = null;
  private readonly drainingPodIds = new Set<string>();

  constructor(options: ScaleInOptions = {}) {
    this.scaleDownCooldownSeconds = options.scaleDownCooldownSeconds ?? 300;
    this.scaleDownStableWindowSeconds = options.scaleDownStableWindowSeconds ?? 120;
  }

  markDraining(podId: string): void {
    this.drainingPodIds.add(podId);
  }

  clearDraining(podId: string): void {
    this.drainingPodIds.delete(podId);
  }

  isDraining(podId: string): boolean {
    return this.drainingPodIds.has(podId);
  }

  /**
   * Evaluates whether scale-in conditions are met:
   * 1. Backlog is zero or sufficiently small that desired < current.
   * 2. Stable window has elapsed (no sudden burst rebound).
   * 3. Cooldown has elapsed since the last scale-down event.
   */
  canScaleIn(currentCloudSlots: number, desiredCloudSlots: number): boolean {
    if (currentCloudSlots <= desiredCloudSlots || currentCloudSlots <= 0) {
      this.stableSinceMs = null; // Reset stable window tracking
      return false;
    }

    const now = Date.now();

    // Check cooldown
    if (now - this.lastScaleDownTimeMs < this.scaleDownCooldownSeconds * 1000) {
      return false;
    }

    // Check stable window
    if (!this.stableSinceMs) {
      this.stableSinceMs = now;
      if (this.scaleDownStableWindowSeconds > 0) {
        return false;
      }
    }

    if (now - this.stableSinceMs < this.scaleDownStableWindowSeconds * 1000) {
      return false;
    }

    return true;
  }

  /**
   * Identifies candidate idle pod and triggers graceful drain and stop.
   */
  async evaluateAndDrain(
    lifecycle: CloudLifecycleManager,
    currentCloudSlots: number,
    desiredCloudSlots: number,
  ): Promise<{ stoppedPodId?: string; reason: string }> {
    if (!this.canScaleIn(currentCloudSlots, desiredCloudSlots)) {
      return { reason: "Scale-in conditions not met (cooldown or stable window active)" };
    }

    const pods = lifecycle.listTrackedPods();
    // Candidate must be a cloud pod, running/ready, with no active job assigned
    const idleCandidates = pods.filter((p: RunPodPodRecord) =>
      (p.actualState.toLowerCase() === "running" || p.actualState.toLowerCase() === "ready") &&
      !p.currentJobId &&
      !this.drainingPodIds.has(p.runpodPodId),
    );

    if (idleCandidates.length === 0) {
      return { reason: "No completely idle cloud pods available to drain" };
    }

    // Sort by highest hourly cost first to maximize FinOps savings
    idleCandidates.sort((a: RunPodPodRecord, b: RunPodPodRecord) => b.costPerHour - a.costPerHour);
    const victim = idleCandidates[0];

    this.markDraining(victim.runpodPodId);
    this.lastScaleDownTimeMs = Date.now();

    try {
      await lifecycle.stopPod(victim.id);
      this.clearDraining(victim.runpodPodId);
      return {
        stoppedPodId: victim.runpodPodId,
        reason: `Drained and auto-stopped cloud pod ${victim.runpodPodId} (${victim.gpuType} @ $${victim.costPerHour.toFixed(2)}/hr) following backlog reduction`,
      };
    } catch (err) {
      this.clearDraining(victim.runpodPodId);
      return { reason: `Failed to stop candidate pod ${victim.runpodPodId}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
