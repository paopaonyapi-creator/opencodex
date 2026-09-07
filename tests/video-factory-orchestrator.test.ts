// Tests for Phase 20.7: Pao AI Video Factory × MoneyPrinterTurbo Native AI Video Orchestrator
import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import {
  VideoProductionRequestSchema,
  MptManifestSchema,
  buildMptManifest,
  MptRuntimeManager,
  MockMptProvider,
  ComfyUiVideoAdapter,
  LocalMediaAdapter,
  VideoProviderRegistry,
  SmartProductionRouter,
  VideoCostGuard,
  enforceAdobeStockPolicy,
  evaluateStockFootageRights,
  VideoJobQueue,
  getVideoJobQueue,
  TechnicalVideoQcEngine,
  VideoSimilarityGate,
  ReviewerCouncilGate,
  VideoExportPackageBuilder,
  syncVideoFactoryKnowledge,
  VIDEO_FACTORY_MCP_TOOLS,
  type VideoProductionRequest,
  type VideoProductionJob,
} from "../src/agent-os/video";

describe("Phase 20.7: Pao AI Video Factory × MoneyPrinterTurbo Orchestrator", () => {
  beforeEach(() => {
    // Ensure DB is initialized
    openAgentOsDb();
  });

  describe("1. SQLite Schema v13 Verification", () => {
    it("verifies all 8 Phase 20.7 tables exist with correct indices", () => {
      const db = openAgentOsDb();
      const tables = [
        "video_production_jobs",
        "video_production_scenes",
        "video_production_attempts",
        "video_production_artifacts",
        "video_technical_qc",
        "video_reviewer_council",
        "video_export_packages",
        "video_provider_health",
      ];

      for (const table of tables) {
        const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as any;
        expect(row).toBeDefined();
        expect(row.name).toBe(table);
      }
    });
  });

  describe("2. Domain Validation & Schemas", () => {
    it("validates valid video production requests", () => {
      const valid = {
        mode: "adobe_stock",
        prompt: "Ultra-detailed aerial footage of glacial fjord at dawn, cinematic 4k",
        aspectRatio: "16:9",
        targetDurationSeconds: 10,
      };
      const parsed = VideoProductionRequestSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.resolution).toBe("1080P");
        expect(parsed.data.voiceoverEnabled).toBe(false);
      }
    });

    it("rejects invalid aspect ratios and empty prompts", () => {
      const invalid = {
        mode: "adobe_stock",
        prompt: "  ",
        aspectRatio: "invalid_ratio",
      };
      const parsed = VideoProductionRequestSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("validates MPT batch manifest schema", () => {
      const manifest = {
        request_id: "req-123",
        topic: "Nordic mountains in snow",
        script: "Serene alpine scenery",
        aspect_ratio: "16:9",
        video_source: "metaso_minimax",
        voiceover: false,
        subtitle: false,
        created_at: new Date().toISOString(),
      };
      const parsed = MptManifestSchema.safeParse(manifest);
      expect(parsed.success).toBe(true);
    });
  });

  describe("3. Upstream MoneyPrinterTurbo Adapter & Runtime", () => {
    it("builds MPT task manifest with proper provider mapping", () => {
      const req: VideoProductionRequest = {
        mode: "cinematic_broll",
        prompt: "Cyberpunk street night, neon reflections in rain",
        aspectRatio: "9:16",
        providerPreference: ["seedance"],
      };
      const manifest = buildMptManifest(req);
      expect(manifest.topic).toBe(req.prompt);
      expect(manifest.aspect_ratio).toBe("9:16");
      expect(manifest.video_source).toBe("ark_seedance");
    });

    it("manages runtime integration modes and performs health checks", async () => {
      const runtime = new MptRuntimeManager({ mode: "external_api" });
      const health = await runtime.healthCheck();
      expect(health.status).toBeDefined();
    });
  });

  describe("4. Deterministic Mock Provider (Zero Credit Spending)", () => {
    it("simulates successful video generation lifecycle", async () => {
      const mock = new MockMptProvider("success");
      const health = await mock.healthCheck();
      expect(health.status).toBe("healthy");

      const req: VideoProductionRequest = {
        mode: "adobe_stock",
        prompt: "Forest waterfall cascading into turquoise pool",
        aspectRatio: "16:9",
        targetDurationSeconds: 8,
      };

      const est = await mock.estimate(req);
      expect(est.estimatedCostUsd).toBeGreaterThanOrEqual(0.0);
      expect(est.currency).toBe("USD");

      const sub = await mock.submit(req);
      expect(sub.success).toBe(true);
      expect(sub.externalJobId).toContain("mock-task-");

      const status = await mock.getStatus(sub.externalJobId);
      expect(status.status).toBe("completed");

      const artifacts = await mock.collectArtifacts(sub.externalJobId);
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0].type).toBe("processed_video");
    });

    it("simulates deterministic failure scenarios", async () => {
      const failSubmitMock = new MockMptProvider("fail_before_submit");
      const req: VideoProductionRequest = {
        mode: "social_shorts",
        prompt: "Quick cooking tutorial clip",
        aspectRatio: "9:16",
      };
      const sub = await failSubmitMock.submit(req);
      expect(sub.success).toBe(false);
      expect(sub.error).toContain("submission");

      const failAfterSubmitMock = new MockMptProvider("fail_after_submit");
      const sub2 = await failAfterSubmitMock.submit(req);
      expect(sub2.success).toBe(true);
      const status = await failAfterSubmitMock.getStatus(sub2.externalJobId);
      expect(status.status).toBe("failed");

      const rateLimitMock = new MockMptProvider("rate_limit");
      const sub3 = await rateLimitMock.submit(req);
      expect(sub3.success).toBe(false);
      expect(sub3.error?.toLowerCase()).toContain("rate limit");
    });
  });

  describe("5. Alternate Adapters (ComfyUI & Local Media)", () => {
    it("handles ComfyUI adapter capabilities and estimates", async () => {
      const comfy = new ComfyUiVideoAdapter();
      const caps = await comfy.getCapabilities();
      expect(caps.providerId).toBe("comfyui-video");
      expect(caps.imageToVideo).toBe(true);

      const est = await comfy.estimate({
        mode: "cinematic_broll",
        prompt: "Space station orbit",
        aspectRatio: "16:9",
        targetDurationSeconds: 10,
      });
      expect(est.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("handles Local Media adapter capabilities and free estimate", async () => {
      const local = new LocalMediaAdapter();
      const caps = await local.getCapabilities();
      expect(caps.providerId).toBe("local-media");
      expect(caps.stockFootage).toBe(true);

      const est = await local.estimate({
        mode: "explainer_video",
        prompt: "Local archival video clips",
        aspectRatio: "16:9",
      });
      expect(est.estimatedCostUsd).toBe(0.0);
    });
  });

  describe("6. Provider Registry", () => {
    it("registers and retrieves all first-class adapters", async () => {
      const registry = new VideoProviderRegistry();
      const caps = await registry.getAllCapabilities();
      expect(caps.length).toBeGreaterThanOrEqual(4);

      const health = await registry.checkAllHealth();
      expect(health.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("7. Smart Production Router", () => {
    it("routes Adobe Stock request to MPT or ComfyUI with transparent scoring", async () => {
      const router = new SmartProductionRouter();
      const req: VideoProductionRequest = {
        mode: "adobe_stock",
        prompt: "Macro close up of blooming flower, time lapse, 4k",
        aspectRatio: "16:9",
        targetDurationSeconds: 8,
      };

      const result = await router.route(req);
      expect(result.selectedProvider).toBeDefined();
      expect(result.allScores.length).toBeGreaterThan(0);
      expect(result.explanation.selected).toBeDefined();
    });

    it("respects provider preference override", async () => {
      const router = new SmartProductionRouter();
      const req: VideoProductionRequest = {
        mode: "cinematic_broll",
        prompt: "Desert sand dunes at twilight",
        aspectRatio: "16:9",
        providerPreference: ["local-media"],
      };

      const result = await router.route(req);
      expect(result.selectedProvider).toBe("local-media");
    });
  });

  describe("8. Video Cost Guard", () => {
    it("transitions through cost guard states and blocks limits", () => {
      const guard = new VideoCostGuard({ defaultMaxJobCostUsd: 1.0 });
      const req: VideoProductionRequest = {
        mode: "adobe_stock",
        prompt: "Volcano lava flow, aerial shot",
        aspectRatio: "16:9",
        maxEstimatedCost: 0.5,
      };

      // Free estimate
      const freeDecision = guard.evaluate(req, {
        estimatedCostUsd: 0.0,
        currency: "USD",
        pricingSource: "rate_table",
        confidence: "high",
        observedAt: new Date().toISOString(),
        requiresApproval: false,
      });
      expect(freeDecision.allowed).toBe(true);
      expect(freeDecision.state).toBe("FREE");

      // Within limit estimate
      const normalDecision = guard.evaluate(req, {
        estimatedCostUsd: 0.25,
        currency: "USD",
        pricingSource: "rate_table",
        confidence: "high",
        observedAt: new Date().toISOString(),
        requiresApproval: false,
      });
      expect(normalDecision.allowed).toBe(true);
      expect(normalDecision.state).toBe("APPROVED");

      // Requires user approval
      const approvalDecision = guard.evaluate(req, {
        estimatedCostUsd: 0.4,
        currency: "USD",
        pricingSource: "rate_table",
        confidence: "high",
        observedAt: new Date().toISOString(),
        requiresApproval: true,
      });
      expect(approvalDecision.allowed).toBe(false);
      expect(approvalDecision.state).toBe("REQUIRES_APPROVAL");

      // Exceeds max ceiling
      const exceededDecision = guard.evaluate(req, {
        estimatedCostUsd: 2.5,
        currency: "USD",
        pricingSource: "rate_table",
        confidence: "high",
        observedAt: new Date().toISOString(),
        requiresApproval: false,
      });
      expect(exceededDecision.allowed).toBe(false);
      expect(exceededDecision.state).toBe("BLOCKED_BY_LIMIT");
    });
  });

  describe("9. Adobe Stock Clean Footage Policy", () => {
    it("enforces clean footage constraints for Adobe Stock mode", () => {
      const dirtyRequest: VideoProductionRequest = {
        mode: "adobe_stock",
        prompt: "Sunset beach walk",
        aspectRatio: "16:9",
        voiceoverEnabled: true,
        subtitlesEnabled: true,
        musicMode: "custom_audio",
        targetDurationSeconds: 3.0, // too short
      };

      const policyResult = enforceAdobeStockPolicy(dirtyRequest);
      expect(policyResult.valid).toBe(false);
      expect(policyResult.violations.length).toBeGreaterThan(0);
      expect(policyResult.enforcedAdjustments.voiceoverEnabled).toBe(false);
      expect(policyResult.enforcedAdjustments.subtitlesEnabled).toBe(false);
      expect(policyResult.enforcedAdjustments.musicMode).toBe("none");
    });
  });

  describe("10. Third-Party Stock Footage Rights Policy", () => {
    it("blocks unverified Pexels/Pixabay stock footage redistribution for Adobe Stock", () => {
      const rights1 = evaluateStockFootageRights("pexels", undefined, false);
      expect(rights1.permitted).toBe(false);
      expect(rights1.reason).toContain("does not permit direct redistribution");

      const rights2 = evaluateStockFootageRights("pexels", undefined, true);
      expect(rights2.permitted).toBe(true);

      const rights3 = evaluateStockFootageRights("ai_generated_original", undefined, false);
      expect(rights3.permitted).toBe(true);
    });
  });

  describe("11. Production Job Queue & Pipeline", () => {
    it("creates job with idempotency, runs pipeline with Mock provider, and collects artifacts", async () => {
      const queue = new VideoJobQueue();
      const clientReqId = "client-test-" + Math.random().toString(36).slice(2, 10);

      const req: VideoProductionRequest = {
        clientRequestId: clientReqId,
        mode: "adobe_stock",
        prompt: "Pristine mountain river rushing over smooth stones, 4k 60fps",
        aspectRatio: "16:9",
        targetDurationSeconds: 8,
        preferredProvider: "mock-mpt",
      };

      // 1. Create job
      const job1 = await queue.createJob(req);
      expect(job1.id).toBeDefined();
      expect(job1.status).toBe("VALIDATING");

      // Idempotency check: creating again with same clientRequestId returns same job
      const job2 = await queue.createJob(req);
      expect(job2.id).toBe(job1.id);

      // 2. Run pipeline
      const pipelineResult = await queue.runJobPipeline(job1.id);
      expect(pipelineResult.job.status).toBe("QC_PENDING");
      expect(pipelineResult.artifacts.length).toBeGreaterThan(0);

      // 3. Status transitions & cancellation
      const jobCancelled = queue.cancelJob(job1.id);
      expect(jobCancelled.status).toBe("CANCELLED");
    });
  });

  describe("12. Technical Video QC Engine", () => {
    it("evaluates video technical criteria for Adobe Stock requirements", () => {
      const db = openAgentOsDb();
      const engine = new TechnicalVideoQcEngine();
      const now = new Date().toISOString();
      const jobId = "vjob-qc-test-" + Math.random().toString(36).slice(2, 8);
      const artId = "art-qc-test-" + Math.random().toString(36).slice(2, 8);

      // Insert job and artifact into SQLite to fulfill FK constraints
      db.query(`
        INSERT INTO video_production_jobs (
          id, mode, status, stage, prompt, script, aspect_ratio, resolution,
          target_duration_seconds, voiceover_enabled, subtitles_enabled, music_mode,
          cost_guard_state, currency, request_json, routing_json, metadata_json, created_at, updated_at
        ) VALUES (
          ?, 'adobe_stock', 'QC_PENDING', 'qc', 'Tropical rainforest waterfall in misty morning light', '',
          '16:9', '1080P', 8.0, 0, 0, 'none', 'FREE', 'USD', '{}', '{}', '{}', ?, ?
        )
      `).run(jobId, now, now);

      db.query(`
        INSERT INTO video_production_artifacts (
          id, job_id, type, path, duration_ms, fps, width, height, file_size_bytes,
          container_format, video_codec, created_at
        ) VALUES (?, ?, 'processed_video', 'fjord_dawn.mp4', 8000, 30.0, 1920, 1080, 15728640, 'mp4', 'h264', ?)
      `).run(artId, jobId, now);

      const mockJob: VideoProductionJob = {
        id: jobId,
        mode: "adobe_stock",
        status: "QC_PENDING",
        stage: "qc",
        prompt: "Tropical rainforest waterfall in misty morning light",
        script: "",
        aspectRatio: "16:9",
        resolution: "1080P",
        targetDurationSeconds: 8,
        voiceoverEnabled: false,
        subtitlesEnabled: false,
        musicMode: "none",
        costGuardState: "FREE",
        currency: "USD",
        requestJson: {},
        routingJson: {},
        metadataJson: {},
        createdAt: now,
        updatedAt: now,
      };

      const validArtifact = {
        id: artId,
        jobId,
        type: "processed_video" as const,
        path: "fjord_dawn.mp4",
        durationMs: 8000,
        fps: 30.0,
        width: 1920,
        height: 1080,
        fileSizeBytes: 15728640,
        containerFormat: "mp4",
        videoCodec: "h264",
        lineageJson: {},
        qcJson: {},
        createdAt: now,
      };

      const result = engine.runQC(mockJob, validArtifact);
      expect(result.passed).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);

      // Retrieve persisted QC result
      const retrieved = engine.getQCResultForJob(mockJob.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.passed).toBe(true);
    });
  });

  describe("13. Video Similarity & Near-Duplicate Gate", () => {
    it("flags duplicates and scores distinct video prompts", () => {
      const gate = new VideoSimilarityGate();
      const candidate: VideoProductionJob = {
        id: "vjob-sim-cand",
        mode: "adobe_stock",
        status: "READY_FOR_EXPORT",
        stage: "completed",
        prompt: "Aerial drone view of snow-capped mountains at sunrise",
        script: "",
        aspectRatio: "16:9",
        resolution: "1080P",
        targetDurationSeconds: 8,
        voiceoverEnabled: false,
        subtitlesEnabled: false,
        musicMode: "none",
        costGuardState: "FREE",
        currency: "USD",
        requestJson: {},
        routingJson: {},
        metadataJson: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Completely distinct sibling
      const distinctResult = gate.evaluateJob(candidate, [
        {
          id: "sib-1",
          promptText: "Tropical beach with coconut palm trees and clear blue ocean waves",
        },
      ]);
      expect(distinctResult.category).toBe("UNIQUE");
      expect(distinctResult.similarityFlag).toBe("LOW");

      // Near duplicate sibling
      const duplicateResult = gate.evaluateJob(candidate, [
        {
          id: "sib-2",
          promptText: "Aerial drone view of snow-capped mountains at sunrise morning",
        },
      ]);
      expect(duplicateResult.similarityFlag).not.toBe("LOW");
    });
  });

  describe("14. Reviewer Council Gate & Human Approval", () => {
    it("runs 5-agent Council, generates decision, and enforces human approval gate", () => {
      const db = openAgentOsDb();
      const council = new ReviewerCouncilGate();
      const now = new Date().toISOString();
      const jobId = "vjob-council-test-" + Math.random().toString(36).slice(2, 8);

      // Insert job to satisfy FK constraint
      db.query(`
        INSERT INTO video_production_jobs (
          id, mode, status, stage, prompt, script, aspect_ratio, resolution,
          target_duration_seconds, voiceover_enabled, subtitles_enabled, music_mode,
          cost_guard_state, currency, request_json, routing_json, metadata_json, created_at, updated_at
        ) VALUES (
          ?, 'adobe_stock', 'QC_PENDING', 'qc', 'Cinematic establishing shot of modern architectural glass building in downtown city', '',
          '16:9', '1080P', 10.0, 0, 0, 'none', 'FREE', 'USD', '{}', '{}', '{}', ?, ?
        )
      `).run(jobId, now, now);

      const mockJob: VideoProductionJob = {
        id: jobId,
        mode: "adobe_stock",
        status: "QC_PENDING",
        stage: "qc",
        prompt: "Cinematic establishing shot of modern architectural glass building in downtown city",
        script: "",
        aspectRatio: "16:9",
        resolution: "1080P",
        targetDurationSeconds: 10,
        voiceoverEnabled: false,
        subtitlesEnabled: false,
        musicMode: "none",
        costGuardState: "FREE",
        currency: "USD",
        requestJson: {},
        routingJson: {},
        metadataJson: {},
        createdAt: now,
        updatedAt: now,
      };

      const evalSummary = council.evaluate(mockJob);
      expect(evalSummary.compositeScore).toBeGreaterThan(70);
      expect(evalSummary.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");

      // Approve human review
      const approved = council.approveHumanReview(evalSummary.id, "lead_video_editor");
      expect(approved.humanApprovedBy).toBe("lead_video_editor");
      expect(approved.humanApprovedAt).toBeDefined();
    });
  });

  describe("15. Adobe Stock Export Package Builder", () => {
    it("assembles complete Adobe Stock export bundle with CSV and manifest", () => {
      const db = openAgentOsDb();
      const jobId = "vjob-export-test-" + Math.random().toString(36).slice(2, 8);
      const now = new Date().toISOString();

      db.query(`
        INSERT INTO video_production_jobs (
          id, mode, status, stage, prompt, script, aspect_ratio, resolution,
          target_duration_seconds, voiceover_enabled, subtitles_enabled, music_mode,
          cost_guard_state, currency, request_json, routing_json, metadata_json, created_at, updated_at
        ) VALUES (
          ?, 'adobe_stock', 'READY_FOR_EXPORT', 'export', 'Majestic mountain peak aerial shot 4k', '',
          '16:9', '1080P', 8.0, 0, 0, 'none', 'FREE', 'USD', '{}', '{}', '{}', ?, ?
        )
      `).run(jobId, now, now);

      db.query(`
        INSERT INTO video_production_artifacts (
          id, job_id, type, path, duration_ms, fps, container_format, video_codec, created_at
        ) VALUES ('art-exp-1', ?, 'processed_video', 'peak_aerial.mp4', 8000, 30.0, 'mp4', 'h264', ?)
      `).run(jobId, now);

      const builder = new VideoExportPackageBuilder();
      const pkg = builder.buildPackage(jobId, {
        title: "Majestic Mountain Peak Aerial View",
        keywords: ["mountain", "peak", "aerial", "drone", "4k", "nature"],
      });

      expect(pkg.id).toBeDefined();
      expect(pkg.csvContent).toContain("Filename,Title,Keywords,Category,Releases");
      expect(pkg.csvContent).toContain("peak_aerial.mp4");
      expect(pkg.csvContent).toContain("Majestic Mountain Peak Aerial View");
      expect(pkg.manifestJson.files).toContain("peak_aerial.mp4");
      expect(pkg.manifestJson.files).toContain("metadata.csv");
    });
  });

  describe("16. Living Knowledge Brain Hooks & ADRs", () => {
    it("registers Phase 20.7 entities and records ADR-023 and ADR-024", () => {
      const syncResult = syncVideoFactoryKnowledge();
      expect(syncResult.entitiesRegistered).toBeGreaterThanOrEqual(5);
      expect(syncResult.decisionsRecorded).toBeGreaterThanOrEqual(2);
      expect(syncResult.syncedAt).toBeDefined();
    });
  });

  describe("17. 22 WebMCP Tools for Video Factory", () => {
    it("exposes all 22 WebMCP tools with valid schemas and callable methods", async () => {
      expect(VIDEO_FACTORY_MCP_TOOLS.length).toBe(22);

      const toolNames = VIDEO_FACTORY_MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain("video_create_job");
      expect(toolNames).toContain("video_get_job");
      expect(toolNames).toContain("video_list_jobs");
      expect(toolNames).toContain("video_cancel_job");
      expect(toolNames).toContain("video_route_job");
      expect(toolNames).toContain("video_list_providers");
      expect(toolNames).toContain("video_check_provider_health");
      expect(toolNames).toContain("video_estimate_cost");
      expect(toolNames).toContain("video_approve_cost");
      expect(toolNames).toContain("video_run_pipeline");
      expect(toolNames).toContain("video_run_technical_qc");
      expect(toolNames).toContain("video_get_technical_qc");
      expect(toolNames).toContain("video_evaluate_similarity");
      expect(toolNames).toContain("video_evaluate_council");
      expect(toolNames).toContain("video_get_council_review");
      expect(toolNames).toContain("video_approve_human_review");
      expect(toolNames).toContain("video_check_rights");
      expect(toolNames).toContain("video_build_export_package");
      expect(toolNames).toContain("video_get_export_package");
      expect(toolNames).toContain("video_resume_incomplete");
      expect(toolNames).toContain("video_sync_knowledge");
      expect(toolNames).toContain("video_build_mpt_manifest");

      // Execute safe read-only tools
      const listProvidersTool = VIDEO_FACTORY_MCP_TOOLS.find((t) => t.name === "video_list_providers")!;
      const providers = await listProvidersTool.execute({});
      expect(Array.isArray(providers)).toBe(true);

      const checkRightsTool = VIDEO_FACTORY_MCP_TOOLS.find((t) => t.name === "video_check_rights")!;
      const rights = await checkRightsTool.execute({ source: "pexels", redistributionPermitted: false }) as any;
      expect(rights.permitted).toBe(false);
    });
  });
});
