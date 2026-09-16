// Phase 20.60 — Asset handoff pipeline (spec §10).
//
// Local/generated asset → integrity inspection (SHA-256 recomputed from disk,
// MIME sniffed from bytes, size/dimensions/duration) → upload to the OpenPost
// media library via the two-phase upload-session API (which deduplicates on
// `client_sha256` upstream) → remote media reference stored and attached to
// renditions. Provenance (generation job, model, workflow, review status)
// travels with the asset; internal prompts never leave the process.

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { openAgentOsDb } from "../db";
import { newId, nowIso, sha256Hex } from "./store";
import type { OpenPostClient } from "./openpost/client";
import type { PublicationAsset } from "./types";

export interface InspectedAsset {
  localAssetId: string;
  filename: string;
  storagePath: string;
  sha256: string;
  mimeType: string;
  declaredMimeType: string;
  mimeMismatch: boolean;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  assetType: string;
  provenance: Record<string, unknown>;
  bytes: () => Promise<Uint8Array>;
}

type Row = Record<string, unknown>;

/** Magic-byte MIME detection — extension/declared type is never trusted alone (spec §10.1). */
export function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("M4A") || brand.startsWith("M4B")) return "audio/mp4";
    return "video/mp4";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3))) return "audio/mpeg";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}

const MAX_INLINE_BYTES = 512 * 1024 * 1024;

interface GenAssetRow {
  id: string;
  filename: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  asset_type: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  model_id: string | null;
  workflow_id: string | null;
  job_id: string | null;
  generation_metadata_json: string;
}

function parseGenAssetRow(row: Row): GenAssetRow {
  return {
    id: String(row["id"] ?? ""),
    filename: String(row["filename"] ?? ""),
    storage_path: String(row["storage_path"] ?? ""),
    mime_type: String(row["mime_type"] ?? "application/octet-stream"),
    file_size: Number(row["file_size"] ?? 0),
    sha256: String(row["sha256"] ?? ""),
    asset_type: String(row["asset_type"] ?? "image"),
    width: row["width"] === null || row["width"] === undefined ? null : Number(row["width"]),
    height: row["height"] === null || row["height"] === undefined ? null : Number(row["height"]),
    duration_seconds: row["duration_seconds"] === null || row["duration_seconds"] === undefined ? null : Number(row["duration_seconds"]),
    model_id: row["model_id"] === null || row["model_id"] === undefined ? null : String(row["model_id"]),
    workflow_id: row["workflow_id"] === null || row["workflow_id"] === undefined ? null : String(row["workflow_id"]),
    job_id: row["job_id"] === null || row["job_id"] === undefined ? null : String(row["job_id"]),
    generation_metadata_json: String(row["generation_metadata_json"] ?? "{}"),
  };
}

/**
 * Inspect a local (generated or uploaded) asset registered in the generation
 * asset store: file must exist, SHA-256 is recomputed from disk, MIME is
 * sniffed from bytes, dimensions/duration are carried over.
 */
export async function inspectLocalAsset(assetId: string): Promise<InspectedAsset> {
  const row = openAgentOsDb().query("SELECT id, filename, storage_path, mime_type, file_size, sha256, asset_type, width, height, duration_seconds, model_id, workflow_id, job_id, generation_metadata_json FROM gen_assets WHERE id = ?").get(assetId) as Row | null;
  if (!row) throw new Error("local asset not found: " + assetId);
  const asset = parseGenAssetRow(row);
  if (!asset.storage_path || !existsSync(asset.storage_path)) {
    throw new Error("asset file missing on disk: " + assetId);
  }
  const stat = statSync(asset.storage_path);
  if (stat.size <= 0) throw new Error("asset file is empty: " + assetId);
  if (stat.size > MAX_INLINE_BYTES) throw new Error("asset exceeds the inline upload bound: " + assetId);
  const bytes = await readFile(asset.storage_path);
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (asset.sha256 && asset.sha256 !== actualSha) {
    throw new Error("asset integrity mismatch (stored sha256 does not match disk bytes): " + assetId);
  }
  const detected = detectMimeFromBytes(bytes);
  const declared = asset.mime_type || "application/octet-stream";
  const effective = detected ?? declared;
  const generationMetadata = safeParse(asset.generation_metadata_json);
  const provenance: Record<string, unknown> = {
    source: "pao-generation-factory",
    localAssetId: asset.id,
    generationJobId: asset.job_id,
    modelId: asset.model_id,
    workflowId: asset.workflow_id,
    ...generationMetadata,
  };
  return {
    localAssetId: asset.id,
    filename: asset.filename || "asset",
    storagePath: asset.storage_path,
    sha256: actualSha,
    mimeType: effective,
    declaredMimeType: declared,
    mimeMismatch: detected !== null && detected !== declared,
    byteSize: stat.size,
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration_seconds !== null ? Math.round(asset.duration_seconds * 1000) : null,
    assetType: asset.asset_type,
    provenance,
    bytes: () => readFile(asset.storage_path),
  };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface HandoffResult {
  asset: PublicationAsset;
  /** True when OpenPost already had this exact SHA-256 (deduped, no bytes sent). */
  deduped: boolean;
}

/**
 * Hand one inspected asset to OpenPost: attach the sha to the publication
 * first (local dedupe), then create an upload session passing
 * `client_sha256` — upstream returns `deduped: true` with a media id when the
 * same bytes are already in the workspace, and no byte transfer happens.
 */
export async function handoffAssetToOpenPost(input: {
  client: OpenPostClient;
  workspaceRef: string;
  publicationId: string;
  inspected: InspectedAsset;
  existingShaRef: PublicationAsset | null;
}): Promise<HandoffResult> {
  if (input.existingShaRef?.openpostMediaRef) {
    return { asset: input.existingShaRef, deduped: true };
  }
  const session = await input.client.createMediaUploadSession({
    workspace_id: input.workspaceRef,
    filename: input.inspected.filename,
    size: input.inspected.byteSize,
    mime_type: input.inspected.mimeType,
    client_sha256: input.inspected.sha256,
    asset_kind: "library",
    retention_class: "library",
    source: "upload",
  });
  if (!session.deduped) {
    await input.client.uploadMediaBytes(session, await input.inspected.bytes());
    await input.client.completeMediaUploadSession(session.media_id, input.workspaceRef);
  }
  const asset: PublicationAsset = {
    id: input.existingShaRef?.id ?? newId("spas"),
    publicationId: input.publicationId,
    localAssetId: input.inspected.localAssetId,
    openpostMediaRef: session.media_id,
    sha256: input.inspected.sha256,
    mimeType: input.inspected.mimeType,
    byteSize: input.inspected.byteSize,
    width: input.inspected.width,
    height: input.inspected.height,
    durationMs: input.inspected.durationMs,
    provenance: input.inspected.provenance,
    createdAt: nowIso(),
  };
  return { asset, deduped: session.deduped };
}

/** Stable per-asset content contribution used inside rendition hashes. */
export function assetHashContribution(asset: PublicationAsset): string {
  return sha256Hex(asset.sha256);
}
