// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// OmniGet CLI Provider Adapter (GPL-3.0 Clean Process Boundary)

import type {
  MediaProvider,
  InspectRequest,
  InspectResult,
  MediaJob,
  JobStatus,
  ProviderHealth,
  MediaFormat,
  MediaSubtitle,
} from "./types";
import { runProcessSafely } from "./process-runner";
import { validateAndNormalizeUrl } from "./url-policy";
import { MediaError } from "./errors";

export class OmniGetAdapter implements MediaProvider {
  readonly name = "omniget";
  private binaryName = process.platform === "win32" ? "omniget.exe" : "omniget";
  private activeJobs = new Map<string, { abort: () => void }>();

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const res = await runProcessSafely({
        binary: this.binaryName,
        args: ["--version"],
        timeoutMs: 5000,
      });

      const latencyMs = Date.now() - startTime;
      if (res.exitCode === 0) {
        return {
          provider: this.name,
          status: "healthy",
          available: true,
          version: res.stdout.trim() || "1.0.0",
          lastCheckedAt: new Date().toISOString(),
          latencyMs,
          capabilities: {
            formats: ["mp4", "mkv", "webm", "mp3", "m4a", "wav"],
            supportsSubtitles: true,
            supportsAudioExtraction: true,
            supportsBatch: true,
            supportsThumbnails: true,
            maxResolution: "4K",
          },
        };
      }

      return {
        provider: this.name,
        status: "offline",
        available: false,
        lastCheckedAt: new Date().toISOString(),
        latencyMs,
        errorMessage: `OmniGet returned exit code ${res.exitCode}: ${res.stderr.trim()}`,
        capabilities: {
          formats: [],
          supportsSubtitles: false,
          supportsAudioExtraction: false,
          supportsBatch: false,
          supportsThumbnails: false,
        },
      };
    } catch (err) {
      return {
        provider: this.name,
        status: "offline",
        available: false,
        lastCheckedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
        capabilities: {
          formats: [],
          supportsSubtitles: false,
          supportsAudioExtraction: false,
          supportsBatch: false,
          supportsThumbnails: false,
        },
      };
    }
  }

  async inspect(request: InspectRequest): Promise<InspectResult> {
    const policy = validateAndNormalizeUrl(request.url);
    const health = await this.healthCheck();
    if (!health.available) {
      throw new MediaError(
        "MEDIA_PROVIDER_OFFLINE",
        "OmniGet binary is not available or not installed on this machine.",
        true,
      );
    }

    const res = await runProcessSafely({
      binary: this.binaryName,
      args: ["inspect", "--json", policy.normalizedUrl],
      timeoutMs: 30_000,
    });

    if (res.exitCode !== 0) {
      throw new MediaError(
        "MEDIA_PROVIDER_ERROR",
        `OmniGet inspect failed: ${res.stderr || res.stdout}`,
        false,
        { exitCode: res.exitCode },
      );
    }

    try {
      const parsed = JSON.parse(res.stdout);
      return {
        provider: this.name,
        url: request.url,
        normalizedUrl: policy.normalizedUrl,
        title: parsed.title || "Untitled Media",
        description: parsed.description,
        mediaType: parsed.mediaType || "video",
        durationSec: parsed.durationSec || parsed.duration,
        thumbnailUrl: parsed.thumbnailUrl || parsed.thumbnail,
        formats: (parsed.formats || []).map((f: any): MediaFormat => ({
          formatId: String(f.id || f.formatId),
          ext: f.ext || "mp4",
          resolution: f.resolution,
          filesizeApprox: f.filesize || f.size,
          qualityNote: f.quality,
        })),
        subtitles: (parsed.subtitles || []).map((s: any): MediaSubtitle => ({
          language: s.language || s.lang || "en",
          ext: s.ext || "vtt",
          url: s.url,
        })),
        author: parsed.author || parsed.uploader,
        sourcePlatform: policy.platform,
        requiresAuth: Boolean(parsed.requiresAuth),
        supported: true,
        inspectedAt: new Date().toISOString(),
      };
    } catch {
      // Fallback if stdout wasn't strict JSON
      return {
        provider: this.name,
        url: request.url,
        normalizedUrl: policy.normalizedUrl,
        title: policy.platform.toUpperCase() + " Media",
        mediaType: "video",
        formats: [{ formatId: "best", ext: "mp4" }],
        subtitles: [],
        sourcePlatform: policy.platform,
        requiresAuth: false,
        supported: true,
        inspectedAt: new Date().toISOString(),
      };
    }
  }

  async download(
    job: MediaJob,
    onProgress?: (progress: Partial<MediaJob>) => void,
  ): Promise<{ outputPath: string; metadata?: Record<string, unknown> }> {
    const policy = validateAndNormalizeUrl(job.sourceUrl);
    const health = await this.healthCheck();
    if (!health.available) {
      throw new MediaError(
        "MEDIA_PROVIDER_OFFLINE",
        "OmniGet binary is not available or not installed on this machine.",
        true,
      );
    }

    const targetOutput = job.outputPath;
    if (!targetOutput) {
      throw new MediaError("MEDIA_INVALID_ARGUMENT", "Job outputPath is missing.");
    }

    const args = ["download", policy.normalizedUrl, "-o", targetOutput];
    if (job.preset === "audio") {
      args.push("--audio-only");
    }

    const res = await runProcessSafely({
      binary: this.binaryName,
      args,
      timeoutMs: 300_000, // 5 min timeout
      onStdoutLine: (line) => {
        // Parse progress if omniget outputs progress percentages e.g. "Progress: 45%"
        const match = line.match(/(\d{1,3}(?:\.\d+)?)%/);
        if (match && onProgress) {
          const pct = Math.min(100, Math.max(0, parseFloat(match[1])));
          onProgress({ progressPercent: pct });
        }
      },
    });

    if (res.exitCode !== 0) {
      throw new MediaError(
        "MEDIA_DOWNLOAD_FAILED",
        `OmniGet download execution failed (exit ${res.exitCode}): ${res.stderr || res.stdout}`,
        false,
        { exitCode: res.exitCode },
      );
    }

    return { outputPath: targetOutput };
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.abort();
      this.activeJobs.delete(jobId);
    }
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    return this.activeJobs.has(jobId) ? "running" : "completed";
  }
}
