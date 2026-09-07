// Phase 20.1 — Burst Decision Engine & Scale Plan Controller
//
// Governs cloud scaling decisions with hysteresis cooldowns, stable window checks,
// and explicit explainability, fully bounded by Phase 20 FinOps Cost Guard.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type { CapacityPlanResult } from "./capacity-planner";
import type { BurstDecision, BurstMode, PredictionConfidence, ScalePlan } from "./types";

export interface BurstControllerOptions {
  burstMode?: BurstMode;
  burstSoftDepth?: number;
  burstHardDepth?: number;
  minBurstTimeSavingPercent?: number;
  scaleUpCooldownSeconds?: number;
  scaleUpStableWindowSeconds?: number;
}

export interface BurstEvaluationInput {
  queueDepth: number;
  oldestWaitSeconds: number;
  capacityPlan: CapacityPlanResult;
  costGuardApproval: boolean;
  costGuardReason?: string;
  estimatedHourlyCost: number;
  estimatedBatchCost: number;
  confidence?: PredictionConfidence;
}

export class BurstDecisionEngine {
  burstMode: BurstMode;
  readonly burstSoftDepth: number;
  readonly burstHardDepth: number;
  readonly minBurstTimeSavingPercent: number;
  readonly scaleUpCooldownSeconds: number;
  readonly scaleUpStableWindowSeconds: number;

  private lastScaleUpTimeMs = 0;
  private highBacklogDetectedSinceMs: number | null = null;

  constructor(options: BurstControllerOptions = {}) {
    this.burstMode = options.burstMode ?? "ASSISTED";
    this.burstSoftDepth = options.burstSoftDepth ?? 4;
    this.burstHardDepth = options.burstHardDepth ?? 12;
    this.minBurstTimeSavingPercent = options.minBurstTimeSavingPercent ?? 20;
    this.scaleUpCooldownSeconds = options.scaleUpCooldownSeconds ?? 60;
    this.scaleUpStableWindowSeconds = options.scaleUpStableWindowSeconds ?? 30;
  }

  setBurstMode(mode: BurstMode): void {
    this.burstMode = mode;
  }

