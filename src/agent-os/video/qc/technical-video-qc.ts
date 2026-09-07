// Technical Video QC Engine for Pao AI Video Factory
import { openAgentOsDb } from "../../db";
import {
  type TechnicalVideoQCResult,
  type VideoProductionJob,
  type VideoProductionArtifact,
} from "../domain/types";
import { validateStockVideo } from "../../validators/stock-video-validator";

export interface TechnicalQcOptions {
  requireAudio?: boolean;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
}

export class TechnicalVideoQcEngine {
  /**
   * Run automated technical QC against a video artifact produced by a job.
   */
  runQC(
    job: VideoProductionJob,
    artifact: VideoProductionArtifact,
    options: TechnicalQcOptions = {},
  ): TechnicalVideoQCResult {
    const db = openAgentOsDb();
    const id = "tqc-" + Math.random().toString(36).slice(2, 10);
    const inspectedAt = new Date().toISOString();

    const durationSeconds = (artifact.durationMs || 8000) / 1000;
    const width = artifact.width || 1920;
    const height = artifact.height || 1080;
    const fps = artifact.fps || 30.0;
    const container = artifact.containerFormat || "mp4";
    const codec = artifact.videoCodec || "h264";
    const fileSizeBytes = artifact.fileSizeBytes || 10485760;
    const bitrateKbps = fileSizeBytes > 0 && durationSeconds > 0
      ? (fileSizeBytes * 8) / (durationSeconds * 1000)
      : 8000;

    const checks: Array<{ name: string; passed: boolean; message: string }> = [];
    const warnings: string[] = [];
    const failures: string[] = [];

    // Mode-specific validation
    if (job.mode === "adobe_stock") {
      // Use Adobe Stock Video Validator rules
      const stockRes = validateStockVideo({
        durationSeconds,
        container,
        codec,
        fps,
        width,
        height,
        fileSizeBytes,
        bitrate: bitrateKbps,
        audioCodec: artifact.audioCodec || null,
      });

      checks.push({
        name: "stock_duration_check",
        passed: stockRes.details.durationPass,
        message: `Duration ${durationSeconds.toFixed(2)}s (requires 5-60s)`,
      });
      checks.push({
        name: "stock_container_check",
        passed: stockRes.details.containerPass,
        message: `Container: ${container}`,
      });
      checks.push({
        name: "stock_codec_check",
        passed: stockRes.details.codecPass,
        message: `Codec: ${codec}`,
      });
      checks.push({
        name: "stock_framerate_check",
        passed: stockRes.details.frameRatePass,
        message: `Frame rate: ${fps} fps`,
      });
      checks.push({
        name: "stock_resolution_check",
        passed: stockRes.details.resolutionPass,
        message: `Resolution: ${width}x${height}`,
      });

      failures.push(...stockRes.errors);
      warnings.push(...stockRes.warnings);
    } else {
      // Generic production validation
      const minDur = options.minDurationSeconds ?? 3.0;
      const maxDur = options.maxDurationSeconds ?? 300.0;
      const durPass = durationSeconds >= minDur && durationSeconds <= maxDur;
      checks.push({
        name: "duration_bounds",
        passed: durPass,
        message: `Duration ${durationSeconds.toFixed(2)}s (bounds: ${minDur}-${maxDur}s)`,
      });
      if (!durPass) failures.push(`Duration out of bounds (${durationSeconds.toFixed(2)}s)`);

      const resPass = width >= 720 && height >= 720;
      checks.push({
        name: "minimum_resolution",
        passed: resPass,
        message: `Resolution: ${width}x${height}`,
      });
      if (!resPass) failures.push(`Resolution below minimum requirements: ${width}x${height}`);

      const fpsPass = fps >= 15 && fps <= 120;
      checks.push({
        name: "frame_rate_bounds",
        passed: fpsPass,
        message: `FPS: ${fps}`,
      });
      if (!fpsPass) failures.push(`Invalid frame rate: ${fps} fps`);
    }

    const passed = failures.length === 0;

    // Persist result in SQLite
    db.query(`
      INSERT INTO video_technical_qc (
        id, job_id, artifact_id, passed, container_format, video_codec,
        audio_codec, width, height, aspect_ratio, fps, duration_seconds,
        bitrate_kbps, file_size_bytes, checks_json, warnings_json, failures_json, inspected_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      id,
      job.id,
      artifact.id,
      passed ? 1 : 0,
      container,
      codec,
      artifact.audioCodec || null,
      width,
      height,
      job.aspectRatio,
      fps,
      durationSeconds,
      bitrateKbps,
      fileSizeBytes,
      JSON.stringify(checks),
      JSON.stringify(warnings),
      JSON.stringify(failures),
      inspectedAt,
    );

    return {
      id,
      jobId: job.id,
      artifactId: artifact.id,
      passed,
      containerFormat: container,
      videoCodec: codec,
      audioCodec: artifact.audioCodec,
      width,
      height,
      aspectRatio: job.aspectRatio,
      fps,
      durationSeconds,
      bitrateKbps,
      fileSizeBytes,
      checks,
      warnings,
      failures,
      inspectedAt,
    };
  }

  getQCResultForJob(jobId: string): TechnicalVideoQCResult | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM video_technical_qc WHERE job_id = ? ORDER BY inspected_at DESC LIMIT 1").get(jobId) as any;
    if (!row) return null;

    return {
      id: row.id,
      jobId: row.job_id,
      artifactId: row.artifact_id || undefined,
      passed: Boolean(row.passed),
      containerFormat: row.container_format || undefined,
      videoCodec: row.video_codec || undefined,
      audioCodec: row.audio_codec || undefined,
      width: row.width ? Number(row.width) : undefined,
      height: row.height ? Number(row.height) : undefined,
      aspectRatio: row.aspect_ratio || undefined,
      fps: row.fps ? Number(row.fps) : undefined,
      durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
      bitrateKbps: row.bitrate_kbps ? Number(row.bitrate_kbps) : undefined,
      fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : undefined,
      checks: JSON.parse(row.checks_json || "[]"),
      warnings: JSON.parse(row.warnings_json || "[]"),
      failures: JSON.parse(row.failures_json || "[]"),
      inspectedAt: row.inspected_at,
    };
  }
}
