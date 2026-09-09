/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Job Manager: Orchestration Lifecycle, State Machine & Execution Engine
 */

import { randomUUID } from "node:crypto";
import { FrameExtractor } from "./frame-extractor";
import { HookAnalyzer } from "./hook-analyzer";
import { MediaProbe } from "./media-probe";
import { PacingAnalyzer } from "./pacing-analyzer";
import { ReportBuilder } from "./report-builder";
import { VideoSecurityValidator } from "./security";
import { StockQcEngine } from "./stock-qc";
import { TranscriptEngine } from "./transcript-engine";
import { VideoReviewerCouncil } from "./council-adapter";
import { KnowledgeAdapter } from "./knowledge-adapter";
import { VideoDbStore } from "./db-store";
import type {
  VideoAnalysisReport,
  VideoJob,
  VideoJobConfig,
} from "./types";

export class VideoJobManager {
  private jobs: Map<string, VideoJob> = new Map();
  private security: VideoSecurityValidator;
  private probe: MediaProbe;
  private frameExtractor: FrameExtractor;
  private hookAnalyzer: HookAnalyzer;
  private transcriptEngine: TranscriptEngine;
  private pacingAnalyzer: PacingAnalyzer;
  private stockQc: StockQcEngine;
  private reportBuilder: ReportBuilder;
  private council: VideoReviewerCouncil;
  private knowledgeAdapter: KnowledgeAdapter;
  private dbStore: VideoDbStore;

  constructor() {
    this.security = new VideoSecurityValidator();
    this.probe = new MediaProbe();
    this.frameExtractor = new FrameExtractor();
    this.hookAnalyzer = new HookAnalyzer();
    this.transcriptEngine = new TranscriptEngine();
    this.pacingAnalyzer = new PacingAnalyzer();
    this.stockQc = new StockQcEngine();
    this.reportBuilder = new ReportBuilder();
    this.council = new VideoReviewerCouncil();
    this.knowledgeAdapter = new KnowledgeAdapter();
    this.dbStore = new VideoDbStore();
  }

  /**
   * Submits a video source (URL or local path) for intelligence analysis.
   */
  public async submitJob(source: string, config: VideoJobConfig = {}): Promise<VideoJob> {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    const sourceType: "url" | "file" = isUrl ? "url" : "file";

    // 1. Security Validation
    if (sourceType === "url") {
      const urlCheck = this.security.validateUrl(source);
      if (!urlCheck.valid) {
        throw new Error(`Security validation failed: ${urlCheck.reason}`);
      }
    } else {
      const pathCheck = this.security.validateLocalPath(source);
      if (!pathCheck.valid) {
        throw new Error(`Security validation failed: ${pathCheck.reason}`);
      }
    }

    const now = new Date().toISOString();
    const id = `vjob_${randomUUID().slice(0, 10)}`;

    const job: VideoJob = {
      id,
      source,
      sourceType,
      config: {
        intent: config.intent ?? "general",
        sampling: config.sampling ?? "auto",
        enableHookMicroscope: config.enableHookMicroscope ?? true,
        localOnly: config.localOnly ?? false,
        ...config,
      },
      status: "queued",
      progressPercent: 0,
      currentStage: "Initialized job in queue",
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);

    // Execute asynchronously
    void this.executeJob(job);

    return { ...job };
  }

