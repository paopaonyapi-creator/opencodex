// Phase 19 — Pao AI Generation Studio management API.
//
// Endpoints under /api/generation/*: providers, workflows, models, loras,
// projects, jobs (queue), assets (gallery), review, metadata, export, realtime
// events (SSE), audit, and validation. Auth is the existing management plane
// (management-api.ts gate); mutations additionally require an admin-token or
// gui-session principal — capability principals are rejected (defense in depth;
// they are route-scoped and never reach this module in production).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getWorkflow, listWorkflows, listModels, listLoras, upsertModel, upsertLora, upsertWorkflow, setWorkflowEnabled,
} from "../../agent-os/generation/registry";
import {
  createJob, getJob, listJobs, listJobEvents, listEventsForJobs, requestCancel, updateJob,
  recordGenerationAudit, listGenerationAudit, retryFailedJob, getJobByIdempotencyKey,
} from "../../agent-os/generation/queue";
import {
  getProvider, listProviders, upsertProvider,
} from "../../agent-os/generation/providers";
import {
  listAssets, getAssetRecord, softDeleteAsset, listProjects, upsertProject, updateAssetFavoriteRating,
} from "../../agent-os/generation/store-helpers";
import { evaluateAssetByGenerationCouncil, listReviewsForAsset } from "../../agent-os/generation/reviewer";
import { generateStockMetadata, createExportPackage, listExportPackages } from "../../agent-os/generation/stock";
import { getGenerationOrchestrator } from "../../agent-os/generation/orchestrator";
import { loadGenerationConfig } from "../../agent-os/generation/config";
import { ComfyUiClient } from "../../agent-os/generation/comfyui-client";
import type { JobStatus } from "../../agent-os/generation/types";
import { handleComputeAndRunPodRoutes } from "./generation-compute-routes";
import { handleSmartQueueRoutes } from "./smart-queue-routes";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function forbidden(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "forbidden", message } }, 403, req, {});
}

function disabled(req: Request): Response {
  return jsonResponse({ error: { code: "generation_disabled", message: "PAO_GENERATION_ENABLED=false" } }, 503, req, {});
}

function actorOf(ctx: ManagementContext): string {
  const principal = ctx.principal ?? "admin-token";
  if (typeof principal === "string") return principal;
  const role = (principal as { role?: string }).role;
  return role ? `session:${role}` : "session";
}

/** Mutations need a human-plane principal; capability principals are read-scoped. */
function requireMutationPrincipal(ctx: ManagementContext): Response | null {
  const principal = ctx.principal ?? "admin-token"; // direct-dispatch tests behave as admin-token
  // Production principals are the ManagementPrincipal union; the object form is
  // the route-test convention used by stock-routes/seo-routes fixtures.
  const isStringPrincipal = typeof principal === "string";
  const isGuiOrAdmin = isStringPrincipal
    ? principal === "admin-token" || principal === "gui-session"
    : (principal as { role?: string }).role === "admin" || (principal as { role?: string }).role === "reviewer" || (principal as { role?: string }).role === "creator";
  if (isGuiOrAdmin) return null;
  return forbidden(ctx.req, "principal cannot mutate generation state");
}

function generationDisabled(ctx: ManagementContext): boolean {
  try {
    return !loadGenerationConfig().enabled;
  } catch {
    return false; // config errors surface through validate, not a hard 503 here
  }
}

