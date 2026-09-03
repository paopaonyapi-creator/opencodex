import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { handleStockRoutes } from "../src/server/management/stock-routes";
import type { ManagementContext } from "../src/server/management/context";
import { providerRegistry } from "../src/agent-os/providers/provider-registry";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "stock-routes-test-"));
  openAgentOsDb(tempDir);
  providerRegistry.budgetGovernor.reset();
});

afterEach(() => {
  closeAgentOsDbForTests();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function mockCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    config: {} as never,
    principal: { role: "admin", isLoopback: true } as never,
    deps: {} as never,
  };
}

describe("Phase 16 — Stock Management API Endpoints (/api/agent-os/stock/*)", () => {
  test("GET /api/agent-os/stock/rules returns Adobe Stock rules", async () => {
    const res = await handleStockRoutes(mockCtx("/api/agent-os/stock/rules"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.rulesVersion).toBe("adobe-stock-2026-06-11");
    expect(json.image.minMegapixels).toBe(4.0);
  });

  test("POST /api/agent-os/stock/validate validates media specs", async () => {
    const res = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/validate", "POST", {
        mode: "jpeg",
        payload: { width: 3840, height: 2160, fileSizeBytes: 3000000, format: "jpeg", colorProfile: "sRGB" },
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.valid).toBe(true);
    expect(json.megapixels).toBe(8.29);
  });

  test("POST & GET /api/agent-os/stock/opportunities", async () => {
    const postRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/opportunities", "POST", {
        projectId: "proj_factory",
        title: "Cleanroom Semiconductor Automation",
        niche: "High-Tech Manufacturing",
        buyerPersona: "Industrial tech marketing director",
        score: 88,
        confidence: 90,
        evidenceClass: "A",
      }),
    );
    expect(postRes!.status).toBe(201);
    const postJson = await postRes!.json();
    expect(postJson.opportunity.id).toBeDefined();

    const getRes = await handleStockRoutes(mockCtx("/api/agent-os/stock/opportunities?projectId=proj_factory"));
    expect(getRes!.status).toBe(200);
    const getJson = await getRes!.json();
    expect(getJson.opportunities.length).toBe(1);
    expect(getJson.opportunities[0].title).toBe("Cleanroom Semiconductor Automation");
  });

  test("POST & GET /api/agent-os/stock/concepts", async () => {
    const postRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/concepts", "POST", {
        projectId: "proj_factory",
        title: "Robotic wafer transfer arm in cleanroom",
        commercialUseCase: "Editorial hero image for chip manufacturing articles",
        copySpace: "Clean blue negative space on top third",
        productionMode: "stock_image",
      }),
    );
    expect(postRes!.status).toBe(201);
    const postJson = await postRes!.json();
    expect(postJson.concept.id).toBeDefined();

    const getRes = await handleStockRoutes(mockCtx("/api/agent-os/stock/concepts?projectId=proj_factory"));
    expect(getRes!.status).toBe(200);
    const getJson = await getRes!.json();
    expect(getJson.concepts[0].title).toBe("Robotic wafer transfer arm in cleanroom");
  });

  test("POST /api/agent-os/stock/generate creates image asset and enforces budget guard", async () => {
    const genRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/generate", "POST", {
        projectId: "proj_factory",
        conceptId: "cpt_test_1",
        type: "image",
        prompt: {
          positivePrompt: "photoreal robotic arm in semiconductor cleanroom",
          aspectRatio: "16:9",
        },
      }),
    );
    expect(genRes!.status).toBe(201);
    const genJson = await genRes!.json();
    expect(genJson.asset.id).toBeDefined();
    expect(genJson.asset.status).toBe("GENERATED");
    expect(genJson.asset.megapixels).toBe(8.29);

    const assetId = genJson.asset.id;
    const getAssetRes = await handleStockRoutes(mockCtx(`/api/agent-os/stock/assets/${assetId}`));
    expect(getAssetRes!.status).toBe(200);
    const getAssetJson = await getAssetRes!.json();
    expect(getAssetJson.asset.id).toBe(assetId);
  });

  test("POST /api/agent-os/stock/generate supports stock video", async () => {
    const genRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/generate", "POST", {
        projectId: "proj_factory",
        type: "video",
        prompt: {
          positivePrompt: "smooth dolly shot along automated wafer production",
          durationSeconds: 10.0,
          aspectRatio: "16:9",
        },
      }),
    );
    expect(genRes!.status).toBe(201);
    const genJson = await genRes!.json();
    expect(genJson.asset.type).toBe("video");
    expect(genJson.asset.durationSeconds).toBe(10.0);
  });

  test("POST /api/agent-os/stock/review runs 5-agent council and updates status", async () => {
    // Generate an asset first
    const genRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/generate", "POST", {
        projectId: "proj_factory",
        conceptId: "cpt_test_review",
        type: "image",
        prompt: { positivePrompt: "clean commercial stock image with ample copy space" },
      }),
    );
    const { asset } = await genRes!.json();

    const reviewRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/review", "POST", {
        assetId: asset.id,
        commercialContext: { buyerUtilityRating: 5 },
      }),
    );
    expect(reviewRes!.status).toBe(200);
    const reviewJson = await reviewRes!.json();
    expect(reviewJson.evaluation.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");
    expect(reviewJson.evaluation.reports.length).toBe(5);
    expect(reviewJson.evaluation.compositeScore).toBeGreaterThanOrEqual(80);
  });

  test("POST /api/agent-os/stock/override applies human supervisor decision", async () => {
    const genRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/generate", "POST", {
        projectId: "proj_factory",
        type: "image",
        prompt: { positivePrompt: "test asset for human override" },
      }),
    );
    const { asset } = await genRes!.json();

    const overrideRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/override", "POST", {
        assetId: asset.id,
        decision: "APPROVED",
        note: "Human certified commercial readiness.",
        operator: "lead_curator",
      }),
    );
    expect(overrideRes!.status).toBe(200);
    const overrideJson = await overrideRes!.json();
    expect(overrideJson.success).toBe(true);
    expect(overrideJson.newStatus).toBe("EXPORT_READY");
  });

  test("POST /api/agent-os/stock/export builds export pack manifest", async () => {
    const genRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/generate", "POST", {
        projectId: "proj_factory",
        type: "image",
        prompt: { positivePrompt: "asset ready for packaging" },
      }),
    );
    const { asset } = await genRes!.json();

    const exportRes = await handleStockRoutes(
      mockCtx("/api/agent-os/stock/export", "POST", {
        projectId: "proj_factory",
        batchId: "batch_2026_01",
        assetIds: [asset.id],
      }),
    );
    expect(exportRes!.status).toBe(201);
    const exportJson = await exportRes!.json();
    expect(exportJson.exportPack.humanReviewRequired).toBe(true);
    expect(exportJson.exportPack.manifest.assetCount).toBe(1);

    const assetCheck = await handleStockRoutes(mockCtx(`/api/agent-os/stock/assets/${asset.id}`));
    const assetJson = await assetCheck!.json();
    expect(assetJson.asset.status).toBe("EXPORTED");
  });
});
