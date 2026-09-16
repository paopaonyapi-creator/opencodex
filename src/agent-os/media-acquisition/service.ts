// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Master Media Acquisition Service & Facade

import { join } from "node:path";
import type {
  InspectRequest,
  InspectResult,
  DownloadRequest,
  MediaJob,
  BatchDownloadRequest,
  BatchDownloadResult,
  MediaArtifact,
  ProviderHealth,
  ProviderName,
  TranscriptResult,
  BridgePairingRequest,
  BridgePairingResponse,
  BridgeDispatchRequest,
} from "./types";
import { MediaProviderRouter } from "./provider-router";
import { MediaQueueEngine } from "./queue-engine";
import { initMediaStorage, generateSafeMediaFilename, assertPathInsideRoot } from "./storage";
import { MediaProcessor, type ProcessingPreset } from "./media-processor";
import { TranscriptionProvider } from "./transcription-provider";
import { ArtifactRegistry } from "./artifact-registry";
import { MediaSecretsVault } from "./vault";
import { MediaPermissionEngine } from "./permission";
import { LocalBridgeSecurity } from "./local-bridge";
import { MediaAuditLogger } from "./audit";
import { MediaMetricsTracker } from "./metrics";
import { validateAndNormalizeUrl } from "./url-policy";
import { MediaError } from "./errors";

export class MediaAcquisitionService {
  readonly router = new MediaProviderRouter();
  readonly queue = new MediaQueueEngine();
  readonly storage = initMediaStorage();
  readonly processor = new MediaProcessor();
  readonly transcriber = new TranscriptionProvider();
  readonly registry = new ArtifactRegistry();
  readonly vault = new MediaSecretsVault();
  readonly permissions = new MediaPermissionEngine();
  readonly bridge = new LocalBridgeSecurity();
  readonly audit = new MediaAuditLogger();
  readonly metrics = new MediaMetricsTracker();

  private isRunningWorker = false;

  constructor() {
    this.startBackgroundQueueWorker();
  }

