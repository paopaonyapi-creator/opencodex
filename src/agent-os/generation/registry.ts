// Phase 19 — Workflow / Model / LoRA registries.
//
// The workflow registry owns node bindings (spec section 10): no controller ever
// hardcodes ComfyUI node ids. Built-in workflows are seeded on first open and
// versioned; applying a binding deep-copies the template (spec section 98) so a
// shared template can never be mutated in flight.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { GenerationLora, GenerationModel, WorkflowDefinition } from "./types";

// ---------------------------------------------------------------- rows

interface WorkflowRow {
  id: string; version: number; name: string; category: string; provider: string;
  workflow_json: string; enabled: number; status: string;
  capabilities_json: string; bindings_json: string; output_nodes_json: string;
  required_inputs_json: string; optional_inputs_json: string;
  parameter_schema_json: string; model_requirements_json: string;
  min_vram_gb: number | null; tags_json: string; created_at: string; updated_at: string;
}

function rowToWorkflow(row: WorkflowRow): WorkflowDefinition {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    category: row.category as WorkflowDefinition["category"],
    provider: row.provider,
    workflowJson: row.workflow_json,
    enabled: row.enabled === 1,
    status: row.status as WorkflowDefinition["status"],
    capabilities: JSON.parse(row.capabilities_json) as string[],
    bindings: JSON.parse(row.bindings_json) as WorkflowDefinition["bindings"],
    outputNodes: JSON.parse(row.output_nodes_json) as WorkflowDefinition["outputNodes"],
    requiredInputs: JSON.parse(row.required_inputs_json) as string[],
    optionalInputs: JSON.parse(row.optional_inputs_json) as string[],
    parameterSchema: JSON.parse(row.parameter_schema_json) as Record<string, unknown>,
    modelRequirements: JSON.parse(row.model_requirements_json) as Record<string, unknown>,
    minVramGb: row.min_vram_gb,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToModel(row: Record<string, unknown>): GenerationModel {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    family: row.family as string,
    type: row.type as string,
    checkpointName: row.checkpoint_name as string,
    provider: row.provider as string,
    minVramGb: (row.min_vram_gb as number | null) ?? null,
    recommendedVramGb: (row.recommended_vram_gb as number | null) ?? null,
    licenseNotes: row.license_notes as string,
    commercialUseNotes: row.commercial_use_notes as string,
    enabled: row.enabled === 1,
    tags: JSON.parse(row.tags_json as string) as string[],
    createdAt: row.created_at as string,
  };
}

function rowToLora(row: Record<string, unknown>): GenerationLora {
  return {
    id: row.id as string,
    name: row.name as string,
    filename: row.filename as string,
    baseModelFamily: row.base_model_family as string,
    triggerWords: JSON.parse(row.trigger_words_json as string) as string[],
    defaultStrength: row.default_strength as number,
    minStrength: row.min_strength as number,
    maxStrength: row.max_strength as number,
    commercialUseNotes: row.commercial_use_notes as string,
    enabled: row.enabled === 1,
    tags: JSON.parse(row.tags_json as string) as string[],
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------- built-ins

interface BuiltInWorkflow {
  id: string; name: string; category: WorkflowDefinition["category"];
  capabilities: string[]; bindings: WorkflowDefinition["bindings"];
  outputType: "image" | "video" | "audio" | "text";
  requiredInputs: string[]; optionalInputs: string[];
}

/**
 * Minimal SDXL text-to-image graph. Model selection flows through the
 * `model` binding (CheckpointLoaderSimple.ckpt_name); seeds resolve before
 * queueing so every asset is reproducible (spec section 92).
 */
function sdxlTextToImageGraph(): Record<string, unknown> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: 0, steps: 28, cfg: 7.0, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0,
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "80": { class_type: "SaveImage", inputs: { filename_prefix: "paohubpro", images: ["8", 0] } },
  };
}

