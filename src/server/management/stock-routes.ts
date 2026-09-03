// Pao AI Media Factory — Stock Management API Routes (Phase 16)
//
// Endpoints under /api/agent-os/stock/* for stock opportunities, concepts,
// multi-provider generation, Reviewer Council execution, human override,
// technical validation, and export packaging.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { ADOBE_STOCK_RULES } from "../../agent-os/config/adobe-stock-rules";
import { validateStockJpeg } from "../../agent-os/validators/stock-jpeg-validator";
import { validateStockPng } from "../../agent-os/validators/stock-png-validator";
import { validateStockVideo } from "../../agent-os/validators/stock-video-validator";
import { validateStockMetadata } from "../../agent-os/validators/stock-metadata-validator";
import {
  createStockOpportunity,
  listStockOpportunities,
  createStockConcept,
  listStockConcepts,
  getStockConcept,
  createStockAsset,
  getStockAsset,
  recordStockLineage,
  createStockExportPack,
  updateStockAssetStatus,
} from "../../agent-os/stock-models";
import { openAgentOsDb } from "../../agent-os/db";
import { providerRegistry } from "../../agent-os/providers/provider-registry";
import { evaluateAssetByCouncil, applyHumanCouncilOverride } from "../../agent-os/reviewers/reviewer-council";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

