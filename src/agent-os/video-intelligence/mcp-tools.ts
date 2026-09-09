/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * WebMCP Tools Suite: Provider-Neutral Video Intelligence & Stock QC Tools
 */

import { getVideoJobManager } from "./index";
import { MediaProbe } from "./media-probe";
import { FrameExtractor } from "./frame-extractor";
import { HookAnalyzer } from "./hook-analyzer";
import { PacingAnalyzer } from "./pacing-analyzer";
import { StockQcEngine } from "./stock-qc";
import { TranscriptEngine } from "./transcript-engine";
import type { VideoJobConfig } from "./types";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const VIDEO_INTELLIGENCE_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "video_analyze",
    description: "Submit a video URL or local file for complete multi-stage intelligence analysis.",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) {
        throw new Error("Missing required 'source' argument");
      }
      const config: VideoJobConfig = {
        intent: (args.intent as any) ?? "general",
        sampling: (args.sampling as any) ?? "auto",
        localOnly: Boolean(args.local_only ?? args.localOnly ?? false),
        enableHookMicroscope: args.hook !== false,
        startSec: args.start !== undefined ? Number(args.start) : undefined,
        endSec: args.end !== undefined ? Number(args.end) : undefined,
      };
      const manager = getVideoJobManager();
      return manager.submitJob(source, config);
    },
  },
  {
    name: "video_inspect",
    description: "Probe technical video metadata, resolution, aspect ratio, orientation, duration, and codecs.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const probe = new MediaProbe();
      return probe.probe(source);
    },
  },
  {
    name: "video_transcribe",
    description: "Extract multi-tier transcript (native captions, local Whisper, cloud fallback) with word/segment timestamps.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const engine = new TranscriptEngine();
      return engine.transcribe(source, {
        localOnly: Boolean(args.local_only ?? args.localOnly ?? false),
      });
    },
  },
  {
    name: "video_extract_frames",
    description: "Detect scene cuts and select hero keyframes with aesthetic contrast scoring.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const probe = new MediaProbe();
      const meta = await probe.probe(source);
      const extractor = new FrameExtractor();
      const scenes = extractor.detectScenes(meta, {
        sampling: (args.sampling as any) ?? "auto",
        sceneThreshold: args.scene_threshold ? Number(args.scene_threshold) : undefined,
        maxFrames: args.max_frames ? Number(args.max_frames) : undefined,
      });
      const heroFrames = extractor.selectHeroFrames(scenes, meta);
      return { scenes, heroFrames };
    },
  },
  {
    name: "video_analyze_hook",
    description: "Analyze 0-10s Hook Microscope: opening visual impact, first scene cut, first speech onset, and retention style.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const probe = new MediaProbe();
      const meta = await probe.probe(source);
      const extractor = new FrameExtractor();
      const scenes = extractor.detectScenes(meta, { sampling: "uniform" });
      const transEngine = new TranscriptEngine();
      const transcript = await transEngine.transcribe(source);
      const hookAnalyzer = new HookAnalyzer();
      return hookAnalyzer.analyzeHook(scenes, transcript);
    },
  },
  {
    name: "video_analyze_pacing",
    description: "Calculate editorial pacing metrics: cuts per minute (CPM), mean/median shot lengths, and rhythm profile.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const probe = new MediaProbe();
      const meta = await probe.probe(source);
      const extractor = new FrameExtractor();
      const scenes = extractor.detectScenes(meta);
      const pacingAnalyzer = new PacingAnalyzer();
      return pacingAnalyzer.analyzePacing(scenes, meta);
    },
  },
  {
    name: "video_stock_qc",
    description: "Run automated Adobe Stock quality control review against resolution, duration, watermark, and visual defect standards.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const probe = new MediaProbe();
      const meta = await probe.probe(source);
      const transEngine = new TranscriptEngine();
      const transcript = await transEngine.transcribe(source);
      const stockQc = new StockQcEngine();
      return stockQc.evaluate(meta, transcript.fullText);
    },
  },
  {
    name: "video_debug_screen",
    description: "Analyze screen recordings and tutorial videos to identify error UI states and failure moments.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const source = String(args.source ?? "");
      if (!source) throw new Error("Missing 'source'");
      const manager = getVideoJobManager();
      return manager.submitJob(source, {
        intent: "screen_debug",
        sampling: "uniform",
      });
    },
  },
  {
    name: "video_get_report",
    description: "Retrieve generated markdown and structured JSON intelligence report for a completed job.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const jobId = String(args.job_id ?? args.jobId ?? "");
      if (!jobId) throw new Error("Missing 'job_id'");
      const manager = getVideoJobManager();
      const job = manager.getJob(jobId);
      if (!job) throw new Error(`Video job '${jobId}' not found`);
      return {
        status: job.status,
        progressPercent: job.progressPercent,
        report: job.report ?? null,
        markdown: job.report?.markdownReport ?? null,
      };
    },
  },
  {
    name: "video_list_jobs",
    description: "List and filter video intelligence jobs by status or intent.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const manager = getVideoJobManager();
      return manager.listJobs({
        intent: args.intent ? String(args.intent) : undefined,
        status: args.status ? String(args.status) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });
    },
  },
  {
    name: "video_cancel_job",
    description: "Cancel an active or queued video intelligence job.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const jobId = String(args.job_id ?? args.jobId ?? "");
      if (!jobId) throw new Error("Missing 'job_id'");
      const manager = getVideoJobManager();
      const success = manager.cancelJob(jobId);
      return { success, job: manager.getJob(jobId) };
    },
  },
];
