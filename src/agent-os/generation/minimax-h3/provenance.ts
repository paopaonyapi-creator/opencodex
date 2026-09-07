// Phase 20.6 — Forensic Provenance & Asset Packaging.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { getH3Job } from "./jobs";
import { getStockQC } from "./stock-qc";
import type { H3ProvenanceRecord, ReferenceRole } from "./types";

function rowToProvenance(row: Record<string, unknown>): H3ProvenanceRecord {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    assetPath: row.asset_path as string,
    promptHash: row.prompt_hash as string,
    workflowKey: row.workflow_key as string,
    preset: row.preset as H3ProvenanceRecord["preset"],
    seed: row.seed as number,
    modelManifest: JSON.parse((row.model_manifest_json as string) ?? "{}") as Record<string, unknown>,
    referenceRoles: JSON.parse((row.reference_roles_json as string) ?? "[]") as Array<{ role: ReferenceRole; path: string }>,
    refinementUsed: row.refinement_used === 1,
    stockMode: row.stock_mode === 1,
    knowledgeSyncStatus: row.knowledge_sync_status as H3ProvenanceRecord["knowledgeSyncStatus"],
    createdAt: row.created_at as string,
  };
}

export function recordProvenance(input: {
  jobId: string;
  assetPath: string;
  workflowKey?: string;
  modelManifest?: Record<string, unknown>;
}): H3ProvenanceRecord {
  const db = openAgentOsDb();
  const job = getH3Job(input.jobId);
  if (!job) {
    throw new Error(`Job ${input.jobId} not found to record provenance.`);
  }

  const id = `prov_${input.jobId}_${randomUUID().slice(0, 6)}`;
  const promptHash = createHash("sha256").update(job.prompt).digest("hex");
  const workflowKey = input.workflowKey ?? (job.mode === "reference_edit" ? "H3_REFERENCE_EDIT" : "H3_T2I");
  const now = new Date().toISOString();

  const refRoles = job.referenceImages.map((r) => ({ role: r.role, path: r.imagePath }));

  db.query(`
    INSERT INTO h3_provenance (
      id, job_id, asset_path, prompt_hash, workflow_key, preset, seed,
      model_manifest_json, reference_roles_json, refinement_used, stock_mode,
      knowledge_sync_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    ON CONFLICT(id) DO UPDATE SET
      asset_path = excluded.asset_path,
      prompt_hash = excluded.prompt_hash,
      workflow_key = excluded.workflow_key,
      preset = excluded.preset,
      seed = excluded.seed,
      model_manifest_json = excluded.model_manifest_json,
      reference_roles_json = excluded.reference_roles_json,
      refinement_used = excluded.refinement_used,
      stock_mode = excluded.stock_mode
  `).run(
    id,
    job.id,
    input.assetPath,
    promptHash,
    workflowKey,
    job.preset,
    job.seed,
    JSON.stringify(input.modelManifest ?? { diffusion: "minimax_h3_diffusion", vae: "video_vae", text_encoder: "t5_text_encoder" }),
    JSON.stringify(refRoles),
    job.detailRefine ? 1 : 0,
    job.stockMode ? 1 : 0,
    now,
  );

  return getProvenance(job.id)!;
}

export function getProvenance(jobIdOrAssetPath: string): H3ProvenanceRecord | null {
  const row = openAgentOsDb()
    .query("SELECT * FROM h3_provenance WHERE job_id = ? OR asset_path = ? LIMIT 1")
    .get(jobIdOrAssetPath, jobIdOrAssetPath) as Record<string, unknown> | undefined;
  return row ? rowToProvenance(row) : null;
}

export function exportAssetPackage(jobId: string): {
  exportAllowed: boolean;
  packagePath?: string;
  manifest?: Record<string, unknown>;
  blockedReason?: string;
} {
  const job = getH3Job(jobId);
  if (!job) {
    return { exportAllowed: false, blockedReason: `Job ${jobId} not found.` };
  }

  // If stock mode is enabled, enforce QC approval gate
  if (job.stockMode) {
    const qc = getStockQC(jobId);
    if (!qc || !qc.overallPassed) {
      return {
        exportAllowed: false,
        blockedReason: "Asset failed Adobe Stock QC or reviewer approval has not been granted.",
      };
    }
  }

  const provenance = getProvenance(jobId) ?? recordProvenance({
    jobId,
    assetPath: job.outputImagePath ?? `./storage/h3_outputs/${jobId}_final.png`,
  });

  const manifest = {
    assetId: `asset_${jobId}`,
    jobId: job.id,
    mode: job.mode,
    preset: job.preset,
    seed: job.seed,
    resolution: `${job.width}x${job.height}`,
    frameProfile: job.frameProfile,
    prompt: job.prompt,
    provenance,
    exportedAt: new Date().toISOString(),
  };

  return {
    exportAllowed: true,
    packagePath: `./storage/exports/h3_${jobId}_package.json`,
    manifest,
  };
}
