// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Priority Job Queue Engine with Exponential Backoff & Concurrency Limiting

import type { MediaJob, JobStatus, JobPriority, DownloadPreset, UsageClass } from "./types";
import { MediaError } from "./errors";
import { validateAndNormalizeUrl } from "./url-policy";

export interface QueueConfig {
  maxGlobalJobs: number;
  maxPerDomain: number;
  maxRetries: number;
}

export type QueueEventListener = (event: {
  type: "job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled";
  job: MediaJob;
}) => void;

export class MediaQueueEngine {
  private jobs = new Map<string, MediaJob>();
  private activeDomains = new Map<string, number>();
  private config: QueueConfig;
  private listeners: QueueEventListener[] = [];
  private paused = false;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      maxGlobalJobs: config?.maxGlobalJobs ?? 3,
      maxPerDomain: config?.maxPerDomain ?? 1,
      maxRetries: config?.maxRetries ?? 3,
    };
  }

  onEvent(listener: QueueEventListener): void {
    this.listeners.push(listener);
  }

  private emit(type: Parameters<QueueEventListener>[0]["type"], job: MediaJob): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, job: { ...job } });
      } catch {
        // Listener error should not break queue
      }
    }
  }

  createJob(params: {
    sourceUrl: string;
    preset?: DownloadPreset;
    priority?: JobPriority;
    usageClass?: UsageClass;
    requestedBy?: string;
    outputPath?: string;
    provider?: string;
  }): MediaJob {
    const policy = validateAndNormalizeUrl(params.sourceUrl);
    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const usageClass = params.usageClass || "research_reference";

    const job: MediaJob = {
      id,
      type: "download",
      provider: params.provider || "omniget",
      sourceUrl: params.sourceUrl,
      normalizedUrl: policy.normalizedUrl,
      status: "queued",
      priority: params.priority || "P2",
      preset: params.preset || "best",
      progressPercent: 0,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      requestedBy: params.requestedBy || "agent",
      usageClass,
      exportToStockAllowed: usageClass === "production_derivative",
      createdAt: new Date().toISOString(),
      outputPath: params.outputPath,
    };

    this.jobs.set(id, job);
    this.emit("job.created", job);
    return job;
  }

  getJob(id: string): MediaJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(statusFilter?: JobStatus): MediaJob[] {
    const all = Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return statusFilter ? all.filter((j) => j.status === statusFilter) : all;
  }

  updateJob(id: string, updates: Partial<MediaJob>): MediaJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new MediaError("MEDIA_NOT_FOUND", `Job '${id}' not found in queue.`);
    }

    Object.assign(job, updates);
    if (updates.status === "running") {
      this.emit("job.started", job);
    } else if (updates.status === "completed") {
      this.emit("job.completed", job);
    } else if (updates.status === "failed") {
      this.emit("job.failed", job);
    } else if (updates.status === "cancelled") {
      this.emit("job.cancelled", job);
    } else if (updates.progressPercent !== undefined) {
      this.emit("job.progress", job);
    }

    return job;
  }

  canRunNext(domain: string): boolean {
    if (this.paused) return false;
    const runningCount = Array.from(this.jobs.values()).filter((j) => j.status === "running").length;
    if (runningCount >= this.config.maxGlobalJobs) return false;

    const domainCount = this.activeDomains.get(domain) || 0;
    return domainCount < this.config.maxPerDomain;
  }

  acquireDomainSlot(domain: string): void {
    const current = this.activeDomains.get(domain) || 0;
    this.activeDomains.set(domain, current + 1);
  }

  releaseDomainSlot(domain: string): void {
    const current = this.activeDomains.get(domain) || 0;
    if (current <= 1) {
      this.activeDomains.delete(domain);
    } else {
      this.activeDomains.set(domain, current - 1);
    }
  }

  cancelJob(id: string): MediaJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new MediaError("MEDIA_NOT_FOUND", `Job '${id}' not found.`);
    }
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    this.emit("job.cancelled", job);
    return job;
  }

  retryJob(id: string): MediaJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new MediaError("MEDIA_NOT_FOUND", `Job '${id}' not found.`);
    }
    job.status = "queued";
    job.retryCount++;
    job.errorCode = undefined;
    job.errorMessage = undefined;
    job.progressPercent = 0;
    this.emit("job.created", job);
    return job;
  }

  calculateBackoffMs(retryCount: number): number {
    // 5s, 15s, 45s exponential progression
    return Math.min(120_000, 5000 * Math.pow(3, retryCount));
  }

  getQueueDepth(): number {
    return Array.from(this.jobs.values()).filter(
      (j) => j.status === "queued" || j.status === "retry_wait",
    ).length;
  }
}