export async function handleStockRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  if (!url.pathname.startsWith("/api/agent-os/stock/")) return null;
  const subPath = url.pathname.slice("/api/agent-os/stock/".length);

  // 1. Rules configuration
  if (subPath === "rules" && req.method === "GET") {
    return jsonResponse(ADOBE_STOCK_RULES, 200, req, {});
  }

  // 2. Standalone Validator Endpoint
  if (subPath === "validate" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      mode?: "jpeg" | "png" | "video" | "metadata";
      payload?: Record<string, unknown>;
    } | null;

    if (!body?.mode || !body?.payload) return badRequest(req, "mode and payload are required");

    if (body.mode === "jpeg") {
      const result = validateStockJpeg(body.payload as never);
      return jsonResponse(result, 200, req, {});
    }
    if (body.mode === "png") {
      const result = validateStockPng(body.payload as never);
      return jsonResponse(result, 200, req, {});
    }
    if (body.mode === "video") {
      const result = validateStockVideo(body.payload as never);
      return jsonResponse(result, 200, req, {});
    }
    if (body.mode === "metadata") {
      const result = validateStockMetadata(body.payload as never);
      return jsonResponse(result, 200, req, {});
    }
    return badRequest(req, `Unsupported validation mode: ${body.mode}`);
  }

  // 3. Opportunities
  if (subPath === "opportunities") {
    if (req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      return jsonResponse({ opportunities: listStockOpportunities(projectId) }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        projectId?: string;
        title?: string;
        niche?: string;
        buyerPersona?: string;
        score?: number;
        confidence?: number;
        evidenceClass?: "A" | "B" | "C" | "D" | "P" | "I";
        evidence?: Record<string, unknown>;
      } | null;

      if (!body?.projectId || !body?.title || !body?.niche || !body?.buyerPersona) {
        return badRequest(req, "projectId, title, niche, and buyerPersona are required");
      }

      const opp = createStockOpportunity({
        projectId: body.projectId,
        title: body.title,
        niche: body.niche,
        buyerPersona: body.buyerPersona,
        score: body.score ?? 50,
        confidence: body.confidence ?? 50,
        evidenceClass: body.evidenceClass ?? "I",
        evidence: body.evidence ?? {},
      });
      return jsonResponse({ opportunity: opp }, 201, req, {});
    }
  }

  // 4. Concepts
  if (subPath === "concepts") {
    if (req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      return jsonResponse({ concepts: listStockConcepts(projectId) }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        projectId?: string;
        opportunityId?: string;
        title?: string;
        description?: string;
        commercialUseCase?: string;
        copySpace?: string;
        differentiation?: string;
        productionMode?: "stock_image" | "stock_png" | "stock_video";
      } | null;

      if (!body?.projectId || !body?.title || !body?.commercialUseCase) {
        return badRequest(req, "projectId, title, and commercialUseCase are required");
      }

      const concept = createStockConcept({
        projectId: body.projectId,
        opportunityId: body.opportunityId ?? null,
        title: body.title,
        description: body.description ?? "",
        commercialUseCase: body.commercialUseCase,
        copySpace: body.copySpace ?? "",
        differentiation: body.differentiation ?? "",
        productionMode: body.productionMode ?? "stock_image",
      });
      return jsonResponse({ concept }, 201, req, {});
    }
  }

  // 5. Assets List & Retrieval
  if (subPath === "assets" && req.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const db = openAgentOsDb();

    let query = "SELECT * FROM stock_assets";
    const params: string[] = [];
    const conditions: string[] = [];

    if (projectId) {
      conditions.push("project_id = ?");
      params.push(projectId);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    query += " ORDER BY created_at DESC";

    const rows = db.query(query).all(...params) as Array<Record<string, unknown>>;
    return jsonResponse({ assets: rows }, 200, req, {});
  }

  const assetMatch = subPath.match(/^assets\/([^\/]+)$/);
  if (assetMatch && req.method === "GET") {
    const asset = getStockAsset(assetMatch[1]);
    return asset ? jsonResponse({ asset }, 200, req, {}) : notFound(req, "asset not found");
  }

  // 6. Generation Engine Dispatch
  if (subPath === "generate" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      projectId?: string;
      conceptId?: string;
      batchId?: string;
      type?: "image" | "png" | "video";
      prompt?: Record<string, unknown>;
      strategy?: "LOCAL_FIRST" | "CHEAP" | "QUALITY";
    } | null;

    if (!body?.projectId || !body?.type || !body?.prompt) {
      return badRequest(req, "projectId, type, and prompt are required");
    }

    const conceptId = body.conceptId ?? "general";
    const budgetCheck = providerRegistry.budgetGovernor.checkAndRecordGeneration(conceptId, body.batchId ?? "default");
    if (!budgetCheck.allowed) {
      return jsonResponse({ error: { code: "budget_exceeded", message: budgetCheck.reason } }, 429, req, {});
    }

    const validConceptId = body.conceptId && getStockConcept(body.conceptId) ? body.conceptId : null;

    let assetResult;
    if (body.type === "video") {
      const adapter = providerRegistry.selectVideoProvider(body.strategy ?? "LOCAL_FIRST");
      const videoGen = await adapter.generate({
        positivePrompt: (body.prompt.positivePrompt as string) ?? "stock clip",
        durationSeconds: (body.prompt.durationSeconds as number) ?? 10.0,
        aspectRatio: (body.prompt.aspectRatio as never) ?? "16:9",
      });

      const asset = createStockAsset({
        projectId: body.projectId,
        conceptId: validConceptId,
        batchId: body.batchId ?? null,
        type: "video",
        mode: "stock_video",
        status: "GENERATED",
        path: videoGen.videoPath,
        previewPath: videoGen.posterFramePath,
        width: videoGen.width,
        height: videoGen.height,
        durationSeconds: videoGen.durationSeconds,
        fps: videoGen.fps,
        codec: videoGen.codec,
        provider: videoGen.provider,
        model: videoGen.model,
        prompt: body.prompt,
        generatedAi: true,
        fictionalPeopleProperty: false,
      });

      recordStockLineage({
        assetId: asset.id,
        step: "video_generation",
        details: videoGen.lineage,
      });

      assetResult = { asset, generation: videoGen };
    } else {
      const adapter = providerRegistry.selectImageProvider(body.strategy ?? "LOCAL_FIRST");
      const isPng = body.type === "png";
      const imageGen = await adapter.generate({
        positivePrompt: (body.prompt.positivePrompt as string) ?? "stock image",
        aspectRatio: (body.prompt.aspectRatio as never) ?? "16:9",
        transparentBackground: isPng,
        outputType: isPng ? "png" : "jpeg",
      });

      const asset = createStockAsset({
        projectId: body.projectId,
        conceptId: validConceptId,
        batchId: body.batchId ?? null,
        type: isPng ? "png" : "image",
        mode: isPng ? "stock_png" : "stock_image",
        status: "GENERATED",
        path: imageGen.imagePaths[0] ?? "./storage/assets/image.jpg",
        previewPath: imageGen.imagePaths[0],
        width: imageGen.width,
        height: imageGen.height,
        megapixels: imageGen.megapixels,
        provider: imageGen.provider,
        model: imageGen.model,
        prompt: body.prompt,
        generatedAi: true,
        fictionalPeopleProperty: false,
      });

      recordStockLineage({
        assetId: asset.id,
        step: "image_generation",
        details: imageGen.lineage,
      });

      assetResult = { asset, generation: imageGen };
    }

    return jsonResponse(assetResult, 201, req, {});
  }

  // 7. Reviewer Council Evaluation
  if (subPath === "review" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      assetId?: string;
      artifactFlags?: Record<string, unknown>;
      commercialContext?: Record<string, unknown>;
      metadata?: { title?: string; keywords?: string[] };
    } | null;

    if (!body?.assetId) return badRequest(req, "assetId is required");
    const asset = getStockAsset(body.assetId);
    if (!asset) return notFound(req, "asset not found");

    const evaluation = evaluateAssetByCouncil(asset, {
      artifactFlags: body.artifactFlags as never,
      commercialContext: body.commercialContext as never,
      metadata: body.metadata,
    });

    return jsonResponse({ evaluation }, 200, req, {});
  }

  // 8. Human Supervisor Override
  if (subPath === "override" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      assetId?: string;
      decision?: "APPROVED" | "REJECTED" | "RETURNED_FOR_FIX";
      note?: string;
      operator?: string;
    } | null;

    if (!body?.assetId || !body?.decision || !body?.note) {
      return badRequest(req, "assetId, decision (APPROVED|REJECTED|RETURNED_FOR_FIX), and note are required");
    }

    try {
      const result = applyHumanCouncilOverride(body.assetId, body.decision, body.note, body.operator);
      return jsonResponse(result, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : "override failed");
    }
  }

  // 9. Export Pack Creation
  if (subPath === "export" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      projectId?: string;
      batchId?: string;
      assetIds?: string[];
    } | null;

    if (!body?.projectId || !body?.assetIds || body.assetIds.length === 0) {
      return badRequest(req, "projectId and non-empty assetIds are required");
    }

    // Verify all assets exist
    for (const id of body.assetIds) {
      const asset = getStockAsset(id);
      if (!asset) return notFound(req, `Asset ${id} not found`);
    }

    // Advance exported assets status
    for (const id of body.assetIds) {
      updateStockAssetStatus(id, "EXPORTED");
    }

    const exportPack = createStockExportPack({
      projectId: body.projectId,
      batchId: body.batchId ?? `batch_${Date.now()}`,
      status: "ready",
      manifest: {
        rulesVersion: ADOBE_STOCK_RULES.rulesVersion,
        exportedAt: new Date().toISOString(),
        assetCount: body.assetIds.length,
        assetIds: body.assetIds,
      },
      packagePath: `./exports/${body.projectId}_${body.batchId ?? "pack"}.zip`,
      humanReviewRequired: true,
    });

    return jsonResponse({ exportPack }, 201, req, {});
  }

  return notFound(req, "unknown stock factory route");
}
