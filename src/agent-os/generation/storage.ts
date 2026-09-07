// Phase 19 — Local asset storage.
//
// Writes real files under the configured storage root with UUID filenames
// (never user-supplied names), SHA-256 content hashes, and 512px JPEG/PNG/WebP
// thumbnails for gallery previews (spec sections 18, 69, 70).

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, statSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { openAgentOsDb } from "../db";
import type { GeneratedAsset } from "./types";

export interface AssetStorageConfig {
  /** Absolute or workspace-relative root, e.g. ./data/generation */
  root: string;
}

const ROLE_DIRS: Record<GeneratedAsset["role"], string> = {
  original: "originals",
  generated: "generated",
  edited: "edited",
  upscaled: "upscaled",
  input: "inputs",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "text/plain": ".txt",
};

/** PNG dimensions: IHDR at fixed offset. JPEG/webp return null (not needed for MVP QC). */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return null;
}

/** Blunt corruption checks that catch truncated/blank transfers without decoders. */
export function looksCorrupt(bytes: Uint8Array, mimeType: string): string | null {
  if (bytes.length === 0) return "empty file";
  if (mimeType === "image/png") {
    const sigOk = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!sigOk) return "PNG signature missing";
    // IEND chunk must appear somewhere in the last 12 bytes region.
    const tail = bytes.slice(Math.max(0, bytes.length - 12));
    const tailText = Buffer.from(tail).toString("latin1");
    if (!tailText.includes("IEND")) return "PNG IEND trailer missing (truncated file)";
  }
  if (mimeType === "image/jpeg" && bytes[0] !== 0xff) return "JPEG signature missing";
  return null;
}

export class LocalAssetStorage {
  constructor(private readonly config: AssetStorageConfig) {}

  /** Resolved absolute root (validated, never user-controlled at runtime). */
  absoluteRoot(): string {
    return resolve(this.config.root);
  }