const BUILT_IN_WORKFLOWS: BuiltInWorkflow[] = [
  {
    id: "sdxl-text-to-image",
    name: "SDXL Text to Image",
    category: "text_to_image",
    capabilities: ["text_to_image", "custom_seed", "variable_resolution", "negative_prompt", "lora"],
    bindings: {
      prompt: { node_id: "6", input_key: "text" },
      negative_prompt: { node_id: "7", input_key: "text" },
      seed: { node_id: "3", input_key: "seed" },
      width: { node_id: "5", input_key: "width" },
      height: { node_id: "5", input_key: "height" },
      batch_size: { node_id: "5", input_key: "batch_size" },
      model: { node_id: "4", input_key: "ckpt_name" },
    },
    outputType: "image",
    requiredInputs: ["prompt"],
    optionalInputs: ["negative_prompt", "seed", "width", "height", "batch_size", "model"],
  },
];

/** Seed built-ins once (idempotent on (id, version)). */
export function ensureBuiltInWorkflows(): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  for (const wf of BUILT_IN_WORKFLOWS) {
    const exists = db.query("SELECT id FROM gen_workflows WHERE id = ? AND version = 1").get(wf.id);
    if (exists) continue;
    db.query(`
      INSERT OR IGNORE INTO gen_workflows
        (id, version, name, category, provider, workflow_json, enabled, status,
         capabilities_json, bindings_json, output_nodes_json, required_inputs_json,
         optional_inputs_json, parameter_schema_json, model_requirements_json,
         min_vram_gb, tags_json, created_at, updated_at)
      VALUES (?, 1, ?, ?, 'comfyui', ?, 1, 'ready', ?, ?, ?, ?, ?, '{}', '{}', NULL, '[]', ?, ?)
    `).run(
      wf.id, wf.name, wf.category, JSON.stringify(sdxlTextToImageGraph()),
      JSON.stringify(wf.capabilities), JSON.stringify(wf.bindings),
      JSON.stringify([{ node_id: "80", type: wf.outputType }]),
      JSON.stringify(wf.requiredInputs), JSON.stringify(wf.optionalInputs), now, now,
    );
  }
}

// ---------------------------------------------------------------- workflows

