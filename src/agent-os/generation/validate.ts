// Phase 19 — Startup/validation tool (spec sections 65 + 66).
// Reports [OK]/[WARN]/[FAIL] per subsystem without ever crashing the caller.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadGenerationConfig, generationConfigError } from "./config";
import { ComfyUiClient } from "./comfyui-client";
import { listWorkflows, listModels, listLoras } from "./registry";
import { listProviders } from "./providers";

export interface GenerationValidationLine {
  level: "OK" | "WARN" | "FAIL";
  component: string;
  message: string;
}

export interface GenerationValidationResult {
  ok: boolean;
  lines: GenerationValidationLine[];
}

export async function validateGenerationSubsystem(): Promise<GenerationValidationResult> {
  const lines: GenerationValidationLine[] = [];
  let config: ReturnType<typeof loadGenerationConfig>;
  try {
    config = loadGenerationConfig();
    const err = generationConfigError(config);
    if (err) {
      lines.push({ level: "FAIL", component: "Config", message: err });
      return { ok: false, lines };
    }
    lines.push({ level: "OK", component: "Config", message: "environment values valid" });
  } catch (error) {
    lines.push({ level: "FAIL", component: "Config", message: error instanceof Error ? error.message : String(error) });
    return { ok: false, lines };
  }

  if (!config.enabled) {
    lines.push({ level: "WARN", component: "FeatureFlag", message: "PAO_GENERATION_ENABLED=false — subsystem disabled" });
  }

  // Storage root exists or is creatable.
  try {
    const root = resolve(config.storagePath);
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      lines.push({ level: "OK", component: "Storage", message: `created ${root}` });
    } else if (statSync(root).isDirectory()) {
      lines.push({ level: "OK", component: "Storage", message: root });
    } else {
      lines.push({ level: "FAIL", component: "Storage", message: `${root} is not a directory` });
    }
  } catch (error) {
    lines.push({ level: "FAIL", component: "Storage", message: error instanceof Error ? error.message : String(error) });
  }

  // Provider connectivity (never fatal for the rest of Pao-hubPro).
  const providers = listProviders({ enabledOnly: true });
  if (providers.length === 0) {
    lines.push({ level: "WARN", component: "Providers", message: "no providers registered; ComfyUI default is probed instead" });
  }
  const client = new ComfyUiClient({ baseUrl: config.comfyuiBaseUrl, timeoutMs: 6_000 });
  const health = await client.healthCheck();
  lines.push(health.healthy
    ? { level: "OK", component: "ComfyUI", message: `${config.comfyuiBaseUrl} reachable` }
    : { level: "WARN", component: "ComfyUI", message: `${config.comfyuiBaseUrl} offline (${health.error ?? "unknown"}) — generation degraded, rest of Pao-hubPro unaffected` });

  // Workflows: every enabled workflow must parse and bind to real nodes.
  for (const workflow of listWorkflows()) {
    if (!workflow.enabled) {
      lines.push({ level: "WARN", component: `Workflow ${workflow.id}`, message: "disabled" });
      continue;
    }
    try {
      const graph = JSON.parse(workflow.workflowJson) as Record<string, unknown>;
      const missingNodes = Object.values(workflow.bindings)
        .map(b => b.node_id)
        .filter(nodeId => !(nodeId in graph));
      const missingOutputs = workflow.outputNodes.filter(o => !(o.node_id in graph));
      if (missingNodes.length > 0 || missingOutputs.length > 0) {
        lines.push({ level: "FAIL", component: `Workflow ${workflow.id}`, message: `invalid binding: missing nodes ${[...missingNodes, ...missingOutputs.map(o => o.node_id)].join(", ")}` });
      } else {
        lines.push({ level: "OK", component: `Workflow ${workflow.id}`, message: `v${workflow.version} bindings resolve` });
      }
    } catch {
      lines.push({ level: "FAIL", component: `Workflow ${workflow.id}`, message: "workflowJson is not valid JSON" });
    }
  }

  // Model/LoRA registry sanity.
  const models = listModels();
  if (models.length === 0) lines.push({ level: "WARN", component: "Models", message: "no models registered" });
  for (const model of models) {
    if (model.commercialUseNotes === "unverified") {
      lines.push({ level: "WARN", component: `Model ${model.id}`, message: "license metadata unverified — commercial use requires admin confirmation" });
    }
  }
  for (const lora of listLoras()) {
    if (lora.commercialUseNotes === "unverified") {
      lines.push({ level: "WARN", component: `LoRA ${lora.id}`, message: "license metadata missing" });
    }
  }

  return { ok: lines.every(l => l.level !== "FAIL"), lines };
}

/** Single-workflow validation used by POST /api/generation/workflows/:id/validate. */
export async function validateWorkflow(workflow: { id: string; workflowJson: string; bindings: Record<string, { node_id: string }>; outputNodes: Array<{ node_id: string }>; provider: string }): Promise<{ ok: boolean; lines: GenerationValidationLine[] }> {
  const lines: GenerationValidationLine[] = [];
  let graph: Record<string, unknown>;
  try {
    graph = JSON.parse(workflow.workflowJson) as Record<string, unknown>;
  } catch {
    return { ok: false, lines: [{ level: "FAIL", component: `Workflow ${workflow.id}`, message: "workflowJson is not valid JSON" }] };
  }
  const missing = Object.values(workflow.bindings).map(b => b.node_id).filter(nodeId => !(nodeId in graph));
  const missingOutputs = workflow.outputNodes.filter(o => !(o.node_id in graph));
  if (missing.length > 0 || missingOutputs.length > 0) {
    lines.push({ level: "FAIL", component: `Workflow ${workflow.id}`, message: `invalid binding: missing nodes ${[...missing, ...missingOutputs.map(o => o.node_id)].join(", ")}` });
  } else {
    lines.push({ level: "OK", component: `Workflow ${workflow.id}`, message: "bindings resolve" });
  }
  const config = loadGenerationConfig();
  const client = new ComfyUiClient({ baseUrl: config.comfyuiBaseUrl, timeoutMs: 6_000 });
  const health = await client.healthCheck();
  if (health.healthy) {
    lines.push({ level: "OK", component: "ComfyUI", message: "reachable — node availability can be verified live" });
  } else {
    lines.push({ level: "WARN", component: "ComfyUI", message: `offline (${health.error ?? "unknown"}) — status provider_offline until reachable` });
  }
  return { ok: lines.every(l => l.level !== "FAIL"), lines };
}
