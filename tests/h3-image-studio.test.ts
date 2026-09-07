// Phase 20.6 — MiniMax H3 Image Studio × Reference Editing × Qwen Detail Refiner Test Suite.

import { describe, expect, test, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import {
  // Workflows & presets
  listWorkflows,
  getWorkflow,
  registerWorkflow,
  listPresets,
  resolvePreset,
  calculateDimensions,
  // Models & licenses
  listModels,
  getModel,
  validateModelStack,
  evaluateLicensePolicy,
  canRunInStockMode,
  // Jobs & prompts
  compilePromptFromStructured,
  estimateH3Job,
  createH3Job,
  getH3Job,
  listH3Jobs,
  updateH3JobStatus,
  cancelH3Job,
  // Adapter & graphs
  H3GraphCompiler,
  H3ProviderAdapter,
  // Candidate packet
  generateCandidatePacket,
  saveCandidates,
  getCandidates,
  selectCandidate,
  // Detail refiner
  buildDefectTargetedPrompt,
  applyDetailToneLock,
  routeDetailRefinement,
  // Stock QC
  evaluateStockQC,
  getStockQC,
  // Provenance & export
  recordProvenance,
  getProvenance,
  exportAssetPackage,
  // Knowledge Brain
  ensureH3KnowledgeEntities,
  syncH3RunToKnowledgeBrain,
  getH3KnownIssues,
  recordH3ArchitectureDecision,
  // MCP Tools
  H3_MCP_TOOLS,
} from "../src/agent-os/generation/minimax-h3";
import { handleH3Routes } from "../src/server/management/h3-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.6: MiniMax H3 Image Studio Subsystem", () => {
  beforeEach(() => {
    // Ensure database is initialized
    openAgentOsDb();
  });

  describe("1. Workflows & Presets Registry", () => {
    test("lists built-in workflows covering T2I, I2I, REF2VA, Turbo, and Refiner", () => {
      const wfs = listWorkflows();
      expect(wfs.length).toBeGreaterThanOrEqual(8);

      const keys = wfs.map((w) => w.id);
      expect(keys).toContain("H3_T2I");
      expect(keys).toContain("H3_T2I_SINGLE");
      expect(keys).toContain("H3_I2I");
      expect(keys).toContain("H3_I2I_SINGLE");
      expect(keys).toContain("H3_REFERENCE_EDIT");
      expect(keys).toContain("H3_REFERENCE_SINGLE");
      expect(keys).toContain("H3_I2I_TURBO");
      expect(keys).toContain("H3_DETAIL_REFINER");
    });

    test("filters workflows by mode and stock-safety", () => {
      const stockSafeWfs = listWorkflows({ stockSafeOnly: true });
      for (const w of stockSafeWfs) {
        expect(w.stockSafe).toBe(true);
      }
      expect(stockSafeWfs.some((w) => w.id === "H3_T2I_SINGLE")).toBe(false); // experimental single frame is not stock safe
    });

    test("resolves presets and frame profiles", () => {
      const quality = resolvePreset("QUALITY");
      expect(quality.frameProfile).toBe(5);
      expect(quality.samplingProfile).toBe("BASE_QUALITY");

      const turbo = resolvePreset("TURBO_FAST");
      expect(turbo.samplingProfile).toBe("FL2VA_TURBO_4_768");

      const stockSafe = resolvePreset("STOCK_SAFE");
      expect(stockSafe.stockSafe).toBe(true);
    });

    test("calculates target dimensions accurately (~0.98 MP vs 2.0 MP)", () => {
      const nativeDims = calculateDimensions("NATIVE_DETAIL", "1:1");
      expect(nativeDims.width).toBe(1024);
      expect(nativeDims.height).toBe(1024);
      expect(nativeDims.megapixels).toBeCloseTo(1.05, 1);

      const twoMpDims = calculateDimensions("TWO_MP", "1:1");
      expect(twoMpDims.width).toBe(1440);
      expect(twoMpDims.height).toBe(1440);
      expect(twoMpDims.megapixels).toBeCloseTo(2.07, 1);
    });
  });

  describe("2. Models & 3-Tier License Engine", () => {
    test("catalogs official models and community experimental adapters", () => {
      const models = listModels();
      expect(models.length).toBeGreaterThanOrEqual(10);

      const h3 = getModel("minimax_h3_diffusion");
      expect(h3).not.toBeNull();
      expect(h3?.licenseName).toBe("Apache-2.0");
      expect(h3?.stockUseStatus).toBe("ALLOWED");

      const qwen = getModel("qwen_image_edit_2511");
      expect(qwen).not.toBeNull();
      expect(qwen?.stockUseStatus).toBe("ALLOWED");

      const community = getModel("hybrid_single_adapter");
      expect(community).not.toBeNull();
      expect(community?.licenseName).toBe("CC-BY-NC-4.0");
      expect(community?.stockUseStatus).toBe("DISALLOWED");
    });

    test("validates model stack readiness and identifies missing or disallowed assets", () => {
      const valid = validateModelStack(["minimax_h3_diffusion", "t5_text_encoder", "video_vae"]);
      expect(valid.allPresent).toBe(true);
      expect(valid.approvedForStock).toBe(true);

      const withNonCommercial = validateModelStack(["minimax_h3_diffusion", "hybrid_single_adapter"]);
      expect(withNonCommercial.approvedForStock).toBe(false);
      expect(withNonCommercial.blockedReasons.some((r) => r.includes("CC-BY-NC-4.0"))).toBe(true);
    });

    test("evaluates 3-tier license governance and enforces stock safety gate", () => {
      const officialCheck = evaluateLicensePolicy({
        modelAssetLicense: "Apache-2.0",
        officialOrCommunity: "official",
        targetUse: "commercial_stock",
      });
      expect(officialCheck.status).toBe("ALLOWED");

      const ncCheck = evaluateLicensePolicy({
        modelAssetLicense: "CC-BY-NC-4.0",
        officialOrCommunity: "community",
        targetUse: "commercial_stock",
      });
      expect(ncCheck.status).toBe("DISALLOWED");

      expect(canRunInStockMode("H3_T2I").allowed).toBe(true);
      expect(canRunInStockMode("H3_T2I_SINGLE").allowed).toBe(false);
    });
  });

  describe("3. Structured Prompt Engine", () => {
    test("compiles structured prompt with subject, lighting, camera and reference roles", () => {
      const prompt = compilePromptFromStructured(
        "A futuristic botanist",
        {
          subject: "Botanist with cybernetic gloves",
          environment: "Hydroponic greenhouse on Mars",
          lighting: "Neon cyan and warm amber rim lights",
          camera: "Hasselblad 80mm f/2.8",
          stockConstraints: "No trademarks, clean hands",
        },
        [
          { role: "PRIMARY_IDENTITY", imagePath: "ref1.png", description: "Hero face" },
          { role: "POSE_REFERENCE", imagePath: "ref2.png", description: "Standing pose" },
        ],
      );

      expect(prompt).toContain("A futuristic botanist");
      expect(prompt).toContain("Subject: Botanist with cybernetic gloves");
      expect(prompt).toContain("Environment: Hydroponic greenhouse on Mars");
      expect(prompt).toContain("Lighting: Neon cyan and warm amber rim lights");
      expect(prompt).toContain("Reference Context: Image [1] serves as PRIMARY_IDENTITY (Hero face)");
      expect(prompt).toContain("Stock Safety Constraints: No trademarks, clean hands");
    });
  });

  describe("4. Job Builder, Resource Estimation & Lifecycle", () => {
    test("estimates VRAM and runtime for job configurations", () => {
      const est = estimateH3Job({
        preset: "QUALITY",
        resolution: "NATIVE_DETAIL",
        frameProfile: 5,
      });

      expect(est.estimatedVramGb).toBeGreaterThanOrEqual(14.0);
      expect(est.estimatedRuntimeSeconds).toBeGreaterThan(0);
      expect(est.targetNode).toBe("local");
    });

    test("creates job and automatically blocks CC-BY-NC workflows in stock mode", () => {
      const cleanJob = createH3Job({
        prompt: "A beautiful landscape",
        preset: "STOCK_SAFE",
        stockMode: true,
      });
      expect(cleanJob.status).toBe("QUEUED");

      const blockedJob = createH3Job({
        prompt: "Fast experimental portrait",
        mode: "text_to_image_single", // Uses experimental single frame workflow
        stockMode: true,
      });
      expect(blockedJob.status).toBe("BLOCKED_LICENSE");
      expect(blockedJob.errorMessage).toContain("not certified as stock-safe");
    });

    test("updates job status and supports cancellation", () => {
      const job = createH3Job({ prompt: "Testing cancellation", preset: "FAST" });
      expect(job.status).toBe("QUEUED");

      const updated = updateH3JobStatus(job.id, "RUNNING", { stage: "generating", progress: 0.5 });
      expect(updated.status).toBe("RUNNING");
      expect(updated.progress).toBe(0.5);

      const canceled = cancelH3Job(job.id, "User requested stop");
      expect(canceled.status).toBe("CANCELED");
      expect(canceled.errorMessage).toBe("User requested stop");
    });
  });

  describe("5. ComfyUI Graph Compiler & Adapter", () => {
    test("compiles standard H3 T2I graph with 5-frame latent buffer", () => {
      const job = createH3Job({
        prompt: "Cyberpunk street market",
        mode: "text_to_image",
        frameProfile: 5,
        preset: "BALANCED",
      });

      const compiled = H3GraphCompiler.compileJob(job);
      expect(compiled.workflowId).toBe("H3_T2I");
      expect(compiled.nodeCount).toBeGreaterThanOrEqual(7);

      const nodes = compiled.graph;
      expect(nodes["1"].class_type).toBe("MiniMaxH3Loader");
      expect(nodes["4"].class_type).toBe("EmptyVideoLatent");
      expect(nodes["4"].inputs.length).toBe(5);
      expect(nodes["5"].class_type).toBe("KSampler");
      expect(nodes["7"].class_type).toBe("SaveImageBatch");

      const validation = H3GraphCompiler.validateGraph(compiled.graph);
      expect(validation.valid).toBe(true);
    });

    test("compiles reference edit graph with REF2VA adapter and multi-image slots", () => {
      const job = createH3Job({
        prompt: "Subject wearing leather jacket in snow",
        mode: "reference_edit",
        referenceImages: [
          { role: "PRIMARY_IDENTITY", imagePath: "/path/to/face.png", weight: 0.9 },
          { role: "OUTFIT_REFERENCE", imagePath: "/path/to/jacket.png", weight: 0.8 },
        ],
      });

      const compiled = H3GraphCompiler.compileJob(job);
      expect(compiled.workflowId).toBe("H3_REFERENCE_EDIT");

      const nodes = compiled.graph;
      expect(nodes["2"].class_type).toBe("Ref2vaAdapterLoader");
      expect(nodes["3"].class_type).toBe("Ref2vaConditioningApply");
      expect(nodes["100"]).toBeDefined();
      expect(nodes["100"].inputs.image).toBe("/path/to/face.png");
      expect(nodes["101"]).toBeDefined();
      expect(nodes["101"].inputs.image).toBe("/path/to/jacket.png");
    });

    test("compiles Qwen Image Edit detail refiner with Tone Lock node", () => {
      const job = createH3Job({
        prompt: "Refine candidate image",
        mode: "detail_refiner",
        sourceImagePath: "renders/frame_2.png",
      });

      const compiled = H3GraphCompiler.compileJob(job);
      expect(compiled.workflowId).toBe("H3_DETAIL_REFINER");

      const nodes = compiled.graph;
      expect(nodes["1"].class_type).toBe("QwenImageEditLoader");
      expect(nodes["7"].class_type).toBe("DetailToneLockComposite");
      expect(nodes["7"].inputs.chroma_lock).toBe(true);
    });

    test("executes dry-run simulation cleanly via adapter", async () => {
      const job = createH3Job({
        prompt: "Sunset over mountain lake",
        preset: "FAST",
        frameProfile: 5,
      });

      const adapter = new H3ProviderAdapter();
      const res = await adapter.execute(job);
      expect(res.success).toBe(true);
      expect(res.outputFrames?.length).toBe(5);
    });
  });

  describe("6. Multi-Frame Candidate Packet & Selection", () => {
    test("generates multi-frame candidate packet and designates middle frame as recommended", () => {
      const job = createH3Job({ prompt: "Astronaut on alien planet", frameProfile: 5 });
      const candidates = generateCandidatePacket(job.id, 5);

      expect(candidates.length).toBe(5);
      expect(candidates[2].isRecommended).toBe(true);
      expect(candidates[0].isRecommended).toBe(false);

      const saved = saveCandidates(job.id, candidates);
      expect(saved.length).toBe(5);

      const retrieved = getCandidates(job.id);
      expect(retrieved.length).toBe(5);
    });

    test("selects candidate and updates job output", () => {
      const job = createH3Job({ prompt: "Futuristic vehicle design", frameProfile: 5 });
      generateCandidatePacket(job.id, 5);

      const { job: updatedJob, selected } = selectCandidate(job.id, 3);
      expect(selected.candidateIndex).toBe(3);
      expect(selected.isSelected).toBe(true);
      expect(updatedJob.selectedCandidateIndex).toBe(3);
      expect(updatedJob.outputImagePath).toBe(selected.imagePath);
    });
  });

  describe("7. Qwen Detail Refiner & Detail Tone Lock", () => {
    test("builds defect-targeted prompts for eyes, hands, edges and texture", () => {
      const eyePrompt = buildDefectTargetedPrompt("eyes");
      expect(eyePrompt).toContain("iris clarity");

      const handPrompt = buildDefectTargetedPrompt("hands");
      expect(handPrompt).toContain("5 fingers per hand");

      const edgePrompt = buildDefectTargetedPrompt("edges");
      expect(edgePrompt).toContain("boundary artifacts");
    });

    test("applies Detail Tone Lock preserving color grade", () => {
      const lock = applyDetailToneLock("frame.png", "refined.png");
      expect(lock.toneLockApplied).toBe(true);
      expect(lock.toneLockMode).toBe("lab_chroma_preserve");
    });

    test("routes detail refinement through Qwen 2511 post-processing", async () => {
      const job = createH3Job({ prompt: "Portrait needing fine detail polish" });
      const res = await routeDetailRefinement(job.id, "renders/candidate_2.png", {
        defectTarget: "hands",
        toneLock: true,
      });

      expect(res.refinedImagePath).toContain("_refined.png");
      expect(res.toneLockApplied).toBe(true);
      expect(res.refinePrompt).toContain("5 fingers");

      const updatedJob = getH3Job(job.id);
      expect(updatedJob?.outputImagePath).toBe(res.refinedImagePath);
    });
  });

  describe("8. Adobe Stock Mode QC & Gating", () => {
    test("evaluates stock QC checklist and requires reviewer sign-off", () => {
      const job = createH3Job({ prompt: "Stock commercial illustration", stockMode: true });

      const qc = evaluateStockQC(job.id, {
        logoCheckPassed: true,
        textCheckPassed: true,
        anatomyCheckPassed: true,
        ipCheckPassed: true,
        reviewerNotes: "Clean image, no logos or defects.",
        reviewedBy: "art_director",
      });

      expect(qc.licensePassed).toBe(true);
      expect(qc.overallPassed).toBe(true);
      expect(qc.reviewedBy).toBe("art_director");

      const fetched = getStockQC(job.id);
      expect(fetched?.overallPassed).toBe(true);
    });

    test("fails stock QC if defects or IP violations are flagged", () => {
      const job = createH3Job({ prompt: "Questionable character render", stockMode: true });

      const qc = evaluateStockQC(job.id, {
        logoCheckPassed: false,
        anatomyCheckPassed: false,
        reviewerNotes: "Brand logo visible and extra thumb on left hand.",
      });

      expect(qc.logoCheckPassed).toBe(false);
      expect(qc.anatomyCheckPassed).toBe(false);
      expect(qc.overallPassed).toBe(false);
    });
  });

  describe("9. Forensic Provenance & Asset Export", () => {
    test("records immutable provenance ledger with SHA256 prompt hash and model manifest", () => {
      const job = createH3Job({
        prompt: "A neon cyborg warrior in heavy rain",
        preset: "STOCK_SAFE",
        referenceImages: [{ role: "PRIMARY_IDENTITY", imagePath: "face.png" }],
      });

      const prov = recordProvenance({
        jobId: job.id,
        assetPath: "renders/master_asset.png",
      });

      expect(prov.jobId).toBe(job.id);
      expect(prov.promptHash.length).toBe(64); // SHA-256 hex
      expect(prov.workflowKey).toBe("H3_T2I");
      expect(prov.referenceRoles[0].role).toBe("PRIMARY_IDENTITY");

      const fetched = getProvenance(job.id);
      expect(fetched?.promptHash).toBe(prov.promptHash);
    });

    test("blocks export in stock mode without human reviewer approval", () => {
      const job = createH3Job({ prompt: "Stock landscape", stockMode: true });
      updateH3JobStatus(job.id, "REVIEW_REQUIRED", { outputImagePath: "renders/output.png" });

      // No QC signed off yet
      const blockedExport = exportAssetPackage(job.id);
      expect(blockedExport.exportAllowed).toBe(false);
      expect(blockedExport.blockedReason).toContain("Asset failed Adobe Stock QC");

      // Now approve QC
      evaluateStockQC(job.id, {
        logoCheckPassed: true,
        textCheckPassed: true,
        anatomyCheckPassed: true,
        ipCheckPassed: true,
      });

      const allowedExport = exportAssetPackage(job.id);
      expect(allowedExport.exportAllowed).toBe(true);
      expect(allowedExport.packagePath).toContain(job.id);
      expect(allowedExport.manifest?.provenance).toBeDefined();
    });
  });

  describe("10. Living Knowledge Brain Integration", () => {
    test("registers H3 & Qwen entities and syncs execution claims", () => {
      const entities = ensureH3KnowledgeEntities();
      expect(entities.h3EntityId).toBeDefined();
      expect(entities.qwenEntityId).toBeDefined();

      const job = createH3Job({ prompt: "Brain sync test", stockMode: true });
      recordProvenance({ jobId: job.id, assetPath: "renders/brain_test.png" });

      const syncResult = syncH3RunToKnowledgeBrain(job.id);
      expect(syncResult.synced).toBe(true);
      expect(syncResult.claimsCreated).toBeGreaterThanOrEqual(2);

      const prov = getProvenance(job.id);
      expect(prov?.knowledgeSyncStatus).toBe("SYNCED");
    });

    test("records ADR decision and provides known issues catalog", () => {
      expect(() => recordH3ArchitectureDecision()).not.toThrow();

      const issues = getH3KnownIssues();
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.some((i) => i.topic.includes("FL2VA vs REF2VA"))).toBe(true);
      expect(issues.some((i) => i.topic.includes("Overprocessing"))).toBe(true);
      expect(issues.some((i) => i.topic.includes("CC-BY-NC"))).toBe(true);
    });
  });

  describe("11. WebMCP Tools Integration (21 Tools)", () => {
    test("exposes all 21 defined agentic tools", () => {
      expect(H3_MCP_TOOLS.length).toBe(21);
      const names = H3_MCP_TOOLS.map((t) => t.name);

      expect(names).toContain("h3_list_workflows");
      expect(names).toContain("h3_list_presets");
      expect(names).toContain("h3_list_models");
      expect(names).toContain("h3_validate_stack");
      expect(names).toContain("h3_create_job");
      expect(names).toContain("h3_estimate_job");
      expect(names).toContain("h3_run_job");
      expect(names).toContain("h3_get_job");
      expect(names).toContain("h3_cancel_job");
      expect(names).toContain("h3_submit_reference_edit");
      expect(names).toContain("h3_submit_i2i");
      expect(names).toContain("h3_submit_t2i");
      expect(names).toContain("h3_submit_detail_refine");
      expect(names).toContain("h3_get_candidates");
      expect(names).toContain("h3_select_candidate");
      expect(names).toContain("h3_send_to_refine");
      expect(names).toContain("h3_run_stock_qc");
      expect(names).toContain("h3_get_provenance");
      expect(names).toContain("h3_export_asset");
      expect(names).toContain("h3_get_known_issues");
      expect(names).toContain("h3_sync_knowledge");
    });

    test("executes h3_create_job and h3_run_job tool calls end-to-end", async () => {
      const createTool = H3_MCP_TOOLS.find((t) => t.name === "h3_create_job")!;
      const runTool = H3_MCP_TOOLS.find((t) => t.name === "h3_run_job")!;

      const created = (await createTool.execute({
        prompt: "MCP automated test portrait",
        preset: "FAST",
        frameProfile: 5,
        stockMode: false,
      })) as any;

      expect(created.id).toBeDefined();

      const runRes = (await runTool.execute({ jobId: created.id })) as any;
      expect(runRes.success).toBe(true);
      expect(runRes.candidates.length).toBe(5);
    });
  });

  describe("12. Management API REST Endpoints (/api/h3/*)", () => {
    function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://localhost:4000${path}`);
      const req = new Request(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        req,
        url,
        principal: "admin-token",
      } as any;
    }

    test("GET /api/h3/workflows returns catalog", async () => {
      const res = await handleH3Routes(makeCtx("/api/h3/workflows"));
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(8);
    });

    test("GET /api/h3/presets returns presets", async () => {
      const res = await handleH3Routes(makeCtx("/api/h3/presets"));
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      const data = await res?.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("POST /api/h3/jobs creates a new job", async () => {
      const res = await handleH3Routes(
        makeCtx("/api/h3/jobs", "POST", {
          prompt: "API test image",
          preset: "BALANCED",
        }),
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(201);
      const job = await res?.json();
      expect(job.id).toBeDefined();
      expect(job.prompt).toContain("API test image");
    });

    test("POST /api/h3/jobs/:id/run executes the job pipeline", async () => {
      const createRes = await handleH3Routes(
        makeCtx("/api/h3/jobs", "POST", {
          prompt: "Full pipeline API test",
          preset: "FAST",
          frameProfile: 5,
        }),
      );
      const job = await createRes?.json();

      const runRes = await handleH3Routes(makeCtx(`/api/h3/jobs/${job.id}/run`, "POST"));
      expect(runRes?.status).toBe(200);
      const result = await runRes?.json();
      expect(result.success).toBe(true);
      expect(result.candidates.length).toBe(5);
    });
  });
});
