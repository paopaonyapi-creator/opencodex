// Pao AI Media Factory — Stock Domain Models & Storage (Phase 16)
//
// Core domain interfaces and database operations for Adobe Stock First workflows:
// Opportunities, Concepts, Assets, Lineage, QC Reviews, and Export Packs.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "./db";

export type EvidenceClass = "A" | "B" | "C" | "D" | "P" | "I";

export type ProductionMode =
  | "stock_image"
  | "stock_png"
  | "stock_video"
  | "drama"
  | "social_video"
  | "youtube";

export type AssetStatus =
  | "DRAFT"
  | "PLANNED"
  | "QUEUED"
  | "GENERATING"
  | "GENERATED"
  | "TECH_QC"
  | "VISUAL_QC"
  | "COMMERCIAL_QC"
  | "SIMILARITY_QC"
  | "COMPLIANCE_QC"
  | "METADATA_READY"
  | "HUMAN_REVIEW"
  | "EXPORT_READY"
  | "EXPORTED"
  | "NEEDS_FIXES"
  | "HOLD_COMPLIANCE"
  | "REJECT_INTERNAL"
  | "ARCHIVED";

export interface StockOpportunity {
  id: string;
  projectId: string;
  title: string;
  niche: string;
  buyerPersona: string;
  score: number; // 0–100 Opportunity Score
  confidence: number; // 0–100 Evidence Confidence
  evidenceClass: EvidenceClass;
  evidence: Record<string, unknown>;
  status: "active" | "archived";
  createdAt: string;
}

export interface StockConcept {
  id: string;
  projectId: string;
  opportunityId?: string | null;
  title: string;
  description: string;
  commercialUseCase: string;
  copySpace: string;
  differentiation: string;
  productionMode: ProductionMode;
  status: "draft" | "approved" | "rejected";
  createdAt: string;
}

