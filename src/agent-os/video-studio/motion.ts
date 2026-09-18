// Phase 20.92 — Motion Primitive Registry + Motion Template Registry.
//
// Registry/plugin design (source §15): templates declare metadata (supported
// intents, required data, aspect ratios, duration range, motion profile) and
// the selector matches intent → template deterministically. Motion is
// parameterized via MotionCue records — animation behavior is never hard-coded
// into project data. Only primitives required by the MVP templates are defined
// here; the renderer implements the ones it needs and ignores the rest
// honestly (QA flags unsupported usage).

import type { MotionPrimitive, Scene, SceneIntent } from "./types";

export const MOTION_PRIMITIVES: readonly MotionPrimitive[] = [
  "fade", "slide", "scale", "spring", "pop", "stagger", "wipe", "maskReveal",
  "countUp", "typewriter", "highlight", "underline", "pulse", "pan", "zoom",
  "parallax",
];

export interface MotionTemplate {
  id: string;
  /** Scene intents this template supports (source §18 metadata). */
  supportsIntents: SceneIntent[];
  requiredData: string[];
  aspectRatios: Array<"16:9" | "9:16" | "1:1" | "4:5">;
  durationRangeMs: [number, number];
  energy: Array<"calm" | "balanced" | "dynamic">;
  version: string;
  /** Entrance/emphasis/exit primitive triple the renderer executes. */
  motion: { entrance: MotionPrimitive; emphasis: MotionPrimitive; exit: MotionPrimitive };
  /** Scene-element model the renderer draws (deterministic layout). */
  elements: Array<{ kind: "title" | "text" | "number" | "icon" | "list" | "compare" | "steps" | "timeline" | "quote"; slots: number }>;
}

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  { id: "hero-title", supportsIntents: ["INTRO_HOOK", "CTA", "OUTRO"], requiredData: ["title"], aspectRatios: ["16:9", "9:16", "1:1", "4:5"], durationRangeMs: [2000, 8000], energy: ["calm", "balanced", "dynamic"], version: "1.0.0", motion: { entrance: "fade", emphasis: "scale", exit: "fade" }, elements: [{ kind: "title", slots: 1 }] },
  { id: "definition-card", supportsIntents: ["DEFINITION", "CONCEPT"], requiredData: ["title", "text"], aspectRatios: ["16:9", "9:16"], durationRangeMs: [2500, 10000], energy: ["calm", "balanced"], version: "1.0.0", motion: { entrance: "wipe", emphasis: "highlight", exit: "fade" }, elements: [{ kind: "text", slots: 1 }] },
  { id: "icon-text", supportsIntents: ["EXPLANATION", "PRODUCT_FEATURE"], requiredData: ["text", "icon"], aspectRatios: ["16:9", "9:16", "1:1"], durationRangeMs: [2000, 9000], energy: ["calm", "balanced", "dynamic"], version: "1.0.0", motion: { entrance: "slide", emphasis: "pulse", exit: "fade" }, elements: [{ kind: "icon", slots: 1 }, { kind: "text", slots: 1 }] },
  { id: "two-column-compare", supportsIntents: ["COMPARISON"], requiredData: ["left", "right"], aspectRatios: ["16:9"], durationRangeMs: [3000, 12000], energy: ["balanced", "dynamic"], version: "1.0.0", motion: { entrance: "stagger", emphasis: "highlight", exit: "wipe" }, elements: [{ kind: "compare", slots: 2 }] },
  { id: "three-step-process", supportsIntents: ["PROCESS"], requiredData: ["steps"], aspectRatios: ["16:9", "9:16"], durationRangeMs: [3000, 12000], energy: ["balanced", "dynamic"], version: "1.0.0", motion: { entrance: "stagger", emphasis: "highlight", exit: "fade" }, elements: [{ kind: "steps", slots: 3 }] },
  { id: "timeline-horizontal", supportsIntents: ["TIMELINE"], requiredData: ["events"], aspectRatios: ["16:9"], durationRangeMs: [3000, 14000], energy: ["calm", "balanced"], version: "1.0.0", motion: { entrance: "wipe", emphasis: "pulse", exit: "fade" }, elements: [{ kind: "timeline", slots: 4 }] },
  { id: "quote-card", supportsIntents: ["QUOTE"], requiredData: ["quote", "author"], aspectRatios: ["16:9", "9:16"], durationRangeMs: [2500, 9000], energy: ["calm"], version: "1.0.0", motion: { entrance: "maskReveal", emphasis: "underline", exit: "fade" }, elements: [{ kind: "quote", slots: 1 }] },
  { id: "stat-counter", supportsIntents: ["STATISTIC", "COMPARISON"], requiredData: ["number", "label"], aspectRatios: ["16:9", "9:16", "1:1"], durationRangeMs: [2000, 7000], energy: ["balanced", "dynamic"], version: "1.0.0", motion: { entrance: "pop", emphasis: "countUp", exit: "fade" }, elements: [{ kind: "number", slots: 1 }] },
  { id: "bullet-reveal", supportsIntents: ["LIST"], requiredData: ["items"], aspectRatios: ["16:9", "9:16"], durationRangeMs: [3000, 12000], energy: ["calm", "balanced", "dynamic"], version: "1.0.0", motion: { entrance: "stagger", emphasis: "highlight", exit: "fade" }, elements: [{ kind: "list", slots: 5 }] },
  { id: "kinetic-keyword", supportsIntents: ["INTRO_HOOK", "CONCEPT"], requiredData: ["keywords"], aspectRatios: ["16:9", "9:16", "1:1", "4:5"], durationRangeMs: [2000, 8000], energy: ["dynamic"], version: "1.0.0", motion: { entrance: "typewriter", emphasis: "pulse", exit: "fade" }, elements: [{ kind: "text", slots: 3 }] },
  { id: "cta-card", supportsIntents: ["CTA", "OUTRO"], requiredData: ["title"], aspectRatios: ["16:9", "9:16", "1:1", "4:5"], durationRangeMs: [2000, 6000], energy: ["balanced", "dynamic"], version: "1.0.0", motion: { entrance: "pop", emphasis: "pulse", exit: "fade" }, elements: [{ kind: "title", slots: 1 }] },
];

