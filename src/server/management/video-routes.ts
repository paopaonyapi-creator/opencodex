// Phase 20.7 — Pao AI Video Factory Management API Routes

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getVideoJobQueue,
  SmartProductionRouter,
  getVideoProviderRegistry,
  TechnicalVideoQcEngine,
  VideoSimilarityGate,
  ReviewerCouncilGate,
  VideoExportPackageBuilder,
  evaluateStockFootageRights,
  syncVideoFactoryKnowledge,
  buildMptTaskManifest,
  type VideoProductionRequest,
} from "../../agent-os/video";
import { openAgentOsDb } from "../../agent-os/db";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleVideoRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/video/")) {
    path = url.pathname.slice("/api/video/".length);
  } else if (url.pathname === "/api/video") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/video/")) {
    path = url.pathname.slice("/api/agent-os/video/".length);
  } else if (url.pathname === "/api/agent-os/video") {
    path = "";
  } else {
    return null;
  }

  const queue = getVideoJobQueue();

  // 1. Providers & Health
  if (path === "providers" && req.method === "GET") {
    const registry = getVideoProviderRegistry();
    const capabilities = await registry.listCapabilities();
    return jsonResponse({ success: true, providers: capabilities }, 200, req, {});
  }

  if (path === "health" && req.method === "GET") {
    const registry = getVideoProviderRegistry();
    const health = await registry.runAllHealthChecks();
    return jsonResponse({ success: true, health }, 200, req, {});
  }

  // 2. Routing & Estimation
  if (path === "route" && req.method === "POST") {
    try {
      const body = (await req.json()) as VideoProductionRequest;
      const router = new SmartProductionRouter();
      const route = await router.route(body);
      return jsonResponse({ success: true, route }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message || "Failed to calculate route");
    }
  }

  if (path === "estimate" && req.method === "POST") {
    try {
      const body = (await req.json()) as VideoProductionRequest;
      const router = new SmartProductionRouter();
      const route = await router.route(body);
      const adapter = getVideoProviderRegistry().getAdapter(route.selectedProvider);
      if (!adapter) return badRequest(req, `Adapter for ${route.selectedProvider} not found`);
      const estimate = await adapter.estimate(body);
      return jsonResponse({ success: true, provider: route.selectedProvider, estimate }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message || "Failed to estimate cost");
    }
  }

  // 3. Jobs Management
  if (path === "jobs" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const mode = url.searchParams.get("mode") || undefined;
    const jobs = queue.listJobs(limit, mode);
    return jsonResponse({ success: true, jobs }, 200, req, {});
  }

  if (path === "jobs" && req.method === "POST") {
    try {
      const body = (await req.json()) as VideoProductionRequest;
      const job = await queue.createJob(body);
      return jsonResponse({ success: true, job }, 201, req, {});
    } catch (e: any) {
      return badRequest(req, e.message || "Failed to create video job");
    }
  }

  // Specific job sub-actions: /jobs/:id/...
  if (path.startsWith("jobs/")) {
    const parts = path.slice("jobs/".length).split("/");
    const jobId = parts[0];
    const subAction = parts[1];

    if (!subAction && req.method === "GET") {
      const job = queue.getJob(jobId);
      if (!job) return notFound(req, `Job ${jobId} not found`);

      const db = openAgentOsDb();
      const artifacts = db
        .query("SELECT * FROM video_production_artifacts WHERE job_id = ? ORDER BY created_at DESC")
        .all(jobId);
      const qc = db
        .query("SELECT * FROM video_technical_qc WHERE job_id = ? ORDER BY inspected_at DESC LIMIT 1")
        .get(jobId);
      const council = db
        .query("SELECT * FROM video_reviewer_council WHERE job_id = ? ORDER BY evaluated_at DESC LIMIT 1")
        .get(jobId);
      const pkg = db
        .query("SELECT * FROM video_export_packages WHERE job_id = ? ORDER BY exported_at DESC LIMIT 1")
        .get(jobId);

      return jsonResponse(
        {
          success: true,
          job,
          artifacts,
          technicalQc: qc,
          councilReview: council,
          exportPackage: pkg,
        },
        200,
        req,
        {},
      );
    }

    if (subAction === "cancel" && req.method === "POST") {
      try {
        const job = queue.cancelJob(jobId);
        return jsonResponse({ success: true, job }, 200, req, {});
      } catch (e: any) {
        return badRequest(req, e.message);
      }
    }

    if (subAction === "approve-cost" && req.method === "POST") {
      try {
        const job = queue.approveCost(jobId);
        return jsonResponse({ success: true, job }, 200, req, {});
      } catch (e: any) {
        return badRequest(req, e.message);
      }
    }

    if (subAction === "run" && req.method === "POST") {
      try {
        const result = await queue.runJobPipeline(jobId);
        return jsonResponse({ success: true, ...result }, 200, req, {});
      } catch (e: any) {
        return badRequest(req, e.message);
      }
    }
  }

  // 4. QC & Reviewer Council
  if (path === "qc/technical" && req.method === "POST") {
    try {
      const body = (await req.json()) as { jobId: string; options?: any };
      const job = queue.getJob(body.jobId);
      if (!job) return notFound(req, `Job ${body.jobId} not found`);

      const db = openAgentOsDb();
      const artRow = db
        .query("SELECT * FROM video_production_artifacts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(job.id) as any;

      const artifact = artRow || {
        id: "art-simulated",
        jobId: job.id,
        durationMs: (job.targetDurationSeconds || 8) * 1000,
        fps: 30,
        fileSizeBytes: 10485760,
        containerFormat: "mp4",
        videoCodec: "h264",
      };

      const engine = new TechnicalVideoQcEngine();
      const qc = engine.runQC(job, artifact, body.options);
      return jsonResponse({ success: true, qc }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  if (path.startsWith("qc/technical/") && req.method === "GET") {
    const jobId = path.slice("qc/technical/".length);
    const engine = new TechnicalVideoQcEngine();
    const qc = engine.getQCResultForJob(jobId);
    return jsonResponse({ success: true, qc }, 200, req, {});
  }

  if (path === "qc/similarity" && req.method === "POST") {
    try {
      const body = (await req.json()) as { jobId: string };
      const job = queue.getJob(body.jobId);
      if (!job) return notFound(req, `Job ${body.jobId} not found`);

      const gate = new VideoSimilarityGate();
      const similarity = gate.evaluateJob(job);
      return jsonResponse({ success: true, similarity }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  if (path === "qc/council" && req.method === "POST") {
    try {
      const body = (await req.json()) as { jobId: string };
      const job = queue.getJob(body.jobId);
      if (!job) return notFound(req, `Job ${body.jobId} not found`);

      const engine = new TechnicalVideoQcEngine();
      const qc = engine.getQCResultForJob(job.id) || undefined;

      const council = new ReviewerCouncilGate();
      const result = council.evaluate(job, undefined, qc);
      return jsonResponse({ success: true, council: result }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  if (path.startsWith("qc/council/") && req.method === "GET") {
    const jobId = path.slice("qc/council/".length);
    const council = new ReviewerCouncilGate();
    const result = council.getCouncilEvaluation(jobId);
    return jsonResponse({ success: true, council: result }, 200, req, {});
  }

  if (path.startsWith("qc/council/") && path.endsWith("/approve") && req.method === "POST") {
    const councilId = path.slice("qc/council/".length, -"/approve".length);
    try {
      const body = ((await req.json().catch(() => ({}))) || {}) as { approvedBy?: string };
      const council = new ReviewerCouncilGate();
      const result = council.approveHumanReview(councilId, body.approvedBy || "operator");
      return jsonResponse({ success: true, council: result }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  // 5. Policies & Rights
  if (path === "policy/rights" && req.method === "POST") {
    try {
      const body = (await req.json()) as { source: string; license?: string; redistributionPermitted?: boolean };
      const rights = evaluateStockFootageRights(body.source, body.license, body.redistributionPermitted);
      return jsonResponse({ success: true, rights }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  // 6. Export Package
  if (path === "export" && req.method === "POST") {
    try {
      const body = (await req.json()) as { jobId: string; options?: any };
      const builder = new VideoExportPackageBuilder();
      const pkg = builder.buildPackage(body.jobId, body.options);
      return jsonResponse({ success: true, package: pkg }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  if (path.startsWith("export/") && req.method === "GET") {
    const jobId = path.slice("export/".length);
    const builder = new VideoExportPackageBuilder();
    const pkg = builder.getPackageForJob(jobId);
    return jsonResponse({ success: true, package: pkg }, 200, req, {});
  }

  // 7. Resume & Maintenance
  if (path === "resume" && req.method === "POST") {
    const result = queue.resumeIncompleteJobs();
    return jsonResponse({ success: true, ...result }, 200, req, {});
  }

  if (path === "sync-knowledge" && req.method === "POST") {
    const result = syncVideoFactoryKnowledge();
    return jsonResponse({ success: true, ...result }, 200, req, {});
  }

  if (path === "manifest/mpt" && req.method === "POST") {
    try {
      const body = (await req.json()) as VideoProductionRequest;
      const manifest = buildMptTaskManifest(body);
      return jsonResponse({ success: true, manifest }, 200, req, {});
    } catch (e: any) {
      return badRequest(req, e.message);
    }
  }

  return null;
}
