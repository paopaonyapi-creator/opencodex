// Phase 20.92 GOLD — Real ComfyUI image-generation client (P0).
//
// Speaks ComfyUI's native HTTP API: POST /prompt (submit graph), GET
// /history/{prompt_id} (queue monitoring), GET /view (artifact download).
// This module is a PURE network client: it returns artifact BYTES plus
// metadata; persistence and integrity live in the AssetRegistry (which owns
// every storage location through the sandbox guard).
//
// Workflow graphs are REGISTRY-CONTROLLED: the built-in text2img graph is the
// default; an optional approved graph is selected by WORKFLOW ID from the
// registered studio `workflows/` directory (never by a caller-supplied
// location) — the lookup itself lives with the AssetRegistry. Configuration
// comes only from approved env (PAO_COMFYUI_URL); no secrets are written into
// project JSON, prompts or logs. The Phase 20.7 ComfyUiVideoAdapter keeps
// owning VIDEO production — this client adds the IMAGE capability without
// duplicating that subsystem.

import { getRandomValues, randomUUID } from "node:crypto";
import { comfyuiEndpoint } from "./providers";

export type ComfyuiErrorCode =
  | "COMFYUI_UNCONFIGURED"
  | "COMFYUI_UNAVAILABLE"
  | "COMFYUI_SUBMIT_FAILED"
  | "COMFYUI_TIMEOUT"
  | "COMFYUI_JOB_FAILED"
  | "COMFYUI_OUTPUT_MISSING";

export class ComfyuiError extends Error {
  readonly code: ComfyuiErrorCode;
  readonly detail: Record<string, unknown>;
  constructor(code: ComfyuiErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ComfyuiError";
    this.code = code;
    this.detail = detail ?? {};
  }
}

export interface ComfyuiHealth { healthy: boolean; latencyMs: number; error?: string }