  /**
   * Executes the multi-stage video intelligence pipeline.
   */
  private async executeJob(job: VideoJob): Promise<void> {
    try {
      // Stage 1: Probing
      job.status = "probing";
      job.progressPercent = 15;
      job.currentStage = "Extracting media format, codecs & duration";
      job.updatedAt = new Date().toISOString();

      const metadata = await this.probe.probe(job.source);

      // Stage 2: Extracting Frames & Scenes
      job.status = "extracting_frames";
      job.progressPercent = 35;
      job.currentStage = "Detecting scene cuts & selecting hero keyframes";
      job.updatedAt = new Date().toISOString();

      const scenes = this.frameExtractor.detectScenes(metadata, {
        sampling: job.config.sampling,
        sceneThreshold: job.config.sceneThreshold,
        maxFrames: job.config.maxFrames,
        startSec: job.config.startSec,
        endSec: job.config.endSec,
      });

      const heroFrames = this.frameExtractor.selectHeroFrames(scenes, metadata);

      // Stage 3: Transcribing Audio
      job.status = "transcribing";
      job.progressPercent = 55;
      job.currentStage = "Transcribing speech and extracting dialogue timestamps";
      job.updatedAt = new Date().toISOString();

      const transcript = await this.transcriptEngine.transcribe(job.source, {
        localOnly: job.config.localOnly,
        sourceType: job.sourceType,
      });

      // Stage 4: Analyzing Pacing & Hook
      job.status = "analyzing";
      job.progressPercent = 75;
      job.currentStage = "Calculating editorial pacing & 0-10s hook retention metrics";
      job.updatedAt = new Date().toISOString();

      const pacing = this.pacingAnalyzer.analyzePacing(scenes, metadata);
      const hook = job.config.enableHookMicroscope
        ? this.hookAnalyzer.analyzeHook(scenes, transcript)
        : undefined;

      // Stage 5: Reviewing & Stock QC
      job.status = "reviewing";
      job.progressPercent = 88;
      job.currentStage = "Performing automated quality control review";
      job.updatedAt = new Date().toISOString();

      const stockQc =
        job.config.intent === "adobe_stock_qc" || job.config.intent === "general"
          ? this.stockQc.evaluate(metadata, transcript.fullText)
          : undefined;

      let councilReview = undefined;
      if (this.council.shouldReview(job, { metadata, pacing, hook, transcript, stockQc })) {
        councilReview = await this.council.evaluate(job, { metadata, pacing, hook, transcript, stockQc });
      }

      // Stage 6: Reporting
      job.status = "reporting";
      job.progressPercent = 95;
      job.currentStage = "Synthesizing markdown and structured report artifacts";
      job.updatedAt = new Date().toISOString();

      const completedAt = new Date().toISOString();
      const markdownReport = this.reportBuilder.buildMarkdown({
        jobId: job.id,
        source: job.source,
        intent: job.config.intent ?? "general",
        metadata,
        pacing,
        hook,
        transcript,
        stockQc,
        councilReview,
        createdAt: completedAt,
      });

      const report: VideoAnalysisReport = {
        jobId: job.id,
        source: job.source,
        sourceType: job.sourceType,
        intent: job.config.intent ?? "general",
        metadata,
        pacing,
        hook,
        transcript,
        scenes,
        heroFrames,
        stockQc,
        councilReview,
        markdownReport,
        createdAt: job.createdAt,
        completedAt,
      };

      if (job.config.ingestKnowledge ?? true) {
        report.knowledgeRecord = this.knowledgeAdapter.ingest(report);
      }

      job.report = report;
      job.status = "completed";
      job.progressPercent = 100;
      job.currentStage = "Analysis complete";
      job.updatedAt = completedAt;
      this.dbStore.saveJob(job);
    } catch (err) {
      job.status = "failed";
      job.error = (err as Error).message;
      job.updatedAt = new Date().toISOString();
      this.dbStore.saveJob(job);
    }
  }

  public getJob(id: string): VideoJob | undefined {
    const job = this.jobs.get(id);
    if (job) return { ...job };
    const persisted = this.dbStore.getJob(id);
    return persisted ? { ...persisted } : undefined;
  }

  public listJobs(filter: { intent?: string; status?: string; limit?: number } = {}): VideoJob[] {
    let result = Array.from(this.jobs.values());
    if (filter.intent) {
      result = result.filter((j) => j.config.intent === filter.intent);
    }
    if (filter.status) {
      result = result.filter((j) => j.status === filter.status);
    }
    const limit = filter.limit ?? 50;
    return result.slice(0, limit);
  }

  public cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === "completed" || job.status === "failed") {
      return false;
    }
    job.status = "cancelled";
    job.currentStage = "Job cancelled by operator";
    job.updatedAt = new Date().toISOString();
    return true;
  }
}
