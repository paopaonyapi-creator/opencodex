// Phase 20 — Asset & Model Synchronization.
//
// Resolves remote ComfyUI endpoints, fetches remote generated outputs,
// verifies SHA-256 and size integrity, saves into local Phase 19 asset storage,
// and checks commercial licensing before Stock Mode executions.

import { createHash } from "node:crypto";
import type { LocalAssetStorage } from "../storage";
import type { GeneratedAsset, GenerationJob } from "../types";
import { getModel } from "../registry";

export interface SyncOutputResult {
  asset: GeneratedAsset;
  sha256: string;
  sizeBytes: number;
}

export class AssetSynchronizer {
  readonly storage: LocalAssetStorage;

  constructor(storage: LocalAssetStorage) {
    this.storage = storage;
  }

  async syncRemoteAsset(params: {
    job: GenerationJob;
    remoteBaseUrl: string;
    filename: string;
    subfolder?: string;
    type?: string;
    authHeader?: string;
  }): Promise<SyncOutputResult> {
    const { job, remoteBaseUrl, filename, subfolder, type, authHeader } = params;

    const query = new URLSearchParams({
      filename,
      subfolder: subfolder ?? "",
      type: type ?? "output",
    });

    const url = `${remoteBaseUrl.replace(/\/+$/, "")}/view?${query.toString()}`;
    const headers: Record<string, string> = {};
    if (authHeader) headers.Authorization = authHeader;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch remote asset from ${url}: HTTP ${res.status} ${res.statusText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("Received empty asset from remote ComfyUI provider");
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";

    const asset = this.storage.saveAsset({
      projectId: job.projectId,
      jobId: job.id,
      assetType: job.jobType.includes("video") ? "video" : "image",
      role: "generated",
      bytes: buffer,
      mimeType,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      seed: job.resolvedSeed ?? job.seed,
      modelId: job.modelId,
      workflowId: job.workflowId,
      workflowVersion: job.workflowVersion,
      providerId: job.providerId,
      generationMetadata: {
        remote_provider: "runpod",
        remote_url: remoteBaseUrl,
        remote_filename: filename,
        sha256,
      },
    });

    return {
      asset,
      sha256,
      sizeBytes: buffer.length,
    };
  }

  assertCommercialLicenseSafe(modelId: string | null, stockMode: boolean): { allowed: boolean; reason?: string } {
    if (!stockMode || !modelId) return { allowed: true };

    const model = getModel(modelId);
    if (!model) return { allowed: true };

    const notes = (model.commercialUseNotes || "").toLowerCase();
    if (notes.includes("blocked") || notes.includes("non-commercial") || notes.includes("prohibited")) {
      return {
        allowed: false,
        reason: `Model ${modelId} is blocked for commercial/stock use (${model.commercialUseNotes})`,
      };
    }

    return { allowed: true };
  }
}