  /**
   * Evaluates whether a cloud burst should be triggered or recommended.
   */
  evaluate(input: BurstEvaluationInput): ScalePlan {
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const planId = `plan_${randomUUID().slice(0, 12)}`;
    const { capacityPlan, costGuardApproval, costGuardReason, estimatedHourlyCost, estimatedBatchCost } = input;

    // 1. Policy Gate: Burst Mode OFF
    if (this.burstMode === "OFF") {
      return this.createPlan(planId, capacityPlan, "NO_BURST", "Cloud bursting disabled by operator policy (Burst Mode: OFF)", "pending", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 2. No scale-up required if capacity plan needs 0 additional cloud slots
    if (capacityPlan.desiredCloudSlots <= capacityPlan.currentCloudSlots) {
      this.highBacklogDetectedSinceMs = null;
      return this.createPlan(planId, capacityPlan, "NO_BURST", capacityPlan.reason, "pending", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 3. Minimum Time Savings Check
    const timeSavingsPct = capacityPlan.estimatedDrainBefore > 0
      ? Math.round(((capacityPlan.estimatedDrainBefore - capacityPlan.estimatedDrainAfter) / capacityPlan.estimatedDrainBefore) * 100)
      : 0;

    if (timeSavingsPct < this.minBurstTimeSavingPercent && input.queueDepth < this.burstHardDepth) {
      return this.createPlan(planId, capacityPlan, "NO_BURST", `Estimated time savings (${timeSavingsPct}%) below minimum threshold of ${this.minBurstTimeSavingPercent}%`, "pending", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 4. Stable Window Check (prevent transient blips from triggering cloud provisioning)
    if (input.queueDepth >= this.burstSoftDepth) {
      if (this.highBacklogDetectedSinceMs === null) {
        this.highBacklogDetectedSinceMs = nowMs;
      }
    } else {
      this.highBacklogDetectedSinceMs = null;
    }

    const isStable = this.highBacklogDetectedSinceMs !== null &&
      (nowMs - this.highBacklogDetectedSinceMs) >= (this.scaleUpStableWindowSeconds * 1000);

    // If hard depth exceeded, bypass stable window requirement
    const hardExceeded = input.queueDepth >= this.burstHardDepth;

    if (!isStable && !hardExceeded) {
      const waitRemaining = Math.round((this.scaleUpStableWindowSeconds * 1000 - (nowMs - (this.highBacklogDetectedSinceMs ?? nowMs))) / 1000);
      return this.createPlan(planId, capacityPlan, "NO_BURST", `Queue backlog accumulating; observing stable window (${waitRemaining}s remaining)`, "pending", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 5. Cooldown Check
    const timeSinceLastScaleUp = (nowMs - this.lastScaleUpTimeMs) / 1000;
    if (timeSinceLastScaleUp < this.scaleUpCooldownSeconds) {
      const cooldownRemaining = Math.round(this.scaleUpCooldownSeconds - timeSinceLastScaleUp);
      return this.createPlan(planId, capacityPlan, "NO_BURST", `Scale-up cooldown active (${cooldownRemaining}s remaining)`, "pending", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 6. FinOps Cost Guard Gate
    if (!costGuardApproval) {
      return this.createPlan(planId, capacityPlan, "BURST_BLOCKED_BY_BUDGET", costGuardReason ?? "Cloud burst rejected by FinOps Cost Guard budget limits", "rejected", nowIso, estimatedHourlyCost, estimatedBatchCost);
    }

    // 7. Decision Determination
    const decision: BurstDecision = hardExceeded ? "BURST_REQUIRED" : "BURST_RECOMMENDED";
    const status = this.burstMode === "AUTO" ? "approved" : "pending";

    const reason = hardExceeded
      ? `Critical queue depth (${input.queueDepth} >= ${this.burstHardDepth}) requires cloud burst: ${capacityPlan.reason}`
      : `High queue depth (${input.queueDepth} >= ${this.burstSoftDepth}) recommends cloud burst: ${capacityPlan.reason}`;

    const plan = this.createPlan(planId, capacityPlan, decision, reason, status, nowIso, estimatedHourlyCost, estimatedBatchCost, input.confidence ?? "HIGH");

    this.lastScaleUpTimeMs = nowMs;
    return plan;
  }

  private createPlan(
    id: string,
    capacityPlan: CapacityPlanResult,
    decision: BurstDecision,
    reason: string,
    status: "pending" | "approved" | "executed" | "rejected",
    nowIso: string,
    estimatedHourlyCost: number,
    estimatedBatchCost: number,
    confidence: PredictionConfidence = "MEDIUM",
  ): ScalePlan {
    const isNoBurst = decision === "NO_BURST" || decision.startsWith("BURST_BLOCKED");
    const desiredCloudSlots = isNoBurst ? capacityPlan.currentCloudSlots : capacityPlan.desiredCloudSlots;
    const desiredTotalSlots = isNoBurst ? (capacityPlan.currentLocalSlots + capacityPlan.currentCloudSlots) : capacityPlan.desiredTotalSlots;

    const plan: ScalePlan = {
      id,
      currentLocalSlots: capacityPlan.currentLocalSlots,
      currentCloudSlots: capacityPlan.currentCloudSlots,
      desiredTotalSlots,
      desiredCloudSlots,
      reason,
      estimatedDrainBefore: capacityPlan.estimatedDrainBefore,
      estimatedDrainAfter: isNoBurst ? capacityPlan.estimatedDrainBefore : capacityPlan.estimatedDrainAfter,
      estimatedHourlyCost,
      estimatedBatchCost,
      confidence,
      decision,
      status,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.persistScalePlan(plan);
    return plan;
  }

  private persistScalePlan(plan: ScalePlan): void {
    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO gen_scale_plans
          (id, current_local_slots, current_cloud_slots, desired_total_slots, desired_cloud_slots,
           reason, estimated_drain_before, estimated_drain_after, estimated_hourly_cost,
           estimated_batch_cost, confidence, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.id,
        plan.currentLocalSlots,
        plan.currentCloudSlots,
        plan.desiredTotalSlots,
        plan.desiredCloudSlots,
        plan.reason,
        plan.estimatedDrainBefore,
        plan.estimatedDrainAfter,
        plan.estimatedHourlyCost,
        plan.estimatedBatchCost,
        plan.confidence,
        plan.status,
        plan.createdAt,
        plan.updatedAt,
      );
    } catch {
      // Scale plan logging is best-effort
    }
  }
}