export interface StockAsset {
  id: string;
  projectId: string;
  conceptId?: string | null;
  batchId?: string | null;
  type: "image" | "png" | "video";
  mode: ProductionMode;
  status: AssetStatus;
  path: string;
  previewPath?: string | null;
  width?: number | null;
  height?: number | null;
  megapixels?: number | null;
  durationSeconds?: number | null;
  fps?: number | null;
  codec?: string | null;
  provider?: string | null;
  model?: string | null;
  prompt?: Record<string, unknown>;
  generatedAi: boolean;
  fictionalPeopleProperty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockAssetLineage {
  id: string;
  assetId: string;
  parentAssetId?: string | null;
  step: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface StockQcReview {
  id: string;
  assetId: string;
  reviewer: string;
  verdict: "pass" | "warn" | "fail";
  score?: number | null;
  report: Record<string, unknown>;
  createdAt: string;
}

export interface StockExportPack {
  id: string;
  projectId: string;
  batchId?: string | null;
  status: "pending" | "ready" | "exported";
  manifest: Record<string, unknown>;
  packagePath?: string | null;
  humanReviewRequired: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Database CRUD Helpers
// ---------------------------------------------------------------------------

// --- Opportunities ---
export function createStockOpportunity(
  input: Omit<StockOpportunity, "id" | "createdAt" | "status"> & { id?: string; status?: "active" | "archived" },
): StockOpportunity {
  const db = openAgentOsDb();
  const id = input.id ?? `opp_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const status = input.status ?? "active";

  db.query(`
    INSERT INTO stock_opportunities (id, project_id, title, niche, buyer_persona, score, confidence, evidence_class, evidence_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId,
    input.title,
    input.niche,
    input.buyerPersona,
    input.score,
    input.confidence,
    input.evidenceClass,
    JSON.stringify(input.evidence ?? {}),
    status,
    now,
  );

  return {
    id,
    projectId: input.projectId,
    title: input.title,
    niche: input.niche,
    buyerPersona: input.buyerPersona,
    score: input.score,
    confidence: input.confidence,
    evidenceClass: input.evidenceClass,
    evidence: input.evidence,
    status,
    createdAt: now,
  };
}

export function listStockOpportunities(projectId?: string): StockOpportunity[] {
  const db = openAgentOsDb();
  const rows = projectId
    ? db.query("SELECT * FROM stock_opportunities WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
    : db.query("SELECT * FROM stock_opportunities ORDER BY created_at DESC").all();

  return (rows as Array<{
    id: string;
    project_id: string;
    title: string;
    niche: string;
    buyer_persona: string;
    score: number;
    confidence: number;
    evidence_class: string;
    evidence_json: string;
    status: string;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    niche: row.niche,
    buyerPersona: row.buyer_persona,
    score: row.score,
    confidence: row.confidence,
    evidenceClass: row.evidence_class as EvidenceClass,
    evidence: JSON.parse(row.evidence_json || "{}"),
    status: row.status as "active" | "archived",
    createdAt: row.created_at,
  }));
}

// --- Concepts ---
export function createStockConcept(
  input: Omit<StockConcept, "id" | "createdAt" | "status"> & { id?: string; status?: "draft" | "approved" | "rejected" },
): StockConcept {
  const db = openAgentOsDb();
  const id = input.id ?? `cpt_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const status = input.status ?? "draft";

  const description = input.description ?? "";
  const copySpace = input.copySpace ?? "";
  const differentiation = input.differentiation ?? "";

  db.query(`
    INSERT INTO stock_concepts (id, project_id, opportunity_id, title, description, commercial_use_case, copy_space, differentiation, production_mode, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId,
    input.opportunityId ?? null,
    input.title,
    description,
    input.commercialUseCase,
    copySpace,
    differentiation,
    input.productionMode,
    status,
    now,
  );

  return {
    id,
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    title: input.title,
    description,
    commercialUseCase: input.commercialUseCase,
    copySpace,
    differentiation,
    productionMode: input.productionMode,
    status,
    createdAt: now,
  };
}

export function listStockConcepts(projectId?: string): StockConcept[] {
  const db = openAgentOsDb();
  const rows = projectId
    ? db.query("SELECT * FROM stock_concepts WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
    : db.query("SELECT * FROM stock_concepts ORDER BY created_at DESC").all();

  return (rows as Array<{
    id: string;
    project_id: string;
    opportunity_id: string | null;
    title: string;
    description: string;
    commercial_use_case: string;
    copy_space: string;
    differentiation: string;
    production_mode: string;
    status: string;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    description: row.description,
    commercialUseCase: row.commercial_use_case,
    copySpace: row.copy_space,
    differentiation: row.differentiation,
    productionMode: row.production_mode as ProductionMode,
    status: row.status as "draft" | "approved" | "rejected",
    createdAt: row.created_at,
  }));
}

export function getStockConcept(id: string): StockConcept | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM stock_concepts WHERE id = ?").get(id) as {
    id: string;
    project_id: string;
    opportunity_id: string | null;
    title: string;
    description: string;
    commercial_use_case: string;
    copy_space: string;
    differentiation: string;
    production_mode: string;
    status: string;
    created_at: string;
  } | null;

  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    description: row.description,
    commercialUseCase: row.commercial_use_case,
    copySpace: row.copy_space,
    differentiation: row.differentiation,
    productionMode: row.production_mode as ProductionMode,
    status: row.status as "draft" | "approved" | "rejected",
    createdAt: row.created_at,
  };
}

