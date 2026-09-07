// Phase 20.1 — Capacity Planner
//
// Translates queued backlog volume and target drain deadlines into optimal GPU parallel slot counts,
// constrained by FinOps limits and cloud cold-start penalties.

export interface CapacityPlannerOptions {
  localSlots?: number;
  maxCloudPods?: number;
  targetDrainMinutes?: number;
  coldStartSeconds?: number;
}

export interface CapacityPlanResult {
  currentLocalSlots: number;
  currentCloudSlots: number;
  desiredTotalSlots: number;
  desiredCloudSlots: number;
  estimatedDrainBefore: number; // in seconds
  estimatedDrainAfter: number;  // in seconds
  coldStartOverheadSeconds: number;
  reason: string;
}

export class CapacityPlanner {
  readonly localSlots: number;
  readonly maxCloudPods: number;
  readonly targetDrainMinutes: number;
  readonly coldStartSeconds: number;

  constructor(options: CapacityPlannerOptions = {}) {
    this.localSlots = options.localSlots ?? 1;
    this.maxCloudPods = options.maxCloudPods ?? 2;
    this.targetDrainMinutes = options.targetDrainMinutes ?? 20;
    this.coldStartSeconds = options.coldStartSeconds ?? 90; // Average cold start for ComfyUI container
  }

  /**
   * Plans desired parallel slot capacity for a given total backlog runtime.
   */
  plan(
    totalBacklogRuntimeSeconds: number,
    currentCloudSlots = 0,
    options: {
      budgetApproved?: boolean;
      customTargetDrainMinutes?: number;
      overrideMaxCloudPods?: number;
    } = {},
  ): CapacityPlanResult {
    const targetDrainSeconds = (options.customTargetDrainMinutes ?? this.targetDrainMinutes) * 60;
    const maxCloudPods = options.overrideMaxCloudPods ?? this.maxCloudPods;

    // Drain time on current capacity (Local + existing warm cloud)
    const currentTotalSlots = Math.max(this.localSlots + currentCloudSlots, 1);
    const estimatedDrainBefore = Math.round(totalBacklogRuntimeSeconds / currentTotalSlots);

    // If backlog is trivial or fits within target drain comfortably, no scale-up needed
    if (estimatedDrainBefore <= targetDrainSeconds || totalBacklogRuntimeSeconds <= 120) {
      return {
        currentLocalSlots: this.localSlots,
        currentCloudSlots,
        desiredTotalSlots: currentTotalSlots,
        desiredCloudSlots: currentCloudSlots,
        estimatedDrainBefore,
        estimatedDrainAfter: estimatedDrainBefore,
        coldStartOverheadSeconds: 0,
        reason: `Current capacity drains backlog in ${Math.round(estimatedDrainBefore / 60)}m (within ${this.targetDrainMinutes}m target)`,
      };
    }

    // Calculate ideal parallel slots
    const rawDesiredSlots = Math.ceil(totalBacklogRuntimeSeconds / targetDrainSeconds);

    // Clamp desired cloud slots by policy limit and local capacity
    const desiredCloud = Math.min(
      Math.max(rawDesiredSlots - this.localSlots, 0),
      maxCloudPods,
    );

    const desiredTotal = this.localSlots + desiredCloud;

    // Calculate post-scale drain time, factoring cold-start on newly added cloud slots
    const isNewCloudAddition = desiredCloud > currentCloudSlots;
    const coldStartPenalty = isNewCloudAddition ? this.coldStartSeconds : 0;

    const postParallelDrain = Math.round(totalBacklogRuntimeSeconds / Math.max(desiredTotal, 1));
    const estimatedDrainAfter = postParallelDrain + Math.round(coldStartPenalty / desiredTotal);

    const speedupPct = estimatedDrainBefore > 0
      ? Math.round(((estimatedDrainBefore - estimatedDrainAfter) / estimatedDrainBefore) * 100)
      : 0;

    return {
      currentLocalSlots: this.localSlots,
      currentCloudSlots,
      desiredTotalSlots: desiredTotal,
      desiredCloudSlots: desiredCloud,
      estimatedDrainBefore,
      estimatedDrainAfter,
      coldStartOverheadSeconds: coldStartPenalty,
      reason: desiredCloud > currentCloudSlots
        ? `Scale to ${desiredCloud} cloud GPU(s) reduces drain time from ${Math.round(estimatedDrainBefore / 60)}m to ~${Math.round(estimatedDrainAfter / 60)}m (~${speedupPct}% faster)`
        : `Maintaining ${currentTotalSlots} active slot(s) for steady queue drain`,
    };
  }
}
