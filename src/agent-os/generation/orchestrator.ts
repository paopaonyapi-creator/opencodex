// Phase 19 & Phase 20 — Job Orchestrator.
//
// Pulls claimed jobs through the explicit state machine, analyzes requirements,
// routes to Local ComfyUI or RunPod GPU via IntelligentWorkloadRouter,
// executes against the real ComfyUI HTTP API, downloads outputs into asset storage,
// runs the Reviewer Council chain, attributes compute costs, and completes
// metadata/export stages. The worker is non-blocking (setTimeout loop),
// heartbeat-driven, and safe across restarts.

import { randomUUID } from "node:crypto";
import { ComfyUiClient, ComfyUiRequestError } from "./comfyui-client";
import { loadGenerationConfig, type GenerationConfig } from "./config";
import { applyBindings, getWorkflow, getModel, type BindingValues } from "./registry";
import {
  claimNextJob, claimSpecificJob, listJobs, getJob, recordGenerationAudit, recordJobEvent, requestCancel,
  retryFailedJob, updateJob, heartbeatJob,
} from "./queue";
import { recordProviderHealth, selectProvider } from "./providers";
import { LocalAssetStorage } from "./storage";
import { configureReviewerThresholds, evaluateAssetByGenerationCouncil } from "./reviewer";
import { createExportPackage, generateStockMetadata } from "./stock";
import type { GenerationJob, JobErrorCode, RoutingMode } from "./types";
import { IntelligentWorkloadRouter } from "./routing/router";
import { CostGuard } from "./cost/cost-guard";
import { attributeCostToJobAssets } from "./cost/meter";
import { RunPodClient } from "./cloud/runpod/client";
import { CloudLifecycleManager } from "./cloud/lifecycle-manager";
import { AssetSynchronizer } from "./sync/asset-sync";
import { SmartQueueController } from "./smart-queue";
import type { BurstMode } from "./smart-queue/types";

const WORKER_ID = `worker_${randomUUID().slice(0, 8)}`;

function mapComfyError(error: unknown): { code: JobErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ComfyUiRequestError) {
    if (error.kind === "timeout") return { code: "provider_timeout", message };
    if (error.kind === "offline") return { code: "provider_offline", message };
    return { code: "workflow_invalid", message };
  }
  return { code: "internal", message };
}

function resolveModelCheckpoint(modelId: string): string | undefined {
  const model = getModel(modelId);
  return model?.checkpointName;
}

export class GenerationOrchestrator {
  readonly config: GenerationConfig;
  readonly storage: LocalAssetStorage;
  readonly router: IntelligentWorkloadRouter;
  readonly costGuard: CostGuard;
  readonly assetSync: AssetSynchronizer;
  readonly lifecycleManager: CloudLifecycleManager | null;
  readonly smartQueue: SmartQueueController | null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeComfy: Map<string, {
    client: ComfyUiClient;
    promptId: string;
    runpodPodId?: string;
    estimatedCost?: number;
    providerId?: string;
    leaseId?: string;
  }> = new Map();