// --- Assets ---
export function createStockAsset(
  input: Omit<StockAsset, "id" | "createdAt" | "updatedAt"> & { id?: string },
): StockAsset {
  const db = openAgentOsDb();
  const id = input.id ?? `ast_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO stock_assets (
      id, project_id, concept_id, batch_id, type, mode, status, path, preview_path,
      width, height, megapixels, duration_seconds, fps, codec, provider, model,
      prompt_json, generated_ai, fictional_people_property, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId,
    input.conceptId ?? null,
    input.batchId ?? null,
    input.type,
    input.mode,
    input.status,
    input.path,
    input.previewPath ?? null,
    input.width ?? null,
    input.height ?? null,
    input.megapixels ?? null,
    input.durationSeconds ?? null,
    input.fps ?? null,
    input.codec ?? null,
    input.provider ?? null,
    input.model ?? null,
    JSON.stringify(input.prompt ?? {}),
    input.generatedAi ? 1 : 0,
    input.fictionalPeopleProperty ? 1 : 0,
    now,
    now,
  );

  return {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateStockAssetStatus(assetId: string, status: AssetStatus): boolean {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const result = db.query("UPDATE stock_assets SET status = ?, updated_at = ? WHERE id = ?").run(status, now, assetId);
  return result.changes > 0;
}

export function getStockAsset(assetId: string): StockAsset | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM stock_assets WHERE id = ?").get(assetId) as
    | {
        id: string;
        project_id: string;
        concept_id: string | null;
        batch_id: string | null;
        type: string;
        mode: string;
        status: string;
        path: string;
        preview_path: string | null;
        width: number | null;
        height: number | null;
        megapixels: number | null;
        duration_seconds: number | null;
        fps: number | null;
        codec: string | null;
        provider: string | null;
        model: string | null;
        prompt_json: string;
        generated_ai: number;
        fictional_people_property: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    conceptId: row.concept_id,
    batchId: row.batch_id,
    type: row.type as "image" | "png" | "video",
    mode: row.mode as ProductionMode,
    status: row.status as AssetStatus,
    path: row.path,
    previewPath: row.preview_path,
    width: row.width,
    height: row.height,
    megapixels: row.megapixels,
    durationSeconds: row.duration_seconds,
    fps: row.fps,
    codec: row.codec,
    provider: row.provider,
    model: row.model,
    prompt: JSON.parse(row.prompt_json || "{}"),
    generatedAi: Boolean(row.generated_ai),
    fictionalPeopleProperty: Boolean(row.fictional_people_property),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Lineage ---
export function recordStockLineage(
  input: Omit<StockAssetLineage, "id" | "createdAt"> & { id?: string },
): StockAssetLineage {
  const db = openAgentOsDb();
  const id = input.id ?? `lin_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO stock_asset_lineage (id, asset_id, parent_asset_id, step, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.assetId, input.parentAssetId ?? null, input.step, JSON.stringify(input.details ?? {}), now);

  return {
    id,
    assetId: input.assetId,
    parentAssetId: input.parentAssetId,
    step: input.step,
    details: input.details,
    createdAt: now,
  };
}

export function getStockLineage(assetId: string): StockAssetLineage[] {
  const db = openAgentOsDb();
  const rows = db.query("SELECT * FROM stock_asset_lineage WHERE asset_id = ? ORDER BY created_at ASC").all(assetId) as Array<{
    id: string;
    asset_id: string;
    parent_asset_id: string | null;
    step: string;
    details_json: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    assetId: r.asset_id,
    parentAssetId: r.parent_asset_id,
    step: r.step,
    details: JSON.parse(r.details_json || "{}"),
    createdAt: r.created_at,
  }));
}

// --- QC Reviews ---
export function recordStockQcReview(
  input: Omit<StockQcReview, "id" | "createdAt"> & { id?: string },
): StockQcReview {
  const db = openAgentOsDb();
  const id = input.id ?? `sqc_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO stock_qc_reviews (id, asset_id, reviewer, verdict, score, report_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.assetId, input.reviewer, input.verdict, input.score ?? null, JSON.stringify(input.report ?? {}), now);

  return {
    id,
    assetId: input.assetId,
    reviewer: input.reviewer,
    verdict: input.verdict,
    score: input.score,
    report: input.report,
    createdAt: now,
  };
}

export function listStockQcReviews(assetId: string): StockQcReview[] {
  const db = openAgentOsDb();
  const rows = db.query("SELECT * FROM stock_qc_reviews WHERE asset_id = ? ORDER BY created_at ASC").all(assetId) as Array<{
    id: string;
    asset_id: string;
    reviewer: string;
    verdict: string;
    score: number | null;
    report_json: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    assetId: r.asset_id,
    reviewer: r.reviewer,
    verdict: r.verdict as "pass" | "warn" | "fail",
    score: r.score ?? undefined,
    report: JSON.parse(r.report_json || "{}"),
    createdAt: r.created_at,
  }));
}

// --- Export Packs ---
export function createStockExportPack(
  input: Omit<StockExportPack, "id" | "createdAt" | "status"> & { id?: string; status?: "pending" | "ready" | "exported" },
): StockExportPack {
  const db = openAgentOsDb();
  const id = input.id ?? `exp_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const status = input.status ?? "ready";

  db.query(`
    INSERT INTO stock_export_packs (id, project_id, batch_id, status, manifest_json, package_path, human_review_required, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId,
    input.batchId ?? null,
    status,
    JSON.stringify(input.manifest ?? {}),
    input.packagePath ?? null,
    input.humanReviewRequired ? 1 : 0,
    now,
  );

  return {
    id,
    projectId: input.projectId,
    batchId: input.batchId,
    status,
    manifest: input.manifest,
    packagePath: input.packagePath,
    humanReviewRequired: input.humanReviewRequired,
    createdAt: now,
  };
}
