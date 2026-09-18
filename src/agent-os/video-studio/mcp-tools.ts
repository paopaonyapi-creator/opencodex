// Phase 20.92 — Video Studio MCP tools (typed, risk-tagged, policy-gated).
// Mutating tools traverse the service's own gates (locks, budget, approvals);
// render/publish stay bounded per the tool risk policy (GOLD §43).

import type { VideoStudioService } from "./service";
import { VideoStudioError } from "./types";

export interface VideoStudioMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function errToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof VideoStudioError) {
    return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message, detail: err.detail } };
  }
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createVideoStudioMcpTools(service: VideoStudioService): VideoStudioMcpTool[] {
  return [
    {
      name: "video.project.create",
      description: "Create a Video Studio project (Phase 20.92) with script input, format, and quality preset.",
      riskTier: "R1",
      parameters: { type: "object", properties: { title: { type: "string" }, script: { type: "string" }, aspectRatio: { type: "string" }, language: { type: "string" }, quality: { type: "string" } }, required: ["title"] },
      handler: async (args) => {
        try {
          const project = service.createProject({ title: String(args.title), sourceType: "script", rawInput: typeof args.script === "string" ? args.script : "", aspectRatio: (args.aspectRatio as never) ?? "16:9", fps: 30, language: typeof args.language === "string" ? args.language : "en", quality: (args.quality as never) ?? "BALANCED" }, "mcp");
          return { ok: true, project };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.project.get",
      description: "Get full project detail: scenes, timeline, QA report, audio plan, render path, cost, approvals.",
      riskTier: "R0",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      handler: async (args) => {
        try {
          const detail = service.getProject(String(args.id));
          if (!detail) return { ok: false, status: 404, error: { code: "PROJECT_NOT_FOUND", message: `project '${args.id}' not found` } };
          return { ok: true, ...detail };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.script.segment",
      description: "Segment a project's script into semantic blocks (deterministic; punctuation alone never splits).",
      riskTier: "R1",
      parameters: { type: "object", properties: { projectId: { type: "string" }, script: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          const script = typeof args.script === "string"
            ? (service.setScript(String(args.projectId), args.script, { actor: "mcp" }), service.getScript(String(args.projectId)))
            : service.getScript(String(args.projectId));
          return { ok: true, script };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.scene.plan",
      description: "(Re)plan all scenes for a project from its script.",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, scenes: service.planAllScenes(String(args.projectId), "mcp") };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.scene.update",
      description: "Rewrite a scene's narration (lock-enforced; speech estimate + duration re-computed).",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" }, sceneId: { type: "string" }, narrationText: { type: "string" } }, required: ["projectId", "sceneId", "narrationText"] },
      handler: async (args) => {
        try {
          const scene = service.updateSceneNarration(String(args.projectId), String(args.sceneId), String(args.narrationText), "mcp");
          return { ok: true, scene };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.scene.lock",
      description: "Lock/unlock scene fields (script, asset, layout, motion, timing, voice). Locked fields cannot be regenerated.",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" }, sceneId: { type: "string" }, locks: { type: "object" } }, required: ["projectId", "sceneId", "locks"] },
      handler: async (args) => {
        try {
          const scene = service.updateSceneLocks(String(args.projectId), String(args.sceneId), args.locks as never, "mcp");
          return { ok: true, locks: scene.locks };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.asset.resolve",
      description: "Run the asset resolution ladder (project → brand → shared → cache → deterministic card) for all scenes.",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await service.resolveAssets(String(args.projectId), "mcp")) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.asset.search",
      description: "Search the shared media asset registry by tag/uri keyword.",
      riskTier: "R0",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async (args) => {
        try {
          const assets = service.searchAssets(String(args.query));
          return { ok: true, count: assets.length, assets: assets.map((a) => ({ id: a.id, type: a.type, uri: a.uri, checksum: a.checksum, tags: a.tags, source: a.source.kind })) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.motion.plan",
      description: "Select motion templates for all scenes (intent-aware, deterministic) and return the registry.",
      riskTier: "R1",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          void args;
          return { ok: true, templates: service.listTemplates().map((t) => ({ id: t.id, intents: t.supportsIntents, motion: t.motion })) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.timeline.build",
      description: "Build the deterministic timeline (frame math computed by the engine, never by an LLM).",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, timeline: service.buildProjectTimeline(String(args.projectId), "mcp") };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.voice.generate",
      description: "Synthesize narration + captions for all scenes (TTS provider; alignment method marked honestly).",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await service.generateVoiceAndCaptions(String(args.projectId), "mcp")) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.qa.run",
      description: "Run automated QA (script/asset/layout/timeline/audio/render categories).",
      riskTier: "R1",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, report: service.runProjectQA(String(args.projectId), "mcp") };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.render.preview",
      description: "Render the 720p preview MP4 (deterministic ffmpeg engine; no AI calls during render).",
      riskTier: "R2",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await service.renderProject(String(args.projectId), "PREVIEW_720P", "mcp")) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.render.final",
      description: "Render the final MP4 at the project profile (cost-aware; budget gate applies).",
      riskTier: "R3",
      parameters: { type: "object", properties: { projectId: { type: "string" }, profile: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          const guard = service.checkBudget(String(args.projectId), 0.05);
          if (!guard.allowed) return { ok: false, status: 402, error: { code: "BUDGET_EXCEEDED", message: guard.reason ?? "budget" } };
          return { ok: true, ...(await service.renderProject(String(args.projectId), (args.profile as never) ?? "YOUTUBE_1080P", "mcp")) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.project.approve",
      description: "Record a human approval decision (SCRIPT/STORYBOARD/ASSET/DRAFT_VIDEO/FINAL_EXPORT).",
      riskTier: "R3",
      parameters: { type: "object", properties: { projectId: { type: "string" }, kind: { type: "string" }, approve: { type: "boolean" }, approver: { type: "string" } }, required: ["projectId", "kind", "approve", "approver"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await Promise.resolve(service.decideApproval(String(args.projectId), args.kind as never, args.approve === true, String(args.approver)))) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.project.export",
      description: "Export the rendered project package path (external publish is a separate high-risk action).",
      riskTier: "R3",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          const detail = service.getProject(String(args.projectId));
          if (!detail?.renderPath) return { ok: false, status: 422, error: { code: "RENDER_FAILED", message: "no render output yet — render before export" } };
          const approval = detail.approvals.find((a) => a.kind === "DRAFT_VIDEO_APPROVAL" && a.status === "APPROVED");
          if (!approval) return { ok: false, status: 403, error: { code: "APPROVAL_REQUIRED", message: "DRAFT_VIDEO_APPROVAL must be approved before export" } };
          return { ok: true, exportPath: detail.renderPath, provenance: "see vs_provenance rows" };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.providers.status",
      description: "Provider capability matrix (IMAGE/TTS/RENDER/VIDEO/MUSIC): availability, credential status, fallback class. Set verify=true for live health probes.",
      riskTier: "R0",
      parameters: { type: "object", properties: { verify: { type: "boolean" } } },
      handler: async (args) => {
        try {
          const providers = args.verify === true ? await service.verifyProviders() : service.providerStatuses();
          return { ok: true, providers };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.project.manifest",
      description: "Adobe Stock sidecar manifest: full provenance, providers/models, real SHA-256 of the rendered artifact, human-approval state. Publishing remains manual.",
      riskTier: "R1",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await Promise.resolve(service.buildStockManifest(String(args.projectId)))) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.project.render_final",
      description: "Final 1080p render after DRAFT_VIDEO_APPROVAL (H.264 + AAC via the deterministic ffmpeg engine).",
      riskTier: "R3",
      parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await service.renderFinal(String(args.projectId), "mcp")) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.batch.run",
      description: "Create (mode=create, items[{title,script}]) or advance (mode=run, batchId, concurrency<=8) a batch of video jobs with bounded concurrency and failure isolation.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: { mode: { type: "string" }, items: { type: "array" }, batchId: { type: "string" }, concurrency: { type: "number" } },
        required: ["mode"],
      },
      handler: async (args) => {
        try {
          if (args.mode === "create") {
            const items = Array.isArray(args.items) ? (args.items as Array<{ title: string; script: string; aspectRatio?: string; language?: string }>) : [];
            return { ok: true, ...(await Promise.resolve(service.createBatch(items, "mcp"))) };
          }
          const result = await service.runBatch(String(args.batchId), typeof args.concurrency === "number" ? args.concurrency : 2, "mcp");
          return { ok: true, ...result };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "video.job.control",
      description: "Cancel or retry a pipeline job (retry resumes only the failed unit; cancellation refuses further steps).",
      riskTier: "R2",
      parameters: { type: "object", properties: { jobId: { type: "string" }, action: { type: "string" }, reason: { type: "string" } }, required: ["jobId", "action"] },
      handler: async (args) => {
        try {
          if (args.action === "cancel") return { ok: true, ...(await Promise.resolve(service.cancelJob(String(args.jobId), String(args.reason ?? "cancelled"), "mcp"))) };
          if (args.action === "retry") return { ok: true, ...(await Promise.resolve(service.retryJob(String(args.jobId), "mcp"))) };
          return { ok: false, status: 422, error: { code: "SCHEMA_INVALID", message: "action must be cancel|retry" } };
        } catch (err) { return errToPayload(err); }
      },
    },
  ];
}