  private projectDir(projectId: string | null, role: GeneratedAsset["role"]): string {
    const safeProject = (projectId ?? "unsorted").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unsorted";
    const dir = join(this.absoluteRoot(), "projects", safeProject, ROLE_DIRS[role]);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Writes bytes to disk and records the asset row. Throws on corruption. */
  saveAsset(input: {
    projectId: string | null;
    jobId: string | null;
    assetType: GeneratedAsset["assetType"];
    role: GeneratedAsset["role"];
    bytes: Uint8Array;
    mimeType: string;
    sourceFilename?: string;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    fps?: number | null;
    prompt?: string;
    negativePrompt?: string;
    seed?: number | null;
    modelId?: string | null;
    workflowId?: string | null;
    workflowVersion?: number | null;
    providerId?: string | null;
    parentAssetId?: string | null;
    sourceJobId?: string | null;
    generationMetadata?: Record<string, unknown>;
  }): GeneratedAsset {
    const corruption = looksCorrupt(input.bytes, input.mimeType);
    if (corruption) throw new Error(`corrupted output rejected: ${corruption}`);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const ext = EXTENSION_BY_MIME[input.mimeType] ?? ".bin";
    // UUID filename; user-provided names are never used on disk (spec section 18).
    const filename = `${randomUUID()}${ext}`;
    const dir = this.projectDir(input.projectId, input.role);
    const filePath = join(dir, filename);
    writeFileSync(filePath, input.bytes);
    const fileSize = statSync(filePath).size;
    const dims = input.width && input.height ? { width: input.width, height: input.height } : readImageDimensions(input.bytes);
    const now = new Date().toISOString();
    const db = openAgentOsDb();
    const id = `asset_${randomUUID().slice(0, 12)}`;
    db.query(`
      INSERT INTO gen_assets
        (id, job_id, project_id, asset_type, role, filename, storage_path, mime_type,
         width, height, duration_seconds, fps, file_size, sha256, prompt, negative_prompt,
         seed, model_id, workflow_id, workflow_version, provider_id, parent_asset_id,
         source_job_id, generation_metadata_json, review_status, stock_status,
         metadata_status, export_status, favorite, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'pending', 'none', 'none', 'none', 0, 0, ?, ?)
    `).run(
      id, input.jobId, input.projectId, input.assetType, input.role, filename, filePath,
      input.mimeType, dims?.width ?? null, dims?.height ?? null, input.durationSeconds ?? null,
      input.fps ?? null, fileSize, sha256, input.prompt ?? "", input.negativePrompt ?? "",
      input.seed ?? null, input.modelId ?? null, input.workflowId ?? null,
      input.workflowVersion ?? null, input.providerId ?? null, input.parentAssetId ?? null,
      input.sourceJobId ?? null, JSON.stringify(input.generationMetadata ?? {}), now, now,
    );
    return this.getAsset(id)!;
  }

  getAsset(id: string): GeneratedAsset | null {
    const row = openAgentOsDb().query("SELECT * FROM gen_assets WHERE id = ? AND deleted = 0").get(id) as Record<string, unknown> | undefined;
    return row ? rowToAsset(row) : null;
  }

  /** Soft delete (spec section 74): reversible; physical removal is separate. */
  softDeleteAsset(id: string): boolean {
    const result = openAgentOsDb()
      .query("UPDATE gen_assets SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  readAssetBytes(asset: GeneratedAsset): Uint8Array {
    return new Uint8Array(readFileSync(asset.storagePath));
  }

/** Writes a small preview thumbnail under <root>/thumbnails. */
  writeThumbnail(assetId: string, bytes: Uint8Array): string | null {
    const dir = join(this.absoluteRoot(), "thumbnails");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${assetId}.webp`);
    writeFileSync(path, bytes);
    return path;
  }

  /** Startup cleanup of stale job temp dirs (spec section 56). */
  cleanupTempDirs(tempRoot: string, olderThanHours: number): number {
    const resolvedTemp = resolve(tempRoot);
    let removed = 0;
    try {
      for (const entry of readdirSync(resolvedTemp, { withFileTypes: true })) {
        const dirPath = join(resolvedTemp, entry.name);
        try {
          const stat = statSync(dirPath);
          if (stat.mtimeMs < Date.now() - olderThanHours * 3_600_000) {
            rmSync(dirPath, { recursive: true, force: true });
            removed++;
          }
        } catch { /* raced deletion; skip */ }
      }
    } catch { /* temp root may not exist yet */ }
    return removed;
  }

  /** Export package directory for one asset. */
  exportDir(projectId: string | null): string {
    const safeProject = (projectId ?? "unsorted").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unsorted";
    const dir = join(this.absoluteRoot(), "projects", safeProject, "exports");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Metadata sidecar directory for one project. */
  metadataDir(projectId: string | null): string {
    const safeProject = (projectId ?? "unsorted").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unsorted";
    const dir = join(this.absoluteRoot(), "projects", safeProject, "metadata");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Manifest directory for one project. */
  manifestDir(projectId: string | null): string {
    const safeProject = (projectId ?? "unsorted").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unsorted";
    const dir = join(this.absoluteRoot(), "projects", safeProject, "manifests");
    mkdirSync(dir, { recursive: true });
    return dir;
  }
}

function rowToAsset(row: Record<string, unknown>): GeneratedAsset {
  return {
    id: row.id as string,
    jobId: (row.job_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    assetType: row.asset_type as GeneratedAsset["assetType"],
    role: row.role as GeneratedAsset["role"],
    filename: row.filename as string,
    storagePath: row.storage_path as string,
    mimeType: row.mime_type as string,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    fps: (row.fps as number | null) ?? null,
    fileSize: row.file_size as number,
    sha256: row.sha256 as string,
    prompt: row.prompt as string,
    negativePrompt: row.negative_prompt as string,
    seed: (row.seed as number | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    workflowId: (row.workflow_id as string | null) ?? null,
    workflowVersion: (row.workflow_version as number | null) ?? null,
    providerId: (row.provider_id as string | null) ?? null,
    parentAssetId: (row.parent_asset_id as string | null) ?? null,
    sourceJobId: (row.source_job_id as string | null) ?? null,
    generationMetadata: JSON.parse((row.generation_metadata_json as string) ?? "{}") as Record<string, unknown>,
    technicalScore: (row.technical_score as number | null) ?? null,
    visualScore: (row.visual_score as number | null) ?? null,
    commercialScore: (row.commercial_score as number | null) ?? null,
    policyScore: (row.policy_score as number | null) ?? null,
    overallScore: (row.overall_score as number | null) ?? null,
    reviewStatus: row.review_status as GeneratedAsset["reviewStatus"],
    stockStatus: row.stock_status as GeneratedAsset["stockStatus"],
    metadataStatus: row.metadata_status as GeneratedAsset["metadataStatus"],
    exportStatus: row.export_status as GeneratedAsset["exportStatus"],
    favorite: row.favorite === 1,
    userRating: (row.user_rating as number | null) ?? null,
    deleted: row.deleted === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------- projects

export interface UpsertProjectInput {
  id?: string;
  name: string;
  description?: string;
  mode?: "general" | "adobe_stock" | "social" | "product";
  defaultWorkflow?: string | null;
  defaultModel?: string | null;
}

export function upsertProject(input: UpsertProjectInput): { id: string; name: string; description: string; mode: string; defaultWorkflow: string | null; defaultModel: string | null; createdAt: string } {
  const db = openAgentOsDb();
  const id = input.id ?? `proj_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_projects (id, name, description, mode, default_workflow, default_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
      mode = excluded.mode, default_workflow = excluded.default_workflow, default_model = excluded.default_model
  `).run(id, input.name, input.description ?? "", input.mode ?? "general", input.defaultWorkflow ?? null, input.defaultModel ?? null, now);
  const row = db.query("SELECT * FROM gen_projects WHERE id = ?").get(id) as Record<string, unknown>;
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    mode: row.mode as string,
    defaultWorkflow: (row.default_workflow as string | null) ?? null,
    defaultModel: (row.default_model as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function listProjects(): Array<{ id: string; name: string; description: string; mode: string; defaultWorkflow: string | null; defaultModel: string | null; createdAt: string }> {
  const rows = openAgentOsDb().query("SELECT * FROM gen_projects ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    mode: row.mode as string,
    defaultWorkflow: (row.default_workflow as string | null) ?? null,
    defaultModel: (row.default_model as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export function getProject(id: string): { id: string; name: string; description: string; mode: string; defaultWorkflow: string | null; defaultModel: string | null; createdAt: string } | null {
  const row = openAgentOsDb().query("SELECT * FROM gen_projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    mode: row.mode as string,
    defaultWorkflow: (row.default_workflow as string | null) ?? null,
    defaultModel: (row.default_model as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------- asset queries

export interface ListAssetsOptions {
  projectId?: string;
  assetType?: string;
  modelId?: string;
  workflowId?: string;
  reviewStatus?: string;
  stockStatus?: string;
  keyword?: string;
  minScore?: number;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export function listAssets(options: ListAssetsOptions = {}): { assets: GeneratedAsset[]; total: number } {
  const db = openAgentOsDb();
  const where: string[] = [];
  const params: SQLBinding[] = [];
  if (!options.includeDeleted) where.push("deleted = 0");
  if (options.projectId) { where.push("project_id = ?"); params.push(options.projectId); }
  if (options.assetType) { where.push("asset_type = ?"); params.push(options.assetType); }
  if (options.modelId) { where.push("model_id = ?"); params.push(options.modelId); }
  if (options.workflowId) { where.push("workflow_id = ?"); params.push(options.workflowId); }
  if (options.reviewStatus) { where.push("review_status = ?"); params.push(options.reviewStatus); }
  if (options.stockStatus) { where.push("stock_status = ?"); params.push(options.stockStatus); }
  if (options.keyword) { where.push("(prompt LIKE ? OR filename LIKE ?)"); params.push(`%${options.keyword}%`, `%${options.keyword}%`); }
  if (options.minScore !== undefined) { where.push("overall_score >= ?"); params.push(options.minScore); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.query(`SELECT COUNT(*) AS c FROM gen_assets ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db.query(`SELECT * FROM gen_assets ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];
  return { assets: rows.map(rowToAsset), total };
}

type SQLBinding = string | number | bigint | boolean | null | Uint8Array;

export function findExactDuplicateBySha(sha256: string, excludeAssetId?: string): GeneratedAsset | null {
  const row = openAgentOsDb()
    .query("SELECT * FROM gen_assets WHERE sha256 = ? AND deleted = 0 AND id != ? LIMIT 1")
    .get(sha256, excludeAssetId ?? "") as Record<string, unknown> | undefined;
  return row ? rowToAsset(row) : null;
}

export function updateAssetScores(id: string, scores: {
  technicalScore?: number | null;
  visualScore?: number | null;
  commercialScore?: number | null;
  policyScore?: number | null;
  overallScore?: number | null;
  reviewStatus?: GeneratedAsset["reviewStatus"];
  stockStatus?: GeneratedAsset["stockStatus"];
}): void {
  const sets: string[] = ["updated_at = ?"];
  const params: Array<string | number | bigint | boolean | null | Uint8Array> = [new Date().toISOString()];
  const mapping: Array<[keyof typeof scores, string]> = [
    ["technicalScore", "technical_score"],
    ["visualScore", "visual_score"],
    ["commercialScore", "commercial_score"],
    ["policyScore", "policy_score"],
    ["overallScore", "overall_score"],
    ["reviewStatus", "review_status"],
    ["stockStatus", "stock_status"],
  ];
  for (const [key, column] of mapping) {
    if (scores[key] !== undefined) { sets.push(`${column} = ?`); params.push(scores[key]); }
  }
  openAgentOsDb().query(`UPDATE gen_assets SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
}

export function updateAssetStatuses(id: string, patch: {
  metadataStatus?: GeneratedAsset["metadataStatus"];
  exportStatus?: GeneratedAsset["exportStatus"];
}): void {
  const sets: string[] = ["updated_at = ?"];
  const params: Array<string | number | bigint | boolean | null | Uint8Array> = [new Date().toISOString()];
  if (patch.metadataStatus !== undefined) { sets.push("metadata_status = ?"); params.push(patch.metadataStatus); }
  if (patch.exportStatus !== undefined) { sets.push("export_status = ?"); params.push(patch.exportStatus); }
  openAgentOsDb().query(`UPDATE gen_assets SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
}
