// Phase 20.92 — Automatic Scene Planner + intent classification.
//
// Deterministic rule-based planning: narration → intent → visual strategy →
// layout → asset requirements → motion suggestion → duration. Produces
// structured Scene plans persisted in the project model — never natural-
// language-only suggestions. An LLM may refine, but every refinement passes
// SceneSchema before persisting.

import { randomUUID } from "node:crypto";
import {
  SceneSchema,
  type CaptionMode,
  type Scene,
  type SceneIntent,
  type SceneLocks,
  type ScriptBlock,
  type VisualStrategy,
} from "./types";

const INTENT_RULES: Array<{ intent: SceneIntent; keywords: RegExp }> = [
  { intent: "INTRO_HOOK", keywords: /\b(hook|imagine|what if|introducing|welcome)\b/i },
  { intent: "DEFINITION", keywords: /\b(is defined as|means|refers to|definition|คือ|หมายถึง)\b/i },
  { intent: "PROCESS", keywords: /\b(step|process|first|then|next|finally|workflow|pipeline)\b/i },
  { intent: "COMPARISON", keywords: /\b(instead|rather|compared|unlike|versus|vs|however|แต่|เทียบ)\b/i },
  { intent: "STATISTIC", keywords: /(\d+%|\bpercent\b|\bx\b.*faster|\bnumber\b|\bcount\b)/i },
  { intent: "QUOTE", keywords: /("[^"]{8,}"|according to|said|กล่าวว่า)/ },
  { intent: "TIMELINE", keywords: /\b(19|20)\d{2}\b|\b(timeline|history|evolution|over time)\b/i },
  { intent: "LIST", keywords: /\b(three|four|five|several|including|such as|ประกอบด้วย)\b/i },
  { intent: "PRODUCT_FEATURE", keywords: /\b(feature|capability|supports|offers|pricing)\b/i },
  { intent: "SCREEN_DEMO", keywords: /\b(dashboard|interface|screenshot|app|ui|click)\b/i },
  { intent: "MAP", keywords: /\b(country|region|global|world|city|map)\b/i },
  { intent: "PERSON", keywords: /\b(founder|ceo|engineer|researcher|team|person)\b/i },
  { intent: "CTA", keywords: /\b(try|sign up|get started|subscribe|start now)\b/i },
  { intent: "OUTRO", keywords: /\b(thanks for watching|see you|follow for)\b/i },
];

const INTENT_STRATEGY: Record<SceneIntent, VisualStrategy> = {
  INTRO_HOOK: "KINETIC_TYPOGRAPHY",
  DEFINITION: "TEXT_ONLY",
  EXPLANATION: "ICON",
  PROCESS: "DIAGRAM",
  COMPARISON: "COMPARISON",
  STATISTIC: "TEXT_ONLY",
  QUOTE: "QUOTE",
  TIMELINE: "TIMELINE",
  LIST: "LIST",
  PRODUCT_FEATURE: "ICON",
  SCREEN_DEMO: "SCREENSHOT",
  MAP: "MAP",
  PERSON: "PERSON",
  CONCEPT: "ILLUSTRATION",
  CTA: "TEXT_ONLY",
  OUTRO: "TEXT_ONLY",
};

const INTENT_LAYOUT: Record<SceneIntent, string> = {
  INTRO_HOOK: "center-hero",
  DEFINITION: "definition-card",
  EXPLANATION: "icon-text",
  PROCESS: "horizontal-steps",
  COMPARISON: "two-column",
  STATISTIC: "big-number",
  QUOTE: "quote-card",
  TIMELINE: "timeline-horizontal",
  LIST: "bullet-list",
  PRODUCT_FEATURE: "feature-grid",
  SCREEN_DEMO: "screen-frame",
  MAP: "map-focus",
  PERSON: "person-profile",
  CONCEPT: "illustration-focus",
  CTA: "center-hero",
  OUTRO: "center-hero",
};

const INTENT_CAPTION: Partial<Record<SceneIntent, CaptionMode>> = {
  INTRO_HOOK: "WORD_HIGHLIGHT",
  STATISTIC: "KEYWORD_ONLY",
  QUOTE: "FULL_SUBTITLE",
  CTA: "NONE",
  OUTRO: "NONE",
};

/** Visual strategies renderable deterministically without external AI providers. */
export const MVP_RENDERABLE_STRATEGIES = new Set<VisualStrategy>([
  "TEXT_ONLY", "KINETIC_TYPOGRAPHY", "ICON", "LIST", "COMPARISON", "TIMELINE", "QUOTE", "DIAGRAM",
]);

export function classifyIntent(text: string): SceneIntent {
  for (const rule of INTENT_RULES) {
    if (rule.keywords.test(text)) return rule.intent;
  }
  return "EXPLANATION";
}

/**
 * Scene duration formula (source §23): speech + reading time + entrance +
 * transition. Entrance/transition constants derive from the brand motion
 * energy at planning time (calm=longer holds).
 */
export function sceneDurationMs(estimatedSpeechMs: number, energy: "calm" | "balanced" | "dynamic"): number {
  const readTime = Math.round(estimatedSpeechMs * 0.18);
  const entrance = energy === "dynamic" ? 300 : energy === "calm" ? 600 : 400;
  const transition = 300;
  return Math.max(1500, estimatedSpeechMs + readTime + entrance + transition);
}

const NO_LOCKS: SceneLocks = { script: false, asset: false, layout: false, motion: false, timing: false, voice: false };

export interface PlanSceneInput {
  projectId: string;
  blocks: ScriptBlock[];
  energy: "calm" | "balanced" | "dynamic";
}

/** Plan one scene per block group. Callers may merge blocks before planning. */
export function planScene(projectId: string, blocks: ScriptBlock[], energy: "calm" | "balanced" | "dynamic", order: number): Scene {
  const narration = blocks.map((b) => b.text).join(" ");
  const intent = classifyIntent(narration);
  const strategy = INTENT_STRATEGY[intent];
  const speechMs = blocks.reduce((sum, b) => sum + b.estimatedSpeechMs, 0);
  const scene: Scene = {
    id: `scn_${randomUUID().slice(0, 12)}`,
    projectId,
    order,
    blockIds: blocks.map((b) => b.id),
    narrationText: narration,
    intent,
    durationMs: sceneDurationMs(speechMs, energy),
    estimatedSpeechMs: speechMs,
    alignmentMs: 0,
    visualPlan: {
      strategy,
      layout: INTENT_LAYOUT[intent],
      assetRequirements: strategy === "ICON" || strategy === "DIAGRAM"
        ? [{ kind: "icon" as const, query: blocks.flatMap((b) => b.keywords).slice(0, 2).join(" ") || "concept", optional: false }]
        : [],
      resolvedAssetIds: [],
      explanation: `intent=${intent} → strategy=${strategy} (deterministic rule)`,
      generationVersion: 0,
      candidateScores: [],
    },
    motionPlan: {
      templateId: "",
      entrance: energy === "dynamic" ? "pop" : energy === "calm" ? "fade" : "slide",
      emphasis: "highlight",
      exit: "fade",
      cues: [],
    },
    captions: {
      mode: INTENT_CAPTION[intent] ?? "FULL_SUBTITLE",
      cues: [],
      maxLines: 2,
      safeAreaBottomMs: true,
      overflowRisk: false,
    },
    transitionInMs: 300,
    transitionOutMs: 300,
    locks: { ...NO_LOCKS },
    disabled: false,
    status: "planned",
  };
  return SceneSchema.parse(scene);
}

export function planScenesFromBlocks(input: PlanSceneInput): Scene[] {
  return input.blocks.map((block, index) => planScene(input.projectId, [block], input.energy, index));
}

export { NO_LOCKS };