  constructor(config?: GenerationConfig) {
    this.config = config ?? loadGenerationConfig();
    configureReviewerThresholds(this.config);
    this.storage = new LocalAssetStorage({ root: this.config.storagePath });
    this.assetSync = new AssetSynchronizer(this.storage);

    this.router = new IntelligentWorkloadRouter({
      preferLocal: this.config.gpuPreferLocal,
      localGpuVramGb: 16,
      cloudBurstQueueThreshold: this.config.cloudBurstQueueThreshold,
      maxGpuPricePerHour: this.config.runpodMaxGpuPricePerHour,
    });

    this.costGuard = new CostGuard({
      maxGpuPricePerHour: this.config.runpodMaxGpuPricePerHour,
      maxEstimatedCostPerJob: this.config.runpodMaxEstimatedCostPerJob,
      dailyBudget: this.config.runpodDailyBudget,
      monthlyBudget: this.config.runpodMonthlyBudget,
      maxActivePods: this.config.runpodMaxActivePods,
      requireApproval: this.config.runpodRequireApproval,
    });

    if (this.config.runpodEnabled && this.config.runpodApiKey) {
      const runpodClient = new RunPodClient({
        apiKey: this.config.runpodApiKey,
        baseUrl: this.config.runpodApiBaseUrl,
        allowCustomHost: true,
      });
      this.lifecycleManager = new CloudLifecycleManager({
        client: runpodClient,
        costGuard: this.costGuard,
        defaultTemplateId: this.config.runpodDefaultTemplateId,
        idleStopMinutes: this.config.runpodIdleStopMinutes,
        autoStop: this.config.runpodAutoStop,
      });
    } else {
      this.lifecycleManager = null;
    }

    if (this.config.smartQueueEnabled) {
      this.smartQueue = new SmartQueueController({
        config: {
          enabled: this.config.smartQueueEnabled,
          observerIntervalSeconds: this.config.queueObserverIntervalSeconds,
          burstMode: (this.config.queueBurstMode.toUpperCase() as BurstMode) || "ASSISTED",
          burstSoftDepth: this.config.queueBurstSoftDepth,
          burstHardDepth: this.config.queueBurstHardDepth,
          targetDrainMinutes: this.config.queueTargetDrainMinutes,
          maxLocalWaitMinutes: this.config.queueMaxLocalWaitMinutes,
          minBurstTimeSavingPercent: this.config.queueMinBurstTimeSavingPercent,
          scaleUpCooldownSeconds: this.config.queueScaleUpCooldownSeconds,
          scaleUpStableWindowSeconds: this.config.queueScaleUpStableWindowSeconds,
          scaleDownCooldownSeconds: this.config.queueScaleDownCooldownSeconds,
          scaleDownStableWindowSeconds: this.config.queueScaleDownStableWindowSeconds,
          providerMaxPending: this.config.queueProviderMaxPending,
          maxPrefetchJobsPerProvider: this.config.queueMaxPrefetchJobsPerProvider,
          batchChunkSize: this.config.queueBatchChunkSize,
          maxConcurrentPerProject: this.config.queueMaxConcurrentPerProject,
          affinityWarmMinutes: this.config.queueAffinityWarmMinutes,
          aggressiveScaleUp: this.config.queueAggressiveScaleUp,
        },
        localComfyUrl: this.config.comfyuiBaseUrl,
        router: this.router,
        costGuard: this.costGuard,
        lifecycleManager: this.lifecycleManager,
      });
    } else {
      this.smartQueue = null;
    }
  }

  /** Startup diagnostics (spec section 66): recovery + non-blocking health. */
  startup(): { enabled: boolean; recoveredJobs: number; removedTempDirs: number } {
    if (!this.config.enabled) return { enabled: false, recoveredJobs: 0, removedTempDirs: 0 };
    let recoveredJobs = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { recoverStaleJobs } = require("./queue") as typeof import("./queue");
      recoveredJobs = recoverStaleJobs(120_000);
    } catch { /* startup sweep is best-effort */ }
    const removedTempDirs = this.storage.cleanupTempDirs(this.config.tempPath, this.config.tempRetentionHours);
    void this.refreshProviderHealth().catch(() => { /* degraded, not fatal */ });

    // Phase 20: reconcile live RunPod state if active
    if (this.lifecycleManager) {
      void this.lifecycleManager.reconcileWithRunPod().catch(() => { /* best-effort */ });
    }

