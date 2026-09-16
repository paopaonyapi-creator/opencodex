// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Safe Media Processor (FFmpeg / ffprobe with Named Presets)

import { existsSync, statSync } from "node:fs";
import { runProcessSafely } from "./process-runner";
import { MediaError } from "./errors";

export interface ProbeResult {
  durationSec?: number;
  width?: number;
  height?: number;
  format?: string;
  vcodec?: string;
  acodec?: string;
  bitrate?: number;
  sizeBytes?: number;
}

export type ProcessingPreset =
  | "web_preview"
  | "audio_wav"
  | "audio_mp3"
  | "thumbnail_1080"
  | "video_h264"
  | "video_h265";

export class MediaProcessor {
  private ffmpegBinary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  private ffprobeBinary = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";

  async probe(filePath: string): Promise<ProbeResult> {
    if (!existsSync(filePath)) {
      throw new MediaError("MEDIA_NOT_FOUND", `File not found for probing: ${filePath}`);
    }

    const stat = statSync(filePath);
    try {
      const res = await runProcessSafely({
        binary: this.ffprobeBinary,
        args: [
          "-v", "quiet",
          "-print_format", "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        timeoutMs: 15_000,
      });

      if (res.exitCode === 0) {
        const data = JSON.parse(res.stdout);
        const format = data.format || {};
        const vstream = (data.streams || []).find((s: any) => s.codec_type === "video");
        const astream = (data.streams || []).find((s: any) => s.codec_type === "audio");

        return {
          durationSec: format.duration ? parseFloat(format.duration) : undefined,
          width: vstream?.width,
          height: vstream?.height,
          format: format.format_name,
          vcodec: vstream?.codec_name,
          acodec: astream?.codec_name,
          bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
          sizeBytes: stat.size,
        };
      }
    } catch {
      // ffprobe may not be installed or failed
    }

    // Basic filesystem fallback
    return {
      sizeBytes: stat.size,
      format: filePath.split(".").pop() || "unknown",
    };
  }

  async processWithPreset(inputPath: string, outputPath: string, preset: ProcessingPreset): Promise<string> {
    if (!existsSync(inputPath)) {
      throw new MediaError("MEDIA_NOT_FOUND", `Source media file not found: ${inputPath}`);
    }

    const args: string[] = ["-y", "-i", inputPath];

    switch (preset) {
      case "web_preview":
        args.push("-vf", "scale=-2:720", "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "aac", "-b:a", "128k", outputPath);
        break;
      case "audio_wav":
        args.push("-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outputPath);
        break;
      case "audio_mp3":
        args.push("-vn", "-acodec", "libmp3lame", "-b:a", "192k", outputPath);
        break;
      case "thumbnail_1080":
        args.push("-ss", "00:00:01.000", "-vframes", "1", "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease", outputPath);
        break;
      case "video_h264":
        args.push("-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", outputPath);
        break;
      case "video_h265":
        args.push("-c:v", "libx265", "-crf", "24", "-preset", "fast", "-c:a", "aac", outputPath);
        break;
      default:
        throw new MediaError("MEDIA_INVALID_ARGUMENT", `Unknown preset: ${preset}`);
    }

    const res = await runProcessSafely({
      binary: this.ffmpegBinary,
      args,
      timeoutMs: 180_000, // 3 mins max
    });

    if (res.exitCode !== 0) {
      throw new MediaError(
        "MEDIA_PROCESSING_FAILED",
        `FFmpeg preset '${preset}' failed (exit ${res.exitCode}): ${res.stderr || res.stdout}`,
        false,
        { exitCode: res.exitCode },
      );
    }

    return outputPath;
  }
}
