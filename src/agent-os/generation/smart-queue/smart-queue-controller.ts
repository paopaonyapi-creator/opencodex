// Phase 20.1 — Pao ComfyUI Smart Queue Controller
//
// Master orchestration layer that links real-time native ComfyUI observation,
// intelligent workload routing, FinOps cost guardrails, and automated cloud bursting.

import { openAgentOsDb } from "../../db";
import type { CloudLifecycleManager } from "../cloud/lifecycle-manager";
import type { CostGuard } from "../cost/cost-guard";
import type { IntelligentWorkloadRouter } from "../routing/router";
import type { GenerationJob } from "../types";
import { BatchAffinityPlanner } from "./batch-affinity";
import { BurstDecisionEngine } from "./burst-controller";
import { CapacityPlanner } from "./capacity-planner";
import { DispatchWindowManager } from "./dispatch-window";
import { ComfyUiQueueObserver, type ObserverTarget } from "./observer";
import { QueueReconciler } from "./queue-reconciler";
import { RuntimePredictor } from "./runtime-predictor";
import { ScaleInController } from "./scale-in-controller";
import type {
  BacklogMetrics,
  BurstMode,
  PredictionConfidence,
  QueueSnapshot,
  ScalePlan,
  SmartQueueConfig,
} from "./types";

export interface SmartQueueControllerDeps {
  config: SmartQueueConfig;
  localComfyUrl: string;
  router: IntelligentWorkloadRouter;
  costGuard: CostGuard;
  lifecycleManager: CloudLifecycleManager | null;
}

export class SmartQueueController {
  readonly config: SmartQueueConfig;
  readonly localComfyUrl: string;
  readonly router: IntelligentWorkloadRouter;
  readonly costGuard: CostGuard;
  readonly lifecycleManager: CloudLifecycleManager | null;

  readonly observer: ComfyUiQueueObserver;
  readonly predictor: RuntimePredictor;
  readonly affinityPlanner: BatchAffinityPlanner;
  readonly capacityPlanner: CapacityPlanner;
  readonly burstEngine: BurstDecisionEngine;
  readonly dispatchWindow: DispatchWindowManager;
  readonly scaleInController: ScaleInController;
  readonly reconciler: QueueReconciler;

  private latestPlan: ScalePlan | null = null;
  private readonly snapshots = new Map<string, QueueSnapshot>();
  private readonly warmAffinityMap = new Map<string, string>(); // providerId -> affinityKey

  constructor(deps: SmartQueueControllerDeps) {
    this.config = deps.config;
    this.localComfyUrl = deps.localComfyUrl;
    this.router = deps.router;
    this.costGuard = deps.costGuard;
    this.lifecycleManager = deps.lifecycleManager;

    this.observer = new ComfyUiQueueObserver();
    this.predictor = new RuntimePredictor();
    this.affinityPlanner = new BatchAffinityPlanner({ defaultChunkSize: deps.config.batchChunkSize });
    this.capacityPlanner = new CapacityPlanner({
      localSlots: 1,
      maxCloudPods: deps.config.enabled ? 3 : 0,
      targetDrainMinutes: deps.config.targetDrainMinutes,
    });
    this.burstEngine = new BurstDecisionEngine({
      burstMode: deps.config.burstMode,
      burstSoftDepth: deps.config.burstSoftDepth,
      burstHardDepth: deps.config.burstHardDepth,
      minBurstTimeSavingPercent: deps.config.minBurstTimeSavingPercent,
      scaleUpCooldownSeconds: deps.config.scaleUpCooldownSeconds,
      scaleUpStableWindowSeconds: deps.config.scaleUpStableWindowSeconds,
    });
    this.dispatchWindow = new DispatchWindowManager({
      maxPrefetchJobsPerProvider: deps.config.maxPrefetchJobsPerProvider,
    });
    this.scaleInController = new ScaleInController({
      scaleDownCooldownSeconds: deps.config.scaleDownCooldownSeconds,
      scaleDownStableWindowSeconds: deps.config.scaleDownStableWindowSeconds,
    });
    this.reconciler = new QueueReconciler();
  }

  get paused(): boolean {
    return this.dispatchWindow.paused;
  }

  pauseDispatch(): void {
    this.dispatchWindow.pauseDispatch();
  }

  resumeDispatch(): void {
    this.dispatchWindow.resumeDispatch();
  }

  setBurstMode(mode: BurstMode): void {
    this.config.burstMode = mode;
    this.burstEngine.setBurstMode(mode);
  }

  getLatestSnapshot(providerId = "comfyui-local"): QueueSnapshot | null {
    return this.snapshots.get(providerId) ?? null;
  }

  getAllSnapshots(): QueueSnapshot[] {
    return [...this.snapshots.values()];
  }

