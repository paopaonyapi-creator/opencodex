// Video Production Job Queue & State Machine
import { openAgentOsDb } from "../../db";
import {
  type JobStatus,
  type VideoProductionJob,
  type VideoProductionRequest,
  type VideoProductionAttempt,
  type VideoProductionArtifact,
  VIDEO_JOB_TRANSITIONS,
} from "../domain/types";
import { VideoCostGuard } from "../cost/video-cost-guard";
import { SmartProductionRouter } from "../routing/production-router";
import { getVideoProviderRegistry } from "../routing/provider-registry";
import { enforceAdobeStockPolicy } from "../policy/adobe-stock-policy";

export class VideoJobQueue {
  private costGuard = new VideoCostGuard();
  private router = new SmartProductionRouter();

  async createJob(request: VideoProductionRequest): Promise<VideoProductionJob> {
    const db = openAgentOsDb();

    // Idempotency check by clientRequestId
    if (request.clientRequestId) {
      const existing = db
        .query("SELECT * FROM video_production_jobs WHERE client_request_id = ?")
        .get(request.clientRequestId) as any;
      if (existing) {
        return this.mapJobRow(existing);
      }
    }

    const id = request.jobId || ("vjob-" + Math.random().toString(36).slice(2, 10));
    const now = new Date().toISOString();

    // Policy enforcement
    const policyResult = enforceAdobeStockPolicy(request);
    const initialStatus: JobStatus = "VALIDATING";

    db.query(`
      INSERT INTO video_production_jobs (
        id, project_id, concept_id, mode, status, stage, prompt, script,
        aspect_ratio, resolution, target_duration_seconds, voiceover_enabled,
        subtitles_enabled, music_mode, client_request_id, request_json,
        routing_json, cost_guard_state, currency, created_at, updated_at, metadata_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      id,
      request.projectId || null,
      request.conceptId || null,
      request.mode,
      initialStatus,
      "validating",
      request.prompt,
      request.script || "",
      request.aspectRatio,
      request.resolution || "1080P",
      request.targetDurationSeconds || 8.0,
      request.voiceoverEnabled ? 1 : 0,
      request.subtitlesEnabled ? 1 : 0,
      request.musicMode || "none",
      request.clientRequestId || null,
      JSON.stringify(request),
      JSON.stringify({ policyCheck: policyResult }),
      "FREE",
      "USD",
      now,
      now,
      JSON.stringify(request.metadata || {}),
    );

    return this.getJob(id)!;
  }

  getJob(id: string): VideoProductionJob | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM video_production_jobs WHERE id = ?").get(id) as any;
    return row ? this.mapJobRow(row) : null;
  }

  listJobs(limit = 50, mode?: string): VideoProductionJob[] {
    const db = openAgentOsDb();
    let query = "SELECT * FROM video_production_jobs";
    const params: any[] = [];
    if (mode) {
      query += " WHERE mode = ?";
      params.push(mode);
    }
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...params) as any[];
    return rows.map((r) => this.mapJobRow(r));
  }

  updateJobStatus(jobId: string, newStatus: JobStatus, errorMessage?: string): VideoProductionJob {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const allowed = VIDEO_JOB_TRANSITIONS[job.status];
    if (allowed && !allowed.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${job.status} to ${newStatus}`);
    }

    const now = new Date().toISOString();
    db.query(`
      UPDATE video_production_jobs
      SET status = ?, error_message = COALESCE(?, error_message), updated_at = ?
      WHERE id = ?
    `).run(newStatus, errorMessage || null, now, jobId);

