// Phase 20.6 — H3 Workflow Registry & Catalog.

import { openAgentOsDb } from "../../db";
import type { H3Mode, H3WorkflowDefinition } from "./types";

function rowToWorkflow(row: Record<string, unknown>): H3WorkflowDefinition {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    mode: row.mode as H3Mode,
    workflowJson: JSON.parse((row.workflow_json as string) ?? "{}") as Record<string, unknown>,
    modelStack: JSON.parse((row.model_stack_json as string) ?? "[]") as string[],
    experimental: row.experimental === 1,
    stockSafe: row.stock_safe === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function registerWorkflow(wf: {
  id: string;
  name: string;
  category: string;
  mode: H3Mode;
  workflowJson?: Record<string, unknown>;
  modelStack?: string[];
  experimental?: boolean;
  stockSafe?: boolean;
  enabled?: boolean;
}): H3WorkflowDefinition {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO h3_workflows (
      id, name, category, mode, workflow_json, model_stack_json,
      experimental, stock_safe, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      mode = excluded.mode,
      workflow_json = excluded.workflow_json,
      model_stack_json = excluded.model_stack_json,
      experimental = excluded.experimental,
      stock_safe = excluded.stock_safe,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    wf.id,
    wf.name,
    wf.category,
    wf.mode,
    JSON.stringify(wf.workflowJson ?? {}),
    JSON.stringify(wf.modelStack ?? []),
    wf.experimental ? 1 : 0,
    wf.stockSafe !== false ? 1 : 0,
    wf.enabled !== false ? 1 : 0,
    now,
    now,
  );
  return getWorkflow(wf.id)!;
}

export function getWorkflow(id: string): H3WorkflowDefinition | null {
  const row = openAgentOsDb().query("SELECT * FROM h3_workflows WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(filters?: { mode?: H3Mode; stockSafeOnly?: boolean }): H3WorkflowDefinition[] {
  seedBuiltInWorkflows();
  const db = openAgentOsDb();
  let sql = "SELECT * FROM h3_workflows WHERE enabled = 1";
  const params: unknown[] = [];
  if (filters?.mode) {
    sql += " AND mode = ?";
    params.push(filters.mode);
  }
  if (filters?.stockSafeOnly) {
    sql += " AND stock_safe = 1";
  }
  sql += " ORDER BY category, name";
  const rows = db.query(sql).all(...(params as any[])) as Record<string, unknown>[];
  return rows.map(rowToWorkflow);
}

export function seedBuiltInWorkflows(): void {
  const db = openAgentOsDb();
  const count = (db.query("SELECT COUNT(*) as c FROM h3_workflows").get() as { c: number }).c;
  if (count > 0) return;

  const builtIns = [
    {
      id: "H3_T2I",
      name: "MiniMax H3 Text-to-Image (Production)",
      category: "standard",
      mode: "text_to_image" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "video_vae"],
      experimental: false,
      stockSafe: true,
      workflowJson: {
        template: "minimax_h3_t2i_v1",
        description: "Official 5-frame packet text-to-image pipeline with recommended frame extraction.",
      },
    },
    {
      id: "H3_T2I_SINGLE",
      name: "MiniMax H3 Text-to-Image (One-Frame Fast)",
      category: "experimental",
      mode: "text_to_image_single" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "image_vae", "hybrid_single_adapter"],
      experimental: true,
      stockSafe: false,
      workflowJson: {
        template: "minimax_h3_t2i_single_v1",
        description: "Experimental low-latency 1-frame direct generation. Lab mode only.",
      },
    },
    {
      id: "H3_I2I",
      name: "MiniMax H3 Image-to-Image Restyling",
      category: "standard",
      mode: "image_to_image" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "video_vae"],
      experimental: false,
      stockSafe: true,
      workflowJson: {
        template: "minimax_h3_i2i_v1",
        description: "Controlled visual restyle and concept transformation from source input.",
      },
    },
    {
      id: "H3_I2I_SINGLE",
      name: "MiniMax H3 Image-to-Image (One-Frame Fast)",
      category: "experimental",
      mode: "image_to_image_single" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "image_vae"],
      experimental: true,
      stockSafe: false,
      workflowJson: {
        template: "minimax_h3_i2i_single_v1",
        description: "Fast single-frame image-to-image experiment.",
      },
    },
    {
      id: "H3_REFERENCE_EDIT",
      name: "MiniMax H3 Multi-Reference Editor (REF2VA)",
      category: "reference",
      mode: "reference_edit" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "video_vae", "ref2va_adapter"],
      experimental: false,
      stockSafe: true,
      workflowJson: {
        template: "minimax_h3_ref2va_v1",
        description: "Multi-reference image editing preserving identity, pose, outfit, and environment.",
      },
    },
    {
      id: "H3_REFERENCE_SINGLE",
      name: "MiniMax H3 Reference Edit (One-Frame)",
      category: "experimental",
      mode: "reference_edit_single" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "image_vae", "ref2va_adapter"],
      experimental: true,
      stockSafe: false,
      workflowJson: {
        template: "minimax_h3_ref_single_v1",
        description: "Fast 1-frame multi-reference experiment.",
      },
    },
    {
      id: "H3_I2I_TURBO",
      name: "MiniMax H3 Image-to-Image Turbo (8-Step)",
      category: "turbo",
      mode: "image_to_image" as H3Mode,
      modelStack: ["minimax_h3_diffusion", "t5_text_encoder", "video_vae", "fl2va_turbo_adapter"],
      experimental: false,
      stockSafe: true,
      workflowJson: {
        template: "minimax_h3_turbo_v1",
        description: "FL2VA 8-step turbo acceleration with high visual fidelity.",
      },
    },
    {
      id: "H3_DETAIL_REFINER",
      name: "Qwen Image Edit 2511 Detail Refiner & Tone Lock",
      category: "refinement",
      mode: "detail_refiner" as H3Mode,
      modelStack: ["qwen_image_edit_2511", "qwen_text_encoder", "qwen_vae", "lightning_refiner_adapter"],
      experimental: false,
      stockSafe: true,
      workflowJson: {
        template: "qwen_image_edit_refiner_v1",
        description: "Second-pass anatomy and texture cleanup with Detail Tone Lock.",
      },
    },
  ];

  for (const b of builtIns) {
    registerWorkflow(b);
  }
}
