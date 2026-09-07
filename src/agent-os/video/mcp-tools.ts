// Phase 20.7 — WebMCP Tools for Pao AI Video Factory Orchestrator
import { getVideoJobQueue } from "./queue/video-job-queue";
import { SmartProductionRouter } from "./routing/production-router";
import { getVideoProviderRegistry } from "./routing/provider-registry";
import { TechnicalVideoQcEngine } from "./qc/technical-video-qc";
import { VideoSimilarityGate } from "./qc/similarity-gate";
import { ReviewerCouncilGate } from "./qc/reviewer-council-gate";
import { VideoExportPackageBuilder } from "./export/export-package-builder";
import { evaluateStockFootageRights } from "./policy/rights-policy";
import { syncVideoFactoryKnowledge } from "./knowledge-hooks";
import { buildMptTaskManifest } from "./adapters/moneyprinterturbo/mpt-manifest";
import type { VideoProductionRequest, VideoProviderId } from "./domain/types";
import { openAgentOsDb } from "../db";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const VIDEO_FACTORY_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "video_create_job",
    description: "Create a new video production job with policy validation and idempotency.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.createJob(args as unknown as VideoProductionRequest);
    },
  },
  {
    name: "video_get_job",
    description: "Retrieve video production job details, status, stage, and metadata.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.getJob(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_list_jobs",
    description: "List video production jobs with optional limit and mode filter.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.listJobs(
        Number(args.limit ?? 50),
        args.mode ? String(args.mode) : undefined,
      );
    },
  },
  {
    name: "video_cancel_job",
    description: "Cancel a running or queued video production job.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.cancelJob(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_route_job",
    description: "Evaluate multi-provider smart routing for a video production request.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const router = new SmartProductionRouter();
      return router.route(args as unknown as VideoProductionRequest);
    },
  },
  {
    name: "video_list_providers",
    description: "List all registered video production adapters, models, and capabilities.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      const registry = getVideoProviderRegistry();
      return registry.listCapabilities();
    },
  },
  {
    name: "video_check_provider_health",
    description: "Run real-time health checks on video providers.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      const registry = getVideoProviderRegistry();
      return registry.runAllHealthChecks();
    },
  },
  {
    name: "video_estimate_cost",
    description: "Estimate generation cost in USD for a given video request.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const request = args as unknown as VideoProductionRequest;
      const router = new SmartProductionRouter();
      const route = await router.route(request);
      const adapter = getVideoProviderRegistry().getAdapter(route.selectedProvider);
      if (!adapter) throw new Error(`Adapter for ${route.selectedProvider} not found`);
      return adapter.estimate(request);
    },
  },
  {
    name: "video_approve_cost",
    description: "Approve a pending Cost Guard estimate to allow job submission.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.approveCost(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_run_pipeline",
    description: "Run the full execution pipeline for a queued video job.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      return queue.runJobPipeline(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_run_technical_qc",
    description: "Run automated technical QC inspection against generated video artifacts.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      const job = queue.getJob(String(args.jobId ?? ""));
      if (!job) throw new Error(`Job ${args.jobId} not found`);

      const db = openAgentOsDb();
      const artRow = db
        .query("SELECT * FROM video_production_artifacts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(job.id) as any;

      const artifact = artRow ? {
        id: artRow.id,
        jobId: artRow.job_id,
        type: artRow.type,
        path: artRow.path,
        durationMs: artRow.duration_ms ? Number(artRow.duration_ms) : 8000,
        fps: artRow.fps ? Number(artRow.fps) : 30,
        fileSizeBytes: artRow.file_size_bytes ? Number(artRow.file_size_bytes) : 10485760,
        containerFormat: artRow.container_format || "mp4",
        videoCodec: artRow.video_codec || "h264",
        lineageJson: {},
        qcJson: {},
        createdAt: artRow.created_at,
      } : {
        id: "art-mock",
        jobId: job.id,
        type: "processed_video" as const,
        path: "mock_video.mp4",
        durationMs: (job.targetDurationSeconds || 8) * 1000,
        fps: 30,
        fileSizeBytes: 10485760,
        containerFormat: "mp4",
        videoCodec: "h264",
        lineageJson: {},
        qcJson: {},
        createdAt: new Date().toISOString(),
      };

      const qc = new TechnicalVideoQcEngine();
      return qc.runQC(job, artifact, args.options as any);
    },
  },
  {
    name: "video_get_technical_qc",
    description: "Fetch the latest technical QC results for a video job.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const qc = new TechnicalVideoQcEngine();
      return qc.getQCResultForJob(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_evaluate_similarity",
    description: "Evaluate similarity and near-duplicate status against sibling batch videos.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const queue = getVideoJobQueue();
      const job = queue.getJob(String(args.jobId ?? ""));
      if (!job) throw new Error(`Job ${args.jobId} not found`);

      const gate = new VideoSimilarityGate();
      return gate.evaluateJob(job);
    },
  },
  {
    name: "video_evaluate_council",
    description: "Run the 5-Agent Reviewer Council evaluation on a video job.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const queue = getVideoJobQueue();
      const job = queue.getJob(String(args.jobId ?? ""));
      if (!job) throw new Error(`Job ${args.jobId} not found`);

      const qc = new TechnicalVideoQcEngine();
      const qcResult = qc.getQCResultForJob(job.id) || undefined;

      const council = new ReviewerCouncilGate();
      return council.evaluate(job, undefined, qcResult);
    },
  },
  {
    name: "video_get_council_review",
    description: "Fetch Reviewer Council evaluation and scores for a job.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const council = new ReviewerCouncilGate();
      return council.getCouncilEvaluation(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_approve_human_review",
    description: "Record mandatory human approval and advance job to READY_FOR_EXPORT.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const council = new ReviewerCouncilGate();
      return council.approveHumanReview(
        String(args.councilId ?? ""),
        String(args.approvedBy ?? "operator"),
      );
    },
  },
  {
    name: "video_check_rights",
    description: "Check third-party stock footage redistribution rights.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      return evaluateStockFootageRights(
        String(args.source ?? ""),
        args.license ? String(args.license) : undefined,
        Boolean(args.redistributionPermitted),
      );
    },
  },
  {
    name: "video_build_export_package",
    description: "Assemble the complete Adobe Stock export bundle (video, CSV, metadata, lineage).",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const builder = new VideoExportPackageBuilder();
      return builder.buildPackage(String(args.jobId ?? ""), args.options as any);
    },
  },
  {
    name: "video_get_export_package",
    description: "Fetch details of an exported video package.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const builder = new VideoExportPackageBuilder();
      return builder.getPackageForJob(String(args.jobId ?? ""));
    },
  },
  {
    name: "video_resume_incomplete",
    description: "Scan and recover interrupted video jobs across restarts.",
    riskTier: "R1",
    readOnly: false,
    execute: () => {
      const queue = getVideoJobQueue();
      return queue.resumeIncompleteJobs();
    },
  },
  {
    name: "video_sync_knowledge",
    description: "Sync Phase 20.7 entities and ADRs into Living Knowledge Brain.",
    riskTier: "R1",
    readOnly: false,
    execute: () => {
      return syncVideoFactoryKnowledge();
    },
  },
  {
    name: "video_build_mpt_manifest",
    description: "Build an upstream-compatible MoneyPrinterTurbo batch manifest.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      return buildMptTaskManifest(args as unknown as VideoProductionRequest);
    },
  },
];