    return { enabled: true, recoveredJobs, removedTempDirs };
  }

  async refreshProviderHealth(): Promise<void> {
    const client = new ComfyUiClient({
      baseUrl: this.config.comfyuiBaseUrl,
      timeoutMs: Math.min(this.config.comfyuiTimeoutSeconds * 1000, 10_000),
    });
    const health = await client.healthCheck();
    recordProviderHealth("comfyui-local", health.healthy ? "healthy" : "offline");
  }

  start(intervalMs = 1_000): void {
    if (!this.config.enabled || this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      void this.processTick().finally(() => {
        if (this.running) {
          this.timer = setTimeout(tick, intervalMs);
          this.timer.unref?.();
        }
      });
    };
    this.timer = setTimeout(tick, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  isRunning(): boolean {
    return this.running;
  }

  activeJobIds(): string[] {
    return [...this.activeComfy.keys()];
  }

  /** One orchestration pass: claim jobs according to provider slots, poll active prompts and check idle pods. */
  async processTick(): Promise<void> {
    if (this.smartQueue) {
      await this.smartQueue.tick().catch(() => {});

      if (!this.smartQueue.paused) {
        // Collect providers with available slots
        const providers: string[] = [];
        if (this.smartQueue.dispatchWindow.getAvailableSlots("comfyui-local", this.config.queueMaxPrefetchJobsPerProvider) > 0) {
          providers.push("comfyui-local");
        }
        if (this.lifecycleManager) {
          const activePods = this.lifecycleManager.listTrackedPods().filter(p => p.actualState === "RUNNING");
          for (const pod of activePods) {
            if (this.smartQueue.dispatchWindow.getAvailableSlots(pod.runpodPodId, this.config.queueMaxPrefetchJobsPerProvider) > 0) {
              providers.push(pod.runpodPodId);
            }
          }
        }

        // For each provider with an open slot, find candidate job and dispatch
        for (const providerId of providers) {
          const openSlots = this.smartQueue.dispatchWindow.getAvailableSlots(providerId, this.config.queueMaxPrefetchJobsPerProvider);
          if (openSlots <= 0) continue;

          const candidateList = listJobs({ status: "queued", limit: 20 });
          if (candidateList.jobs.length === 0) break;

          const chosenJob = this.smartQueue.findNextJobForProvider(providerId, candidateList.jobs);
          if (!chosenJob) continue;

          const claimed = claimSpecificJob(chosenJob.id, WORKER_ID);
          if (!claimed) continue;

          const slotLease = this.smartQueue.dispatchWindow.acquireSlot(
            providerId,
            claimed.id,
            `attempt_${claimed.id}`,
            this.config.queueMaxPrefetchJobsPerProvider,
          );

          await this.executeJob(claimed, providerId, slotLease?.leaseId).catch(error => {
            const mapped = mapComfyError(error);
            if (slotLease) this.smartQueue?.dispatchWindow.releaseSlot(slotLease.leaseId);
            this.smartQueue?.dispatchWindow.releaseJobSlots(claimed.id);
            try { retryFailedJob(claimed.id, mapped.code, mapped.message); } catch { /* already handled */ }
          });
        }
      }
    } else {
      if (this.activeComfy.size === 0) {
        const job = claimNextJob(WORKER_ID);
        if (job) {
          await this.executeJob(job).catch(error => {
            const mapped = mapComfyError(error);
            try { retryFailedJob(job.id, mapped.code, mapped.message); } catch { /* already failed */ }
          });
        }
      }
    }

    await this.pollActivePrompts();

    // Periodic idle pod auto-stop check
    if (this.lifecycleManager) {
      void this.lifecycleManager.checkIdleAndStopPods().catch(() => {});
    }
  }

  private async pollActivePrompts(): Promise<void> {
    for (const [jobId, active] of [...this.activeComfy.entries()]) {
      const job = getJob(jobId);
      if (!job) {
        if (active.runpodPodId && this.lifecycleManager) {
          this.lifecycleManager.unassignJobFromPod(active.runpodPodId);
        }
        if (active.leaseId && this.smartQueue) {
          this.smartQueue.dispatchWindow.releaseSlot(active.leaseId);
        }
        this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
        this.activeComfy.delete(jobId);
        continue;
      }
      heartbeatJob(jobId, WORKER_ID);
      if (active.leaseId && this.smartQueue) {
        this.smartQueue.dispatchWindow.heartbeatSlot(active.leaseId);
      }
      if (job.cancelRequested) {
        await active.client.interrupt().catch(() => { /* provider may finish first */ });
        requestCancel(jobId, job.cancelReason ?? "cancelled by user");
        updateJob(jobId, { status: "cancelled", stage: null, errorCode: "cancelled", errorMessage: job.cancelReason ?? "cancelled by user" });
        if (active.runpodPodId && this.lifecycleManager) {
          this.lifecycleManager.unassignJobFromPod(active.runpodPodId);
        }
        if (active.leaseId && this.smartQueue) {
          this.smartQueue.dispatchWindow.releaseSlot(active.leaseId);
        }
        this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
        this.activeComfy.delete(jobId);
        continue;
      }
      const history = await active.client.getHistory(active.promptId).catch(() => null);
      if (!history) continue;
      if (history.status?.completed && history.outputs && Object.keys(history.outputs).length > 0) {
        this.activeComfy.delete(jobId);
        if (active.leaseId && this.smartQueue) {
          this.smartQueue.dispatchWindow.releaseSlot(active.leaseId);
        }
        this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
        await this.completeGenerationStage(job.id, active.client, active.promptId, active.runpodPodId, active.estimatedCost, active.providerId);
      } else if (history.status?.completed) {
        // Completed with no outputs = corrupted/empty run.
        if (active.runpodPodId && this.lifecycleManager) {
          this.lifecycleManager.unassignJobFromPod(active.runpodPodId);
        }
        if (active.leaseId && this.smartQueue) {
          this.smartQueue.dispatchWindow.releaseSlot(active.leaseId);
        }
        this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
        this.activeComfy.delete(jobId);
        retryFailedJob(jobId, "output_corrupted", "ComfyUI completed without output files");
      }
    }
  }

  /** Full pipeline for one claimed job up to the parking point. */
  async executeJob(job: GenerationJob, targetProviderId?: string, leaseId?: string): Promise<void> {
    const cleanupLeases = () => {
      if (leaseId && this.smartQueue) this.smartQueue.dispatchWindow.releaseSlot(leaseId);
      this.smartQueue?.dispatchWindow.releaseJobSlots(job.id);
    };

    const fresh = getJob(job.id);
    if (fresh?.cancelRequested) {
      cleanupLeases();
      updateJob(job.id, { status: "cancelled", errorCode: "cancelled", errorMessage: fresh.cancelReason ?? "cancelled" });
      return;
    }
    heartbeatJob(job.id, WORKER_ID);

    // ---- validating
    updateJob(job.id, { status: "validating", stage: "validating", progress: 0.02 });
    const workflow = job.workflowId ? getWorkflow(job.workflowId, job.workflowVersion ?? undefined) : null;
    if (!workflow || !workflow.enabled) {
      cleanupLeases();
      retryFailedJob(job.id, "workflow_invalid", `workflow ${job.workflowId ?? "(none)"} not found or disabled`);
      return;
    }
    if (!job.prompt.trim()) {
      cleanupLeases();
      retryFailedJob(job.id, "validation_error", "prompt is required");
      return;
    }

    // Commercial license safety check for Stock Mode
    if (job.stockMode && job.modelId) {
      const commCheck = this.assetSync.assertCommercialLicenseSafe(job.modelId, true);
      if (!commCheck.allowed) {
        cleanupLeases();
        retryFailedJob(job.id, "RP_MODEL_SYNC_FAILED", commCheck.reason ?? "Model blocked for stock mode");
        return;
      }
    }

    // ---- selecting_provider & routing (Phase 20 & 20.1)
    updateJob(job.id, { status: "selecting_provider", stage: "selecting_provider", progress: 0.05 });
    const mode = (job.parameters?.routing_mode as RoutingMode) ?? undefined;

    let selectedProvider: string;
    let selectedInstanceId: string | undefined;
    let estimatedJobCost = 0;
    let decisionReason = "";

    if (targetProviderId && targetProviderId !== "comfyui-local") {
      selectedProvider = "runpod";
      selectedInstanceId = targetProviderId;
      estimatedJobCost = 0.05;
      decisionReason = `Smart Queue dispatched to RunPod GPU ${targetProviderId}`;
    } else if (targetProviderId === "comfyui-local") {
      selectedProvider = "local";
      estimatedJobCost = 0;
      decisionReason = "Smart Queue dispatched to local ComfyUI GPU";
    } else {
      const decision = await this.router.routeJob(job, mode);
      selectedProvider = decision.selectedProvider;
      selectedInstanceId = decision.selectedInstanceId ?? undefined;
      estimatedJobCost = decision.estimatedJobCost ?? 0;
      decisionReason = decision.reason;
    }

    let client: ComfyUiClient;
    let runpodPodId: string | undefined;

    if (selectedProvider === "runpod" && this.lifecycleManager) {
      updateJob(job.id, { status: "provisioning", stage: "provisioning", progress: 0.08 });
      recordJobEvent(job.id, "stage_changed", "provisioning", 0.08, decisionReason);

      let podReadyUrl: string | null = null;
      if (selectedInstanceId) {
        // Reuse existing warm pod
        runpodPodId = selectedInstanceId;
        const readyInfo = await this.lifecycleManager.waitForPodReady(runpodPodId, 30);
        podReadyUrl = readyInfo.baseUrl;
      } else {
        // Provision new on-demand pod
        const podRecord = await this.lifecycleManager.provisionPod({
          jobId: job.id,
          gpuType: "NVIDIA GeForce RTX 4090",
          hourlyPrice: 0.74,
          estimatedCost: estimatedJobCost,
        });
        runpodPodId = podRecord.runpodPodId;
        updateJob(job.id, { status: "waiting_provider_ready", stage: "waiting_provider_ready", progress: 0.12 });
        const readyInfo = await this.lifecycleManager.waitForPodReady(runpodPodId, 300);
        podReadyUrl = readyInfo.baseUrl;
      }

      this.lifecycleManager.assignJobToPod(runpodPodId, job.id);
      client = new ComfyUiClient({ baseUrl: podReadyUrl, timeoutMs: 300_000 });
    } else {
      // ---- preparing local provider
      updateJob(job.id, { status: "preparing", stage: "preparing", progress: 0.08 });
      const provider = selectProvider(job.providerId);
      if (!provider) {
        cleanupLeases();
        retryFailedJob(job.id, "provider_offline", "no generation provider configured");
        return;
      }
      updateJob(job.id, { providerId: provider.id });
      client = new ComfyUiClient({ baseUrl: provider.baseUrl, timeoutMs: provider.timeoutSeconds * 1000 });
      const health = await client.healthCheck();
      recordProviderHealth(provider.id, health.healthy ? "healthy" : "offline");
      if (!health.healthy) {
        cleanupLeases();
        retryFailedJob(job.id, "provider_offline", health.error ?? "provider unreachable");
        return;
      }
    }

    // Resolve seed BEFORE queueing (spec section 92).
    const resolvedSeed = job.seed >= 0 ? job.seed : Math.floor(Math.random() * 1_000_000_000);
    const checkpoint = job.modelId ? resolveModelCheckpoint(job.modelId) : undefined;
    if (job.modelId && !checkpoint) {
      if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
      cleanupLeases();
      retryFailedJob(job.id, "model_missing", `model ${job.modelId} not registered`);
      return;
    }
    const bindingValues: BindingValues = {
      prompt: job.prompt,
      negative_prompt: job.negativePrompt || undefined,
      seed: resolvedSeed,
      width: job.width,
      height: job.height,
      batch_size: job.batchSize,
      model: checkpoint,
    };
    const applied = applyBindings(workflow, bindingValues);
    if (applied.missing.length > 0) {
      if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
      cleanupLeases();
      retryFailedJob(job.id, "workflow_invalid", `binding targets missing in workflow: ${applied.missing.join(", ")}`);
      return;
    }

    // ---- generating
    updateJob(job.id, { status: "generating", stage: "generating", progress: 0.15, resolvedSeed });
    recordJobEvent(job.id, "stage_changed", "generating", 0.15, `queued to provider ${selectedProvider}`);
    let promptId: string;
    try {
      const queued = await client.queuePrompt(applied.graph);
      promptId = queued.promptId;
    } catch (error) {
      if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
      cleanupLeases();
      const mapped = mapComfyError(error);
      retryFailedJob(job.id, mapped.code, mapped.message);
      return;
    }
    this.activeComfy.set(job.id, {
      client,
      promptId,
      runpodPodId,
      estimatedCost: estimatedJobCost,
      providerId: targetProviderId ?? (selectedProvider === "runpod" ? runpodPodId : "comfyui-local"),
      leaseId,
    });
    recordJobEvent(job.id, "progress", "generating", 0.2, `ComfyUI prompt ${promptId}`);
  }

  /** post_processing -> reviewing -> qc -> metadata -> exporting -> completed. */
  private async completeGenerationStage(
    jobId: string,
    client: ComfyUiClient,
    promptId: string,
    runpodPodId?: string,
    estimatedCost?: number,
    providerId?: string,
  ): Promise<void> {
    const job = getJob(jobId);
    if (!job) return;
    updateJob(jobId, { status: "post_processing", stage: "post_processing", progress: 0.75 });
    const history = await client.getHistory(promptId).catch(() => null);
    if (!history) {
      if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
      this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
      retryFailedJob(jobId, "output_corrupted", "ComfyUI history vanished before download");
      return;
    }
    try {
      const assetIds: string[] = [];
      for (const nodeOutput of Object.values(history.outputs)) {
        for (const outputs of Object.values(nodeOutput)) {
          for (const output of outputs ?? []) {
            const fetched = await client.fetchOutput(output);
            const asset = this.storage.saveAsset({
              projectId: job.projectId,
              jobId: job.id,
              assetType: "image",
              role: "generated",
              bytes: fetched.bytes,
              mimeType: fetched.contentType.split(";")[0]!.trim(),
              prompt: job.prompt,
              negativePrompt: job.negativePrompt,
              seed: job.resolvedSeed ?? job.seed,
              modelId: job.modelId,
              workflowId: job.workflowId,
              workflowVersion: job.workflowVersion,
              providerId: job.providerId,
              generationMetadata: {
                comfy_prompt_id: promptId,
                comfy_node: output.filename,
                estimated_compute_cost: estimatedCost ?? 0,
              },
            });
            assetIds.push(asset.id);
            recordJobEvent(jobId, "output_created", "post_processing", 0.8, `asset ${asset.id}`);
          }
        }
      }
      if (assetIds.length === 0) {
        if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
        this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
        retryFailedJob(jobId, "output_corrupted", "no output files in ComfyUI history");
        return;
      }

      // Attribute cost to assets
      if (estimatedCost) {
        attributeCostToJobAssets(jobId, estimatedCost);
      }

      // Unassign RunPod pod once execution and downloads complete
      if (runpodPodId && this.lifecycleManager) {
        this.lifecycleManager.unassignJobFromPod(runpodPodId);
      }

      // Record warm model affinity in Smart Queue
      if (this.smartQueue) {
        this.smartQueue.recordWarmAffinity(providerId ?? job.providerId ?? "comfyui-local", job);
      }

      // ---- reviewing + qc (Reviewer Council reuse)
      updateJob(jobId, { status: "reviewing", stage: "reviewing", progress: 0.85 });
      recordJobEvent(jobId, "review_started", "reviewing", 0.85, "generation reviewer council");
      let lastDecision = "PASS";
      for (const assetId of assetIds) {
        const asset = this.storage.getAsset(assetId);
        if (!asset) continue;
        const evaluation = evaluateAssetByGenerationCouncil(asset);
        lastDecision = evaluation.decision;
        recordJobEvent(jobId, "review_completed", "qc", 0.9, `${assetId}: ${evaluation.decision} (${evaluation.overallScore})`);
      }
      updateJob(jobId, { status: "qc", stage: "qc", progress: 0.92 });

      // ---- metadata (auto chain per request flags)
      updateJob(jobId, { status: "metadata", stage: "metadata", progress: 0.93 });
      if (job.autoMetadata) {
        for (const assetId of assetIds) {
          const asset = this.storage.getAsset(assetId);
          if (!asset) continue;
          const meta = generateStockMetadata(asset);
          recordJobEvent(jobId, "metadata_completed", "metadata", 0.95, `${assetId}: valid=${meta.validation.valid}`);
        }
      }

      // ---- exporting (auto chain, gated by stock safety gate)
      if (job.autoExport) {
        updateJob(jobId, { status: "exporting", stage: "exporting", progress: 0.97 });
        for (const assetId of assetIds) {
          const asset = this.storage.getAsset(assetId);
          if (!asset) continue;
          const result = createExportPackage({ asset, storage: this.storage });
          recordJobEvent(jobId, "export_completed", "exporting", 0.99, `${assetId}: ${result.gate.mode}${result.gate.allowed ? "" : ` blocked (${result.gate.blockers.join("; ")})`}`);
        }
      }

      recordGenerationAudit({
        actor: "orchestrator",
        action: "job.completed",
        subjectType: "gen_job",
        subjectId: jobId,
        details: { assets: assetIds, decision: lastDecision, runpodPodId },
      });
      updateJob(jobId, { status: "completed", stage: null, progress: 1, errorCode: null, errorMessage: null });
      recordJobEvent(jobId, "completed", null, 1, `assets: ${assetIds.join(", ")}`);
    } catch (error) {
      if (runpodPodId && this.lifecycleManager) this.lifecycleManager.unassignJobFromPod(runpodPodId);
      this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
      const mapped = mapComfyError(error);
      retryFailedJob(jobId, mapped.code, mapped.message);
    }
  }

  /** Cancel a running/queued job (spec section 54). */
  async cancel(jobId: string, reason: string, requestedBy: string): Promise<boolean> {
    recordGenerationAudit({ actor: requestedBy, action: "job.cancel", subjectType: "gen_job", subjectId: jobId, details: { reason } });
    this.smartQueue?.dispatchWindow.releaseJobSlots(jobId);
    const active = this.activeComfy.get(jobId);
    if (active) {
      await active.client.interrupt().catch(() => { /* provider race */ });
      if (active.runpodPodId && this.lifecycleManager) {
        this.lifecycleManager.unassignJobFromPod(active.runpodPodId);
      }
      if (active.leaseId && this.smartQueue) {
        this.smartQueue.dispatchWindow.releaseSlot(active.leaseId);
      }
    }
    const result = requestCancel(jobId, reason);
    return result !== null;
  }
}

/** Process-wide singleton wired from server lifecycle. */
let orchestratorSingleton: GenerationOrchestrator | null = null;

export function getGenerationOrchestrator(): GenerationOrchestrator {
  if (!orchestratorSingleton) orchestratorSingleton = new GenerationOrchestrator();
  return orchestratorSingleton;
}

export function resetGenerationOrchestratorForTests(): void {
  orchestratorSingleton?.stop();
  orchestratorSingleton = null;
}
