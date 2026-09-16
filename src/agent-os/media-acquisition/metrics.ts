// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Telemetry & Metrics Tracker

export interface MediaMetricsSnapshot {
  jobsTotal: number;
  jobsRunning: number;
  jobsCompleted: number;
  jobsFailed: number;
  downloadBytesTotal: number;
  totalDurationMs: number;
  providerFailures: number;
  rateLimitEvents: number;
  retryCount: number;
  queueDepth: number;
}

export class MediaMetricsTracker {
  private jobsTotal = 0;
  private jobsRunning = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private downloadBytesTotal = 0;
  private totalDurationMs = 0;
  private providerFailures = 0;
  private rateLimitEvents = 0;
  private retryCount = 0;

  recordJobStarted(): void {
    this.jobsTotal++;
    this.jobsRunning++;
  }

  recordJobCompleted(bytes: number, durationMs: number): void {
    if (this.jobsRunning > 0) this.jobsRunning--;
    this.jobsCompleted++;
    this.downloadBytesTotal += bytes;
    this.totalDurationMs += durationMs;
  }

  recordJobFailed(): void {
    if (this.jobsRunning > 0) this.jobsRunning--;
    this.jobsFailed++;
  }

  recordProviderFailure(): void {
    this.providerFailures++;
  }

  recordRateLimitEvent(): void {
    this.rateLimitEvents++;
  }

  recordRetry(): void {
    this.retryCount++;
  }

  getSnapshot(queueDepth: number): MediaMetricsSnapshot {
    return {
      jobsTotal: this.jobsTotal,
      jobsRunning: this.jobsRunning,
      jobsCompleted: this.jobsCompleted,
      jobsFailed: this.jobsFailed,
      downloadBytesTotal: this.downloadBytesTotal,
      totalDurationMs: this.totalDurationMs,
      providerFailures: this.providerFailures,
      rateLimitEvents: this.rateLimitEvents,
      retryCount: this.retryCount,
      queueDepth,
    };
  }
}