  getLatestPlan(): ScalePlan | null {
    return this.latestPlan;
  }

  /**
   * Main periodic evaluation loop.
   */
  async tick(): Promise<{
    snapshots: QueueSnapshot[];
    plan: ScalePlan | null;
    scaleActionResult?: string;
  }> {
    if (!this.config.enabled) {
      return { snapshots: [], plan: null };
    }

    // 1. Observe Local ComfyUI
    const localTarget: ObserverTarget = {
      providerId: "comfyui-local",
      baseUrl: this.localComfyUrl,
    };
    const localSnapshot = await this.observer.captureSnapshot(localTarget);
    this.snapshots.set(localTarget.providerId, localSnapshot);

    // 2. Observe Active Cloud Pods
    const activeCloudPods = this.lifecycleManager
      ? this.lifecycleManager.listTrackedPods().filter(p => p.actualState.toLowerCase() === "running" || p.actualState.toLowerCase() === "ready")
      : [];
    for (const pod of activeCloudPods) {
      const lease = this.lifecycleManager?.getLease(pod.id);
      if (lease?.comfyEndpoint) {
        const cloudTarget: ObserverTarget = {
          providerId: pod.runpodPodId,
          instanceId: pod.id,
          baseUrl: lease.comfyEndpoint,
        };
        const cloudSnapshot = await this.observer.captureSnapshot(cloudTarget);
        this.snapshots.set(pod.runpodPodId, cloudSnapshot);
      }
    }

    // 3. Compute Backlog Metrics across Pao SQLite DB
    const db = openAgentOsDb();
    const queuedJobs = db.query(`
      SELECT * FROM gen_jobs
      WHERE status = 'queued' AND cancel_requested = 0
      ORDER BY priority DESC, created_at ASC
    `).all() as Array<{
      id: string;
      workflow_id: string | null;
      model_id: string | null;
      width: number;
      height: number;
      batch_size: number;
      loras_json: string;
      project_id: string | null;
      created_at: string;
      priority: number;
      status: string;
    }>;

    const queuedCount = queuedJobs.length;
    let totalBacklogRuntimeSeconds = 0;

    for (const j of queuedJobs) {
      const pred = this.predictor.predict({
        workflowId: j.workflow_id,
        modelId: j.model_id,
        width: j.width,
        height: j.height,
        batchSize: j.batch_size,
      });
      totalBacklogRuntimeSeconds += pred.estimatedSeconds;
    }

    // 4. Capacity Planning
    const currentCloudSlots = activeCloudPods.length;
    const capacityPlan = this.capacityPlanner.plan(totalBacklogRuntimeSeconds, currentCloudSlots);

    // 5. Cost Guard Budget Validation
    const estimatedHourlyPrice = 0.74 * capacityPlan.desiredCloudSlots; // baseline RTX 4090 estimate
    const estimatedBatchCost = (totalBacklogRuntimeSeconds / 3600) * estimatedHourlyPrice;

    const budgetValidation = this.costGuard.evaluate({
      hourlyPrice: 0.74,
      estimatedCost: estimatedBatchCost,
    });

    // 6. Burst Decision Evaluation
    const now = Date.now();
    const oldestWait = queuedJobs.length > 0
      ? Math.round((now - new Date(queuedJobs[0].created_at).getTime()) / 1000)
      : 0;

    const plan = this.burstEngine.evaluate({
      queueDepth: queuedCount,
      oldestWaitSeconds: oldestWait,
      capacityPlan,
      costGuardApproval: budgetValidation.allowed,
      costGuardReason: budgetValidation.reasons.join("; "),
      estimatedHourlyCost: estimatedHourlyPrice,
      estimatedBatchCost,
      confidence: "HIGH",
    });

    this.latestPlan = plan;
    let scaleActionResult: string | undefined;

    // 7. Auto Scale-Up Action (if AUTO mode and approved)
    if (plan.status === "approved" && plan.desiredCloudSlots > currentCloudSlots && this.lifecycleManager) {
      try {
        const neededPods = plan.desiredCloudSlots - currentCloudSlots;
        for (let i = 0; i < neededPods; i++) {
          await this.lifecycleManager.provisionPod({
            jobId: `burst_${Date.now()}_${i}`,
            gpuType: "NVIDIA GeForce RTX 4090",
            hourlyPrice: 0.74,
            estimatedCost: estimatedBatchCost,
          });
        }
        plan.status = "executed";
        scaleActionResult = `Provisioned ${neededPods} RunPod cloud GPU(s) to accelerate backlog drain`;
      } catch (err) {
        scaleActionResult = `Failed auto-provisioning cloud pod: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 8. Scale-In Action (if backlog is clearing)
    if (this.lifecycleManager && currentCloudSlots > plan.desiredCloudSlots) {
      const drainResult = await this.scaleInController.evaluateAndDrain(
        this.lifecycleManager,
        currentCloudSlots,
        plan.desiredCloudSlots,
      );
      if (drainResult.stoppedPodId) {
        scaleActionResult = drainResult.reason;
      }
    }

    return {
      snapshots: [...this.snapshots.values()],
      plan,
      scaleActionResult,
    };
  }

  /**
   * Approves a pending ScalePlan manually in ASSISTED or MANUAL mode.
   */
  async approvePlan(planId: string): Promise<{ success: boolean; message: string }> {
    let plan = this.latestPlan;
    if (!plan || plan.id !== planId) {
      const db = openAgentOsDb();
      const row = db.query("SELECT * FROM gen_scale_plans WHERE id = ?").get(planId) as {
        id: string;
        current_local_slots: number;
        current_cloud_slots: number;
        desired_total_slots: number;
        desired_cloud_slots: number;
        reason: string;
        estimated_drain_before: number;
        estimated_drain_after: number;
        estimated_hourly_cost: number;
        estimated_batch_cost: number;
        confidence: PredictionConfidence;
        status: "pending" | "approved" | "executed" | "rejected";
        created_at: string;
        updated_at: string;
      } | undefined;

      if (!row) {
        return { success: false, message: `Scale plan ${planId} not found or expired` };
      }

      plan = {
        id: row.id,
        currentLocalSlots: row.current_local_slots,
        currentCloudSlots: row.current_cloud_slots,
        desiredTotalSlots: row.desired_total_slots,
        desiredCloudSlots: row.desired_cloud_slots,
        reason: row.reason,
        estimatedDrainBefore: row.estimated_drain_before,
        estimatedDrainAfter: row.estimated_drain_after,
        estimatedHourlyCost: row.estimated_hourly_cost,
        estimatedBatchCost: row.estimated_batch_cost,
        confidence: row.confidence,
        decision: "BURST_RECOMMENDED",
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.latestPlan = plan;
    }

    if (!this.lifecycleManager) {
      return { success: false, message: "RunPod integration is not enabled in configuration" };
    }

    try {
      const neededPods = plan.desiredCloudSlots - plan.currentCloudSlots;
      for (let i = 0; i < neededPods; i++) {
        await this.lifecycleManager.provisionPod({
          jobId: `manual_burst_${Date.now()}_${i}`,
          gpuType: "NVIDIA GeForce RTX 4090",
          hourlyPrice: 0.74,
          estimatedCost: plan.estimatedBatchCost,
        });
      }
      plan.status = "executed";
      const db = openAgentOsDb();
      db.query("UPDATE gen_scale_plans SET status = 'executed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), plan.id);
      return { success: true, message: `Successfully approved and launched ${neededPods} cloud GPU(s)` };
    } catch (err) {
      return { success: false, message: `Cloud allocation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Drains a provider gracefully.
   */
  async drainProvider(providerId: string): Promise<{ success: boolean; message: string }> {
    this.scaleInController.markDraining(providerId);

    if (this.lifecycleManager) {
      const pod = this.lifecycleManager.listTrackedPods().find(p => p.runpodPodId === providerId || p.id === providerId);
      if (pod) {
        try {
          await this.lifecycleManager.stopPod(pod.id);
          this.scaleInController.clearDraining(providerId);
          return { success: true, message: `Provider ${providerId} drained and stopped successfully` };
        } catch (err) {
          this.scaleInController.clearDraining(providerId);
          return { success: false, message: `Drain failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
    }

    return { success: true, message: `Provider ${providerId} marked as draining (no new jobs will be assigned)` };
  }

  /**
   * Records warm model affinity key for a provider after successful job execution.
   */
  recordWarmAffinity(providerId: string, job: GenerationJob): void {
    const key = this.affinityPlanner.computeAffinityKey(job);
    this.warmAffinityMap.set(providerId, key);
  }

  /**
   * Dispatches next available job to an available slot, considering affinity.
   */
  findNextJobForProvider(providerId: string, candidateJobs: GenerationJob[]): GenerationJob | null {
    if (candidateJobs.length === 0 || this.dispatchWindow.paused) return null;

    // Check if slot is available
    if (this.dispatchWindow.getAvailableSlots(providerId) <= 0) return null;

    // Calculate priority + affinity bonus for each candidate
    let bestJob: GenerationJob | null = null;
    let highestScore = -Infinity;

    for (const job of candidateJobs) {
      const affinityBonus = this.affinityPlanner.calculateAffinityBonus(job, providerId, this.warmAffinityMap);
      const score = job.priority + affinityBonus;

      if (score > highestScore) {
        highestScore = score;
        bestJob = job;
      }
    }

    return bestJob;
  }

  getActiveScalePlan(): ScalePlan | null {
    return this.latestPlan;
  }
}