/** Intent-aware deterministic selection (source §18: template metadata drives it). */
export function selectTemplate(scene: Pick<Scene, "intent" | "durationMs" | "visualPlan">, aspectRatio: string, energy: "calm" | "balanced" | "dynamic"): MotionTemplate | null {
  const candidates = MOTION_TEMPLATES.filter((t) => {
    if (!t.supportsIntents.includes(scene.intent)) return false;
    if (!t.aspectRatios.includes(aspectRatio as never)) return false;
    if (scene.durationMs < t.durationRangeMs[0] || scene.durationMs > t.durationRangeMs[1] * 1.5) return false;
    return t.energy.includes(energy);
  });
  if (candidates.length === 0) {
    // Fallback: relax duration; intent match still required.
    const relaxed = MOTION_TEMPLATES.filter((t) => t.supportsIntents.includes(scene.intent) && t.aspectRatios.includes(aspectRatio as never));
    return relaxed[0] ?? null;
  }
  return candidates[0]!;
}

/** Repetition control (source §33): consecutive reuse warnings, never auto-override. */
export function repetitionWarnings(templates: Array<string | null>): Array<{ sceneOrder: number; warning: string }> {
  const warnings: Array<{ sceneOrder: number; warning: string }> = [];
  let streak = 1;
  for (let i = 1; i <= templates.length; i++) {
    if (i < templates.length && templates[i] !== null && templates[i] === templates[i - 1]) {
      streak++;
    } else {
      if (streak >= 3 && templates[i - 1]) {
        warnings.push({ sceneOrder: i - streak, warning: `template '${templates[i - 1]}' repeated ${streak} scenes consecutively — consider variety` });
      }
      streak = 1;
    }
  }
  return warnings;
}
