// Phase 20.6 — MiniMax H3 Image Studio Management API Routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  listWorkflows,
  getWorkflow,
  listPresets,
  resolvePreset,
  listModels,
  validateModelStack,
  createH3Job,
  getH3Job,
  listH3Jobs,
  cancelH3Job,
  estimateH3Job,
  getCandidates,
  selectCandidate,
  routeDetailRefinement,
  evaluateStockQC,
  getStockQC,
  recordProvenance,
  getProvenance,
  exportAssetPackage,
  getH3KnownIssues,
  syncH3RunToKnowledgeBrain,
  recordH3ArchitectureDecision,
  H3ProviderAdapter,
  generateCandidatePacket,
  updateH3JobStatus,
  canRunInStockMode,
} from "../../agent-os/generation/minimax-h3";
import type {
  H3Mode,
  H3Preset,
  H3JobInput,
  RefinementOptions,
} from "../../agent-os/generation/minimax-h3";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleH3Routes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/h3/")) {
    path = url.pathname.slice("/api/h3/".length);
  } else if (url.pathname === "/api/h3") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/h3/")) {
    path = url.pathname.slice("/api/agent-os/h3/".length);
  } else if (url.pathname === "/api/agent-os/h3") {
    path = "";
  } else {
    return null;
  }

  // 1. Workflows
  if (path === "workflows" && req.method === "GET") {
    const mode = url.searchParams.get("mode") as H3Mode | null;
    const stockSafeOnly = url.searchParams.get("stockSafeOnly") === "true";
    return jsonResponse(listWorkflows({ mode: mode ?? undefined, stockSafeOnly }), 200, req, {});
  }

  // 2. Presets
  if (path === "presets" && req.method === "GET") {
    const mode = url.searchParams.get("mode") as H3Mode | null;
    const stockSafeOnly = url.searchParams.get("stockSafeOnly") === "true";
    return jsonResponse(listPresets({ mode: mode ?? undefined, stockSafeOnly }), 200, req, {});
  }

  // 3. Models
  if (path === "models" && req.method === "GET") {
    const category = url.searchParams.get("category") ?? undefined;
    const stockOnly = url.searchParams.get("stockOnly") === "true";
    return jsonResponse(listModels({ category, stockOnly }), 200, req, {});
  }

  // 4. Validate Model Stack
  if (path === "validate" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as {
      workflowId?: string;
      modelKeys?: string[];
    };
    let keys = body.modelKeys;
    if (!keys && body.workflowId) {
      const wf = getWorkflow(body.workflowId);
      keys = wf?.modelStack;
    }
    return jsonResponse(validateModelStack(keys ?? ["minimax_h3_diffusion", "t5_text_encoder", "video_vae"]), 200, req, {});
  }

  // 5. Estimate Job
  if (path === "estimate" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as H3JobInput;
    return jsonResponse(estimateH3Job(body), 200, req, {});
  }

  // 6. Create Job / List Jobs
  if (path === "jobs") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") as any;
      const limit = Number(url.searchParams.get("limit") || 50);
      return jsonResponse(listH3Jobs({ status: status ?? undefined, limit }), 200, req, {});
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as H3JobInput;
      if (!body.prompt && !body.structuredPrompt?.subject) {
        return badRequest(req, "Prompt or structuredPrompt is required to create an H3 job.");
      }
      const job = createH3Job(body);
      return jsonResponse(job, 201, req, {});
    }
  }

  // Known issues
  if (path === "known-issues" && req.method === "GET") {
    return jsonResponse(getH3KnownIssues(), 200, req, {});
  }

  // Knowledge sync
  if (path === "sync-knowledge" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { jobId?: string };
    recordH3ArchitectureDecision();
    if (body.jobId) {
      return jsonResponse(syncH3RunToKnowledgeBrain(body.jobId), 200, req, {});
    }
    return jsonResponse({ synced: true, message: "H3 architecture decision and base entities recorded in Knowledge Brain." }, 200, req, {});
  }

  // Job specific routes: jobs/:id/...
  if (path.startsWith("jobs/")) {
    const parts = path.slice("jobs/".length).split("/");
    const jobId = parts[0];
    const sub = parts[1];

    if (!jobId) return badRequest(req, "Job ID missing.");
    const job = getH3Job(jobId);
    if (!job) return notFound(req, `Job '${jobId}' not found.`);

    // GET /jobs/:id
    if (!sub && req.method === "GET") {
      const candidates = getCandidates(jobId);
      const qc = getStockQC(jobId);
      const provenance = getProvenance(jobId);
      return jsonResponse({ job, candidates, qc, provenance }, 200, req, {});
    }

    // POST /jobs/:id/run
    if (sub === "run" && req.method === "POST") {
      // License pre-check
      if (job.stockMode) {
        const check = canRunInStockMode(job.mode === "reference_edit" ? "H3_REFERENCE_EDIT" : "H3_T2I");
        if (!check.allowed) {
          updateH3JobStatus(jobId, "BLOCKED_LICENSE", { errorMessage: check.reason });
          return jsonResponse({ error: { code: "license_blocked", message: check.reason } }, 403, req, {});
        }
      }

      updateH3JobStatus(jobId, "RUNNING", { stage: "generating", progress: 0.3 });

      const adapter = new H3ProviderAdapter();
      const execResult = await adapter.execute(job);
      if (!execResult.success) {
        updateH3JobStatus(jobId, "FAILED", { errorMessage: execResult.error });
        return jsonResponse({ error: { code: "execution_failed", message: execResult.error } }, 500, req, {});
      }

      const candidates = generateCandidatePacket(job.id, job.frameProfile ?? 5);
      const recommended = candidates.find((c) => c.isRecommended) ?? candidates[0];

      let outputImagePath = recommended.imagePath;

      if (job.detailRefine) {
        const refineResult = await routeDetailRefinement(job.id, outputImagePath, {
          defectTarget: "general",
          toneLock: true,
        });
        outputImagePath = refineResult.refinedImagePath;
      }

      if (job.stockMode) {
        evaluateStockQC(job.id);
      }

      recordProvenance({
        jobId: job.id,
        assetPath: outputImagePath,
      });

      const finalStatus = job.stockMode ? "REVIEW_REQUIRED" : "COMPLETED";
      const updated = updateH3JobStatus(job.id, finalStatus, {
        stage: job.stockMode ? "review_required" : "selecting_output",
        progress: 1.0,
        selectedCandidateIndex: recommended.candidateIndex,
        outputImagePath,
      });

      return jsonResponse({
        success: true,
        job: updated,
        candidates,
        outputImagePath,
      }, 200, req, {});
    }

    // POST /jobs/:id/cancel
    if (sub === "cancel" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { reason?: string };
      const canceled = cancelH3Job(jobId, body.reason);
      return jsonResponse(canceled, 200, req, {});
    }

    // GET /jobs/:id/candidates
    if (sub === "candidates" && req.method === "GET") {
      return jsonResponse(getCandidates(jobId), 200, req, {});
    }

    // POST /jobs/:id/select-candidate
    if (sub === "select-candidate" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { candidateIndex: number };
      if (typeof body.candidateIndex !== "number") {
        return badRequest(req, "candidateIndex number required.");
      }
      const res = selectCandidate(jobId, body.candidateIndex);
      return jsonResponse(res, 200, req, {});
    }

    // POST /jobs/:id/refine
    if (sub === "refine" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as RefinementOptions & { imagePath?: string };
      const imagePath = job.outputImagePath || body.imagePath;
      if (!imagePath) {
        return badRequest(req, "No image available to refine on job.");
      }
      const res = await routeDetailRefinement(jobId, imagePath, {
        defectTarget: body.defectTarget ?? "general",
        refinePrompt: body.refinePrompt,
        toneLock: body.toneLock !== false,
      });
      return jsonResponse(res, 200, req, {});
    }

    // POST /jobs/:id/stock-qc
    if (sub === "stock-qc" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        logoCheckPassed?: boolean;
        textCheckPassed?: boolean;
        anatomyCheckPassed?: boolean;
        ipCheckPassed?: boolean;
        reviewerNotes?: string;
        reviewedBy?: string;
      };
      const res = evaluateStockQC(jobId, body);
      return jsonResponse(res, 200, req, {});
    }

    // GET /jobs/:id/provenance
    if (sub === "provenance" && req.method === "GET") {
      const prov = getProvenance(jobId);
      if (!prov) return notFound(req, "Provenance record not found.");
      return jsonResponse(prov, 200, req, {});
    }

    // POST /jobs/:id/export
    if (sub === "export" && req.method === "POST") {
      const res = exportAssetPackage(jobId);
      if (!res.exportAllowed) {
        return jsonResponse({ error: { code: "export_blocked", message: res.blockedReason } }, 403, req, {});
      }
      return jsonResponse(res, 200, req, {});
    }
  }

  // Asset provenance / export shortcuts
  if (path.startsWith("assets/")) {
    const parts = path.slice("assets/".length).split("/");
    const assetId = parts[0];
    const sub = parts[1];

    if (sub === "provenance" && req.method === "GET") {
      const prov = getProvenance(assetId);
      if (!prov) return notFound(req, "Provenance not found for asset.");
      return jsonResponse(prov, 200, req, {});
    }

    if (sub === "export" && req.method === "POST") {
      const res = exportAssetPackage(assetId);
      if (!res.exportAllowed) {
        return jsonResponse({ error: { code: "export_blocked", message: res.blockedReason } }, 403, req, {});
      }
      return jsonResponse(res, 200, req, {});
    }
  }

  return null;
}
