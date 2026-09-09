// Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
// REST Management API Endpoints
// Accessible via /api/agent-os/video-intelligence/* and /api/video/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getVideoJobManager,
  type VideoJobConfig,
} from "../../agent-os/video-intelligence";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleVideoIntelligenceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agent-os/video-intelligence/")) {
    path = url.pathname.slice("/api/agent-os/video-intelligence/".length);
  } else if (url.pathname === "/api/agent-os/video-intelligence") {
    path = "";
  } else if (url.pathname.startsWith("/api/video/")) {
    path = url.pathname.slice("/api/video/".length);
  } else if (url.pathname === "/api/video") {
    path = "";
  } else {
    return null;
  }

  const manager = getVideoJobManager();

  // 1. POST /jobs and GET /jobs
  if (path === "jobs" || path === "jobs/" || path === "") {
    if (req.method === "GET") {
      const intent = url.searchParams.get("intent") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? parseInt(limitRaw, 10) : 50;

      const jobs = manager.listJobs({ intent, status, limit });
      return jsonResponse({ jobs }, 200, req, {});
    }

    if (req.method === "POST") {
      try {
        const body = (await req.json()) as {
          source?: string;
          config?: VideoJobConfig;
          intent?: VideoJobConfig["intent"];
          sampling?: VideoJobConfig["sampling"];
          localOnly?: boolean;
          enableHookMicroscope?: boolean;
        };

        if (!body.source) {
          return badRequest(req, "Field 'source' (video URL or local file path) is required.");
        }

        const config: VideoJobConfig = {
          intent: body.intent ?? body.config?.intent ?? "general",
          sampling: body.sampling ?? body.config?.sampling ?? "auto",
          localOnly: body.localOnly ?? body.config?.localOnly ?? false,
          enableHookMicroscope: body.enableHookMicroscope ?? body.config?.enableHookMicroscope ?? true,
          ...body.config,
        };

        const job = await manager.submitJob(body.source, config);
        return jsonResponse({ job }, 201, req, {});
      } catch (err) {
        return badRequest(req, (err as Error).message);
      }
    }

    return badRequest(req, `Method ${req.method} not allowed for /jobs.`);
  }

  // Subpaths under /jobs/:id/...
  if (path.startsWith("jobs/")) {
    const parts = path.slice("jobs/".length).split("/");
    const jobId = parts[0];
    const sub = parts[1] || "";

    const job = manager.getJob(jobId);
    if (!job) {
      return notFound(req, `Video job '${jobId}' not found.`);
    }

    // GET /jobs/:id
    if (sub === "") {
      if (req.method === "GET") {
        return jsonResponse({ job }, 200, req, {});
      }
      return badRequest(req, `Method ${req.method} not allowed for /jobs/:id.`);
    }

    // POST /jobs/:id/cancel
    if (sub === "cancel") {
      if (req.method === "POST") {
        const success = manager.cancelJob(jobId);
        return jsonResponse({ success, job: manager.getJob(jobId) }, 200, req, {});
      }
      return badRequest(req, `Method ${req.method} not allowed for cancel.`);
    }

    // GET /jobs/:id/report
    if (sub === "report") {
      if (req.method === "GET") {
        if (!job.report) {
          return jsonResponse({ message: "Report not yet generated.", status: job.status }, 202, req, {});
        }
        return jsonResponse({ report: job.report, markdown: job.report.markdownReport }, 200, req, {});
      }
      return badRequest(req, `Method ${req.method} not allowed for report.`);
    }

    // GET /jobs/:id/frames
    if (sub === "frames") {
      if (req.method === "GET") {
        return jsonResponse(
          {
            scenes: job.report?.scenes ?? [],
            heroFrames: job.report?.heroFrames ?? [],
          },
          200,
          req,
          {}
        );
      }
      return badRequest(req, `Method ${req.method} not allowed for frames.`);
    }

    // GET /jobs/:id/transcript
    if (sub === "transcript") {
      if (req.method === "GET") {
        return jsonResponse({ transcript: job.report?.transcript ?? null }, 200, req, {});
      }
      return badRequest(req, `Method ${req.method} not allowed for transcript.`);
    }
  }

  return notFound(req, `Video Intelligence endpoint '/${path}' not found.`);
}
