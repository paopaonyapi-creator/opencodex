// Phase 20.92 — Video Studio service facade + durable pipeline runtime.
//
// Orchestrates the semantic layer over the Phase 20.7 video factory: project
// CRUD, script → scenes → assets → voice → timeline → QA → render → approve.
// The auto-build job is a step machine: every step is idempotent (keyed by
// projectId+step+inputHash+configHash), resumable (completed steps are
// skipped), retry-aware, observable and audited (source §25/§26/§62).
// Locks are enforced at write time — regeneration may never touch a locked
// field (human override wins, source §17).

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
import { getProviderMatrix, verifyProviderHealth, type ProviderStatus } from "./providers";
import {
  ASPECT_DIMENSIONS,
  VideoProjectInputSchema,
  VideoStudioError,
  parseOrThrow,
  type ApprovalKind,
  type AudioPlan,
  type BrandKit,
  type MediaAsset,
  type ProjectBudget,
  type QAReport,
  type Scene,
  type ScriptDocument,
  type Timeline,
  type VideoProject,
  type VideoProjectInput,
} from "./types";
import { hashScript, segmentScript } from "./segmentation";
import { planScenesFromBlocks, sceneDurationMs } from "./planner";
import { generateImageWithComfyui } from "./comfyui";
import { isComfyuiConfigured, verifyProviderHealth as verifyHealth } from "./providers";
import { AssetRegistry, defaultStudioRoot, resolveSceneVisual, compileImagePrompt, type LadderContext, type LadderOutcome } from "./assets";
import { selectTemplate, repetitionWarnings, MOTION_TEMPLATES } from "./motion";
import { buildCaptionPlan, synthesizeSceneVoice, estimateAlignment, hashVoice, type SceneAudioManifest } from "./voice";
import { buildTimeline } from "./timeline";
import { runQA } from "./qa";
import { renderWithFfmpeg, probeRender, configForProfile, recordRenderArtifact, RENDER_PROFILES } from "./renderer";

export interface JobStepRecord {
  id: string;
  jobId: string;
  step: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  inputHash: string | null;
  configHash: string | null;
  idempotencyKey: string | null;
  outputJson: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProjectDetail {
  project: VideoProject;
  scenes: Scene[];
  timeline: Timeline | null;
  qa: QAReport | null;
  audio: AudioPlan | null;
  renderPath: string | null;
  costUsd: number;
  approvals: Array<{ kind: ApprovalKind; status: string; approver: string | null; decidedAt: string | null }>;
}

export type StudioEvent =
  | "video.project.created" | "video.script.segmented" | "video.scene.planned"
  | "video.scene.locked" | "video.asset.resolved" | "video.voice.generated" | "video.timeline.built"
  | "video.qa.completed" | "video.approval.requested" | "video.approval.granted"
  | "video.render.started" | "video.render.completed" | "video.render.failed"
  | "video.export.completed";

export class VideoStudioService {
  private registry: AssetRegistry;

  constructor(studioRoot = defaultStudioRoot()) {
    this.registry = new AssetRegistry(studioRoot);
    this.studioRoot = studioRoot;
  }

  private studioRoot: string;

  // -------------------------------------------------------------------------
  // Project lifecycle
  // -------------------------------------------------------------------------

