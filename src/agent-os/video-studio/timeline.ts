// Phase 20.92 — Deterministic Timeline Engine.
//
// Architectural boundary (source §20): LLMs may generate intent/emphasis/
// narrative plans; FINAL frame timing is computed HERE, deterministically —
// startMs, durationMs, track placement, frame conversion, caption timing,
// transition timing. Same input → same timeline (verified by timelineHash).

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { TimelineSchema, type Scene, type Timeline, type TimelineClip, type TimelineTrack } from "./types";

function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

export interface BuildTimelineInput {
  scenes: Scene[];
  fps: number;
  /** narration asset id per scene (ordered) — missing audio still yields a silent scene. */
  narrationAssetIds: Array<string | null>;
  /** resolved background/card asset id per scene (ordered). */
  visualAssetIds: Array<string | null>;
}

export function buildTimeline(input: BuildTimelineInput): Timeline {
  const fps = input.fps;
  const tracks: TimelineTrack[] = [
    { id: "trk_visual", type: "image", clips: [] },
    { id: "trk_graphics", type: "graphics", clips: [] },
    { id: "trk_text", type: "text", clips: [] },
    { id: "trk_voice", type: "voice", clips: [] },
    { id: "trk_caption", type: "caption", clips: [] },
  ];
  const visual = tracks[0]!;
  const graphics = tracks[1]!;
  const text = tracks[2]!;
  const voice = tracks[3]!;
  const caption = tracks[4]!;

  let cursorMs = 0;
  for (let i = 0; i < input.scenes.length; i++) {
    const scene = input.scenes[i]!;
    // Timing lock: keep the scene's persisted duration (human override wins);
    // otherwise the deterministic formula output is already in durationMs.
    const sceneStart = cursorMs;
    const sceneEnd = sceneStart + scene.durationMs;

    visual.clips.push(clip("image", scene, sceneStart, scene.durationMs, input.visualAssetIds[i] ?? undefined, scene.transitionInMs, fps));

    const narration = input.narrationAssetIds[i] ?? null;
    if (narration) {
      const voiceMs = Math.min(scene.estimatedSpeechMs || scene.durationMs, scene.durationMs);
      voice.clips.push(clip("voice", scene, sceneStart, voiceMs, narration, 0, fps));
    }

    for (const cue of scene.captions.cues) {
      caption.clips.push({
        id: `clip_cap_${randomUUID().slice(0, 8)}`,
        trackType: "caption",
        sceneId: scene.id,
        startMs: cue.startMs,
        durationMs: Math.max(1, cue.endMs - cue.startMs),
        startFrame: msToFrame(cue.startMs, fps),
        endFrame: msToFrame(cue.endMs, fps),
        text: cue.text,
        transitionInMs: 0,
      });
    }

    // Motion emphasis cue lands mid-scene (deterministic placement).
    graphics.clips.push({
      id: `clip_mot_${randomUUID().slice(0, 8)}`,
      trackType: "graphics",
      sceneId: scene.id,
      startMs: sceneStart + Math.round(scene.durationMs * 0.15),
      durationMs: Math.max(400, Math.round(scene.durationMs * 0.25)),
      startFrame: msToFrame(sceneStart + Math.round(scene.durationMs * 0.15), fps),
      endFrame: msToFrame(sceneStart + Math.round(scene.durationMs * 0.40), fps),
      transitionInMs: 0,
      text: `${scene.motionPlan.entrance}/${scene.motionPlan.emphasis}`,
    });

    text.clips.push({
      id: `clip_txt_${randomUUID().slice(0, 8)}`,
      trackType: "text",
      sceneId: scene.id,
      startMs: sceneStart,
      durationMs: scene.durationMs,
      startFrame: msToFrame(sceneStart, fps),
      endFrame: msToFrame(sceneEnd, fps),
      text: scene.narrationText.slice(0, 80),
      transitionInMs: scene.transitionInMs,
    });

    cursorMs = sceneEnd;
  }

  const timeline: Timeline = {
    fps,
    durationMs: cursorMs,
    tracks: [visual, graphics, text, voice, caption],
    timelineHash: createHash("sha256").update(JSON.stringify([fps, cursorMs, tracks.map((t) => t.clips.map((c) => [c.trackType, c.startMs, c.durationMs, c.sourceId]))])).digest("hex").slice(0, 32),
  };
  return TimelineSchema.parse(timeline);
}

function clip(type: TimelineClip["trackType"], scene: Scene, startMs: number, durationMs: number, sourceId: string | undefined, transitionInMs: number, fps: number): TimelineClip {
  return {
    id: `clip_${type}_${randomUUID().slice(0, 8)}`,
    trackType: type,
    sceneId: scene.id,
    sourceId,
    startMs,
    durationMs,
    startFrame: msToFrame(startMs, fps),
    endFrame: msToFrame(startMs + durationMs, fps),
    transitionInMs,
  };
}