    return this.getJob(jobId)!;
  }

  async runJobPipeline(jobId: string): Promise<{
    job: VideoProductionJob;
    artifacts: VideoProductionArtifact[];
  }> {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const db = openAgentOsDb();
    const request = job.requestJson as unknown as VideoProductionRequest;

    // 1. Route to provider
    this.updateJobStatus(jobId, "ROUTING");
    const routeResult = await this.router.route(request);
    const providerId = routeResult.selectedProvider;

    const registry = getVideoProviderRegistry();
    const adapter = registry.getAdapter(providerId);
    if (!adapter) throw new Error(`Adapter for ${providerId} not found`);

    // 2. Cost Guard check
    const estimate = await adapter.estimate(request);
    const costDecision = this.costGuard.evaluate(request, estimate);

    db.query(`
      UPDATE video_production_jobs
      SET selected_provider = ?, routing_json = ?, estimated_cost = ?,
          cost_guard_state = ?, updated_at = ?
      WHERE id = ?
    `).run(
      providerId,
      JSON.stringify(routeResult.explanation),
      estimate.estimatedCostUsd,
      costDecision.state,
      new Date().toISOString(),
      jobId,
    );

    if (!costDecision.allowed) {
      if (costDecision.state === "REQUIRES_APPROVAL") {
        this.updateJobStatus(jobId, "WAITING_APPROVAL");
        return { job: this.getJob(jobId)!, artifacts: [] };
      }
      this.updateJobStatus(jobId, "FAILED_FINAL", costDecision.reason);
      throw new Error(`Cost Guard Block: ${costDecision.reason}`);
    }

    // 3. Submit to Provider
    this.updateJobStatus(jobId, "SUBMITTING");
    const attemptId = "att-" + Math.random().toString(36).slice(2, 10);
    const attemptNow = new Date().toISOString();

    db.query(`
      INSERT INTO video_production_attempts (
        id, job_id, attempt_number, provider, status, created_at
      ) VALUES (?, ?, 1, ?, 'SUBMITTING', ?)
    `).run(attemptId, jobId, providerId, attemptNow);

    const submission = await adapter.submit(request);
    if (!submission.success || !submission.externalJobId) {
      db.query(`
        UPDATE video_production_attempts
        SET status = 'FAILED', error_message = ?, finished_at = ?
        WHERE id = ?
      `).run(submission.error || "Submission failed", new Date().toISOString(), attemptId);

      this.updateJobStatus(jobId, "FAILED_RETRYABLE", submission.error || "Provider submission rejected");
      throw new Error(`Submission failed: ${submission.error}`);
    }

    db.query(`
      UPDATE video_production_jobs
      SET external_provider_job_id = ?, updated_at = ?
      WHERE id = ?
    `).run(submission.externalJobId, new Date().toISOString(), jobId);

    db.query(`
      UPDATE video_production_attempts
      SET external_provider_job_id = ?, status = 'RUNNING'
      WHERE id = ?
    `).run(submission.externalJobId, attemptId);

    // 4. Provider Running / Polling
    this.updateJobStatus(jobId, "PROVIDER_RUNNING");
    let status = await adapter.getStatus(submission.externalJobId);

    if (status.status === "failed") {
      db.query(`
        UPDATE video_production_attempts
        SET status = 'FAILED', error_message = ?, finished_at = ?
        WHERE id = ?
      `).run(status.error || "Generation sampler failed", new Date().toISOString(), attemptId);

      this.updateJobStatus(jobId, "FAILED_RETRYABLE", status.error || "Generation sampler failed");
      throw new Error(`Generation failed: ${status.error}`);
    }

    // 5. Collect Artifacts
    this.updateJobStatus(jobId, "COLLECTING");
    const collected = await adapter.collectArtifacts(submission.externalJobId);

    const artifacts: VideoProductionArtifact[] = [];
    for (const art of collected) {
      const artId = "art-" + Math.random().toString(36).slice(2, 10);
      const artNow = new Date().toISOString();

      db.query(`
        INSERT INTO video_production_artifacts (
          id, job_id, attempt_id, type, path, mime_type, file_size_bytes,
          width, height, duration_ms, fps, container_format, video_codec, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        artId,
        jobId,
        attemptId,
        art.type,
        art.localPath,
        art.mimeType || "video/mp4",
        art.fileSizeBytes || 10485760,
        1920,
        1080,
        Number((request.targetDurationSeconds || 8) * 1000),
        30.0,
        "mp4",
        "h264",
        artNow,
      );

      artifacts.push({
        id: artId,
        jobId,
        attemptId,
        type: art.type,
        path: art.localPath,
        mimeType: art.mimeType || "video/mp4",
        width: 1920,
        height: 1080,
        durationMs: Number((request.targetDurationSeconds || 8) * 1000),
        fps: 30.0,
        fileSizeBytes: art.fileSizeBytes || 10485760,
        containerFormat: "mp4",
        videoCodec: "h264",
        lineageJson: {},
        qcJson: {},
        createdAt: artNow,
      });
    }

    db.query(`
      UPDATE video_production_attempts
      SET status = 'COMPLETED', finished_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), attemptId);

    // 6. Post Processing / QC Pending
    this.updateJobStatus(jobId, "QC_PENDING");

    return {
      job: this.getJob(jobId)!,
      artifacts,
    };
  }

  approveCost(jobId: string): VideoProductionJob {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    db.query(`
      UPDATE video_production_jobs
      SET cost_guard_state = 'APPROVED', status = 'QUEUED', updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), jobId);

    return this.getJob(jobId)!;
  }

  cancelJob(jobId: string): VideoProductionJob {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    if (job.selectedProvider && job.externalProviderJobId) {
      const adapter = getVideoProviderRegistry().getAdapter(job.selectedProvider);
      if (adapter && adapter.cancel) {
        adapter.cancel(job.externalProviderJobId).catch(() => {});
      }
    }

    db.query(`
      UPDATE video_production_jobs
      SET status = 'CANCELLED', updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), jobId);

    return this.getJob(jobId)!;
  }

  resumeIncompleteJobs(): { recoveredCount: number } {
    const db = openAgentOsDb();
    const incomplete = db
      .query(`
        SELECT id FROM video_production_jobs
        WHERE status IN ('PROVIDER_RUNNING', 'COLLECTING')
      `)
      .all() as Array<{ id: string }>;

    let recoveredCount = 0;
    for (const row of incomplete) {
      try {
        const job = this.getJob(row.id);
        if (job?.selectedProvider && job.externalProviderJobId) {
          const adapter = getVideoProviderRegistry().getAdapter(job.selectedProvider);
          if (adapter && adapter.recover) {
            adapter.recover(job.externalProviderJobId).catch(() => {});
            recoveredCount++;
          }
        }
      } catch {
        // ignore individual recovery failures
      }
    }
    return { recoveredCount };
  }

  private mapJobRow(row: any): VideoProductionJob {
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      conceptId: row.concept_id || undefined,
      mode: row.mode,
      status: row.status,
      stage: row.stage,
      prompt: row.prompt,
      script: row.script,
      aspectRatio: row.aspect_ratio,
      resolution: row.resolution,
      targetDurationSeconds: Number(row.target_duration_seconds),
      voiceoverEnabled: Boolean(row.voiceover_enabled),
      subtitlesEnabled: Boolean(row.subtitles_enabled),
      musicMode: row.music_mode,
      selectedProvider: row.selected_provider || undefined,
      externalProviderJobId: row.external_provider_job_id || undefined,
      clientRequestId: row.client_request_id || undefined,
      requestJson: JSON.parse(row.request_json || "{}"),
      routingJson: JSON.parse(row.routing_json || "{}"),
      costGuardState: row.cost_guard_state,
      estimatedCost: row.estimated_cost ? Number(row.estimated_cost) : undefined,
      actualCost: row.actual_cost ? Number(row.actual_cost) : undefined,
      currency: row.currency,
      pricingObservedAt: row.pricing_observed_at || undefined,
      errorCode: row.error_code || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadataJson: JSON.parse(row.metadata_json || "{}"),
    };
  }
}

let globalQueue: VideoJobQueue | null = null;

export function getVideoJobQueue(): VideoJobQueue {
  if (!globalQueue) {
    globalQueue = new VideoJobQueue();
  }
  return globalQueue;
}
