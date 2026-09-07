// Phase 20.6 — H3 Model Stack Registry.

import { openAgentOsDb } from "../../db";
import type { H3ModelDefinition, LicenseStatus } from "./types";

function rowToModel(row: Record<string, unknown>): H3ModelDefinition {
  return {
    id: row.id as string,
    modelKey: row.model_key as string,
    category: row.category as H3ModelDefinition["category"],
    filename: row.filename as string,
    expectedFolder: row.expected_folder as string,
    sourceUrl: row.source_url as string,
    officialOrCommunity: row.official_or_community as "official" | "community",
    licenseName: row.license_name as string,
    commercialUseStatus: row.commercial_use_status as LicenseStatus,
    stockUseStatus: row.stock_use_status as LicenseStatus,
    approvedForLocal: row.approved_for_local === 1,
    approvedForRemote: row.approved_for_remote === 1,
    checksum: (row.checksum as string | null) ?? undefined,
    status: row.status as "installed" | "missing" | "downloading",
    notes: row.notes as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function registerModel(m: {
  id?: string;
  modelKey: string;
  category: H3ModelDefinition["category"];
  filename: string;
  expectedFolder: string;
  sourceUrl?: string;
  officialOrCommunity?: "official" | "community";
  licenseName: string;
  commercialUseStatus?: LicenseStatus;
  stockUseStatus?: LicenseStatus;
  approvedForLocal?: boolean;
  approvedForRemote?: boolean;
  checksum?: string;
  status?: "installed" | "missing" | "downloading";
  notes?: string;
}): H3ModelDefinition {
  const db = openAgentOsDb();
  const id = m.id ?? `mod_${m.modelKey}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO h3_models (
      id, model_key, category, filename, expected_folder, source_url,
      official_or_community, license_name, commercial_use_status, stock_use_status,
      approved_for_local, approved_for_remote, checksum, status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_key) DO UPDATE SET
      category = excluded.category,
      filename = excluded.filename,
      expected_folder = excluded.expected_folder,
      source_url = excluded.source_url,
      official_or_community = excluded.official_or_community,
      license_name = excluded.license_name,
      commercial_use_status = excluded.commercial_use_status,
      stock_use_status = excluded.stock_use_status,
      approved_for_local = excluded.approved_for_local,
      approved_for_remote = excluded.approved_for_remote,
      checksum = excluded.checksum,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    id,
    m.modelKey,
    m.category,
    m.filename,
    m.expectedFolder,
    m.sourceUrl ?? "",
    m.officialOrCommunity ?? "official",
    m.licenseName,
    m.commercialUseStatus ?? "UNKNOWN",
    m.stockUseStatus ?? "UNKNOWN",
    m.approvedForLocal !== false ? 1 : 0,
    m.approvedForRemote !== false ? 1 : 0,
    m.checksum ?? null,
    m.status ?? "installed",
    m.notes ?? "",
    now,
    now,
  );
  return getModel(m.modelKey)!;
}

export function getModel(modelKey: string): H3ModelDefinition | null {
  const row = openAgentOsDb().query("SELECT * FROM h3_models WHERE model_key = ? OR id = ? LIMIT 1").get(modelKey, modelKey) as Record<string, unknown> | undefined;
  return row ? rowToModel(row) : null;
}

export function listModels(filters?: { category?: string; stockOnly?: boolean }): H3ModelDefinition[] {
  seedBuiltInModels();
  const db = openAgentOsDb();
  let sql = "SELECT * FROM h3_models WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.category) {
    sql += " AND category = ?";
    params.push(filters.category);
  }
  if (filters?.stockOnly) {
    sql += " AND stock_use_status = 'ALLOWED'";
  }
  sql += " ORDER BY category, model_key";
  const rows = db.query(sql).all(...(params as any[])) as Record<string, unknown>[];
  return rows.map(rowToModel);
}

export function validateModelStack(modelKeys: string[]): {
  allPresent: boolean;
  missing: string[];
  approvedForStock: boolean;
  blockedReasons: string[];
} {
  seedBuiltInModels();
  const missing: string[] = [];
  const blockedReasons: string[] = [];
  let approvedForStock = true;

  for (const key of modelKeys) {
    const mod = getModel(key);
    if (!mod) {
      missing.push(key);
      blockedReasons.push(`Model '${key}' is not registered in H3 Model Registry.`);
      approvedForStock = false;
      continue;
    }
    if (mod.status === "missing") {
      missing.push(key);
      blockedReasons.push(`Model asset '${mod.filename}' is missing from '${mod.expectedFolder}'.`);
    }
    if (mod.stockUseStatus !== "ALLOWED") {
      approvedForStock = false;
      blockedReasons.push(`Model '${mod.modelKey}' license (${mod.licenseName}) has stock status '${mod.stockUseStatus}'.`);
    }
  }

  return {
    allPresent: missing.length === 0,
    missing,
    approvedForStock,
    blockedReasons,
  };
}

export function seedBuiltInModels(): void {
  const db = openAgentOsDb();
  const count = (db.query("SELECT COUNT(*) as c FROM h3_models").get() as { c: number }).c;
  if (count > 0) return;

  const builtInModels: Array<Parameters<typeof registerModel>[0]> = [
    {
      modelKey: "minimax_h3_diffusion",
      category: "diffusion",
      filename: "minimax_h3_diffusion_bf16.safetensors",
      expectedFolder: "models/diffusion_models",
      sourceUrl: "https://huggingface.co/MiniMax/MiniMax-H3",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Official MiniMax H3 transformer backbone.",
    },
    {
      modelKey: "t5_text_encoder",
      category: "text_encoder",
      filename: "t5_xxl_fp8_e4m3fn.safetensors",
      expectedFolder: "models/text_encoders",
      sourceUrl: "https://huggingface.co/comfyanonymous/flux_text_encoders",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "T5-XXL text conditioning encoder.",
    },
    {
      modelKey: "video_vae",
      category: "vae",
      filename: "minimax_video_vae_fp32.safetensors",
      expectedFolder: "models/vae",
      sourceUrl: "https://huggingface.co/MiniMax/MiniMax-H3",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "MiniMax 3D temporal-spatial video VAE.",
    },
    {
      modelKey: "fl2va_turbo_adapter",
      category: "turbo_adapter",
      filename: "fl2va_turbo_8step.safetensors",
      expectedFolder: "models/loras",
      sourceUrl: "https://huggingface.co/MiniMax/MiniMax-H3-Turbo",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Official 8-step turbo acceleration adapter.",
    },
    {
      modelKey: "ref2va_adapter",
      category: "turbo_adapter",
      filename: "ref2va_adapter_v1.safetensors",
      expectedFolder: "models/loras",
      sourceUrl: "https://huggingface.co/MiniMax/MiniMax-H3-Ref",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Multi-reference cross-attention adapter for REF2VA.",
    },
    {
      modelKey: "image_vae",
      category: "vae",
      filename: "sdxl_vae.safetensors",
      expectedFolder: "models/vae",
      sourceUrl: "https://huggingface.co/stabilityai/sdxl-vae",
      officialOrCommunity: "community",
      licenseName: "OpenRAIL",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "REVIEW_REQUIRED",
      status: "installed",
      notes: "Standard 2D SDXL image VAE for single-frame experimental output.",
    },
    {
      modelKey: "hybrid_single_adapter",
      category: "turbo_adapter",
      filename: "h3_single_frame_hybrid.safetensors",
      expectedFolder: "models/loras",
      sourceUrl: "https://huggingface.co/community/h3-hybrid-single",
      officialOrCommunity: "community",
      licenseName: "CC-BY-NC-4.0",
      commercialUseStatus: "DISALLOWED",
      stockUseStatus: "DISALLOWED",
      status: "installed",
      notes: "Community experimental 1-frame adapter. Blocked from commercial stock mode.",
    },
    {
      modelKey: "qwen_image_edit_2511",
      category: "refiner",
      filename: "qwen_image_edit_2511_fp8.safetensors",
      expectedFolder: "models/diffusion_models",
      sourceUrl: "https://huggingface.co/Qwen/Qwen-Image-Edit-2511",
      officialOrCommunity: "official",
      licenseName: "Tongyi-Qianwen-License",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Second-pass anatomy and fine texture refiner.",
    },
    {
      modelKey: "qwen_text_encoder",
      category: "text_encoder",
      filename: "qwen_2_5_vl_7b_text.safetensors",
      expectedFolder: "models/text_encoders",
      sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-VL-7B",
      officialOrCommunity: "official",
      licenseName: "Tongyi-Qianwen-License",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Vision-language text encoder for detail instruction parsing.",
    },
    {
      modelKey: "qwen_vae",
      category: "vae",
      filename: "qwen_image_vae.safetensors",
      expectedFolder: "models/vae",
      sourceUrl: "https://huggingface.co/Qwen/Qwen-Image-Edit-2511",
      officialOrCommunity: "official",
      licenseName: "Tongyi-Qianwen-License",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "2D perceptual VAE for Qwen image editing.",
    },
    {
      modelKey: "lightning_refiner_adapter",
      category: "turbo_adapter",
      filename: "qwen_detail_lightning_4step.safetensors",
      expectedFolder: "models/loras",
      sourceUrl: "https://huggingface.co/ByteDance/SDXL-Lightning",
      officialOrCommunity: "official",
      licenseName: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      status: "installed",
      notes: "Lightning 4-step fast refinement adapter.",
    },
  ];

  for (const m of builtInModels) {
    registerModel(m);
  }
}
