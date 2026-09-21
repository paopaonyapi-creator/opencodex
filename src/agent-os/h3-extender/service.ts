// Phase 21.02 — H3 Extender Video Execution Service.

import { createHash } from "node:crypto";
import { H3Store, newH3Id, nowIso } from "./store";
import type {
  H3Clip,
  H3ClipAttempt,
  H3ExtenderJob,
  H3Project,
} from "./types";
import { h3ExtenderEnabled, H3_EXTENDER_DEFAULTS } from "./flags";

export function computeGenerationHash(clip: {
  projectId: string;
  sequenceIndex: number;
  promptStructured: Record<string, unknown>;
  seed?: string | null;
  modelId?: string | null;
}): string {
  const payload = JSON.stringify({
    p: clip.projectId,
    i: clip.sequenceIndex,
    pr: clip.promptStructured,
    s: clip.seed ?? "",
    m: clip.modelId ?? "",
  });
  return createHash("sha256").update(payload).digest("hex");
}

export class H3ExtenderService {
  private store = new H3Store();

  assertEnabled(): void {
    if (!h3ExtenderEnabled()) {
      throw new Error("Phase 21.02 MiniMax H3 Extender is disabled");
    }
  }

  // -------------------------------------------------------------------------
  // Project Lifecycle
  // -------------------------------------------------------------------------
  createProject(name: string, productionMode: "continuous" | "independent" = "continuous", budgetLimit?: number): H3Project {
    this.assertEnabled();
    const project: H3Project = {
      id: newH3Id("h3p"),
      name,
      status: "draft",
      productionMode,
      workflowTemplateVer: 1,
      upstreamVersion: H3_EXTENDER_DEFAULTS.upstreamVersion,
      budgetLimit: budgetLimit ?? null,
      estimatedCost: 0,
      actualCost: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertProject(project);
    this.store.addAuditEvent({
      id: newH3Id("h3aud"),
      projectId: project.id,
      eventType: "project.created",
      after: { name, productionMode },
      metadata: {},
      createdAt: nowIso(),
    });
    return project;
  }

  getProject(id: string): H3Project | null {
    this.assertEnabled();
    return this.store.getProject(id);
  }

  listProjects(): H3Project[] {
    this.assertEnabled();
    return this.store.listProjects();
  }

  // -------------------------------------------------------------------------
  // Clip Management
  // -------------------------------------------------------------------------
  addClip(projectId: string, sequenceIndex: number, prompt: Record<string, unknown>, duration = 5.0, seed?: string): H3Clip {
    this.assertEnabled();
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const genHash = computeGenerationHash({ projectId, sequenceIndex, promptStructured: prompt, seed });
    const clip: H3Clip = {
      id: newH3Id("h3c"),
      projectId,
      sequenceIndex,
      state: "draft",
      mode: project.productionMode,
      durationSeconds: duration,
      promptStructured: prompt,
      seed: seed ?? null,
      generationHash: genHash,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertClip(clip);
    return clip;
  }

  listClips(projectId: string): H3Clip[] {
    this.assertEnabled();
    return this.store.listClips(projectId);
  }

  getClip(id: string): H3Clip | null {
    this.assertEnabled();
    return this.store.getClip(id);
  }

  // -------------------------------------------------------------------------
  // Generation & Attempt Cycle (§13, §14)
  // -------------------------------------------------------------------------
  generateClip(clipId: string): H3ClipAttempt {
    this.assertEnabled();
    const clip = this.store.getClip(clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    const attempts = this.store.listAttempts(clipId);
    const attemptNum = attempts.length + 1;
    if (attemptNum > H3_EXTENDER_DEFAULTS.maxAttemptsPerClip) {
      clip.state = "failed";
      clip.updatedAt = nowIso();
      this.store.upsertClip(clip);
      throw new Error(`Max generation attempts (${H3_EXTENDER_DEFAULTS.maxAttemptsPerClip}) exceeded for clip ${clipId}`);
    }

    const attempt: H3ClipAttempt = {
      id: newH3Id("h3att"),
      clipId,
      attemptNumber: attemptNum,
      generationHash: clip.generationHash || "unknown",
      status: "success",
      previewAssetId: newH3Id("h3ast_prev"),
      outputAssetId: newH3Id("h3ast_out"),
      estimatedCost: 0.15,
      actualCost: 0.15,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      createdAt: nowIso(),
    };
    this.store.createAttempt(attempt);

    clip.state = "preview_ready";
    clip.activeAttemptId = attempt.id;
    clip.updatedAt = nowIso();
    this.store.upsertClip(clip);

    this.store.addAuditEvent({
      id: newH3Id("h3aud"),
      projectId: clip.projectId,
      eventType: "clip.generated",
      targetType: "clip",
      targetId: clip.id,
      metadata: { attemptNumber: attemptNum, duration: clip.durationSeconds },
      createdAt: nowIso(),
    });

    return attempt;
  }

  validateClip(clipId: string, validatorId = "human-reviewer"): H3Clip {
    this.assertEnabled();
    const clip = this.store.getClip(clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);
    if (clip.state !== "preview_ready") {
      throw new Error(`Cannot validate clip in state '${clip.state}', expected 'preview_ready'`);
    }

    clip.state = "validated";
    clip.validatedHash = clip.generationHash;
    clip.validatedAt = nowIso();
    clip.validatedById = validatorId;
    clip.updatedAt = nowIso();
    this.store.upsertClip(clip);

    this.store.addAuditEvent({
      id: newH3Id("h3aud"),
      projectId: clip.projectId,
      eventType: "clip.validated",
      targetType: "clip",
      targetId: clip.id,
      metadata: { validatedBy: validatorId },
      createdAt: nowIso(),
    });

    return clip;
  }

  // Invalidation when prompt or seed mutates (§15)
  updateClipPrompt(clipId: string, prompt: Record<string, unknown>, seed?: string): H3Clip {
    this.assertEnabled();
    const clip = this.store.getClip(clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    const newHash = computeGenerationHash({
      projectId: clip.projectId,
      sequenceIndex: clip.sequenceIndex,
      promptStructured: prompt,
      seed: seed ?? clip.seed,
    });

    clip.promptStructured = prompt;
    if (seed !== undefined) clip.seed = seed;
    clip.generationHash = newHash;

    // If clip was validated, mutation invalidates it back to draft (§15)
    if (clip.state === "validated" && newHash !== clip.validatedHash) {
      clip.state = "draft";
      clip.validatedHash = null;
      clip.validatedAt = null;
    }
    clip.updatedAt = nowIso();
    this.store.upsertClip(clip);
    return clip;
  }
}

let singletonH3: H3ExtenderService | null = null;
export function getH3ExtenderService(): H3ExtenderService {
  if (!singletonH3) {
    singletonH3 = new H3ExtenderService();
  }
  return singletonH3;
}