/** GET /system_stats probe with a bounded timeout. */
export async function probeComfyuiHealth(baseUrl: string): Promise<ComfyuiHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Crypto-strong default seed (reproducible when the caller pins one). */
export function defaultSeed(): number {
  return getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * Strict identifier shape for workflow ids selected from the approved
 * registry: `[A-Za-z0-9_-]` only. The character class excludes dots entirely,
 * so no traversal sequence can ever survive this guard.
 */
export function assertSafeWorkflowId(id: string): string {
  if (!/^[\w-]+$/.test(id)) {
    throw new ComfyuiError("COMFYUI_SUBMIT_FAILED", "workflow id failed the shape guard — rejected");
  }
  return id;
}

export interface ComfyuiWorkflowInput {
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  /** Optional approved workflow JSON (registry-selected), overriding the built-in graph. */
  approvedWorkflow?: Record<string, unknown>;
}

/**
 * Built-in text2img graph in ComfyUI API format. Injection points are the
 * labeled nodes; everything else is fixed so a user-controlled prompt can
 * never alter the graph topology.
 */
export function buildTextToImageWorkflow(input: ComfyuiWorkflowInput): Record<string, unknown> {
  if (input.approvedWorkflow) {
    // Inject ONLY the sanctioned fields into an approved graph.
    const graph = structuredClone(input.approvedWorkflow) as Record<string, Record<string, unknown>>;
    for (const node of Object.values(graph)) {
      const classType = String(node?.["class_type"] ?? "");
      const widgets = (node?.inputs ?? {}) as Record<string, unknown>;
      if (classType === "CLIPTextEncode" && typeof widgets.text === "string") {
        if (widgets.text === "$PAO_POSITIVE") widgets.text = input.prompt;
        else if (widgets.text === "$PAO_NEGATIVE") widgets.text = input.negativePrompt;
      } else if (classType === "KSampler" && widgets.seed !== undefined) {
        widgets.seed = input.seed;
      } else if (classType === "EmptyLatentImage") {
        widgets.width = input.width;
        widgets.height = input.height;
      }
    }
    return graph;
  }
  const positiveId = "6";
  const negativeId = "7";
  const latentId = "5";
  const samplerId = "3";
  const decodeId = "8";
  const saveId = "9";
  return {
    [positiveId]: { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["4", 1] } },
    [negativeId]: { class_type: "CLIPTextEncode", inputs: { text: input.negativePrompt, clip: ["4", 1] } },
    [latentId]: { class_type: "EmptyLatentImage", inputs: { width: input.width, height: input.height, batch_size: 1 } },
    [samplerId]: {
      class_type: "KSampler",
      inputs: { seed: input.seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: [positiveId, 0], negative: [negativeId, 0], latent_image: [latentId, 0] },
    },
    [decodeId]: { class_type: "VAEDecode", inputs: { samples: [samplerId, 0], vae: ["4", 2] } },
    [saveId]: { class_type: "SaveImage", inputs: { filename_prefix: "pao_video_studio", images: [decodeId, 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: process.env.PAO_COMFYUI_CHECKPOINT || "model.safetensors" } },
  };
}

export interface ComfyuiGenerationInput {
  prompt: string;
  negativePrompt: string;
  seed?: number;
  width: number;
  height: number;
  approvedWorkflow?: Record<string, unknown>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  retryLimit?: number;
}

export interface ComfyuiGeneration {
  bytes: Uint8Array;
  checksum: string;
  seed: number;
  promptId: string;
  width: number;
  height: number;
  mimeType: string;
  durationMs: number;
  retryCount: number;
  filename: string;
}

interface HistoryOutput {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
}

/**
 * Generate one image via a real ComfyUI instance: submit → poll history →
 * download artifact bytes. Bounded retry on submission, bounded overall
 * timeout, abort-safe. SHA-256 and registration happen in the AssetRegistry.
 */
export async function generateImageWithComfyui(input: ComfyuiGenerationInput): Promise<ComfyuiGeneration> {
  const baseUrl = comfyuiEndpoint();
  if (!baseUrl) throw new ComfyuiError("COMFYUI_UNCONFIGURED", "PAO_COMFYUI_URL is not configured — ComfyUI image generation is unavailable");
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 500;
  const seed = input.seed ?? defaultSeed();
  const workflow = buildTextToImageWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    seed,
    width: input.width,
    height: input.height,
    approvedWorkflow: input.approvedWorkflow,
  });
  const clientId = `pao-video-studio-${randomUUID().slice(0, 8)}`;
  const signal = input.signal;

  // Submit with bounded backoff retry (network blips only — graph errors fail fast).
  let promptId = "";
  let retryCount = 0;
  const retryLimit = input.retryLimit ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${baseUrl}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ComfyuiError("COMFYUI_SUBMIT_FAILED", `ComfyUI /prompt returned HTTP ${res.status}`, { body: body.slice(0, 300) });
      }
      const parsed = (await res.json()) as { prompt_id?: string };
      if (!parsed.prompt_id) throw new ComfyuiError("COMFYUI_SUBMIT_FAILED", "ComfyUI /prompt returned no prompt_id");
      promptId = parsed.prompt_id;
      break;
    } catch (err) {
      if (err instanceof ComfyuiError && err.code === "COMFYUI_SUBMIT_FAILED" && !String(err.detail?.body ?? "").includes("HTTP 5")) throw err;
      if (signal?.aborted) throw new ComfyuiError("COMFYUI_JOB_FAILED", "generation cancelled before submit");
      if (attempt >= retryLimit) throw err instanceof ComfyuiError ? err : new ComfyuiError("COMFYUI_SUBMIT_FAILED", String(err));
      retryCount = attempt + 1;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }

  // Poll /history until the job completes or the deadline passes.
  const deadline = Date.now() + timeoutMs;
  let history: HistoryOutput | null = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ComfyuiError("COMFYUI_JOB_FAILED", "generation cancelled during execution", { promptId });
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const res = await fetch(`${baseUrl}/history/${promptId}`).catch(() => null);
    if (!res || !res.ok) continue;
    const parsed = (await res.json().catch(() => null)) as Record<string, HistoryOutput> | null;
    const entry = parsed?.[promptId];
    if (!entry) continue;
    history = entry;
    if (entry.status?.completed || Object.keys(entry.outputs ?? {}).length > 0) break;
  }
  if (!history) throw new ComfyuiError("COMFYUI_TIMEOUT", `ComfyUI job ${promptId} did not complete within ${timeoutMs}ms`, { promptId });
  if (history.status?.status_str === "error") throw new ComfyuiError("COMFYUI_JOB_FAILED", `ComfyUI job ${promptId} failed on the remote queue`, { promptId });

  // Discover the produced file and download it through /view.
  const image = Object.values(history.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
  if (!image) throw new ComfyuiError("COMFYUI_OUTPUT_MISSING", `ComfyUI job ${promptId} completed without image outputs`, { promptId });
  const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${encodeURIComponent(image.type ?? "output")}`;
  const download = await fetch(viewUrl);
  if (!download.ok) throw new ComfyuiError("COMFYUI_OUTPUT_MISSING", `ComfyUI /view returned HTTP ${download.status}`, { promptId, filename: image.filename });
  const bytes = new Uint8Array(await download.arrayBuffer());

  return {
    bytes, checksum: "", seed, promptId, width: input.width, height: input.height,
    mimeType: "image/png", durationMs: Date.now() - started, retryCount, filename: image.filename,
  };
}
