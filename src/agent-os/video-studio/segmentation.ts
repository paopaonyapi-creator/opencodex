// Phase 20.92 — Semantic Script Segmentation.
//
// Deterministic-first segmentation: sentence-boundary detection combined with
// discourse markers, entity shift, information density and speech-duration
// budgeting. Punctuation alone never splits a scene (source §8) — a boundary
// needs a semantic reason. An LLM may later refine block metadata, but every
// payload passes ScriptDocumentSchema before it enters the project model.

import { createHash } from "node:crypto";
import { ScriptDocumentSchema, type ScriptBlock, type ScriptDocument, type SemanticRole } from "./types";

/** Discourse markers that signal a topic/beat shift worth a scene boundary. */
const SHIFT_MARKERS = [
  "however", "but", "instead", "meanwhile", "then", "next", "finally",
  "first", "second", "third", "for example", "for instance", "in contrast",
  "on the other hand", "as a result", "therefore", "so that", "because",
  "ในขณะที่", "อย่างไรก็ตาม", "แต่", "จากนั้น", "ต่อมา", "สุดท้าย", "ตัวอย่างเช่น", "เพราะ",
];

const ROLE_MARKERS: Array<{ role: SemanticRole; markers: RegExp }> = [
  { role: "hook", markers: /^(imagine|what if|did you know|here'?s|ever wondered|ลองนึกภาพ|รู้ไหม|จะเกิดอะไรขึ้น)/i },
  { role: "cta", markers: /(try it|sign up|get started|subscribe|learn more|ลองดู|สมัคร|เริ่มใช้)/i },
  { role: "conclusion", markers: /(in conclusion|to sum up|that'?s why|in short|โดยสรุป|สรุปว่า|ดังนั้น)/i },
  { role: "example", markers: /(for example|for instance|such as|e\.g\.|ตัวอย่างเช่น|ยกตัวอย่าง)/i },
  { role: "comparison", markers: /(instead of|rather than|compared to|unlike|versus|แทนที่จะ|เทียบกับ|ต่างจาก)/i },
  { role: "transition", markers: /^(so|now|next|then|meanwhile|แล้ว|ต่อไป|จากนั้น)/i },
];

/** Rough speech pacing: Thai clusters denser than English words. */
function speechMsFor(text: string, language: string): number {
  if (language.startsWith("th")) {
    // Thai has no spaces; count characters, ~11 chars/sec spoken.
    const chars = text.replace(/\s+/g, "").length;
    return Math.max(1200, Math.round((chars / 11) * 1000));
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1200, Math.round((words / 2.6) * 1000)); // ~156 wpm
}

function splitSentences(text: string): string[] {
  // Guard abbreviations/decimals; split on sentence enders (Latin + Thai).
  const guarded = text.replace(/(\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs)\.)/gi, "\u0001$1").replace(/(\d)\.(\d)/g, "$1\u0001$2");
  return guarded
    .split(/(?<=[.!?])\s+|(?<=[。]|!\s*|\?\s*)|\n{2,}/)
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

function extractKeywords(text: string): string[] {
  const stop = new Set(["the", "a", "an", "is", "are", "to", "of", "and", "in", "that", "it", "for", "on", "with", "as", "by", "this", "can", "be", "when", "not", "from"]);
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}|[\u0e00-\u0e7f]+/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (stop.has(w) || w.length < 3) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

function extractEntities(text: string): string[] {
  // Capitalized multiword/singleword tokens (Latin scripts) — lightweight NER.
  const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) ?? [];
  return [...new Set(matches)].filter((m) => m.length > 2).slice(0, 5);
}

function classifyRole(text: string, index: number, total: number): SemanticRole {
  if (index === 0 && total > 1) return "hook";
  if (index === total - 1 && total > 2) return "conclusion";
  for (const { role, markers } of ROLE_MARKERS) {
    if (markers.test(text)) return role;
  }
  return "explanation";
}

export interface SegmentOptions {
  language: string;
  /** Target scene count when the caller pins pacing (e.g. acceptance = 3–5 scenes). */
  targetScenes?: number;
}

/**
 * Segment narration into a ScriptDocument. Boundary rule: a new scene opens
 * when a sentence carries a shift marker OR entity churn is high OR the
 * accumulated speech time crosses the per-scene budget derived from
 * targetScenes (semantic reasons, never punctuation alone).
 */
export function segmentScript(rawInput: string, opts: SegmentOptions): ScriptDocument {
  const text = rawInput.trim();
  if (!text) throw new Error("empty script");
  const sentences = splitSentences(text);
  if (sentences.length === 0) throw new Error("no sentences found in script");

  const targetScenes = Math.max(2, Math.min(opts.targetScenes ?? 8, 12));
  const totalMs = sentences.reduce((sum, s) => sum + speechMsFor(s, opts.language), 0);
  const budgetMs = Math.round(totalMs / targetScenes);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentMs = 0;
  let currentEntities = new Set<string>();

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const ms = speechMsFor(sentence, opts.language);
    const entities = extractEntities(sentence);
    const hasShift = SHIFT_MARKERS.some((m) => sentence.toLowerCase().startsWith(m) || sentence.toLowerCase().includes(` ${m} `));
    const entityChurn = currentEntities.size > 0 && entities.filter((e) => !currentEntities.has(e)).length / Math.max(1, entities.length) > 0.7;

    const boundary = current.length > 0 && (hasShift || (entityChurn && currentMs >= budgetMs * 0.5) || currentMs >= budgetMs);
    if (boundary && groups.length < targetScenes * 2) {
      groups.push(current);
      current = [];
      currentMs = 0;
      currentEntities = new Set();
    }
    current.push(sentence);
    currentMs += ms;
    for (const e of entities) currentEntities.add(e);
  }
  if (current.length > 0) groups.push(current);

  const total = groups.length;
  const blocks: ScriptBlock[] = groups.map((group, index) => {
    const blockText = group.join(" ");
    return {
      id: `blk_${String(index + 1).padStart(3, "0")}`,
      text: blockText,
      semanticRole: classifyRole(blockText, index, total),
      keywords: extractKeywords(blockText),
      entities: extractEntities(blockText),
      visualHints: extractKeywords(blockText).slice(0, 2),
      importance: index === 0 || index === total - 1 ? 0.9 : 0.5,
      estimatedSpeechMs: group.reduce((sum, s) => sum + speechMsFor(s, opts.language), 0),
    };
  });

  const doc: ScriptDocument = {
    language: opts.language,
    title: text.split(/[.!?\n]/)[0]?.slice(0, 80) || undefined,
    hook: blocks[0]?.text,
    blocks,
    estimatedSpeechDurationMs: blocks.reduce((sum, b) => sum + b.estimatedSpeechMs, 0),
  };
  return ScriptDocumentSchema.parse(doc);
}

/** Stable hash of script content — the invalidation identity for scene plans. */
export function hashScript(doc: ScriptDocument): string {
  return createHash("sha256").update(JSON.stringify(doc.blocks.map((b) => [b.id, b.text]))).digest("hex").slice(0, 32);
}
