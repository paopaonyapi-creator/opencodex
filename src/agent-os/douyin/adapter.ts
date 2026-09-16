// Phase 20.26 — Douyin MediaProvider adapter for the Phase 20.24 router.
//
// Implements the existing MediaProvider contract so the Media Acquisition
// Core can route, queue, and audit Douyin work exactly like every other
// provider. Selected only for Douyin-family URLs; degrades gracefully when
// the upstream runtime is absent (doc §84-§85).

import { existsSync } from "node:fs";
import type {
  InspectRequest,
  InspectResult,
  JobStatus,
  MediaFormat,
  MediaJob,
  MediaProvider,
  ProviderCapability,
  ProviderHealth,
} from "../media-acquisition/types";
import { MediaError } from "../media-acquisition/errors";
import { classifyDouyinUrl } from "./url-policy";
import { normalizeMediaItem } from "./normalize";
import { douyinFlags } from "./flags";
import { DouyinCliUpstream } from "./upstream";
import { redactDouyinSecrets } from "./redact";
import type { DouyinUpstreamClient } from "./types";
import type { DouyinStore } from "./store";

export class DouyinProvider implements MediaProvider {
  readonly name = "douyin" as const;
  private upstream: DouyinUpstreamClient;
  private store?: DouyinStore;

  constructor(upstream?: DouyinUpstreamClient, store?: DouyinStore) {
    this.upstream = upstream ?? new DouyinCliUpstream();
    this.store = store;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const flags = douyinFlags();
    const available = flags.provider && (await this.upstream.available());
    const reason = await this.upstream.availabilityReason();
    const capabilities: ProviderCapability = {
      formats: ["mp4", "mp3", "jpg", "json"],
      supportsSubtitles: false,
      supportsAudioExtraction: true,
      supportsBatch: true,
      supportsThumbnails: true,
      notes: "douyin-downloader CLI adapter; watermark-free preferred source",
    };
    return {
      provider: this.name,
      status: available ? "healthy" : "offline",
      available,
      version: "upstream: douyin-downloader (CLI adapter)",
      lastCheckedAt: new Date().toISOString(),
      capabilities,
      errorMessage: available ? undefined : reason ?? "douyin provider disabled or upstream runtime missing",
    };
  }

  async inspect(request: InspectRequest): Promise<InspectResult> {
    const flags = douyinFlags();
    const classification = classifyDouyinUrl(request.url);
    if (!classification) {
      throw new MediaError("MEDIA_UNSUPPORTED_URL", "URL is not a Douyin-family URL");
    }
    if (!flags.provider || !(await this.upstream.available())) {
      throw new MediaError(
        "MEDIA_PROVIDER_OFFLINE",
        `Douyin provider unavailable: ${(await this.upstream.availabilityReason()) ?? "disabled"}`,
        true,
      );
    }

    const raw = redactDouyinSecrets(await this.upstream.inspect(classification.canonicalUrl));
    const item = normalizeMediaItem(raw, classification.canonicalUrl);
    if (this.store) {
      this.store.upsertMediaItem(item);
    }

    const formats: MediaFormat[] = (raw.mediaUrls ?? []).map((mediaUrl, index) => ({
      formatId: `douyin_${index}`,
      ext: item.type === "video" ? "mp4" : "jpg",
      qualityNote: "watermark-free preferred source",
      filesizeApprox: undefined,
    }));

    return {
      provider: this.name,
      url: request.url,
      normalizedUrl: classification.canonicalUrl,
      title: item.title,
      description: item.description,
      mediaType: item.type === "music" ? "audio" : item.type === "gallery" || item.type === "image" ? "gallery" : "video",
      durationSec: item.durationMs !== undefined ? Math.round(item.durationMs / 1000) : undefined,
      formats,
      subtitles: [],
      author: item.creatorName,
      sourcePlatform: "douyin",
      requiresAuth: raw.requiresAuth ?? (classification.risk !== "normal"),
      supported: true,
      inspectedAt: new Date().toISOString(),
    };
  }

  async download(
    job: MediaJob,
    onProgress?: (progress: Partial<MediaJob>) => void,
  ): Promise<{ outputPath: string; metadata?: Record<string, unknown> }> {
    const flags = douyinFlags();
    const classification = classifyDouyinUrl(job.sourceUrl);
    if (!classification) {
      throw new MediaError("MEDIA_UNSUPPORTED_URL", "URL is not a Douyin-family URL");
    }
    if (!flags.provider || !(await this.upstream.available())) {
      throw new MediaError(
        "MEDIA_PROVIDER_OFFLINE",
        `Douyin provider unavailable: ${(await this.upstream.availabilityReason()) ?? "disabled"}`,
        true,
      );
    }
    if (!job.outputPath) {
      throw new MediaError("MEDIA_INVALID_ARGUMENT", "Douyin download job has no output path");
    }
    onProgress?.({ progressPercent: 10 });

    // The CLI client writes into the job's staged directory (generated config,
    // fixed keys only); the produced file is moved to the job output path.
    const { dirname, basename } = await import("node:path");
    const { renameSync } = await import("node:fs");
    const stagedDir = dirname(job.outputPath);
    const produced = await this.upstream.downloadTo(classification.canonicalUrl, stagedDir);
    onProgress?.({ progressPercent: 90 });

    if (produced !== job.outputPath) {
      try {
        renameSync(produced, job.outputPath);
      } catch {
        // Same-directory rename can fail across devices; fall back to keeping
        // the produced path as the artifact source.
      }
    }
    const finalPath = existsSyncSafe(job.outputPath) ? job.outputPath : produced;
    onProgress?.({ progressPercent: 99 });
    return {
      outputPath: finalPath,
      metadata: { provider: "douyin", kind: classification.kind, producedBasename: basename(finalPath) },
    };
  }

  async cancel(_jobId: string): Promise<void> {
    // The CLI adapter runs bounded, synchronous upstream invocations; there is
    // no long-lived process to signal. Documented limitation (doc §86 note).
  }

  async getStatus(_jobId: string): Promise<JobStatus> {
    return "queued";
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