export async function handleGenerationRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  if (!url.pathname.startsWith("/api/generation/")) return null;
  if (generationDisabled(ctx)) return disabled(req);
  const subPath = url.pathname.slice("/api/generation/".length);
  if (subPath.startsWith("compute/") || subPath.startsWith("runpod/")) {
    const computeRes = await handleComputeAndRunPodRoutes(ctx, subPath);
    if (computeRes) return computeRes;
  }
  if (subPath.startsWith("smart-queue/")) {
    const queueRes = await handleSmartQueueRoutes(ctx, subPath);
    if (queueRes) return queueRes;
  }

  // ---------------------------------------------------------- health & stats
  if (subPath === "health" && req.method === "GET") {
    const config = loadGenerationConfig();
    const providers = listProviders();
    const queueDepth = listJobs({ status: "queued" as JobStatus, limit: 1 }).total;
    const activeCount = listJobs({ status: "generating" as JobStatus, limit: 1 }).total;
    return jsonResponse({
      enabled: config.enabled,
      providers: providers.map(p => ({ id: p.id, health: p.healthStatus, baseUrl: p.baseUrl })),
      queueDepth,
      activeJobs: activeCount,
    }, 200, req, {});
  }

  // ---------------------------------------------------------- providers
  if (subPath === "providers" && req.method === "GET") {
    return jsonResponse({ providers: listProviders() }, 200, req, {});
  }
  if (subPath === "providers" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as { id?: string; name?: string; baseUrl?: string; maxConcurrency?: number; timeoutSeconds?: number } | null;
    if (!body?.id || !body?.name || !body?.baseUrl) return badRequest(req, "id, name, and baseUrl are required");
    const provider = upsertProvider({ id: body.id, name: body.name, baseUrl: body.baseUrl, maxConcurrency: body.maxConcurrency, timeoutSeconds: body.timeoutSeconds });
    recordGenerationAudit({ actor: actorOf(ctx), action: "provider.upsert", subjectType: "gen_provider", subjectId: provider.id });
    return jsonResponse({ provider }, 201, req, {});
  }
  if (subPath.startsWith("providers/") && subPath.endsWith("/health") && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const id = subPath.slice("providers/".length, -"/health".length);
    const provider = getProvider(id);
    if (!provider) return notFound(req, `provider ${id} not found`);
    const client = new ComfyUiClient({ baseUrl: provider.baseUrl, timeoutMs: 8_000 });
    const health = await client.healthCheck();
    const { recordProviderHealth } = await import("../../agent-os/generation/providers");
    recordProviderHealth(id, health.healthy ? "healthy" : "offline");
    return jsonResponse({ id, healthy: health.healthy, systemStats: health.systemStats ?? null, error: health.error ?? null }, health.healthy ? 200 : 502, req, {});
  }

  // ---------------------------------------------------------- workflows
  if (subPath === "workflows" && req.method === "GET") {
    return jsonResponse({ workflows: listWorkflows() }, 200, req, {});
  }
  if (subPath === "workflows" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as {
      id?: string; name?: string; category?: string; workflowJson?: string;
      bindings?: Record<string, { node_id: string; input_key: string }>;
      requiredInputs?: string[]; optionalInputs?: string[]; capabilities?: string[];
      enabled?: boolean; newVersion?: boolean;
    } | null;
    if (!body?.id || !body?.name || !body?.category || !body?.workflowJson) {
      return badRequest(req, "id, name, category, and workflowJson are required");
    }
    try {
      JSON.parse(body.workflowJson);
    } catch {
      return badRequest(req, "workflowJson is not valid JSON");
    }
    const workflow = upsertWorkflow({
      id: body.id, name: body.name, category: body.category, workflowJson: body.workflowJson,
      bindings: body.bindings, requiredInputs: body.requiredInputs, optionalInputs: body.optionalInputs,
      capabilities: body.capabilities, enabled: body.enabled, newVersion: body.newVersion,
    });
    recordGenerationAudit({ actor: actorOf(ctx), action: "workflow.upsert", subjectType: "gen_workflow", subjectId: workflow.id, details: { version: workflow.version } });
    return jsonResponse({ workflow }, 201, req, {});
  }
  if (subPath.startsWith("workflows/")) {
    const rest = subPath.slice("workflows/".length);
    if (rest.endsWith("/validate") && req.method === "POST") {
      const id = rest.slice(0, -"/validate".length);
      const workflow = getWorkflow(id);
      if (!workflow) return notFound(req, `workflow ${id} not found`);
      const { validateWorkflow } = await import("../../agent-os/generation/validate");
      const result = await validateWorkflow(workflow);
      return jsonResponse(result, 200, req, {});
    }
    if (rest.endsWith("/enable") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/enable".length);
      const body = await req.json().catch(() => ({})) as { enabled?: boolean };
      setWorkflowEnabled(id, body.enabled ?? true);
      recordGenerationAudit({ actor: actorOf(ctx), action: "workflow.enable", subjectType: "gen_workflow", subjectId: id, details: { enabled: body.enabled ?? true } });
      return jsonResponse({ ok: true }, 200, req, {});
    }
    const versionParam = url.searchParams.get("version");
    const workflow = getWorkflow(rest, versionParam ? Number(versionParam) : undefined);
    if (req.method === "GET" && workflow) return jsonResponse({ workflow }, 200, req, {});
    if (req.method === "GET") return notFound(req, `workflow ${rest} not found`);
  }

  // ---------------------------------------------------------- models & loras
  if (subPath === "models" && req.method === "GET") return jsonResponse({ models: listModels() }, 200, req, {});
  if (subPath === "models" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as { id?: string; displayName?: string; family?: string; checkpointName?: string; commercialUseNotes?: string } | null;
    if (!body?.id || !body?.displayName || !body?.family || !body?.checkpointName) return badRequest(req, "id, displayName, family, and checkpointName are required");
    const model = upsertModel({ id: body.id, displayName: body.displayName, family: body.family, checkpointName: body.checkpointName, commercialUseNotes: body.commercialUseNotes });
    recordGenerationAudit({ actor: actorOf(ctx), action: "model.upsert", subjectType: "gen_model", subjectId: model.id });
    return jsonResponse({ model }, 201, req, {});
  }
  if (subPath === "loras" && req.method === "GET") return jsonResponse({ loras: listLoras() }, 200, req, {});
  if (subPath === "loras" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as { id?: string; name?: string; filename?: string; baseModelFamily?: string } | null;
    if (!body?.id || !body?.name || !body?.filename || !body?.baseModelFamily) return badRequest(req, "id, name, filename, and baseModelFamily are required");
    const lora = upsertLora({ id: body.id, name: body.name, filename: body.filename, baseModelFamily: body.baseModelFamily });
    recordGenerationAudit({ actor: actorOf(ctx), action: "lora.upsert", subjectType: "gen_lora", subjectId: lora.id });
    return jsonResponse({ lora }, 201, req, {});
  }

  // ---------------------------------------------------------- projects
  if (subPath === "projects" && req.method === "GET") return jsonResponse({ projects: listProjects() }, 200, req, {});
  if (subPath === "projects" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as { name?: string; description?: string; mode?: "general" | "adobe_stock" | "social" | "product"; defaultWorkflow?: string; defaultModel?: string } | null;
    if (!body?.name?.trim()) return badRequest(req, "name is required");
    const project = upsertProject({ name: body.name, description: body.description, mode: body.mode, defaultWorkflow: body.defaultWorkflow ?? null, defaultModel: body.defaultModel ?? null });
    recordGenerationAudit({ actor: actorOf(ctx), action: "project.create", subjectType: "gen_project", subjectId: project.id });
    return jsonResponse({ project }, 201, req, {});
  }

  // ---------------------------------------------------------- jobs
  if (subPath === "jobs" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const body = await req.json().catch(() => null) as {
      projectId?: string; jobType?: string; workflowId?: string; workflowVersion?: number;
      modelId?: string; prompt?: string; negativePrompt?: string; seed?: number;
      width?: number; height?: number; batchSize?: number; priority?: number;
      loras?: Array<{ id: string; strength: number }>; stockMode?: boolean;
      autoReview?: boolean; autoMetadata?: boolean; autoExport?: boolean;
    } | null;
    if (!body?.workflowId || !body?.prompt?.trim()) return badRequest(req, "workflowId and prompt are required");
    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (idempotencyKey) {
      const existing = getJobByIdempotencyKey(idempotencyKey);
      if (existing) return jsonResponse({ job: existing, duplicate: true }, 200, req, {});
    }
    const batchSize = Math.min(Math.max(body.batchSize ?? 1, 1), 64);
    const MAX_BATCH_PER_JOB = 4;
    if (batchSize <= MAX_BATCH_PER_JOB) {
      const { job } = createJob({
        projectId: body.projectId ?? null, idempotencyKey: idempotencyKey ?? null,
        jobType: (body.jobType as never) ?? "text_to_image", workflowId: body.workflowId,
        workflowVersion: body.workflowVersion ?? null, modelId: body.modelId ?? null,
        prompt: body.prompt, negativePrompt: body.negativePrompt ?? "", seed: body.seed ?? -1,
        width: Math.min(Math.max(body.width ?? 1024, 64), 8192), height: Math.min(Math.max(body.height ?? 1024, 64), 8192),
        batchSize, priority: body.priority ?? 5, loras: body.loras ?? [],
        stockMode: body.stockMode ?? false, autoReview: body.autoReview ?? true,
        autoMetadata: body.autoMetadata ?? false, autoExport: body.autoExport ?? false,
      });
      recordGenerationAudit({ actor: actorOf(ctx), action: "job.create", subjectType: "gen_job", subjectId: job.id, details: { workflowId: job.workflowId, batchSize } });
      return jsonResponse({ job }, 201, req, {});
    }
    // Batch splitting (spec section 17): parent tracker + children of <=4.
    const { job: parent } = createJob({
      projectId: body.projectId ?? null, idempotencyKey: idempotencyKey ? `${idempotencyKey}:parent` : null,
      jobType: (body.jobType as never) ?? "text_to_image", workflowId: body.workflowId,
      prompt: body.prompt, negativePrompt: body.negativePrompt ?? "", seed: body.seed ?? -1,
      width: body.width ?? 1024, height: body.height ?? 1024, batchSize,
      priority: body.priority ?? 5, parameters: { batch: true },
      stockMode: body.stockMode ?? false,
    });
    const children: string[] = [];
    let remaining = batchSize;
    while (remaining > 0) {
      const size = Math.min(remaining, MAX_BATCH_PER_JOB);
      const { job: child } = createJob({
        projectId: body.projectId ?? null, parentJobId: parent.id,
        jobType: (body.jobType as never) ?? "text_to_image", workflowId: body.workflowId,
        workflowVersion: body.workflowVersion ?? null, modelId: body.modelId ?? null,
        prompt: body.prompt, negativePrompt: body.negativePrompt ?? "", seed: body.seed ?? -1,
        width: body.width ?? 1024, height: body.height ?? 1024, batchSize: size,
        priority: body.priority ?? 5, loras: body.loras ?? [],
        stockMode: body.stockMode ?? false, autoReview: body.autoReview ?? true,
        autoMetadata: body.autoMetadata ?? false, autoExport: body.autoExport ?? false,
      });
      children.push(child.id);
      remaining -= size;
    }
    recordGenerationAudit({ actor: actorOf(ctx), action: "job.create_batch", subjectType: "gen_job", subjectId: parent.id, details: { children } });
    return jsonResponse({ job: parent, children }, 201, req, {});
  }
  if (subPath === "jobs" && req.method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const status = (url.searchParams.get("status") ?? undefined) as JobStatus | undefined;
    const parentId = url.searchParams.get("parentId") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
    const { jobs, total } = listJobs({ projectId, status, parentId, limit, offset });
    return jsonResponse({ jobs, total, limit: limit ?? 50, offset: offset ?? 0 }, 200, req, {});
  }
  if (subPath === "jobs/events" && req.method === "GET") {
    // Realtime job events as SSE (spec section 15 preference: SSE when no
    // existing realtime layer covers the subsystem).
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const jobsParam = url.searchParams.get("jobs");
    const jobIds = jobsParam ? jobsParam.split(",").filter(Boolean) : listJobs({ limit: 50 }).jobs.map(j => j.id);
    const encoder = new TextEncoder();
    let cursor = since;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const push = (event: { id: number; jobId: string; type: string; stage: string | null; progress: number | null; message: string }) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          cursor = Math.max(cursor, event.id);
        };
        const interval = setInterval(() => {
          try {
            const events = listEventsForJobs(jobIds, cursor);
            for (const event of events) push(event);
          } catch {
            // DB hiccup: keep the stream alive.
          }
        }, 700);
        req.signal?.addEventListener("abort", () => {
          closed = true;
          clearInterval(interval);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  }
  if (subPath.startsWith("jobs/")) {
    const rest = subPath.slice("jobs/".length);
    const job = getJob(rest);
    if (req.method === "GET" && !rest.endsWith("/events")) {
      if (!job) return notFound(req, `job ${rest} not found`);
      const children = listJobs({ parentId: rest, limit: 100 }).jobs;
      return jsonResponse({ job, children }, 200, req, {});
    }
    if (rest.endsWith("/events") && req.method === "GET") {
      const id = rest.slice(0, -"/events".length);
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      return jsonResponse({ events: listJobEvents(id, after) }, 200, req, {});
    }
    if (rest.endsWith("/cancel") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/cancel".length);
      if (!getJob(id)) return notFound(req, `job ${id} not found`);
      const body = await req.json().catch(() => ({})) as { reason?: string };
      const orchestrator = getGenerationOrchestrator();
      await orchestrator.cancel(id, body.reason ?? "cancelled via API", actorOf(ctx));
      return jsonResponse({ ok: true, job: getJob(id) }, 200, req, {});
    }
    if (rest.endsWith("/retry") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/retry".length);
      const existing = getJob(id);
      if (!existing) return notFound(req, `job ${id} not found`);
      if (existing.status !== "failed") return badRequest(req, `job is ${existing.status}; only failed jobs can be retried`);
      // Manual retry bypasses the retry counter (explicit user action).
      const requeued = updateJob(id, { status: "queued", stage: "preparing", errorCode: null, errorMessage: null, runAfterMs: Date.now() });
      recordGenerationAudit({ actor: actorOf(ctx), action: "job.retry", subjectType: "gen_job", subjectId: id });
      return jsonResponse({ job: requeued }, 200, req, {});
    }
  }

  // ---------------------------------------------------------- assets / gallery
  if (subPath === "assets" && req.method === "GET") {
    const q = url.searchParams;
    const { assets, total } = listAssets({
      projectId: q.get("projectId") ?? undefined,
      assetType: q.get("assetType") ?? undefined,
      modelId: q.get("modelId") ?? undefined,
      workflowId: q.get("workflowId") ?? undefined,
      reviewStatus: q.get("reviewStatus") ?? undefined,
      stockStatus: q.get("stockStatus") ?? undefined,
      keyword: q.get("keyword") ?? undefined,
      minScore: q.get("minScore") ? Number(q.get("minScore")) : undefined,
      limit: q.get("limit") ? Number(q.get("limit")) : undefined,
      offset: q.get("offset") ? Number(q.get("offset")) : undefined,
    });
    return jsonResponse({ assets, total, limit: Number(q.get("limit") ?? 50), offset: Number(q.get("offset") ?? 0) }, 200, req, {});
  }
  if (subPath === "assets" && req.method === "POST") {
    // Upload an input asset (originals/inputs) — validated image bytes only.
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const projectId = (form?.get("projectId") as string | null) ?? null;
    if (!(file instanceof File)) return badRequest(req, "multipart file field 'file' is required");
    const config = loadGenerationConfig();
    if (file.size > config.maxImageUploadMb * 1_000_000) return badRequest(req, `file exceeds PAO_MAX_IMAGE_UPLOAD_MB=${config.maxImageUploadMb}`);
    const mime = file.type;
    if (!mime.startsWith("image/")) return badRequest(req, "only image uploads are accepted here");
    const orchestrator = getGenerationOrchestrator();
    try {
      const asset = orchestrator.storage.saveAsset({
        projectId, jobId: null, assetType: "image", role: "input",
        bytes: new Uint8Array(await file.arrayBuffer()), mimeType: mime,
        sourceFilename: file.name,
      });
      recordGenerationAudit({ actor: actorOf(ctx), action: "asset.upload", subjectType: "gen_asset", subjectId: asset.id });
      return jsonResponse({ asset }, 201, req, {});
    } catch (error) {
      return badRequest(req, error instanceof Error ? error.message : "upload rejected");
    }
  }
  if (subPath.startsWith("assets/")) {
    const rest = subPath.slice("assets/".length);
    if (rest.endsWith("/file") && req.method === "GET") {
      const id = rest.slice(0, -"/file".length);
      const asset = getAssetRecord(id);
      if (!asset) return notFound(req, `asset ${id} not found`);
      const config = loadGenerationConfig();
      const { resolve } = await import("node:path");
      const root = resolve(config.storagePath);
      const filePath = resolve(asset.storagePath);
      if (!filePath.startsWith(root)) return forbidden(req, "asset path escaped storage root");
      const { readFileSync } = await import("node:fs");
      try {
        const bytes = readFileSync(filePath);
        return new Response(bytes, { status: 200, headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600" } });
      } catch {
        return notFound(req, "asset file missing on disk");
      }
    }
    if (rest.endsWith("/review") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/review".length);
      const asset = getAssetRecord(id);
      if (!asset) return notFound(req, `asset ${id} not found`);
      const evaluation = evaluateAssetByGenerationCouncil(asset);
      recordGenerationAudit({ actor: actorOf(ctx), action: "asset.review", subjectType: "gen_asset", subjectId: id, details: { decision: evaluation.decision, score: evaluation.overallScore } });
      return jsonResponse({ ...evaluation, reviews: listReviewsForAsset(id) }, 200, req, {});
    }
    if (rest.endsWith("/generate-metadata") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/generate-metadata".length);
      const asset = getAssetRecord(id);
      if (!asset) return notFound(req, `asset ${id} not found`);
      const result = generateStockMetadata(asset);
      recordGenerationAudit({ actor: actorOf(ctx), action: "asset.generate_metadata", subjectType: "gen_asset", subjectId: id, details: { valid: result.validation.valid } });
      return jsonResponse(result, 200, req, {});
    }
    if (rest.endsWith("/export") && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const id = rest.slice(0, -"/export".length);
      const asset = getAssetRecord(id);
      if (!asset) return notFound(req, `asset ${id} not found`);
      const body = await req.json().catch(() => ({})) as { allowManualReview?: boolean };
      const orchestrator = getGenerationOrchestrator();
      const result = createExportPackage({ asset, storage: orchestrator.storage, allowManualReview: body.allowManualReview });
      recordGenerationAudit({ actor: actorOf(ctx), action: "asset.export", subjectType: "gen_asset", subjectId: id, details: { mode: result.gate.mode, allowed: result.gate.allowed } });
      return jsonResponse(result, result.gate.allowed ? 201 : 409, req, {});
    }
    if (rest.endsWith("/exports") && req.method === "GET") {
      const id = rest.slice(0, -"/exports".length);
      return jsonResponse({ packages: listExportPackages(id) }, 200, req, {});
    }
    if (req.method === "PATCH") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const body = await req.json().catch(() => null) as { favorite?: boolean; userRating?: number | null } | null;
      if (!body) return badRequest(req, "body required");
      const updated = updateAssetFavoriteRating(rest, body);
      if (!updated) return notFound(req, `asset ${rest} not found`);
      return jsonResponse({ asset: updated }, 200, req, {});
    }
    if (req.method === "DELETE") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;
      const asset = getAssetRecord(rest);
      if (!asset) return notFound(req, `asset ${rest} not found`);
      softDeleteAsset(rest);
      recordGenerationAudit({ actor: actorOf(ctx), action: "asset.delete", subjectType: "gen_asset", subjectId: rest, details: { soft: true } });
      return jsonResponse({ ok: true, softDeleted: true }, 200, req, {});
    }
    if (req.method === "GET") {
      const asset = getAssetRecord(rest);
      if (!asset) return notFound(req, `asset ${rest} not found`);
      return jsonResponse({ asset, reviews: listReviewsForAsset(rest), exports: listExportPackages(rest) }, 200, req, {});
    }
  }

  // ---------------------------------------------------------- audit + validate
  if (subPath === "audit" && req.method === "GET") {
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 100;
    return jsonResponse({ entries: listGenerationAudit(limit) }, 200, req, {});
  }
  if (subPath === "validate" && req.method === "POST") {
    // Spec section 65 validation tool (admin API surface; UI button drives it).
    const { validateGenerationSubsystem } = await import("../../agent-os/generation/validate");
    const result = await validateGenerationSubsystem();
    return jsonResponse(result, 200, req, {});
  }

  return notFound(req, "unknown generation route");
}

// requestCancel/retryFailedJob re-exported for tests
export { requestCancel, retryFailedJob };