  async inspect(request: InspectRequest): Promise<InspectResult> {
    this.permissions.assertAllowed("inspect", { url: request.url });
    const policy = validateAndNormalizeUrl(request.url);

    try {
      const result = await this.router.inspect(request);
      this.audit.log({
        actor: "agent",
        tool: "media.inspect",
        action: "inspect",
        domain: policy.domain,
        permissionDecision: "allowed",
        provider: result.provider,
        details: { title: result.title, mediaType: result.mediaType },
      });
      return result;
    } catch (err) {
      this.metrics.recordProviderFailure();
      this.audit.log({
        actor: "agent",
        tool: "media.inspect",
        action: "inspect",
        domain: policy.domain,
        permissionDecision: "allowed",
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  async enqueueDownload(request: DownloadRequest): Promise<MediaJob> {
    this.permissions.assertAllowed("download", { url: request.url, secretRef: request.secretRef });
    const policy = validateAndNormalizeUrl(request.url);

    const safeFilename = generateSafeMediaFilename({
      platform: policy.platform,
      jobId: Date.now().toString(36),
      title: request.preset || "media",
      ext: request.preset === "audio" ? "mp3" : "mp4",
    });

    const targetOutput = join(this.storage.incomingDir, safeFilename);
    assertPathInsideRoot(targetOutput, this.storage.rootDir);

    const job = this.queue.createJob({
      sourceUrl: policy.normalizedUrl,
      preset: request.preset,
      priority: request.priority,
      usageClass: request.usageClass,
      requestedBy: request.requestedBy,
      outputPath: targetOutput,
    });

    this.audit.log({
      actor: request.requestedBy || "agent",
      tool: "media.download",
      action: "enqueue",
      jobId: job.id,
      domain: policy.domain,
      permissionDecision: "allowed",
      details: { preset: job.preset, usageClass: job.usageClass },
    });

    // Trigger queue processing turn
    this.processQueueLoop();
    return job;
  }

  async batchDownload(request: BatchDownloadRequest): Promise<BatchDownloadResult> {
    const jobIds: string[] = [];
    const batchId = `batch_${Date.now().toString(36)}`;

    for (const url of request.urls) {
      const job = await this.enqueueDownload({
        url,
        preset: request.preset,
        priority: request.priority,
        requestedBy: request.requestedBy,
      });
      jobIds.push(job.id);
    }

    return {
      batchId,
      totalUrls: request.urls.length,
      jobIds,
    };
  }

  private startBackgroundQueueWorker(): void {
    if (this.isRunningWorker) return;
    this.isRunningWorker = true;
    setInterval(() => this.processQueueLoop(), 3000);
  }

  private async processQueueLoop(): Promise<void> {
    const queuedJobs = this.queue.listJobs("queued");
    for (const job of queuedJobs) {
      const policy = validateAndNormalizeUrl(job.sourceUrl);
      if (!this.queue.canRunNext(policy.domain)) {
        continue;
      }

      this.queue.acquireDomainSlot(policy.domain);
      this.executeJob(job, policy.domain).finally(() => {
        this.queue.releaseDomainSlot(policy.domain);
      });
    }
  }

  private async executeJob(job: MediaJob, domain: string): Promise<void> {
    const startTime = Date.now();
    this.queue.updateJob(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    this.metrics.recordJobStarted();

    try {
      const res = await this.router.download(job, (progress) => {
        this.queue.updateJob(job.id, progress);
      });

      this.queue.updateJob(job.id, { status: "processing", progressPercent: 95 });

      // Register newly created media artifact
      const artifact = await this.registry.registerArtifact({
        jobId: job.id,
        type: job.preset === "audio" ? "audio" : "video",
        sourceUrl: job.sourceUrl,
        sourcePlatform: domain,
        title: `${domain.toUpperCase()} Asset`,
        localPath: res.outputPath,
        usageClass: job.usageClass,
      });

      const durationMs = Date.now() - startTime;
      this.queue.updateJob(job.id, {
        status: "completed",
        finishedAt: new Date().toISOString(),
        outputArtifactId: artifact.artifactId,
        progressPercent: 100,
        downloadedBytes: artifact.sizeBytes,
        totalBytes: artifact.sizeBytes,
      });

      this.metrics.recordJobCompleted(artifact.sizeBytes, durationMs);
      this.audit.log({
        actor: job.requestedBy,
        tool: "media.download",
        action: "completed",
        jobId: job.id,
        domain,
        permissionDecision: "allowed",
        details: { artifactId: artifact.artifactId, sizeBytes: artifact.sizeBytes },
      });
    } catch (err) {
      this.metrics.recordJobFailed();
      const isRetryable = err instanceof MediaError && err.retryable;
      if (isRetryable && job.retryCount < job.maxRetries) {
        this.metrics.recordRetry();
        this.queue.updateJob(job.id, {
          status: "retry_wait",
          retryCount: job.retryCount + 1,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        setTimeout(() => {
          this.queue.updateJob(job.id, { status: "queued" });
        }, this.queue.calculateBackoffMs(job.retryCount));
      } else {
        this.queue.updateJob(job.id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorCode: err instanceof MediaError ? err.code : "MEDIA_DOWNLOAD_FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async extractAudio(artifactId: string): Promise<MediaArtifact> {
    this.permissions.assertAllowed("extract_audio");
    const sourceArt = this.registry.getArtifact(artifactId);
    if (!sourceArt) {
      throw new MediaError("MEDIA_NOT_FOUND", `Artifact '${artifactId}' not found.`);
    }

    const outPath = join(this.storage.processedDir, `${sourceArt.artifactId}_audio.mp3`);
    await this.processor.processWithPreset(sourceArt.localPath, outPath, "audio_mp3");

    return await this.registry.registerArtifact({
      jobId: sourceArt.jobId,
      type: "audio",
      sourceUrl: sourceArt.sourceUrl,
      sourcePlatform: sourceArt.sourcePlatform,
      title: `${sourceArt.title} (Audio)`,
      localPath: outPath,
      usageClass: sourceArt.usageClass,
      derivedFromArtifactId: sourceArt.artifactId,
    });
  }

  async transcribe(artifactId: string, language?: string): Promise<TranscriptResult> {
    this.permissions.assertAllowed("transcribe");
    const sourceArt = this.registry.getArtifact(artifactId);
    if (!sourceArt) {
      throw new MediaError("MEDIA_NOT_FOUND", `Artifact '${artifactId}' not found.`);
    }

    // If video, extract audio first or transcribe direct audio
    let audioPath = sourceArt.localPath;
    if (sourceArt.type === "video") {
      const audioArt = await this.extractAudio(artifactId);
      audioPath = audioArt.localPath;
    }

    return await this.transcriber.transcribe(audioPath, {
      sourceArtifactId: sourceArt.artifactId,
      language,
    });
  }

  async convert(artifactId: string, preset: ProcessingPreset): Promise<MediaArtifact> {
    this.permissions.assertAllowed("convert");
    const sourceArt = this.registry.getArtifact(artifactId);
    if (!sourceArt) {
      throw new MediaError("MEDIA_NOT_FOUND", `Artifact '${artifactId}' not found.`);
    }

    const ext = preset.includes("audio") ? "mp3" : preset.includes("thumbnail") ? "jpg" : "mp4";
    const outPath = join(this.storage.processedDir, `${sourceArt.artifactId}_${preset}.${ext}`);
    await this.processor.processWithPreset(sourceArt.localPath, outPath, preset);

    return await this.registry.registerArtifact({
      jobId: sourceArt.jobId,
      type: preset.includes("audio") ? "audio" : preset.includes("thumbnail") ? "image" : "video",
      sourceUrl: sourceArt.sourceUrl,
      sourcePlatform: sourceArt.sourcePlatform,
      title: `${sourceArt.title} (${preset})`,
      localPath: outPath,
      usageClass: sourceArt.usageClass,
      derivedFromArtifactId: sourceArt.artifactId,
    });
  }

  async getHealth(): Promise<Record<ProviderName, ProviderHealth>> {
    return await this.router.checkAllHealth();
  }

  getStatus() {
    return {
      enabled: true,
      storageRoot: this.storage.rootDir,
      queueDepth: this.queue.getQueueDepth(),
      metrics: this.metrics.getSnapshot(this.queue.getQueueDepth()),
      providers: Array.from(this.router.listProviders()).map((p) => p.name),
    };
  }
}

let globalMediaService: MediaAcquisitionService | null = null;

export function getMediaAcquisitionService(): MediaAcquisitionService {
  if (!globalMediaService) {
    globalMediaService = new MediaAcquisitionService();
  }
  return globalMediaService;
}
