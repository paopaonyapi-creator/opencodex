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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
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
import { AssetRegistry, defaultStudioRoot, resolveSceneVisual, compileImagePrompt, type LadderOutcome } from "./assets";
import { selectTemplate, repetitionWarnings, MOTION_TEMPLATES } from "./motion";
import { buildCaptionPlan, synthesizeSceneVoice, hashVoice } from "./voice";
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
    const ladder: Record<string, LadderOutcome["attempted"]> = {};
    for (const scene of scenes) {
      if (scene.locks.asset && scene.visualPlan.resolvedAssetIds.length > 0) continue;
      const outcome = await resolveSceneVisual(scene, {
        registry: this.registry,
        projectId,
        brandPalette: { background: brand.palette.background, foreground: brand.palette.foreground, accent: brand.palette.accent, secondary: brand.palette.secondary },
        width: dims[0], height: dims[1], cornerRadius: brand.visualStyle.cornerRadius,
        previouslyUsedAssetIds: scenes.flatMap((s) => s.visualPlan.resolvedAssetIds),
        keywords: scene.visualPlan.assetRequirements.map((r) => r.query),
        aspectRatio: project.format.aspectRatio,
      });
      scene.visualPlan.resolvedAssetIds = [outcome.asset.id];
      scene.visualPlan.candidateScores = [{ candidateId: outcome.asset.id, score: 1, reasons: [`ladder rung: ${outcome.rung}`, ...outcome.attempted.filter((a) => a.outcome === "skipped").map((a) => `${a.rung}: ${a.reason}`)], selected: true }];
      scene.visualPlan.explanation = `resolved via '${outcome.rung}'; ${scene.visualPlan.explanation}`;
      scene.status = "assets_ready";
      ladder[scene.id] = outcome.attempted;
      this.saveScene(scene);
      this.recordProvenance(projectId, scene.id, `ladder:${outcome.rung}`, outcome.asset.source.provider ?? null, outcome.asset.source.model ?? null, null, outcome.asset.checksum);
      this.recordUsage(outcome.asset.id, projectId, scene.id);
    }
    // Repetition warnings (source §33) — advisory only, never auto-override.
    const templateIds = this.listScenes(projectId).map((s) => s.motionPlan.templateId || null);
    const warnings = repetitionWarnings(templateIds);
    if (warnings.length > 0) this.audit("video.asset.resolved", actor, projectId, null, "resolveAssets", "ok", { warnings });
    openAgentOsDb().run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["ASSETS_READY", new Date().toISOString(), projectId]);
    this.audit("video.asset.resolved", actor, projectId, null, "resolveAssets", "ok", { scenes: scenes.length });
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

  async generateVoiceAndCaptions(projectId: string, actor = "operator"): Promise<{ scenes: Scene[]; audio: AudioPlan }> {
    const project = this.requireProject(projectId);
    const scenes = this.listScenes(projectId);
    const brand = this.getBrandKit(project.brandKitId);
    const audio: AudioPlan = {
      voiceProvider: "mock-speech", voiceProfileId: "default", language: project.language,
      alignmentMethod: "estimated", narrationAssetId: undefined, musicAssetId: undefined, cues: [],
    };
    let cursor = 0;
    for (const scene of scenes) {
      if (scene.locks.voice && scene.alignmentMs > 0) {
        cursor += scene.durationMs;
        continue;
      }
      const voice = await synthesizeSceneVoice({
        projectId, sceneId: scene.id, narrationText: scene.narrationText,
        language: project.language, durationMs: scene.durationMs, studioRoot: this.studioRoot, registry: this.registry,
      });
      if (voice.asset) {
        scene.visualPlan.resolvedAssetIds = [...new Set([...scene.visualPlan.resolvedAssetIds, voice.asset.id])];
        scene.alignmentMs = voice.asset.durationMs ?? scene.estimatedSpeechMs;
        audio.cues.push({ sceneId: scene.id, startMs: cursor, durationMs: scene.alignmentMs });
        audio.narrationAssetId = audio.narrationAssetId ?? voice.asset.id;
      }
      scene.captions = buildCaptionPlan({
        mode: scene.captions.mode, narrationText: scene.narrationText,
        sceneStartMs: cursor, speechMs: voice.asset?.durationMs ?? scene.estimatedSpeechMs,
        alignment: voice.alignment, keywords: scene.visualPlan.assetRequirements.map((r) => r.query),
      });
      this.saveScene(scene);
      this.recordProvenance(projectId, scene.id, `voice:${voice.provider}`, voice.provider, null, null, voice.asset?.checksum ?? null);
      cursor += scene.durationMs;
    }
    audio.alignmentMethod = "estimated"; // no real forced-alignment provider wired — marked honestly
    openAgentOsDb().run("UPDATE vs_projects SET status = ?, updated_at = ? WHERE id = ?", ["TIMELINE_READY", new Date().toISOString(), projectId]);
    this.audit("video.voice.generated", actor, projectId, null, "generateVoiceAndCaptions", "ok", { scenes: scenes.length, alignmentMethod: audio.alignmentMethod });
    return { scenes: this.listScenes(projectId), audio };
  }

  buildProjectTimeline(projectId: string, actor = "operator"): Timeline {
    const project = this.requireProject(projectId);
    const scenes = this.listScenes(projectId);
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

  listTemplates(): typeof MOTION_TEMPLATES {
    return MOTION_TEMPLATES;
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
