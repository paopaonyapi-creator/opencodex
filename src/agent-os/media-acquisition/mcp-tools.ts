// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Canonical WebMCP Tools Suite (14 Tools: 7 Read-Safe, 7 Controlled Actions)

import { getMediaAcquisitionService } from "./service";
import type { DownloadPreset, JobPriority, UsageClass } from "./types";
import type { ProcessingPreset } from "./media-processor";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

export const MEDIA_ACQUISITION_MCP_TOOLS: McpToolDefinition[] = [
  // 1. media.inspect (read-safe)
  {
    name: "media_inspect",
    description: "Inspect a public media URL to extract title, platform, available formats, duration, and subtitles without downloading.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public URL of video, audio, or image to inspect." },
        preferredProvider: { type: "string", enum: ["omniget", "ytdlp", "native"], description: "Optional preferred provider." },
      },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const res = await service.inspect({
          url: String(args.url),
          preferredProvider: args.preferredProvider as any,
        });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 2. media.list_jobs (read-safe)
  {
    name: "media_list_jobs",
    description: "List queued, running, completed, or failed media acquisition jobs.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"], description: "Optional status filter." },
      },
    },
    handler: async (args) => {
      const service = getMediaAcquisitionService();
      const jobs = service.queue.listJobs(args.status as any);
      return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
    },
  },

  // 3. media.get_job (read-safe)
  {
    name: "media_get_job",
    description: "Get current progress, ETA, output paths, and status of a specific media job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Unique ID of the media acquisition job." },
      },
      required: ["jobId"],
    },
    handler: async (args) => {
      const service = getMediaAcquisitionService();
      const job = service.queue.getJob(String(args.jobId));
      if (!job) {
        return { content: [{ type: "text", text: `Job '${args.jobId}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
    },
  },

  // 4. media.get_metadata (read-safe)
  {
    name: "media_get_metadata",
    description: "Probe detailed technical metadata (resolution, codecs, bitrate, duration) for an acquired media artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Unique artifact ID." },
      },
      required: ["artifactId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const artifact = service.registry.getArtifact(String(args.artifactId));
        if (!artifact) {
          return { content: [{ type: "text", text: `Artifact '${args.artifactId}' not found.` }], isError: true };
        }
        const probe = await service.processor.probe(artifact.localPath);
        return { content: [{ type: "text", text: JSON.stringify({ artifact, probe }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 5. media.get_transcript (read-safe)
  {
    name: "media_get_transcript",
    description: "Retrieve generated or extracted audio transcript segments for a media artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact ID." },
      },
      required: ["artifactId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const res = await service.transcribe(String(args.artifactId));
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 6. media.list_artifacts (read-safe)
  {
    name: "media_list_artifacts",
    description: "List all acquired and processed media artifacts with SHA-256 hashes and Adobe Stock safety metadata.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const service = getMediaAcquisitionService();
      const artifacts = service.registry.listArtifacts();
      return { content: [{ type: "text", text: JSON.stringify(artifacts, null, 2) }] };
    },
  },

  // 7. media.health (read-safe)
  {
    name: "media_health",
    description: "Check operational health and binary versions of OmniGet, yt-dlp, FFmpeg, and Whisper.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const service = getMediaAcquisitionService();
      const health = await service.getHealth();
      return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
    },
  },

  // 8. media.download (controlled action)
  {
    name: "media_download",
    description: "Queue a media acquisition job from a verified public URL into the local pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public media URL to download." },
        preset: { type: "string", enum: ["best", "video", "audio", "reference", "transcript"], description: "Quality or processing preset." },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "Queue priority." },
        usageClass: { type: "string", enum: ["research_reference", "internal_training", "concept_analysis", "production_derivative"], description: "Intended usage classification." },
      },
      required: ["url"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const job = await service.enqueueDownload({
          url: String(args.url),
          preset: args.preset as DownloadPreset,
          priority: args.priority as JobPriority,
          usageClass: args.usageClass as UsageClass,
        });
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 9. media.download_batch (controlled action)
  {
    name: "media_download_batch",
    description: "Queue multiple URLs for download with domain-level rate throttling.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "List of public media URLs." },
        preset: { type: "string", enum: ["best", "video", "audio", "reference", "transcript"] },
      },
      required: ["urls"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const res = await service.batchDownload({
          urls: (args.urls as string[]) || [],
          preset: args.preset as DownloadPreset,
        });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 10. media.extract_audio (controlled action)
  {
    name: "media_extract_audio",
    description: "Extract high-quality MP3 audio from a video artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Source video artifact ID." },
      },
      required: ["artifactId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const audio = await service.extractAudio(String(args.artifactId));
        return { content: [{ type: "text", text: JSON.stringify(audio, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 11. media.transcribe (controlled action)
  {
    name: "media_transcribe",
    description: "Transcribe spoken audio from an artifact using local Whisper engine.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact ID." },
        language: { type: "string", description: "Optional ISO language code." },
      },
      required: ["artifactId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const transcript = await service.transcribe(String(args.artifactId), args.language as string);
        return { content: [{ type: "text", text: JSON.stringify(transcript, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 12. media.convert (controlled action)
  {
    name: "media_convert",
    description: "Convert a media artifact to web preview, thumbnail, or specific video format using FFmpeg presets.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact ID to convert." },
        preset: {
          type: "string",
          enum: ["web_preview", "audio_wav", "audio_mp3", "thumbnail_1080", "video_h264", "video_h265"],
          description: "Named conversion preset.",
        },
      },
      required: ["artifactId", "preset"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const artifact = await service.convert(String(args.artifactId), args.preset as ProcessingPreset);
        return { content: [{ type: "text", text: JSON.stringify(artifact, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 13. media.cancel (controlled action)
  {
    name: "media_cancel",
    description: "Cancel a running or queued media acquisition job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job ID to cancel." },
      },
      required: ["jobId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const job = service.queue.cancelJob(String(args.jobId));
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },

  // 14. media.retry (controlled action)
  {
    name: "media_retry",
    description: "Re-queue a failed media job for retry.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Failed job ID." },
      },
      required: ["jobId"],
    },
    handler: async (args) => {
      try {
        const service = getMediaAcquisitionService();
        const job = service.queue.retryJob(String(args.jobId));
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  },
];