export function listWorkflows(options?: { enabledOnly?: boolean }): WorkflowDefinition[] {
  ensureBuiltInWorkflows();
  const db = openAgentOsDb();
  // Latest version per id wins; disabled versions never shadow.
  const rows = db.query(`
    SELECT w.* FROM gen_workflows w
    JOIN (SELECT id, MAX(version) AS v FROM gen_workflows GROUP BY id) latest
      ON w.id = latest.id AND w.version = latest.v
    ${options?.enabledOnly ? "WHERE w.enabled = 1" : ""}
    ORDER BY w.id
  `).all() as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function getWorkflow(id: string, version?: number): WorkflowDefinition | null {
  ensureBuiltInWorkflows();
  const db = openAgentOsDb();
  const row = (version === undefined
    ? db.query("SELECT * FROM gen_workflows WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)
    : db.query("SELECT * FROM gen_workflows WHERE id = ? AND version = ?").get(id, version)) as WorkflowRow | undefined;
  return row ? rowToWorkflow(row) : null;
}

export interface UpsertWorkflowInput {
  id: string;
  name: string;
  category: string;
  provider?: string;
  workflowJson: string;
  capabilities?: string[];
  bindings?: WorkflowDefinition["bindings"];
  outputNodes?: WorkflowDefinition["outputNodes"];
  requiredInputs?: string[];
  optionalInputs?: string[];
  parameterSchema?: Record<string, unknown>;
  minVramGb?: number | null;
  tags?: string[];
  enabled?: boolean;
  /** Create a new version instead of updating in place. */
  newVersion?: boolean;
}

export function upsertWorkflow(input: UpsertWorkflowInput): WorkflowDefinition {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  const existing = db.query("SELECT MAX(version) AS v FROM gen_workflows WHERE id = ?").get(input.id) as { v: number | null };
  const version = input.newVersion ? (existing.v ?? 0) + 1 : (existing.v ?? 1);
  const enabled = input.enabled ?? false;
  db.query(`
    INSERT INTO gen_workflows
      (id, version, name, category, provider, workflow_json, enabled, status,
       capabilities_json, bindings_json, output_nodes_json, required_inputs_json,
       optional_inputs_json, parameter_schema_json, model_requirements_json,
       min_vram_gb, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)
    ON CONFLICT(id, version) DO UPDATE SET
      name = excluded.name, category = excluded.category, provider = excluded.provider,
      workflow_json = excluded.workflow_json, enabled = excluded.enabled,
      capabilities_json = excluded.capabilities_json, bindings_json = excluded.bindings_json,
      output_nodes_json = excluded.output_nodes_json, required_inputs_json = excluded.required_inputs_json,
      optional_inputs_json = excluded.optional_inputs_json, parameter_schema_json = excluded.parameter_schema_json,
      min_vram_gb = excluded.min_vram_gb, tags_json = excluded.tags_json, updated_at = excluded.updated_at
  `).run(
    input.id, version, input.name, input.category, input.provider ?? "comfyui",
    input.workflowJson, enabled ? 1 : 0, enabled ? "ready" : "disabled",
    JSON.stringify(input.capabilities ?? []), JSON.stringify(input.bindings ?? {}),
    JSON.stringify(input.outputNodes ?? []), JSON.stringify(input.requiredInputs ?? []),
    JSON.stringify(input.optionalInputs ?? []), JSON.stringify(input.parameterSchema ?? {}),
    input.minVramGb ?? null, JSON.stringify(input.tags ?? []), now, now,
  );
  return getWorkflow(input.id, version)!;
}

export function setWorkflowEnabled(id: string, enabled: boolean, status?: WorkflowDefinition["status"]): void {
  const db = openAgentOsDb();
  const row = db.query("SELECT version FROM gen_workflows WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as { version: number } | undefined;
  if (!row) return;
  db.query("UPDATE gen_workflows SET enabled = ?, status = ?, updated_at = ? WHERE id = ? AND version = ?")
    .run(enabled ? 1 : 0, status ?? (enabled ? "ready" : "disabled"), new Date().toISOString(), id, row.version);
}

// ---------------------------------------------------------------- models

export interface UpsertModelInput {
  id: string; displayName: string; family: string; type?: string; checkpointName: string;
  provider?: string; minVramGb?: number | null; recommendedVramGb?: number | null;
  licenseNotes?: string; commercialUseNotes?: string; enabled?: boolean; tags?: string[];
}

export function upsertModel(input: UpsertModelInput): GenerationModel {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_models
      (id, display_name, family, type, checkpoint_name, provider, min_vram_gb,
       recommended_vram_gb, license_notes, commercial_use_notes, enabled, tags_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name, family = excluded.family, type = excluded.type,
      checkpoint_name = excluded.checkpoint_name, min_vram_gb = excluded.min_vram_gb,
      recommended_vram_gb = excluded.recommended_vram_gb, license_notes = excluded.license_notes,
      commercial_use_notes = excluded.commercial_use_notes, enabled = excluded.enabled, tags_json = excluded.tags_json
  `).run(
    input.id, input.displayName, input.family, input.type ?? "checkpoint", input.checkpointName,
    input.provider ?? "comfyui", input.minVramGb ?? null, input.recommendedVramGb ?? null,
    input.licenseNotes ?? "", input.commercialUseNotes ?? "unverified", (input.enabled ?? true) ? 1 : 0,
    JSON.stringify(input.tags ?? []), now,
  );
  const row = db.query("SELECT * FROM gen_models WHERE id = ?").get(input.id) as Record<string, unknown>;
  return rowToModel(row);
}

export function listModels(): GenerationModel[] {
  const rows = openAgentOsDb().query("SELECT * FROM gen_models ORDER BY display_name").all() as Record<string, unknown>[];
  return rows.map(rowToModel);
}

export function getModel(id: string): GenerationModel | null {
  const row = openAgentOsDb().query("SELECT * FROM gen_models WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToModel(row) : null;
}

// ---------------------------------------------------------------- loras

export interface UpsertLoraInput {
  id: string; name: string; filename: string; baseModelFamily: string;
  triggerWords?: string[]; defaultStrength?: number; minStrength?: number; maxStrength?: number;
  commercialUseNotes?: string; enabled?: boolean; tags?: string[];
}

export function upsertLora(input: UpsertLoraInput): GenerationLora {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_loras
      (id, name, filename, base_model_family, trigger_words_json, default_strength,
       min_strength, max_strength, commercial_use_notes, enabled, tags_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, filename = excluded.filename, base_model_family = excluded.base_model_family,
      trigger_words_json = excluded.trigger_words_json, default_strength = excluded.default_strength,
      min_strength = excluded.min_strength, max_strength = excluded.max_strength,
      commercial_use_notes = excluded.commercial_use_notes, enabled = excluded.enabled, tags_json = excluded.tags_json
  `).run(
    input.id, input.name, input.filename, input.baseModelFamily,
    JSON.stringify(input.triggerWords ?? []), input.defaultStrength ?? 0.8,
    input.minStrength ?? 0, input.maxStrength ?? 1.5,
    input.commercialUseNotes ?? "unverified", (input.enabled ?? true) ? 1 : 0,
    JSON.stringify(input.tags ?? []), now,
  );
  const row = db.query("SELECT * FROM gen_loras WHERE id = ?").get(input.id) as Record<string, unknown>;
  return rowToLora(row);
}

export function listLoras(): GenerationLora[] {
  const rows = openAgentOsDb().query("SELECT * FROM gen_loras ORDER BY name").all() as Record<string, unknown>[];
  return rows.map(rowToLora);
}

// ---------------------------------------------------------------- binding

export interface BindingValues {
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  batch_size?: number;
  model?: string;
  loras?: Array<{ filename: string; strength: number; model_adapter: string }>; // pre-expanded
}

export interface AppliedBindingResult {
  graph: Record<string, unknown>;
  applied: string[];
  missing: string[];
}

/**
 * Deep-copies the template graph and applies semantic bindings. Registered
 * binding values that reference a missing node/input are reported, never
 * guessed (spec sections 81 + 95).
 */
export function applyBindings(workflow: WorkflowDefinition, values: BindingValues): AppliedBindingResult {
  const graph = JSON.parse(workflow.workflowJson) as Record<string, unknown>;
  const applied: string[] = [];
  const missing: string[] = [];
  const simple: Array<[keyof BindingValues, unknown]> = [
    ["prompt", values.prompt],
    ["negative_prompt", values.negative_prompt],
    ["seed", values.seed],
    ["width", values.width],
    ["height", values.height],
    ["batch_size", values.batch_size],
    ["model", values.model],
  ];
  for (const [key, value] of simple) {
    if (value === undefined) continue;
    const binding = workflow.bindings[key];
    if (!binding) { missing.push(key); continue; }
    const node = graph[binding.node_id] as { inputs?: Record<string, unknown> } | undefined;
    if (!node || typeof node !== "object") { missing.push(key); continue; }
    node.inputs = node.inputs ?? {};
    node.inputs[binding.input_key] = value;
    applied.push(key);
  }
  // LoRA lists are pass-through when the workflow declares a binding target;
  // the workflow author owns the node-level representation. Without a target
  // they are reported missing rather than silently dropped (spec section 95).
  if (values.loras !== undefined && values.loras.length > 0) {
    const loraBinding = workflow.bindings.loras;
    const node = loraBinding ? graph[loraBinding.node_id] as { inputs?: Record<string, unknown> } | undefined : undefined;
    if (!node) { missing.push("loras"); }
    else {
      node.inputs = node.inputs ?? {};
      node.inputs[loraBinding!.input_key] = values.loras;
      applied.push("loras");
    }
  }
  return { graph, applied, missing };
}

/** Semantic keys a workflow supports (capability-driven UI, spec section 96). */
export function workflowSupportedKeys(workflow: WorkflowDefinition): string[] {
  return Object.keys(workflow.bindings);
}

export function newRegistryId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
