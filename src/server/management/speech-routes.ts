// Phase 20.32 — Pao-hubPro × VoiceStudio Local AI Speech Runtime
// Management REST API routes (repo convention: /api/agent-os/speech/*).
// These are the safe Pao-hubPro-side endpoints (doc §13): no raw VoiceStudio
// proxying, no client-supplied upstream URLs, no credential exposure.
// All pathname guards are full literals (repo registry convention); entity ids
// travel in the JSON body, matching the Phase 20.29 automation surface.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSpeechService } from "../../agent-os/speech/service";
import { SpeechError } from "../../agent-os/speech/errors";
import { buildSpeechMcpConfig } from "../../agent-os/speech/mcp-config";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "SPEECH_INVALID_ARGUMENT", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "SPEECH_NOT_FOUND", message } }, 404, req, {});
}

function errorStatus(err: unknown): number {
  if (err instanceof SpeechError) {
    if (err.code === "SPEECH_JOB_NOT_FOUND" || err.code === "SPEECH_VOICE_NOT_FOUND") return 404;
    if (err.message.includes("invariant")) return 403;
    if (err.code === "SPEECH_INVALID_ARGUMENT" || err.code === "SPEECH_PATH_OUTSIDE_WORKSPACE") return 400;
  }
  return 422;
}

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  const code = match ? match[1] : "SPEECH_PROVIDER_ERROR";
  // SpeechError messages are sanitized upstream (no credentials, no bearer tokens).
  return jsonResponse({ ok: false, error: { code, message } }, errorStatus(err), req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleSpeechRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getSpeechService();

  // 1. GET /api/agent-os/speech/health
  if (req.method === "GET" && pathname === "/api/agent-os/speech/health") {
    const health = await service.health();
    return jsonResponse({ ok: true, provider: "speech", data: health }, 200, req, {});
  }

  // 2. GET /api/agent-os/speech/capabilities
  if (req.method === "GET" && pathname === "/api/agent-os/speech/capabilities") {
    const capabilities = await service.capabilities();
    return jsonResponse({ ok: true, provider: "speech", data: capabilities }, 200, req, {});
  }

  // 3. GET /api/agent-os/speech/diagnostics (redacted — never includes the API key)
  if (req.method === "GET" && pathname === "/api/agent-os/speech/diagnostics") {
    return jsonResponse({ ok: true, provider: "speech", data: service.diagnostics() }, 200, req, {});
  }

  // 4. GET /api/agent-os/speech/mcp-config (file mode enforced, redacted)
  if (req.method === "GET" && pathname === "/api/agent-os/speech/mcp-config") {
    try {
      return jsonResponse({ ok: true, provider: "speech", data: buildSpeechMcpConfig() }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. GET /api/agent-os/speech/voices
  if (req.method === "GET" && pathname === "/api/agent-os/speech/voices") {
    return jsonResponse({ ok: true, provider: "speech", data: { voices: service.listVoices() } }, 200, req, {});
  }

  // 6. POST /api/agent-os/speech/voices/sync — provider listing only; new
  //    entries land as "unreviewed" and are never auto-approved (doc §45).
  if (req.method === "POST" && pathname === "/api/agent-os/speech/voices/sync") {
    const body = await readJsonBody(req);
    try {
      const result = await service.syncProviderVoices(typeof body.requestedBy === "string" ? body.requestedBy : "dashboard");
      return jsonResponse({ ok: true, provider: "speech", data: result }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. POST /api/agent-os/speech/voices/approve-stock (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/voices/approve-stock") {
    const body = await readJsonBody(req);
    if (typeof body.voiceId !== "string") return badRequest(req, "Field 'voiceId' is required");
    try {
      const voice = service.approveVoiceForStock(body.voiceId, typeof body.actor === "string" ? body.actor : "dashboard", typeof body.reason === "string" ? body.reason : "");
      return jsonResponse({ ok: true, provider: "speech", data: { voice } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. POST /api/agent-os/speech/voices/block (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/voices/block") {
    const body = await readJsonBody(req);
    if (typeof body.voiceId !== "string") return badRequest(req, "Field 'voiceId' is required");
    try {
      const voice = service.blockVoice(body.voiceId, typeof body.actor === "string" ? body.actor : "dashboard", typeof body.reason === "string" ? body.reason : "");
      return jsonResponse({ ok: true, provider: "speech", data: { voice } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. POST /api/agent-os/speech/voices/policy-status (Generate-form chips; read-only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/voices/policy-status") {
    const body = await readJsonBody(req);
    if (typeof body.voiceId !== "string") return badRequest(req, "Field 'voiceId' is required");
    return jsonResponse({ ok: true, provider: "speech", data: service.voicePolicyStatus(body.voiceId) }, 200, req, {});
  }

  // 10. POST /api/agent-os/speech/synthesize
  if (req.method === "POST" && pathname === "/api/agent-os/speech/synthesize") {
    const body = await readJsonBody(req);
    if (typeof body.projectId !== "string" || typeof body.text !== "string" || typeof body.voiceId !== "string") {
      return badRequest(req, "Fields 'projectId', 'text' and 'voiceId' are required");
    }
    try {
      const job = await service.enqueueSynthesis({
        projectId: body.projectId,
        text: body.text,
        voiceId: body.voiceId,
        language: typeof body.language === "string" ? body.language : undefined,
        format: typeof body.format === "string" ? (body.format as "wav") : undefined,
        purpose: typeof body.purpose === "string" ? body.purpose : undefined,
        stockSafe: typeof body.stockSafe === "boolean" ? body.stockSafe : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      const terminal = await service.processJob(job.id);
      return jsonResponse({ ok: true, provider: "speech", data: { job: terminal } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. POST /api/agent-os/speech/transcribe
  if (req.method === "POST" && pathname === "/api/agent-os/speech/transcribe") {
    const body = await readJsonBody(req);
    if (typeof body.projectId !== "string" || typeof body.audioPath !== "string") {
      return badRequest(req, "Fields 'projectId' and 'audioPath' are required");
    }
    try {
      const job = await service.enqueueTranscription({
        projectId: body.projectId,
        audioPath: body.audioPath,
        language: typeof body.language === "string" ? body.language : undefined,
        responseFormat: typeof body.responseFormat === "string" ? (body.responseFormat as "json") : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      const terminal = await service.processJob(job.id);
      return jsonResponse({ ok: true, provider: "speech", data: { job: terminal } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. POST /api/agent-os/speech/clone
  if (req.method === "POST" && pathname === "/api/agent-os/speech/clone") {
    const body = await readJsonBody(req);
    if (typeof body.projectId !== "string" || typeof body.voiceName !== "string" || typeof body.referencePath !== "string" || typeof body.consentId !== "string") {
      return badRequest(req, "Fields 'projectId', 'voiceName', 'referencePath' and 'consentId' are required");
    }
    try {
      const job = await service.enqueueClone({
        projectId: body.projectId,
        voiceName: body.voiceName,
        referencePath: body.referencePath,
        consentId: body.consentId,
        language: typeof body.language === "string" ? body.language : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      const terminal = await service.processJob(job.id);
      return jsonResponse({ ok: true, provider: "speech", data: { job: terminal } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 13. POST /api/agent-os/speech/dub — feature-flagged; blocked while the
  //     upstream dubbing API is unstable (doc §19).
  if (req.method === "POST" && pathname === "/api/agent-os/speech/dub") {
    const body = await readJsonBody(req);
    if (typeof body.projectId !== "string") return badRequest(req, "Field 'projectId' is required");
    try {
      const job = await service.enqueueDubbing(body.projectId, typeof body.requestedBy === "string" ? body.requestedBy : "dashboard");
      const terminal = await service.processJob(job.id);
      return jsonResponse({ ok: true, provider: "speech", data: { job: terminal } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 14. GET /api/agent-os/speech/jobs
  if (req.method === "GET" && pathname === "/api/agent-os/speech/jobs") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
    return jsonResponse({ ok: true, provider: "speech", data: { jobs: service.listJobs(limit) } }, 200, req, {});
  }

  // 15. POST /api/agent-os/speech/jobs/detail
  if (req.method === "POST" && pathname === "/api/agent-os/speech/jobs/detail") {
    const body = await readJsonBody(req);
    if (typeof body.jobId !== "string") return badRequest(req, "Field 'jobId' is required");
    const record = service.getJobWithChecks(body.jobId);
    if (!record) return notFound(req, `Speech job not found: ${body.jobId}`);
    return jsonResponse({ ok: true, provider: "speech", data: record }, 200, req, {});
  }

  // 16. POST /api/agent-os/speech/jobs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/speech/jobs/cancel") {
    const body = await readJsonBody(req);
    if (typeof body.jobId !== "string") return badRequest(req, "Field 'jobId' is required");
    try {
      const job = await service.cancelJob(body.jobId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, provider: "speech", data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 17. POST /api/agent-os/speech/artifacts/detail
  if (req.method === "POST" && pathname === "/api/agent-os/speech/artifacts/detail") {
    const body = await readJsonBody(req);
    if (typeof body.artifactId !== "string") return badRequest(req, "Field 'artifactId' is required");
    const artifact = service.getArtifact(body.artifactId);
    if (!artifact) return notFound(req, `Speech artifact not found: ${body.artifactId}`);
    return jsonResponse({ ok: true, provider: "speech", data: { artifact } }, 200, req, {});
  }

  // 18. GET /api/agent-os/speech/licenses
  if (req.method === "GET" && pathname === "/api/agent-os/speech/licenses") {
    return jsonResponse({ ok: true, provider: "speech", data: { licenses: service.listLicenses() } }, 200, req, {});
  }

  // 19. POST /api/agent-os/speech/licenses (register a record; human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/licenses") {
    const body = await readJsonBody(req);
    if (typeof body.provider !== "string" || typeof body.engine !== "string" || typeof body.modelId !== "string") {
      return badRequest(req, "Fields 'provider', 'engine' and 'modelId' are required");
    }
    try {
      const license = service.registerLicense({
        provider: body.provider,
        engine: body.engine,
        modelId: body.modelId,
        modelVersion: typeof body.modelVersion === "string" ? body.modelVersion : null,
        codeLicense: typeof body.codeLicense === "string" ? body.codeLicense : null,
        weightsLicense: typeof body.weightsLicense === "string" ? body.weightsLicense : null,
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      }, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, provider: "speech", data: { license } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 20. POST /api/agent-os/speech/licenses/review (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/licenses/review") {
    const body = await readJsonBody(req);
    if (typeof body.licenseId !== "string") return badRequest(req, "Field 'licenseId' is required");
    const status = body.status;
    if (status !== "approved" && status !== "blocked" && status !== "review_required" && status !== "unknown") {
      return badRequest(req, "Field 'status' must be approved | blocked | review_required | unknown");
    }
    try {
      const license = service.reviewLicense(body.licenseId, {
        status,
        commercialUse: body.commercialUse === true,
        stockUse: body.stockUse === true,
        attributionRequired: body.attributionRequired === true,
      }, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, provider: "speech", data: { license } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 21. GET /api/agent-os/speech/consents
  if (req.method === "GET" && pathname === "/api/agent-os/speech/consents") {
    return jsonResponse({ ok: true, provider: "speech", data: { consents: service.listConsents() } }, 200, req, {});
  }

  // 22. POST /api/agent-os/speech/consents (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/consents") {
    const body = await readJsonBody(req);
    if (typeof body.consentBasis !== "string" || typeof body.subjectType !== "string" || typeof body.subjectAlias !== "string") {
      return badRequest(req, "Fields 'subjectType', 'subjectAlias' and 'consentBasis' are required");
    }
    try {
      const consent = service.registerConsent({
        voiceId: typeof body.voiceId === "string" ? body.voiceId : null,
        subjectType: body.subjectType,
        subjectAlias: body.subjectAlias,
        consentBasis: body.consentBasis,
        consentDocumentRef: typeof body.consentDocumentRef === "string" ? body.consentDocumentRef : null,
        allowedUses: Array.isArray(body.allowedUses) ? (body.allowedUses as string[]) : [],
        commercialUseAllowed: body.commercialUseAllowed === true,
        stockUseAllowed: body.stockUseAllowed === true,
        voiceCloneAllowed: body.voiceCloneAllowed === true,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
      }, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, provider: "speech", data: { consent } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 23. POST /api/agent-os/speech/consents/revoke (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/speech/consents/revoke") {
    const body = await readJsonBody(req);
    if (typeof body.consentId !== "string") return badRequest(req, "Field 'consentId' is required");
    try {
      service.revokeConsent(body.consentId, typeof body.actor === "string" ? body.actor : "dashboard", typeof body.reason === "string" ? body.reason : "");
      return jsonResponse({ ok: true, provider: "speech", data: { revoked: true } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 24. GET /api/agent-os/speech/audit
  if (req.method === "GET" && pathname === "/api/agent-os/speech/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
    return jsonResponse({ ok: true, provider: "speech", data: { entries: service.listAudit(limit) } }, 200, req, {});
  }

  return null;
}