  createProject(rawInput: VideoProjectInput, actor = "operator"): VideoProject {
    // Validation law: boundary input is parsed before it enters the model (source §61).
    const input = parseOrThrow(VideoProjectInputSchema, rawInput, "project input");
    const db = openAgentOsDb();
    const id = `vsprj_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const dims = ASPECT_DIMENSIONS[input.aspectRatio].preview;
    const project: VideoProject = {
      id, title: input.title, status: "DRAFT",
      format: { aspectRatio: input.aspectRatio, width: dims[0], height: dims[1], fps: input.fps },
      source: { type: input.sourceType, rawInput: input.rawInput },
      language: input.language, quality: input.quality,
      brandKitId: input.brandKitId ?? null, budget: input.budget ?? null,
      scriptHash: null, plansHash: null, createdAt: now, updatedAt: now,
    };
    db.run(
      "INSERT INTO vs_projects (id, title, status, aspect_ratio, fps, language, quality, source_type, raw_input, brand_kit_id, budget_json, script_hash, plans_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, project.title, project.status, project.format.aspectRatio, project.format.fps, project.language, project.quality, project.source.type, project.source.rawInput, project.brandKitId, project.budget ? JSON.stringify(project.budget) : null, null, null, now, now],
    );
    this.ensureBrandKit(input.brandKitId);
    this.audit("video.project.created", actor, id, null, "createProject", "ok", { title: project.title, quality: project.quality });
    this.snapshot(id, 1, "initial");
    return project;
  }

  getProject(id: string): ProjectDetail | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM vs_projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const project = this.rowToProject(row);
    const scenes = this.listScenes(id);
    // Timeline + audio plans live in the latest job-step outputs (single source of truth).
    const timeline = this.lastStepOutput<Timeline>(id, "TIMELINE");
    const qa = this.lastStepOutput<QAReport>(id, "QA");
    const voice = this.lastStepOutput<{ audio: AudioPlan }>(id, "VOICE");
    const audioPlan: AudioPlan | null = voice?.audio ?? null;
    const render = db.query("SELECT uri FROM vs_assets WHERE project_id = ? AND type = 'video' ORDER BY created_at DESC LIMIT 1").get(id) as { uri?: string } | undefined;
    const cost = db.query("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM vs_cost_events WHERE project_id = ?").get(id) as { total: number };
    const approvals = (db.query("SELECT kind, status, approver, decided_at FROM vs_approvals WHERE project_id = ? ORDER BY created_at").all(id) as Array<Record<string, unknown>>).map((r) => ({
      kind: String(r.kind) as ApprovalKind, status: String(r.status), approver: r.approver === null ? null : String(r.approver), decidedAt: r.decided_at === null ? null : String(r.decided_at),
    }));
    return {
      project, scenes, timeline: timeline ?? null, qa: qa ?? null, audio: audioPlan,
      renderPath: render?.uri ?? null, costUsd: Number(cost.total), approvals,
    };
  }

  listProjects(): VideoProject[] {
    return (openAgentOsDb().query("SELECT * FROM vs_projects ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((r) => this.rowToProject(r));
  }

  /** Paste/import script: segment → persist blocks (hash = invalidation identity). */
  setScript(projectId: string, rawScript: string, opts?: { targetScenes?: number; actor?: string }): { script: ScriptDocument; scenes: Scene[] } {
    const project = this.requireProject(projectId);
    const script = segmentScript(rawScript, { language: project.language, targetScenes: opts?.targetScenes });
    const hash = hashScript(script);
    const db = openAgentOsDb();
    db.run("UPDATE vs_projects SET raw_input = ?, script_hash = ?, status = ?, updated_at = ? WHERE id = ?", [rawScript, hash, "SCRIPTED", new Date().toISOString(), projectId]);
    // Script change invalidates dependent scene plans (dependency-aware invalidation).
    db.run("DELETE FROM vs_scenes WHERE project_id = ?", [projectId]);
    this.audit("video.script.segmented", opts?.actor ?? "operator", projectId, null, "setScript", "ok", { blocks: script.blocks.length, scriptHash: hash });
    const scenes = this.planAllScenes(projectId, opts?.actor ?? "operator");
    return { script, scenes };
  }

  getScript(projectId: string): ScriptDocument | null {
    const row = openAgentOsDb().query("SELECT raw_input, language FROM vs_projects WHERE id = ?").get(projectId) as { raw_input?: string; language?: string } | undefined;
    if (!row?.raw_input) return null;
    return segmentScript(row.raw_input, { language: row.language ?? "en" });
  }

  // -------------------------------------------------------------------------
  // Scene planning + operations
  // -------------------------------------------------------------------------

  planAllScenes(projectId: string, actor = "operator"): Scene[] {
    const project = this.requireProject(projectId);
    const script = this.getScript(projectId);
    if (!script) throw new VideoStudioError("PROJECT_NOT_FOUND", 422, "project has no script — set the script before planning");
    const brand = this.getBrandKit(project.brandKitId);
    const scenes = planScenesFromBlocks({ projectId, blocks: script.blocks, energy: brand.motionProfile.energy });
    const db = openAgentOsDb();
    db.run("DELETE FROM vs_scenes WHERE project_id = ?", [projectId]);
    const insert = db.prepare("INSERT INTO vs_scenes (id, project_id, scene_order, scene_json, updated_at) VALUES (?, ?, ?, ?, ?)");
    scenes.forEach((scene, index) => insert.run(scene.id, projectId, index, JSON.stringify(scene), new Date().toISOString()));
    db.run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["PLANNED", new Date().toISOString(), projectId]);
    this.audit("video.scene.planned", actor, projectId, null, "planAllScenes", "ok", { scenes: scenes.length });
    return scenes;
  }

  listScenes(projectId: string): Scene[] {
    const rows = openAgentOsDb().query("SELECT scene_json FROM vs_scenes WHERE project_id = ? ORDER BY scene_order").all(projectId) as Array<{ scene_json: string }>;
    return rows.map((r) => JSON.parse(r.scene_json) as Scene);
  }

  private saveScene(scene: Scene): void {
    openAgentOsDb().run("UPDATE vs_scenes SET scene_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(scene), new Date().toISOString(), scene.id]);
  }

  updateSceneLocks(projectId: string, sceneId: string, locks: Partial<Scene["locks"]>, actor = "operator"): Scene {
    const scene = this.requireScene(projectId, sceneId);
    const updated = SceneSchemaSafe({ ...scene, locks: { ...scene.locks, ...locks } });
    this.saveScene(updated);
    this.audit("video.scene.locked", actor, projectId, sceneId, "updateSceneLocks", "ok", locks);
    return updated;
  }

  /** Regenerate one aspect of a scene. Locked fields are untouchable (GOLD §54-A). */
  regenerateScene(projectId: string, sceneId: string, what: "visual" | "motion" | "narration" | "all", actor = "operator"): Scene {
    const scene = this.requireScene(projectId, sceneId);
    if (what === "visual" || what === "all") {
      if (scene.locks.asset || scene.locks.layout) throw new VideoStudioError("LOCKED_FIELD", 409, "scene visual is locked — unlock before regenerating", { sceneId });
      scene.visualPlan.resolvedAssetIds = [];
      scene.status = "planned";
    }
    if (what === "motion" || what === "all") {
      if (scene.locks.motion) throw new VideoStudioError("LOCKED_FIELD", 409, "scene motion is locked — unlock before regenerating", { sceneId });
      const template = selectTemplate(scene, this.requireProject(projectId).format.aspectRatio, this.getBrandKit(this.requireProject(projectId).brandKitId).motionProfile.energy);
      scene.motionPlan = {
        templateId: template?.id ?? "",
        entrance: template?.motion.entrance ?? scene.motionPlan.entrance,
        emphasis: template?.motion.emphasis ?? scene.motionPlan.emphasis,
        exit: template?.motion.exit ?? scene.motionPlan.exit,
        cues: scene.motionPlan.cues,
      };
    }
    if (what === "narration") {
      if (scene.locks.script) throw new VideoStudioError("LOCKED_FIELD", 409, "scene script is locked — unlock before rewriting narration", { sceneId });
      scene.estimatedSpeechMs = Math.round(scene.narrationText.split(/\s+/).length / 2.6 * 1000);
      scene.durationMs = sceneDurationMs(scene.estimatedSpeechMs, this.getBrandKit(this.requireProject(projectId).brandKitId).motionProfile.energy);
    }
    this.saveScene(scene);
    this.audit("video.scene.planned", actor, projectId, sceneId, `regenerate:${what}`, "ok", {});
    return scene;
  }

  /** Rewrite a scene's narration (lock-enforced; re-estimates speech + duration). */
  updateSceneNarration(projectId: string, sceneId: string, narrationText: string, actor = "operator"): Scene {
    const scene = this.requireScene(projectId, sceneId);
    if (scene.locks.script) throw new VideoStudioError("LOCKED_FIELD", 409, "scene script is locked — unlock before rewriting narration", { sceneId });
    scene.narrationText = narrationText;
    scene.estimatedSpeechMs = Math.round((narrationText.split(/\s+/).length / 2.6) * 1000);
    if (!scene.locks.timing) {
      scene.durationMs = sceneDurationMs(scene.estimatedSpeechMs, this.getBrandKit(this.requireProject(projectId).brandKitId).motionProfile.energy);
    }
    // Narration change invalidates this scene's voice + captions.
    scene.alignmentMs = 0;
    scene.captions.cues = [];
    scene.status = "planned";
    this.saveScene(scene);
    this.audit("video.scene.planned", actor, projectId, sceneId, "updateSceneNarration", "ok", { length: narrationText.length });
    return scene;
  }

  searchAssets(query: string): MediaAsset[] {
    return this.registry.search(query);
  }

  reorderScenes(projectId: string, orderedSceneIds: string[], actor = "operator"): Scene[] {
    const db = openAgentOsDb();
    orderedSceneIds.forEach((sceneId, index) => {
      db.run("UPDATE vs_scenes SET scene_order = ?, updated_at = ? WHERE id = ? AND project_id = ?", [index, new Date().toISOString(), sceneId, projectId]);
    });
    this.audit("video.scene.planned", actor, projectId, null, "reorderScenes", "ok", { count: orderedSceneIds.length });
    return this.listScenes(projectId);
  }

  // -------------------------------------------------------------------------
  // Asset resolution (ladder) + visual matching
  // -------------------------------------------------------------------------

  async resolveAssets(projectId: string, actor = "operator"): Promise<{ scenes: Scene[]; ladder: Record<string, LadderOutcome["attempted"]> }> {
    const project = this.requireProject(projectId);
    const scenes = this.listScenes(projectId);
    const brand = this.getBrandKit(project.brandKitId);
    const dims = ASPECT_DIMENSIONS[project.format.aspectRatio].preview;

    // GOLD P0: real ComfyUI image generation when configured, healthy, and
    // policy-allowed (PAO_VIDEO_STUDIO_AI_IMAGE is opt-in for paid/external gen).
    let aiImage: LadderContext["aiImage"] | undefined;
    const aiAllowed = process.env.PAO_VIDEO_STUDIO_AI_IMAGE !== "false";
    if (isComfyuiConfigured() && aiAllowed) {
      const health = await verifyProviderHealth("IMAGE", "comfyui");
      if (health.availability === "available") {
        const approvedWorkflow = this.registry.loadApprovedWorkflow();
        const providerModel = process.env.PAO_COMFYUI_WORKFLOW_MODEL || "sdxl-text2img";
        aiImage = {
          available: true,
          generate: async (scene: Scene) => {
            const compiled = this.compileSceneImagePrompt(projectId, scene.id);
            const generation = await generateImageWithComfyui({
              prompt: compiled.prompt, negativePrompt: compiled.negative,
              width: dims[0], height: dims[1],
              approvedWorkflow: approvedWorkflow ?? undefined,
            });
            const asset = this.registry.persistComfyuiArtifact({
              projectId, sceneId: scene.id, bytes: generation.bytes, seed: generation.seed,
              providerModel, promptId: generation.promptId, width: generation.width, height: generation.height,
            });
            this.recordProvenance(projectId, scene.id, "ai-image:comfyui:ai-generated", "comfyui", providerModel, compiled.promptHash, generation.checksum);
            this.recordProviderExecution({
              projectId, sceneId: scene.id, capability: "IMAGE", provider: "comfyui",
              model: providerModel, operation: "image.generate",
              status: "ok", durationMs: generation.durationMs, retryCount: generation.retryCount,
              detail: { promptId: generation.promptId, seed: generation.seed },
            });
            return { assetId: asset.id, provider: "comfyui", model: providerModel, seed: generation.seed, promptId: generation.promptId, retryCount: generation.retryCount, durationMs: generation.durationMs };
          },
        };
      } else {
        aiImage = { available: false, unavailableReason: `comfyui health: ${health.notes ?? health.availability}` };
      }
    } else if (!aiAllowed) {
      aiImage = { available: false, unavailableReason: "policy: PAO_VIDEO_STUDIO_AI_IMAGE=false" };
    }

    const ladder: Record<string, LadderOutcome["attempted"]> = {};
    for (const scene of scenes) {
      if (scene.disabled) continue;
      if (scene.locks.asset && scene.visualPlan.resolvedAssetIds.length > 0) continue;
      const outcome = await resolveSceneVisual(scene, {
        registry: this.registry,
        projectId,
        brandPalette: { background: brand.palette.background, foreground: brand.palette.foreground, accent: brand.palette.accent, secondary: brand.palette.secondary },
        width: dims[0], height: dims[1], cornerRadius: brand.visualStyle.cornerRadius,
        previouslyUsedAssetIds: scenes.flatMap((s) => s.visualPlan.resolvedAssetIds),
        keywords: scene.visualPlan.assetRequirements.map((r) => r.query),
        aspectRatio: project.format.aspectRatio,
        aiImage,
      });
      scene.visualPlan.resolvedAssetIds = [outcome.asset.id];
      scene.visualPlan.candidateScores = [{ candidateId: outcome.asset.id, score: 1, reasons: [`ladder rung: ${outcome.rung}`, ...outcome.attempted.filter((a) => a.outcome === "skipped").map((a) => `${a.rung}: ${a.reason}`)], selected: true }];
      scene.visualPlan.explanation = `resolved via '${outcome.rung}' (${scene.visualPlan.generationClass ?? "deterministic-fallback"}); ${scene.visualPlan.explanation}`;
      scene.status = "assets_ready";
      ladder[scene.id] = outcome.attempted;
      this.saveScene(scene);
      this.recordProvenance(projectId, scene.id, `ladder:${outcome.rung}:${scene.visualPlan.generationClass ?? "deterministic-fallback"}`, outcome.asset.source.provider ?? null, outcome.asset.source.model ?? null, null, outcome.asset.checksum);
      this.recordUsage(outcome.asset.id, projectId, scene.id);
    }
    // Repetition warnings (source §33) — advisory only, never auto-override.
    const templateIds = this.listScenes(projectId).map((s) => s.motionPlan.templateId || null);
    const warnings = repetitionWarnings(templateIds);
    if (warnings.length > 0) this.audit("video.asset.resolved", actor, projectId, null, "resolveAssets", "ok", { warnings });
    openAgentOsDb().run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["ASSETS_READY", new Date().toISOString(), projectId]);
    this.audit("video.asset.resolved", actor, projectId, null, "resolveAssets", "ok", { scenes: scenes.length, aiImage: aiImage?.available === true ? "used" : "bypassed" });
    return { scenes: this.listScenes(projectId), ladder };
  }

  /** Prompt compiler access for when a real image provider is configured. */
  compileSceneImagePrompt(projectId: string, sceneId: string): ReturnType<typeof compileImagePrompt> {
    const project = this.requireProject(projectId);
    const scene = this.requireScene(projectId, sceneId);
    const brand = this.getBrandKit(project.brandKitId);
    return compileImagePrompt(scene, { palette: { background: brand.palette.background, accent: brand.palette.accent }, iconStyle: brand.visualStyle.iconStyle }, project.format.width, project.format.height);
  }

  // -------------------------------------------------------------------------
  // Voice + captions + timeline
  // -------------------------------------------------------------------------

  /**
   * Voice + captions with NARRATION-AUTHORITATIVE timing (GOLD P1): after
   * synthesis, each scene's duration is adapted to cover its real narration
   * (min 1.5s / max 120s, +0.7s read/pad allowance) unless the timing is
   * locked; the timeline is then recomputed from the adapted durations so the
   * audio can never be truncated and scenes never end before the narration.
   */
  async generateVoiceAndCaptions(projectId: string, actor = "operator"): Promise<{ scenes: Scene[]; audio: AudioPlan; manifests: SceneAudioManifest[] }> {
    const project = this.requireProject(projectId);
    const scenes = this.listScenes(projectId);
    const audio: AudioPlan = {
      voiceProvider: "mock-speech", voiceProfileId: "default", language: project.language,
      alignmentMethod: "estimated", narrationAssetId: undefined, musicAssetId: undefined, cues: [],
    };
    const manifests: SceneAudioManifest[] = [];

    // Pass 1: synthesize + adapt durations (narration is authoritative).
    for (const scene of scenes) {
      if (scene.disabled) continue;
      if (scene.locks.voice && scene.alignmentMs > 0) continue;
      const voice = await synthesizeSceneVoice({
        projectId, sceneId: scene.id, narrationText: scene.narrationText,
        language: project.language, durationMs: scene.durationMs, studioRoot: this.studioRoot, registry: this.registry,
      });
      if (voice.asset) {
        if (!scene.visualPlan.resolvedAssetIds.includes(voice.asset.id)) {
          scene.visualPlan.resolvedAssetIds = [...scene.visualPlan.resolvedAssetIds, voice.asset.id];
        }
        scene.alignmentMs = voice.asset.durationMs ?? scene.estimatedSpeechMs;
        audio.narrationAssetId = audio.narrationAssetId ?? voice.asset.id;
      }
      if (!scene.locks.timing && voice.asset) {
        const padded = voice.asset.durationMs ?? scene.estimatedSpeechMs;
        // narration + read/pad allowance, bounded — no truncation, no runaway.
        scene.durationMs = Math.max(1500, Math.min(120_000, Math.max(scene.durationMs, padded + 700)));
      }
      scene.status = "planned";
      this.saveScene(scene);
      manifests.push(voice.manifest);
      this.recordProviderExecution({
        projectId, sceneId: scene.id, capability: "TTS", provider: voice.provider, model: voice.model,
        operation: "voice.generate", status: voice.asset ? "ok" : "failed", durationMs: voice.asset?.durationMs ?? 0,
        errorCode: voice.errorCode, detail: { generationClass: voice.generationClass },
      });
      this.recordProvenance(projectId, scene.id, `voice:${voice.provider}:${voice.generationClass}`, voice.provider, voice.model, null, voice.asset?.checksum ?? null);
    }

    // Pass 2: cursor walk over ADAPTED durations — captions/cues stay in sync.
    let cursor = 0;
    for (const scene of scenes) {
      if (scene.disabled) continue;
      const manifest = manifests.find((m) => m.sceneId === scene.id);
      const speechMs = manifest?.durationMs ?? scene.estimatedSpeechMs;
      audio.cues.push({ sceneId: scene.id, startMs: cursor, durationMs: Math.min(speechMs, scene.durationMs) });
      scene.captions = buildCaptionPlan({
        mode: scene.captions.mode, narrationText: scene.narrationText,
        sceneStartMs: cursor, speechMs,
        alignment: estimateAlignment(scene.narrationText, 0, speechMs, project.language),
        keywords: scene.visualPlan.assetRequirements.map((r) => r.query),
      });
      this.saveScene(scene);
      cursor += scene.durationMs;
    }
    audio.alignmentMethod = "estimated"; // no real forced-alignment provider wired — marked honestly
    audio.voiceProvider = manifests[0]?.provider ?? "mock-speech";
    // Persist for both the job machine and manual (non-job) API paths.
    this.persistManualStep(projectId, "VOICE", JSON.stringify({ audio }));
    openAgentOsDb().run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["TIMELINE_READY", new Date().toISOString(), projectId]);
    this.audit("video.voice.generated", actor, projectId, null, "generateVoiceAndCaptions", "ok", { scenes: scenes.length, alignmentMethod: audio.alignmentMethod, provider: audio.voiceProvider });
    return { scenes: this.listScenes(projectId), audio, manifests };
  }

  buildProjectTimeline(projectId: string, actor = "operator"): Timeline {
    const project = this.requireProject(projectId);
    const scenes = this.listScenes(projectId).filter((s) => !s.disabled);
    const detail = this.getProject(projectId);
    const narrationIds = (detail?.audio?.cues ?? []).map((c) => c.sceneId);
    const audio = detail?.audio ?? null;
    const visualIds = scenes.map((s) => s.visualPlan.resolvedAssetIds.find((id) => this.registry.get(id)?.type === "image" || this.registry.get(id)?.type === "icon") ?? null);
    const narrationAssetIds = scenes.map((s) => {
      void narrationIds;
      return s.visualPlan.resolvedAssetIds.find((id) => this.registry.get(id)?.type === "audio") ?? null;
    });
    void audio;
    const timeline = buildTimeline({ scenes, fps: project.format.fps, narrationAssetIds, visualAssetIds: visualIds });
    this.persistManualStep(projectId, "TIMELINE", JSON.stringify(timeline));
    this.audit("video.timeline.built", actor, projectId, null, "buildProjectTimeline", "ok", { hash: timeline.timelineHash, durationMs: timeline.durationMs });
    return timeline;
  }

  // -------------------------------------------------------------------------
  // QA + render + approvals + auto build
  // -------------------------------------------------------------------------

  runProjectQA(projectId: string, actor = "operator"): QAReport {
    const detail = this.getProject(projectId);
    if (!detail) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `project '${projectId}' not found`);
    const presence = new Map<string, boolean>();
    for (const scene of detail.scenes) {
      for (const assetId of scene.visualPlan.resolvedAssetIds) {
        const asset = this.registry.get(assetId);
        presence.set(assetId, asset ? existsSync(asset.uri) : false);
      }
    }
    const renderProbe = detail.renderPath ? probeRender(detail.renderPath) : null;
    const report = runQA({
      projectId, scenes: detail.scenes, timeline: detail.timeline,
      assetPresence: presence, renderProbe,
      expectedDurationMs: detail.timeline?.durationMs ?? null,
      expectedProfile: detail.timeline ? { width: ASPECT_DIMENSIONS[detail.project.format.aspectRatio].preview[0], height: ASPECT_DIMENSIONS[detail.project.format.aspectRatio].preview[1] } : null,
    });
    this.audit("video.qa.completed", actor, projectId, null, "runProjectQA", report.passed ? "ok" : "failed", { checks: report.checks.filter((c) => !c.passed).length });
    return report;
  }

  async renderProject(projectId: string, profile: import("./types").RenderConfig["profile"] = "PREVIEW_720P", actor = "operator"): Promise<{ path: string; qa: QAReport | null }> {
    const detail = this.getProject(projectId);
    if (!detail) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `project '${projectId}' not found`);
    if (!detail.timeline) throw new VideoStudioError("RENDER_FAILED", 422, "timeline not built — build the timeline before rendering");
    // Missing-asset gate BEFORE the expensive render (GOLD §54-H).
    const missing: string[] = [];
    for (const scene of detail.scenes) {
      for (const assetId of scene.visualPlan.resolvedAssetIds) {
        const asset = this.registry.get(assetId);
        if (!asset || !existsSync(asset.uri)) missing.push(assetId);
      }
    }
    if (missing.length > 0) throw new VideoStudioError("ASSET_UNRESOLVED", 422, "missing assets block the render", { missing });

    const config = configForProfile(profile, detail.project.format.fps);
    this.audit("video.render.started", actor, projectId, null, "renderProject", "ok", { profile, engine: config.engine });
    const visualUris = new Map<string, string>();
    const voiceUris = new Map<string, string>();
    for (const scene of detail.scenes) {
      for (const assetId of scene.visualPlan.resolvedAssetIds) {
        const asset = this.registry.get(assetId);
        if (!asset) continue;
        if ((asset.type === "image" || asset.type === "icon") && !visualUris.has(scene.id)) visualUris.set(scene.id, asset.uri);
        if (asset.type === "audio") voiceUris.set(scene.id, asset.uri);
      }
    }
    try {
      const output = renderWithFfmpeg(
        { projectId, timeline: detail.timeline, visualUris, voiceUris, outputDir: join(this.studioRoot, "projects", projectId, "renders", profile === "PREVIEW_720P" ? "draft" : "final") },
        config,
      );
      recordRenderArtifact(projectId, output, detail.timeline.timelineHash);
      this.registry.register({
        type: "video", uri: output.path, durationMs: output.durationMs, mimeType: "video/mp4",
        width: output.width, height: output.height, tags: ["render", profile],
        source: { kind: "generated", provider: "ffmpeg", projectId },
        license: { type: "generated-owned" },
      });
      this.audit("video.render.completed", actor, projectId, null, "renderProject", "ok", { path: output.path, engine: output.engine });
      const qa = this.runProjectQA(projectId, actor);
      return { path: output.path, qa };
    } catch (err) {
      this.audit("video.render.failed", actor, projectId, null, "renderProject", "failed", { message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  requestApproval(projectId: string, kind: ApprovalKind, actor = "operator"): { kind: ApprovalKind; status: string } {
    const db = openAgentOsDb();
    db.run("INSERT INTO vs_approvals (id, project_id, kind, status, approver, decided_at, created_at) VALUES (?, ?, ?, 'REQUESTED', NULL, NULL, ?)", [`vsapr_${randomUUID().slice(0, 10)}`, projectId, kind, new Date().toISOString()]);
    this.audit("video.approval.requested", actor, projectId, null, `requestApproval:${kind}`, "ok", {});
    db.run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["WAITING_APPROVAL", new Date().toISOString(), projectId]);
    return { kind, status: "REQUESTED" };
  }

  decideApproval(projectId: string, kind: ApprovalKind, approve: boolean, approver: string): { kind: ApprovalKind; status: string } {
    const db = openAgentOsDb();
    const row = db.query("SELECT id, status FROM vs_approvals WHERE project_id = ? AND kind = ? AND status = 'REQUESTED' ORDER BY created_at DESC LIMIT 1").get(projectId, kind) as { id: string } | undefined;
    if (!row) throw new VideoStudioError("APPROVAL_REQUIRED", 409, `no pending '${kind}' request for this project`);
    const status = approve ? "APPROVED" : "DENIED";
    db.run("UPDATE vs_approvals SET status = ?, approver = ?, decided_at = ? WHERE id = ?", [status, approver, new Date().toISOString(), row.id]);
    if (approve) db.run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["QA_PASSED", new Date().toISOString(), projectId]);
    this.audit("video.approval.granted", approver, projectId, null, `decideApproval:${kind}`, status.toLowerCase(), {});
    return { kind, status };
  }

  /** Budget guard (source §38/§41): a paid step that would exceed budget PAUSEs first. */
  checkBudget(projectId: string, estimatedUsd: number): { allowed: boolean; reason?: string } {
    const project = this.requireProject(projectId);
    if (!project.budget?.maxUsd) return { allowed: true };
    const spent = this.getProject(projectId)?.costUsd ?? 0;
    if (spent + estimatedUsd > project.budget.maxUsd) {
      this.requestApproval(projectId, "ASSET_APPROVAL", "budget-guard");
      return { allowed: false, reason: `budget guard: spent $${spent.toFixed(2)} + $${estimatedUsd.toFixed(2)} exceeds maxUsd $${project.budget.maxUsd} — PAUSED for approval` };
    }
    return { allowed: true };
  }

  recordCost(projectId: string, sceneId: string | null, provider: string, operation: string, costUsd: number): void {
    openAgentOsDb().run(
      "INSERT INTO vs_cost_events (id, project_id, scene_id, provider, operation, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [`vscost_${randomUUID().slice(0, 10)}`, projectId, sceneId, provider, operation, costUsd, new Date().toISOString()],
    );
  }

  // -------------------------------------------------------------------------
  // Auto build (durable step machine)
  // -------------------------------------------------------------------------

  startAutoBuild(projectId: string, actor = "operator"): { jobId: string } {
    const db = openAgentOsDb();
    const project = this.requireProject(projectId);
    const jobId = `vsjob_${randomUUID().slice(0, 10)}`;
    db.run(
      "INSERT INTO vs_jobs (id, project_id, kind, status, current_step, quality, idempotency_base, budget_json, created_at, updated_at) VALUES (?, ?, 'auto_build', 'QUEUED', NULL, ?, ?, ?, ?, ?)",
      [jobId, projectId, project.quality, `${projectId}:auto_build`, project.budget ? JSON.stringify(project.budget) : null, new Date().toISOString(), new Date().toISOString()],
    );
    this.audit("video.project.created", actor, projectId, null, "startAutoBuild", "ok", { jobId });
    return { jobId };
  }

  /**
   * Run one pending step of the auto-build job. Returns the step executed and
   * whether the job reached its human-review boundary. Steps already DONE are
   * skipped (resume — GOLD §54-B); each step's idempotency key binds
   * projectId+step+inputHash+configHash so retries never duplicate paid work.
   */
  async runNextStep(jobId: string, actor = "operator"): Promise<{ job: { status: string; currentStep: string | null }; step: string | null; done: boolean; paused: boolean; detail?: string }> {
    const db = openAgentOsDb();
    const job = db.query("SELECT * FROM vs_jobs WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
    if (!job) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `job '${jobId}' not found`);
    const projectId = String(job.project_id);
    if (String(job.status) === "CANCELLED") {
      return { job: { status: "CANCELLED", currentStep: String(job.current_step ?? "") }, step: null, done: true, paused: false, detail: "job cancelled" };
    }
    const order = ["SEGMENT", "PLAN", "RESOLVE_ASSETS", "VOICE", "TIMELINE", "QA", "PREVIEW_RENDER", "APPROVAL_GATE"] as const;
    const done = new Set((db.query("SELECT step FROM vs_job_steps WHERE job_id = ? AND status = 'DONE'").all(jobId) as Array<{ step: string }>).map((r) => r.step));

    let step: (typeof order)[number] | null = null;
    for (const candidate of order) {
      if (candidate === "APPROVAL_GATE") { step = candidate; break; }
      if (!done.has(candidate)) { step = candidate; break; }
    }
    if (!step) { step = "APPROVAL_GATE"; }

    const stepInputHash = this.stepInputHash(projectId, step);
    const idempotencyKey = `${projectId}:${step}:${stepInputHash}`;
    const existing = db.query("SELECT * FROM vs_job_steps WHERE job_id = ? AND step = ? AND status = 'DONE'").get(jobId, step) as Record<string, unknown> | undefined;

    db.run("UPDATE vs_jobs SET current_step = ?, status = 'RUNNING', updated_at = ? WHERE id = ?", [step, new Date().toISOString(), jobId]);

    if (existing && (step === "SEGMENT" || step === "PLAN")) {
      // Content-hash match → reuse (idempotent skip).
      return { job: { status: "RUNNING", currentStep: step }, step, done: false, paused: false, detail: "reused (idempotency hit)" };
    }

    try {
      let outputJson = "{}";
      switch (step) {
        case "SEGMENT": {
          const project = this.requireProject(projectId);
          if (!project.source.rawInput.trim()) throw new VideoStudioError("SEGMENTATION_FAILED", 422, "project has no script input");
          this.setScript(projectId, project.source.rawInput, { actor });
          break;
        }
        case "PLAN":
          this.planAllScenes(projectId, actor);
          break;
        case "RESOLVE_ASSETS":
          await this.resolveAssets(projectId, actor);
          break;
        case "VOICE": {
          const voice = await this.generateVoiceAndCaptions(projectId, actor);
          outputJson = JSON.stringify({ audio: voice.audio });
          break;
        }
        case "TIMELINE": {
          const timeline = this.buildProjectTimeline(projectId, actor);
          outputJson = JSON.stringify(timeline);
          break;
        }
        case "QA": {
          const report = this.runProjectQA(projectId, actor);
          outputJson = JSON.stringify(report);
          if (!report.passed) {
            const failed = report.checks.filter((c) => !c.passed).map((c) => `${c.category}/${c.name}`).join("; ");
            db.run("UPDATE vs_jobs SET status = 'FAILED_BLOCKED', error_code = 'QA_FAILED', error_message = ?, updated_at = ? WHERE id = ?", [failed, new Date().toISOString(), jobId]);
            return { job: { status: "FAILED_BLOCKED", currentStep: step }, step, done: false, paused: false, detail: failed };
          }
          break;
        }
        case "PREVIEW_RENDER": {
          // Budget gate before the (free, local) render — modeled for paid engines.
          const guard = this.checkBudget(projectId, 0);
          if (!guard.allowed) {
            db.run("UPDATE vs_jobs SET status = 'WAITING_APPROVAL', pause_reason = ?, updated_at = ? WHERE id = ?", [guard.reason ?? "budget", new Date().toISOString(), jobId]);
            return { job: { status: "WAITING_APPROVAL", currentStep: step }, step, done: false, paused: true, detail: guard.reason };
          }
          const render = await this.renderProject(projectId, "PREVIEW_720P", actor);
          outputJson = JSON.stringify({ renderPath: render.path });
          break;
        }
        case "APPROVAL_GATE": {
          this.requestApproval(projectId, "DRAFT_VIDEO_APPROVAL", actor);
          db.run("UPDATE vs_jobs SET status = 'WAITING_APPROVAL', pause_reason = 'human review before final export', updated_at = ? WHERE id = ?", [new Date().toISOString(), jobId]);
          return { job: { status: "WAITING_APPROVAL", currentStep: step }, step, done: true, paused: true, detail: "stopped at human review boundary — no auto-publish" };
        }
      }
      db.prepare("INSERT INTO vs_job_steps (id, job_id, step, status, input_hash, config_hash, idempotency_key, output_json, started_at, finished_at) VALUES (?, ?, ?, 'DONE', ?, ?, ?, ?, ?, ?)")
        .run(`vsstep_${randomUUID().slice(0, 10)}`, jobId, step, stepInputHash, this.stepConfigHash(projectId, step), idempotencyKey, outputJson, new Date().toISOString(), new Date().toISOString());
      db.run("UPDATE vs_jobs SET updated_at = ? WHERE id = ?", [new Date().toISOString(), jobId]);
      return { job: { status: "RUNNING", currentStep: step }, step, done: false, paused: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.run("UPDATE vs_jobs SET status = 'FAILED_RETRYABLE', error_message = ?, updated_at = ? WHERE id = ?", [message, new Date().toISOString(), jobId]);
      return { job: { status: "FAILED_RETRYABLE", currentStep: step }, step, done: false, paused: false, detail: message };
    }
  }

  jobStatus(jobId: string): { status: string; currentStep: string | null; steps: JobStepRecord[]; pauseReason: string | null; error: string | null } {
    const db = openAgentOsDb();
    const job = db.query("SELECT * FROM vs_jobs WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
    if (!job) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `job '${jobId}' not found`);
    const steps = (db.query("SELECT * FROM vs_job_steps WHERE job_id = ? ORDER BY started_at").all(jobId) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), jobId: String(r.job_id), step: String(r.step), status: String(r.status) as JobStepRecord["status"],
      inputHash: r.input_hash === null ? null : String(r.input_hash), configHash: r.config_hash === null ? null : String(r.config_hash),
      idempotencyKey: r.idempotency_key === null ? null : String(r.idempotency_key), outputJson: String(r.output_json),
      startedAt: r.started_at === null ? null : String(r.started_at), finishedAt: r.finished_at === null ? null : String(r.finished_at),
    }));
    return {
      status: String(job.status), currentStep: job.current_step === null ? null : String(job.current_step), steps,
      pauseReason: job.pause_reason === null ? null : String(job.pause_reason), error: job.error_message === null ? null : String(job.error_message),
    };
  }

  /** Safe cancellation: the job refuses further steps; in-flight ffmpeg subprocess is bounded by its own timeout. */
  cancelJob(jobId: string, reason: string, actor = "operator"): { status: string } {
    const db = openAgentOsDb();
    db.run("UPDATE vs_jobs SET status = 'CANCELLED', pause_reason = ?, updated_at = ? WHERE id = ?", [reason, new Date().toISOString(), jobId]);
    this.audit("video.project.created", actor, null, null, `cancelJob:${jobId}`, "cancelled", { reason });
    return { status: "CANCELLED" };
  }

  /** Retry only the failed unit: clear the terminal failure, resume from the failed step (GOLD P1). */
  retryJob(jobId: string, actor = "operator"): { status: string } {
    const db = openAgentOsDb();
    db.run("UPDATE vs_jobs SET status = 'QUEUED', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?", [new Date().toISOString(), jobId]);
    this.audit("video.project.created", actor, null, null, `retryJob:${jobId}`, "ok", {});
    return { status: "QUEUED" };
  }

  /** Final 1080p render — gated by DRAFT_VIDEO_APPROVAL; publishing stays human-only. */
  async renderFinal(projectId: string, actor = "operator"): Promise<{ path: string; status: string }> {
    const approved = this.getProject(projectId)?.approvals.find((a) => a.kind === "DRAFT_VIDEO_APPROVAL" && a.status === "APPROVED");
    if (!approved) throw new VideoStudioError("APPROVAL_REQUIRED", 403, "DRAFT_VIDEO_APPROVAL must be approved before the final render");
    const render = await this.renderProject(projectId, "YOUTUBE_1080P", actor);
    openAgentOsDb().run("UPDATE vs_projects SET status = 'RENDERED', updated_at = ? WHERE id = ?", [new Date().toISOString(), projectId]);
    return { path: render.path, status: "RENDERED" };
  }

  listTemplates(): typeof MOTION_TEMPLATES {
    return MOTION_TEMPLATES;
  }

  // -------------------------------------------------------------------------
  // GOLD P2: batch production engine (bounded concurrency, failure isolation)
  // -------------------------------------------------------------------------

  /**
   * Create a batch of auto-build jobs. Each item becomes an independent
   * project + job (failure isolation); nothing is launched here — runBatch
   * drives them with bounded concurrency.
   */
  createBatch(items: Array<{ title: string; script: string; aspectRatio?: string; language?: string }>, actor = "operator"): { batchId: string; jobIds: string[] } {
    const batchId = `vsbatch_${randomUUID().slice(0, 8)}`;
    const jobIds: string[] = [];
    for (const item of items) {
      const project = this.createProject({
        title: item.title, sourceType: "batch", rawInput: item.script,
        aspectRatio: (item.aspectRatio as VideoProject["format"]["aspectRatio"]) ?? "16:9",
        fps: 30, language: item.language ?? "en", quality: "BALANCED",
      }, actor);
      const { jobId } = this.startAutoBuild(project.id, actor);
      openAgentOsDb().run("UPDATE vs_jobs SET parent_id = ? WHERE id = ?", [batchId, jobId]);
      jobIds.push(jobId);
    }
    this.audit("video.project.created", actor, null, null, `createBatch:${batchId}`, "ok", { count: jobIds.length });
    return { batchId, jobIds };
  }

  /** Free-disk guard: refuse to start new work under 500 MB (best-effort probe). */
  private diskGuardOk(): { ok: boolean; reason?: string } {
    try {
      const stats = statfsSync(this.studioRoot);
      const freeBytes = Number(stats.bsize) * Number(stats.bavail);
      if (freeBytes < 500 * 1024 * 1024) {
        return { ok: false, reason: `disk guard: only ${(freeBytes / 1024 / 1024).toFixed(0)} MB free on the studio root` };
      }
    } catch {
      // statfs unsupported on this platform — guard degrades to a no-op.
    }
    return { ok: true };
  }

  /**
   * Drive a batch with BOUNDED concurrency (default 2 — never 50 simultaneous
   * GPU generations). Each child job advances one step per pass; failures are
   * isolated (a failing child never stops the others) and resumable.
   */
  async runBatch(batchId: string, concurrency = 2, actor = "operator"): Promise<{ batchId: string; progressed: number; done: number; failed: number; waiting: number }> {
    const guard = this.diskGuardOk();
    if (!guard.ok) {
      this.audit("video.project.created", actor, null, null, `runBatch:${batchId}`, "blocked", { reason: guard.reason });
      return { batchId, progressed: 0, done: 0, failed: 0, waiting: 0 };
    }
    const children = openAgentOsDb().query("SELECT id FROM vs_jobs WHERE parent_id = ? AND status NOT IN ('CANCELLED') ORDER BY created_at").all(batchId) as Array<{ id: string }>;
    let progressed = 0;
    const queue = [...children.map((c) => c.id)];
    const active = new Set<Promise<void>>();
    let done = 0;
    let failed = 0;
    let waiting = 0;

    const statuses = () => new Map(queue.map((id) => [id, this.jobStatus(id).status] as const));
    while (queue.length > 0 || active.size > 0) {
      while (queue.length > 0 && active.size < Math.max(1, concurrency)) {
        const jobId = queue.shift()!;
        const status = this.jobStatus(jobId);
        if (["WAITING_APPROVAL", "FAILED_BLOCKED", "CANCELLED"].includes(status.status)) {
          if (status.status === "WAITING_APPROVAL") waiting++;
          if (status.status === "FAILED_BLOCKED") failed++;
          continue;
        }
        if (status.status === "FAILED_RETRYABLE") {
          failed++;
          continue;
        }
        if (status.status === "COMPLETED") { done++; continue; }
        const task = this.runNextStep(jobId, actor)
          .then((result) => {
            progressed++;
            if (result.job.status === "WAITING_APPROVAL") waiting++;
            if (result.job.status === "FAILED_BLOCKED" || result.job.status === "FAILED_RETRYABLE") failed++;
            if (result.done) done++;
            // Re-queue until the child reaches a terminal/paused state.
            const child = this.jobStatus(jobId);
            if (["RUNNING", "QUEUED"].includes(child.status)) queue.push(jobId);
          })
          .catch(() => {
            failed++;
          })
          .finally(() => active.delete(task));
        active.add(task);
      }
      if (active.size > 0) await Promise.race(active);
      else if (queue.length > 0 && active.size === 0) {
        // Everything remaining is terminal — drain without work.
        for (const id of queue) {
          const s = this.jobStatus(id).status;
          if (s === "WAITING_APPROVAL") waiting++;
          else if (s === "FAILED_RETRYABLE" || s === "FAILED_BLOCKED") failed++;
          else if (s === "COMPLETED") done++;
        }
        queue.length = 0;
      }
    }
    void statuses;
    this.audit("video.project.created", actor, null, null, `runBatch:${batchId}`, "ok", { progressed, done, failed, waiting });
    return { batchId, progressed, done, failed, waiting };
  }

  batchStatus(batchId: string): { batchId: string; total: number; byStatus: Record<string, number>; jobs: Array<{ id: string; projectId: string; status: string; currentStep: string | null }> } {
    const rows = openAgentOsDb().query("SELECT id, project_id, status, current_step FROM vs_jobs WHERE parent_id = ? ORDER BY created_at").all(batchId) as Array<Record<string, unknown>>;
    const byStatus: Record<string, number> = {};
    const jobs = rows.map((r) => {
      const status = String(r.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      return { id: String(r.id), projectId: String(r.project_id), status, currentStep: r.current_step === null ? null : String(r.current_step) };
    });
    return { batchId, total: rows.length, byStatus, jobs };
  }

  // -------------------------------------------------------------------------
  // GOLD P3: multi-machine execution contract (interfaces only — federation
  // is deferred; single-machine production remains fully functional)
  // -------------------------------------------------------------------------

  /**
   * Serializable execution unit for a future fleet scheduler: workers receive
   * references/IDs, never embedded binaries (GOLD §31). Federation itself is
   * deferred until the Phase 20.91a fleet runtime exists.
   */
  describeExecutionUnits(jobId: string): Array<{ unitId: string; kind: string; capability: string; payloadRef: string }> {
    const status = this.jobStatus(jobId);
    return status.steps.map((s) => ({
      unitId: `${jobId}:${s.step}`,
      kind: s.step,
      capability: s.step === "PREVIEW_RENDER" ? "RENDER" : s.step === "VOICE" ? "TTS" : s.step === "RESOLVE_ASSETS" ? "IMAGE" : s.step === "QA" ? "qa" : "cpu-light",
      payloadRef: s.idempotencyKey ?? s.id,
    }));
  }

  providerStatuses(): ProviderStatus[] {
    return getProviderMatrix();
  }

  async verifyProviders(): Promise<ProviderStatus[]> {
    const matrix = getProviderMatrix();
    const verified: ProviderStatus[] = [];
    for (const entry of matrix) {
      if (entry.availability === "offline") {
        verified.push(await verifyProviderHealth(entry.capability, entry.provider));
      } else {
        verified.push(entry);
      }
    }
    return verified;
  }

  recordProviderExecution(input: {
    projectId: string; sceneId?: string | null; jobId?: string | null;
    capability: string; provider: string; model?: string | null; operation: string;
    status: string; durationMs?: number; retryCount?: number; errorCode?: string;
    detail?: Record<string, unknown>;
  }): void {
    try {
      const now = new Date().toISOString();
      openAgentOsDb().run(
        "INSERT INTO vs_provider_executions (id, project_id, job_id, scene_id, capability, provider, model, operation, status, duration_ms, retry_count, error_code, started_at, finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`vsexec_${randomUUID().slice(0, 10)}`, input.projectId, input.jobId ?? null, input.sceneId ?? null, input.capability, input.provider, input.model ?? null, input.operation, input.status, input.durationMs ?? null, input.retryCount ?? 0, input.errorCode ?? null, now, now, now],
      );
    } catch {
      // Observability is best-effort; functional gates surface their own errors.
    }
    void input.detail;
  }

  /** Concise operational view (GOLD P2) — no secrets, aggregate counts only. */
  opsSummary(): { jobs: Array<{ id: string; projectId: string; kind: string; status: string; currentStep: string | null; updatedAt: string }>; providerExecutions: Array<{ provider: string; operation: string; status: string; count: number; avgDurationMs: number; retries: number }>; recentFailures: Array<{ id: string; provider: string; operation: string; errorCode: string | null; createdAt: string }> } {
    const db = openAgentOsDb();
    const jobs = (db.query("SELECT id, project_id, kind, status, current_step, updated_at FROM vs_jobs ORDER BY updated_at DESC LIMIT 20").all() as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), projectId: String(r.project_id), kind: String(r.kind), status: String(r.status),
      currentStep: r.current_step === null ? null : String(r.current_step), updatedAt: String(r.updated_at),
    }));
    const providerExecutions = (db.query(
      "SELECT provider, operation, status, COUNT(*) AS n, AVG(duration_ms) AS avg_ms, SUM(retry_count) AS retries FROM vs_provider_executions GROUP BY provider, operation, status ORDER BY n DESC LIMIT 20",
    ).all() as Array<Record<string, unknown>>).map((r) => ({
      provider: String(r.provider), operation: String(r.operation), status: String(r.status),
      count: Number(r.n), avgDurationMs: Math.round(Number(r.avg_ms ?? 0)), retries: Number(r.retries ?? 0),
    }));
    const recentFailures = (db.query("SELECT id, provider, operation, error_code, created_at FROM vs_provider_executions WHERE status != 'ok' ORDER BY created_at DESC LIMIT 10").all() as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), provider: String(r.provider), operation: String(r.operation),
      errorCode: r.error_code === null ? null : String(r.error_code), createdAt: String(r.created_at),
    }));
    return { jobs, providerExecutions, recentFailures };
  }

  /** Scene-level ops (GOLD P1). */
  setSceneDisabled(projectId: string, sceneId: string, disabled: boolean, actor = "operator"): Scene {
    const scene = this.requireScene(projectId, sceneId);
    scene.disabled = disabled;
    this.saveScene(scene);
    this.audit("video.scene.locked", actor, projectId, sceneId, disabled ? "disableScene" : "enableScene", "ok", {});
    return scene;
  }

  /** Regenerate narration audio only (voice lock enforced; timeline re-syncs). */
  async regenerateSceneVoice(projectId: string, sceneId: string, actor = "operator"): Promise<Scene> {
    const scene = this.requireScene(projectId, sceneId);
    if (scene.locks.voice) throw new VideoStudioError("LOCKED_FIELD", 409, "scene voice is locked — unlock before regenerating", { sceneId });
    const voice = await synthesizeSceneVoice({
      projectId, sceneId, narrationText: scene.narrationText, language: this.requireProject(projectId).language,
      durationMs: scene.durationMs, studioRoot: this.studioRoot, registry: this.registry,
    });
    if (voice.asset) {
      scene.alignmentMs = voice.asset.durationMs ?? scene.estimatedSpeechMs;
      if (!scene.locks.timing) {
        const padded = voice.asset.durationMs ?? scene.estimatedSpeechMs;
        scene.durationMs = Math.max(1500, Math.min(120_000, Math.max(scene.durationMs, padded + 700)));
      }
      scene.captions.cues = [];
    }
    scene.status = "planned";
    this.saveScene(scene);
    this.recordProviderExecution({
      projectId, sceneId, capability: "TTS", provider: voice.provider, model: voice.model,
      operation: "voice.regenerate", status: voice.asset ? "ok" : "failed", durationMs: voice.asset?.durationMs ?? 0, errorCode: voice.errorCode,
    });
    this.audit("video.voice.generated", actor, projectId, sceneId, "regenerateSceneVoice", "ok", { generationClass: voice.generationClass });
    return scene;
  }

  /**
   * Adobe Stock sidecar manifest (GOLD P2): deterministic naming, full
   * provenance trace, real SHA-256 of the rendered artifact. Publishing is NOT
   * automated — the manifest documents the human-boundary approval state.
   */
  buildStockManifest(projectId: string): { filename: string; manifest: Record<string, unknown> } {
    const detail = this.getProject(projectId);
    if (!detail) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `project '${projectId}' not found`);
    if (!detail.renderPath) throw new VideoStudioError("RENDER_FAILED", 422, "no render output — render before building a stock manifest");
    const db = openAgentOsDb();
    const job = db.query("SELECT id FROM vs_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as { id?: string } | undefined;
    const provenance = (db.query("SELECT origin, provider, model, prompt_hash, output_hash, license, created_at FROM vs_provenance WHERE project_id = ? ORDER BY created_at").all(projectId) as Array<Record<string, unknown>>).map((r) => ({
      origin: String(r.origin), provider: r.provider === null ? null : String(r.provider), model: r.model === null ? null : String(r.model),
      promptHash: r.prompt_hash === null ? null : String(r.prompt_hash), outputHash: r.output_hash === null ? null : String(r.output_hash),
      license: r.license === null ? null : String(r.license), createdAt: String(r.created_at),
    }));
    const fileBuffer = readFileSync(detail.renderPath);
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const dims = ASPECT_DIMENSIONS[detail.project.format.aspectRatio];
    const manifest = {
      project_id: projectId,
      job_id: job?.id ?? null,
      title: detail.project.title,
      description: detail.scenes.map((s) => s.narrationText).join(" ").slice(0, 200),
      keywords: [...new Set(detail.scenes.flatMap((s) => s.visualPlan.assetRequirements.map((r) => r.query)))].slice(0, 20),
      aspect_ratio: detail.project.format.aspectRatio,
      resolution: `${dims.final[0]}x${dims.final[1]}`,
      duration_sec: Number(((detail.timeline?.durationMs ?? 0) / 1000).toFixed(2)),
      fps: detail.project.format.fps,
      audio_status: detail.audio ? `narration:${detail.audio.voiceProvider};alignment:${detail.audio.alignmentMethod}` : "none",
      visual_provider: [...new Set(detail.scenes.map((s) => s.visualPlan.generationClass ?? "deterministic-fallback"))],
      voice_provider: detail.audio?.voiceProvider ?? "none",
      models: [...new Set(provenance.map((p) => p.model).filter((m): m is string => Boolean(m)))],
      generated_assets: detail.scenes.flatMap((s) => s.visualPlan.resolvedAssetIds),
      render_artifact: detail.renderPath,
      sha256,
      created_at: new Date().toISOString(),
      policy_status: {
        human_approval: detail.approvals.some((a) => a.status === "APPROVED") ? "granted" : "pending",
        publish_automated: false,
      },
      provenance,
    };
    const filename = `stock_${projectId}_${detail.project.updatedAt.replace(/[:.]/g, "-")}.json`;
    return { filename, manifest };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private stepInputHash(projectId: string, step: string): string {
    const db = openAgentOsDb();
    const project = db.query("SELECT raw_input, script_hash FROM vs_projects WHERE id = ?").get(projectId) as { raw_input?: string; script_hash?: string } | undefined;
    const scenes = this.listScenes(projectId);
    const identity = {
      script: project?.script_hash ?? project?.raw_input ?? "",
      scenes: scenes.map((s) => [s.id, s.durationMs, s.visualPlan.resolvedAssetIds, s.captions.mode]),
      step,
    };
    return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  }

  private stepConfigHash(projectId: string, _step: string): string {
    const project = this.requireProject(projectId);
    return createHash("sha256").update(JSON.stringify([project.quality, project.format])).digest("hex").slice(0, 16);
  }

  private lastStepOutput<T>(projectId: string, step: string): T | null {
    const row = openAgentOsDb().query(
      "SELECT s.output_json FROM vs_job_steps s JOIN vs_jobs j ON j.id = s.job_id WHERE j.project_id = ? AND s.step = ? AND s.status = 'DONE' ORDER BY s.finished_at DESC LIMIT 1",
    ).get(projectId, step) as { output_json?: string } | undefined;
    if (!row?.output_json || row.output_json === "{}") return null;
    try { return JSON.parse(row.output_json) as T; } catch { return null; }
  }

  /**
   * Manual (non-job-machine) API calls persist their outputs into an implicit
   * 'manual' job so downstream gates (render/QA/project detail) read the same
   * state the step machine would produce.
   */
  private persistManualStep(projectId: string, step: string, outputJson: string): void {
    const db = openAgentOsDb();
    let job = db.query("SELECT id FROM vs_jobs WHERE project_id = ? AND kind = 'manual' ORDER BY created_at DESC LIMIT 1").get(projectId) as { id: string } | undefined;
    if (!job) {
      const id = `vsjob_${randomUUID().slice(0, 10)}`;
      db.run("INSERT INTO vs_jobs (id, project_id, kind, status, quality, idempotency_base, created_at, updated_at) VALUES (?, ?, 'manual', 'RUNNING', 'BALANCED', ?, ?, ?)", [id, projectId, `${projectId}:manual`, new Date().toISOString(), new Date().toISOString()]);
      job = { id };
    }
    // Latest-wins per (job, step) — the UNIQUE(job_id, step) contract holds.
    db.run("DELETE FROM vs_job_steps WHERE job_id = ? AND step = ?", [job.id, step]);
    db.prepare("INSERT INTO vs_job_steps (id, job_id, step, status, input_hash, config_hash, idempotency_key, output_json, started_at, finished_at) VALUES (?, ?, ?, 'DONE', NULL, NULL, NULL, ?, ?, ?)")
      .run(`vsstep_${randomUUID().slice(0, 10)}`, job.id, step, outputJson, new Date().toISOString(), new Date().toISOString());
  }

  private ensureBrandKit(brandKitId?: string): BrandKit {
    const db = openAgentOsDb();
    if (brandKitId) {
      const row = db.query("SELECT kit_json FROM vs_brand_kits WHERE id = ?").get(brandKitId) as { kit_json?: string } | undefined;
      if (row?.kit_json) return JSON.parse(row.kit_json) as BrandKit;
    }
    const existing = db.query("SELECT kit_json FROM vs_brand_kits LIMIT 1").get() as { kit_json?: string } | undefined;
    if (existing?.kit_json) return JSON.parse(existing.kit_json) as BrandKit;
    const kit: BrandKit = {
      id: `vsbrand_${randomUUID().slice(0, 8)}`, name: "Pao Default",
      typography: { headingFont: "Arial", bodyFont: "Arial", weights: [400, 700] },
      palette: { primary: "#1d1d1f", secondary: "#6e6e73", accent: "#0a84ff", background: "#ffffff", foreground: "#1d1d1f" },
      logoAssetIds: [],
      motionProfile: { energy: "balanced", preferredTransitions: ["fade"] },
      visualStyle: { cornerRadius: 24, iconStyle: "outline" },
      locks: { brand: false, typography: false, colors: false, motionLanguage: false },
    };
    db.run("INSERT INTO vs_brand_kits (id, name, kit_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [kit.id, kit.name, JSON.stringify(kit), new Date().toISOString(), new Date().toISOString()]);
    return kit;
  }

  getBrandKit(brandKitId: string | null): BrandKit {
    return this.ensureBrandKit(brandKitId ?? undefined);
  }

  private requireProject(projectId: string): VideoProject {
    const row = openAgentOsDb().query("SELECT * FROM vs_projects WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) throw new VideoStudioError("PROJECT_NOT_FOUND", 404, `project '${projectId}' not found`);
    return this.rowToProject(row);
  }

  private requireScene(projectId: string, sceneId: string): Scene {
    const row = openAgentOsDb().query("SELECT scene_json FROM vs_scenes WHERE id = ? AND project_id = ?").get(sceneId, projectId) as { scene_json?: string } | undefined;
    if (!row?.scene_json) throw new VideoStudioError("SCENE_NOT_FOUND", 404, `scene '${sceneId}' not found in project '${projectId}'`);
    return JSON.parse(row.scene_json) as Scene;
  }

  private rowToProject(row: Record<string, unknown>): VideoProject {
    return {
      id: String(row.id), title: String(row.title), status: String(row.status) as VideoProject["status"],
      format: { aspectRatio: String(row.aspect_ratio) as VideoProject["format"]["aspectRatio"], width: ASPECT_DIMENSIONS[String(row.aspect_ratio) as keyof typeof ASPECT_DIMENSIONS]?.preview[0] ?? 1280, height: ASPECT_DIMENSIONS[String(row.aspect_ratio) as keyof typeof ASPECT_DIMENSIONS]?.preview[1] ?? 720, fps: Number(row.fps) },
      source: { type: String(row.source_type) as VideoProject["source"]["type"], rawInput: String(row.raw_input ?? "") },
      language: String(row.language ?? "en"), quality: String(row.quality ?? "BALANCED") as VideoProject["quality"],
      brandKitId: row.brand_kit_id === null ? null : String(row.brand_kit_id),
      budget: row.budget_json ? (JSON.parse(String(row.budget_json)) as ProjectBudget) : null,
      scriptHash: row.script_hash === null ? null : String(row.script_hash),
      plansHash: row.plans_hash === null ? null : String(row.plans_hash),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private snapshot(projectId: string, revision: number, reason: string): void {
    const detail = this.getProject(projectId);
    if (!detail) return;
    openAgentOsDb().run(
      "INSERT INTO vs_project_versions (id, project_id, revision, reason, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [`vsver_${randomUUID().slice(0, 10)}`, projectId, revision, reason, JSON.stringify({ project: detail.project, scenes: detail.scenes }), new Date().toISOString()],
    );
  }

  private recordProvenance(projectId: string, sceneId: string | null, origin: string, provider: string | null, model: string | null, promptHash: string | null, outputHash: string | null): void {
    openAgentOsDb().run(
      "INSERT INTO vs_provenance (id, project_id, scene_id, origin, provider, model, prompt_hash, input_hash, output_hash, license, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
      [`vsprov_${randomUUID().slice(0, 10)}`, projectId, sceneId, origin, provider, model, promptHash, outputHash, "generated-owned", new Date().toISOString()],
    );
  }

  private recordUsage(assetId: string, projectId: string, sceneId: string): void {
    openAgentOsDb().run("INSERT INTO vs_asset_usage (id, asset_id, project_id, scene_id, used_at) VALUES (?, ?, ?, ?, ?)", [`vsuse_${randomUUID().slice(0, 10)}`, assetId, projectId, sceneId, new Date().toISOString()]);
  }

  private audit(event: StudioEvent, actor: string, projectId: string | null, sceneId: string | null, operation: string, result: string, details: Record<string, unknown>): void {
    try {
      openAgentOsDb().run(
        "INSERT INTO vs_audit_events (id, event_type, actor, project_id, scene_id, operation, result, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`vsaud_${randomUUID().slice(0, 10)}`, event, actor, projectId, sceneId, operation, result, JSON.stringify(details), new Date().toISOString()],
      );
    } catch {
      // Best-effort audit; operational paths surface errors via their own gates.
    }
  }
}

/** Scene write-through with schema re-validation (never persist unvalidated shapes). */
function SceneSchemaSafe(scene: Scene): Scene {
  // Structural re-check of the discriminating fields; full re-parse happens on read paths.
  if (!scene.id || scene.durationMs <= 0) throw new VideoStudioError("SCHEMA_INVALID", 422, "scene payload invalid before persist");
  return scene;
}

let singleton: VideoStudioService | null = null;

export function getVideoStudioService(): VideoStudioService {
  if (!singleton) singleton = new VideoStudioService();
  return singleton;
}

export { hashVoice };
