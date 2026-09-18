// Phase 20.92 — Automated QA Engine (source §44 six categories, static checks
// that run deterministically before any render). Render QA runs post-render
// against the ffprobe result.

import type { QAReport, Scene, Timeline } from "./types";

export interface QAInput {
  projectId: string;
  scenes: Scene[];
  timeline: Timeline | null;
  /** assetId → exists on disk */
  assetPresence: Map<string, boolean>;
  renderProbe: { durationSec: number; width: number; height: number; hasStream: boolean } | null;
  expectedDurationMs: number | null;
  expectedProfile: { width: number; height: number } | null;
}

export function runQA(input: QAInput): QAReport {
  const checks: QAReport["checks"] = [];
  const add = (category: QAReport["checks"][number]["category"], name: string, passed: boolean, detail = "") =>
    checks.push({ category, name, passed, detail });

  // Script QA
  const emptyScenes = input.scenes.filter((s) => s.narrationText.trim().length === 0);
  add("script", "non-empty narration", emptyScenes.length === 0, emptyScenes.length > 0 ? `${emptyScenes.length} empty scene(s)` : "");
  const texts = input.scenes.map((s) => s.narrationText.trim());
  add("script", "no duplicate scene text", new Set(texts).size === texts.length, "duplicate narration across scenes");
  const badDurations = input.scenes.filter((s) => s.durationMs <= 0 || s.durationMs > 120_000);
  add("script", "scene durations valid", badDurations.length === 0, badDurations.map((s) => s.id).join(","));

  // Asset QA — every scene's resolved assets must exist on disk.
  const missing: string[] = [];
  for (const scene of input.scenes) {
    for (const assetId of scene.visualPlan.resolvedAssetIds) {
      if (input.assetPresence.get(assetId) === false) missing.push(`${scene.id}:${assetId}`);
    }
  }
  add("asset", "resolved assets present", missing.length === 0, missing.join(","));

  // Layout QA — caption overflow risk + bottom safe area on vertical formats.
  const overflow = input.scenes.filter((s) => s.captions.overflowRisk);
  add("layout", "caption overflow risk", overflow.length === 0, overflow.map((s) => s.id).join(","));
  add("layout", "caption safe area", input.scenes.every((s) => s.captions.safeAreaBottomMs));

  // Timeline QA — deterministic validity.
  if (input.timeline) {
    const negative = input.timeline.tracks.flatMap((t) => t.clips).filter((c) => c.startMs < 0 || c.durationMs <= 0 || c.endFrame < c.startFrame);
    add("timeline", "clip timing valid", negative.length === 0, `${negative.length} bad clip(s)`);
    add("timeline", "scene coverage", input.timeline.durationMs >= input.scenes.reduce((sum, s) => sum + s.durationMs, 0) - 1, "timeline shorter than scene sum");
    const gaps = detectVisualGaps(input.timeline);
    add("timeline", "no visual gaps", gaps.length === 0, gaps.join(","));
    add("timeline", "too-short scenes", input.scenes.every((s) => s.durationMs >= 1000), "scene below 1s");
  } else {
    add("timeline", "timeline built", false, "timeline not built yet");
  }

  // Audio QA — narration asset per non-locked-voice scene where speech exists.
  const silent = input.scenes.filter((s) => s.estimatedSpeechMs > 0 && !input.timeline?.tracks.find((t) => t.type === "voice")?.clips.some((c) => c.sceneId === s.id));
  add("audio", "narration coverage", silent.length === 0, silent.map((s) => s.id).join(","));

  // Render QA — post-render probe.
  if (input.renderProbe) {
    add("render", "render file playable", input.renderProbe.hasStream && input.renderProbe.durationSec > 0, `duration=${input.renderProbe.durationSec}s`);
    if (input.expectedProfile) {
      add("render", "render resolution", input.renderProbe.width === input.expectedProfile.width && input.renderProbe.height === input.expectedProfile.height, `${input.renderProbe.width}x${input.renderProbe.height} vs ${input.expectedProfile.width}x${input.expectedProfile.height}`);
    }
    if (input.expectedDurationMs) {
      const ratio = input.renderProbe.durationSec * 1000 / input.expectedDurationMs;
      add("render", "render duration matches timeline", ratio > 0.9 && ratio < 1.15, `${(ratio * 100).toFixed(0)}% of timeline`);
    }
  }

  return { projectId: input.projectId, passed: checks.every((c) => c.passed), checks, createdAt: new Date().toISOString() };
}

function detectVisualGaps(timeline: Timeline): string[] {
  const visual = timeline.tracks.find((t) => t.type === "image");
  if (!visual) return ["no visual track"];
  const sorted = [...visual.clips].sort((a, b) => a.startMs - b.startMs);
  const gaps: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1]!.startMs + sorted[i - 1]!.durationMs;
    if (sorted[i]!.startMs > prevEnd + 50) gaps.push(`gap@${prevEnd}ms`);
  }
  return gaps;
}
