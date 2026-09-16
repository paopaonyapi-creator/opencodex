// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Artifact Registry & Provenance (Adobe Stock Safety Boundary Enforcement)

import { statSync, existsSync } from "node:fs";
import { basename } from "node:path";
import type { MediaArtifact, MediaProvenance, UsageClass, MediaType } from "./types";
import { computeFileSha256 } from "./storage";
import { MediaError } from "./errors";
import { evaluateDouyinStockExport, isDouyinSource } from "../douyin/rights";

export class ArtifactRegistry {
  private artifacts = new Map<string, MediaArtifact>();

  async registerArtifact(params: {
    jobId: string;
    type: MediaType;
    sourceUrl: string;
    sourcePlatform: string;
    title: string;
    localPath: string;
    usageClass?: UsageClass;
    durationSec?: number;
    width?: number;
    height?: number;
    thumbnailPath?: string;
    transcriptPath?: string;
    derivedFromArtifactId?: string;
  }): Promise<MediaArtifact> {
    if (!existsSync(params.localPath)) {
      throw new MediaError("MEDIA_STORAGE_FAILED", `Cannot register artifact; file does not exist: ${params.localPath}`);
    }

    const stat = statSync(params.localPath);
    const sha256 = await computeFileSha256(params.localPath);
    const artifactId = `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const filename = basename(params.localPath);

    // MIME type detection
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    let mimeType = "application/octet-stream";
    if (ext === "mp4") mimeType = "video/mp4";
    else if (ext === "webm") mimeType = "video/webm";
    else if (ext === "mp3") mimeType = "audio/mpeg";
    else if (ext === "wav") mimeType = "audio/wav";
    else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "png") mimeType = "image/png";
    else if (ext === "vtt") mimeType = "text/vtt";
    else if (ext === "json") mimeType = "application/json";

    const usageClass: UsageClass = params.usageClass || "research_reference";

    // CRITICAL ADOBE STOCK SAFETY BOUNDARY:
    // Any research_reference or acquired third-party media MUST NOT be licensable or exportable to stock.
    let exportToStock = usageClass === "production_derivative";

    // Phase 20.26 rights boundary: third-party Douyin media is research-only
    // (ownership unknown). It is hard-blocked from stock export regardless of
    // the requested usage class; derived trend signals remain unaffected.
    if (exportToStock && isDouyinSource(params.sourcePlatform, params.sourceUrl)) {
      const decision = evaluateDouyinStockExport({ provider: "douyin", usageClass });
      if (!decision.allowed) {
        exportToStock = false;
      }
    }

    const artifact: MediaArtifact = {
      artifactId,
      jobId: params.jobId,
      type: params.type,
      sourceUrl: params.sourceUrl,
      sourcePlatform: params.sourcePlatform,
      title: params.title,
      localPath: params.localPath,
      filename,
      sha256,
      mimeType,
      sizeBytes: stat.size,
      durationSec: params.durationSec,
      width: params.width,
      height: params.height,
      thumbnailPath: params.thumbnailPath,
      transcriptPath: params.transcriptPath,
      usageClass,
      exportToStock,
      createdAt: new Date().toISOString(),
      derivedFromArtifactId: params.derivedFromArtifactId,
    };

    this.artifacts.set(artifactId, artifact);
    return artifact;
  }

  getArtifact(artifactId: string): MediaArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  listArtifacts(): MediaArtifact[] {
    return Array.from(this.artifacts.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getProvenance(artifactId: string): MediaProvenance | undefined {
    const art = this.artifacts.get(artifactId);
    if (!art) return undefined;

    return {
      sourceUrl: art.sourceUrl,
      sourcePlatform: art.sourcePlatform,
      acquisitionTime: art.createdAt,
      provider: "omniget",
      originalFilename: art.filename,
      sha256: art.sha256,
      processingSteps: art.derivedFromArtifactId ? ["acquired", "processed_derivative"] : ["acquired"],
      notes: art.exportToStock ? "Commercial Derivative" : "Research Reference (Strictly not for Stock Export)",
    };
  }
}
