// Phase 20.6 — H3 Job Builder, State Machine & Execution Orchestration.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { canRunInStockMode } from "./license-policy";
import { calculateDimensions, resolvePreset } from "./presets";
import type {
  H3Job,
  H3JobInput,
  H3JobStage,
  H3JobStatus,
  H3Mode,
  ReferenceImageInput,
  StructuredPrompt,
} from "./types";

function rowToJob(row: Record<string, unknown>): H3Job {
  return {
    id: row.id as string,
    mode: row.mode as H3Mode,
    preset: row.preset as H3Job["preset"],
    prompt: row.prompt as string,
    structuredPrompt: JSON.parse((row.structured_prompt_json as string) ?? "{}") as StructuredPrompt,
    resolution: row.resolution as H3Job["resolution"],
    width: row.width as number,
    height: row.height as number,
    frameProfile: row.frame_profile as H3Job["frameProfile"],
    seed: row.seed as number,
    sourceImagePath: (row.source_image_path as string | null) ?? undefined,
    referenceImages: JSON.parse((row.reference_images_json as string) ?? "[]") as ReferenceImageInput[],
    detailRefine: row.detail_refine === 1,
    stockMode: row.stock_mode === 1,
    status: row.status as H3JobStatus,
    stage: row.stage as H3JobStage,
    progress: row.progress as number,
    targetExecutionNode: row.target_execution_node as "local" | "remote",
    selectedCandidateIndex: (row.selected_candidate_index as number | null) ?? undefined,
    outputImagePath: (row.output_image_path as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    metadata: JSON.parse((row.metadata_json as string) ?? "{}") as Record<string, unknown>,
  };
}

export function compilePromptFromStructured(
  basePrompt: string,
  structured?: StructuredPrompt,
  references?: ReferenceImageInput[],
): string {
  const parts: string[] = [];

  if (basePrompt?.trim()) {
    parts.push(basePrompt.trim());
  }

  if (structured) {
    if (structured.subject) parts.push(`Subject: ${structured.subject}`);
    if (structured.environment) parts.push(`Environment: ${structured.environment}`);
    if (structured.action) parts.push(`Action: ${structured.action}`);
    if (structured.camera) parts.push(`Camera: ${structured.camera}`);
    if (structured.lighting) parts.push(`Lighting: ${structured.lighting}`);
    if (structured.style) parts.push(`Style: ${structured.style}`);
    if (structured.mood) parts.push(`Mood: ${structured.mood}`);
    if (structured.composition) parts.push(`Composition: ${structured.composition}`);
  }

  if (references && references.length > 0) {
    const refRoles = references.map((r, i) => `Image [${i + 1}] serves as ${r.role} (${r.description ?? "reference"})`);
    parts.push(`Reference Context: ${refRoles.join("; ")}`);
  }

  if (structured?.stockConstraints) {
    parts.push(`Stock Safety Constraints: ${structured.stockConstraints}`);
  }

  return parts.join(" | ");
}

export function estimateH3Job(input: H3JobInput): {
  estimatedVramGb: number;
  estimatedRuntimeSeconds: number;
  targetNode: "local" | "remote";
  costUsd: number;
} {
  const presetCfg = resolvePreset(input.preset ?? "BALANCED");
  const frameCount = input.frameProfile ?? presetCfg.frameProfile;
  const isTwoMp = input.resolution === "TWO_MP";

  let baseVram = 14.0;
  if (frameCount > 5) baseVram += (frameCount - 5) * 0.8;
  if (isTwoMp) baseVram += 4.0;
  if (input.detailRefine) baseVram += 3.5;

  let baseSeconds = 12.0;
  if (presetCfg.samplingProfile === "BASE_QUALITY") baseSeconds = 24.0;
  if (presetCfg.samplingProfile === "FL2VA_TURBO_8") baseSeconds = 9.0;
  if (presetCfg.samplingProfile === "FL2VA_TURBO_4_768") baseSeconds = 5.0;
  if (isTwoMp) baseSeconds *= 1.8;
  if (input.detailRefine) baseSeconds += 8.0;

  // Decision on local vs remote
  const targetNode = baseVram > 24.0 ? "remote" : (input.targetExecutionNode ?? "local");
  const costUsd = targetNode === "remote" ? Number(((baseSeconds / 3600) * 0.85).toFixed(4)) : 0.0;

  return {
    estimatedVramGb: Number(baseVram.toFixed(1)),
    estimatedRuntimeSeconds: Math.round(baseSeconds),
    targetNode,
    costUsd,
  };
}

export function createH3Job(input: H3JobInput): H3Job {
  const db = openAgentOsDb();
  const id = input.id ?? `job_h3_${randomUUID().slice(0, 10)}`;
  const presetName = input.preset ?? (input.stockMode ? "STOCK_SAFE" : "BALANCED");
  const presetCfg = resolvePreset(presetName);
  const mode = input.mode ?? presetCfg.mode;
  const frameProfile = input.frameProfile ?? presetCfg.frameProfile;
  const resolutionPreset = input.resolution ?? presetCfg.resolutionPreset;
  const dims = calculateDimensions(resolutionPreset, "1:1", { width: input.width, height: input.height });
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const compiledPrompt = compilePromptFromStructured(input.prompt, input.structuredPrompt, input.referenceImages);

  const stockMode = input.stockMode ?? (presetName === "STOCK_SAFE");
  let status: H3JobStatus = "QUEUED";
  let errorMessage: string | null = null;

  // Pre-generation License & Stock Gate Check
  if (stockMode) {
    let workflowKey = "H3_T2I";
    if (mode === "text_to_image_single") workflowKey = "H3_T2I_SINGLE";
    else if (mode === "image_to_image_single") workflowKey = "H3_I2I_SINGLE";
    else if (mode === "reference_edit_single") workflowKey = "H3_REFERENCE_SINGLE";
    else if (mode === "reference_edit") workflowKey = "H3_REFERENCE_EDIT";
    else if (mode === "image_to_image") workflowKey = (presetName === "TURBO_FAST") ? "H3_I2I_TURBO" : "H3_I2I";
    else if (mode === "detail_refiner") workflowKey = "H3_DETAIL_REFINER";

    const check = canRunInStockMode(workflowKey);
    if (!check.allowed) {
      status = "BLOCKED_LICENSE";
      errorMessage = check.reason ?? "Blocked by Adobe Stock license policy.";
    }
  }

  const now = new Date().toISOString();
  db.query(`
    INSERT INTO h3_jobs (
      id, mode, preset, prompt, structured_prompt_json, resolution, width, height,
      frame_profile, seed, source_image_path, reference_images_json, detail_refine,
      stock_mode, status, stage, progress, target_execution_node, selected_candidate_index,
      output_image_path, error_message, created_at, updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validating', 0.0, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    mode,
    presetName,
    compiledPrompt,
    JSON.stringify(input.structuredPrompt ?? {}),
    resolutionPreset,
    dims.width,
    dims.height,
    frameProfile,
    seed,
    input.sourceImagePath ?? null,
    JSON.stringify(input.referenceImages ?? []),
    input.detailRefine ? 1 : 0,
    stockMode ? 1 : 0,
    status,
    input.targetExecutionNode ?? "local",
    null,
    null,
    errorMessage,
    now,
    now,
    JSON.stringify(input.metadata ?? {}),
  );

  return getH3Job(id)!;
}

export function getH3Job(id: string): H3Job | null {
  const row = openAgentOsDb().query("SELECT * FROM h3_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function listH3Jobs(filters?: { status?: H3JobStatus; limit?: number }): H3Job[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM h3_jobs WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  sql += " ORDER BY created_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  const rows = db.query(sql).all(...(params as any[])) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function updateH3JobStatus(
  id: string,
  status: H3JobStatus,
  updates?: {
    stage?: H3JobStage;
    progress?: number;
    selectedCandidateIndex?: number;
    outputImagePath?: string;
    errorMessage?: string;
  },
): H3Job {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    UPDATE h3_jobs SET
      status = ?,
      stage = COALESCE(?, stage),
      progress = COALESCE(?, progress),
      selected_candidate_index = COALESCE(?, selected_candidate_index),
      output_image_path = COALESCE(?, output_image_path),
      error_message = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    status,
    updates?.stage ?? null,
    updates?.progress ?? null,
    updates?.selectedCandidateIndex ?? null,
    updates?.outputImagePath ?? null,
    updates?.errorMessage ?? null,
    now,
    id,
  );
  return getH3Job(id)!;
}

export function cancelH3Job(id: string, reason?: string): H3Job {
  return updateH3JobStatus(id, "CANCELED", {
    errorMessage: reason ?? "Job canceled by operator.",
  });
}
