// Phase 20.12 — Self-Healing Element Matcher
//
// Recovers broken workflows caused by UI/DOM layout shifts.
// Uses multi-signal heuristic similarity scoring (role, text, tag, attributes)
// with a confidence threshold >= 0.60 to autonomously remap displaced targets.

import type { ElementSignature, SelfHealingResult } from "./types";
import type { PageSnapshot, SnapshotElement } from "../types";
import { getTaskMemoryManager } from "./task-memory";

export class SelfHealingMatcher {
  private readonly confidenceThreshold = 0.6;

  /**
   * Attempts to heal a failed element reference on the given page snapshot.
   */
  public heal(
    target: string | ElementSignature,
    snapshot: PageSnapshot,
    domain?: string,
  ): SelfHealingResult {
    const originalTargetStr = typeof target === "string" ? target : JSON.stringify(target);

    if (!snapshot || !snapshot.elements || snapshot.elements.length === 0) {
      return {
        healed: false,
        originalTarget: originalTargetStr,
        healedTarget: "",
        confidence: 0,
        strategy: "none",
      };
    }

    // 1. Check Task Memory if domain is provided
    if (domain) {
      const memoryManager = getTaskMemoryManager();
      const remembered = memoryManager.getSignature(domain, originalTargetStr);
      if (remembered) {
        // Try to locate by remembered signature
        const matchedByMemory = this.findBestCandidate(remembered, snapshot.elements);
        if (matchedByMemory && matchedByMemory.confidence >= this.confidenceThreshold) {
          return {
            healed: true,
            originalTarget: originalTargetStr,
            healedTarget: matchedByMemory.element.ref,
            confidence: matchedByMemory.confidence,
            strategy: "task_memory_recalled",
          };
        }
      }
    }

    // 2. Synthesize an ElementSignature from the target
    const targetSig: ElementSignature =
      typeof target === "string" ? this.inferSignatureFromString(target) : target;

    // 3. Multi-signal heuristic similarity scoring
    const best = this.findBestCandidate(targetSig, snapshot.elements);

    if (best && best.confidence >= this.confidenceThreshold) {
      // If we healed, record to Task Memory for future speedup
      if (domain) {
        getTaskMemoryManager().recordSuccess(domain, "workflow_step", originalTargetStr, {
          role: best.element.role,
          name: best.element.name,
          text: best.element.text,
          tag: best.element.tag,
          selector: best.element.selector,
        });
      }

      return {
        healed: true,
        originalTarget: originalTargetStr,
        healedTarget: best.element.ref,
        confidence: Number(best.confidence.toFixed(2)),
        strategy: "multi_signal_similarity",
      };
    }

    return {
      healed: false,
      originalTarget: originalTargetStr,
      healedTarget: "",
      confidence: best ? Number(best.confidence.toFixed(2)) : 0,
      strategy: "none",
    };
  }

  private inferSignatureFromString(target: string): ElementSignature {
    const clean = target.trim();

    // Check if selector like 'button[type="submit"]' or '#submit-btn'
    let role: string | undefined;
    let tag: string | undefined;
    let name: string | undefined;

    if (clean.startsWith("#")) {
      name = clean.slice(1);
    } else if (clean.startsWith(".")) {
      name = clean.slice(1);
    } else if (clean.toLowerCase().includes("button") || clean.toLowerCase().includes("btn")) {
      role = "button";
      tag = "button";
      name = clean.replace(/button|btn|[#.]/gi, "").trim();
    } else if (clean.toLowerCase().includes("input")) {
      role = "textbox";
      tag = "input";
      name = clean.replace(/input|[#.]/gi, "").trim();
    } else {
      name = clean;
    }

    return {
      role,
      tag,
      name,
      text: clean,
    };
  }

  private findBestCandidate(
    sig: ElementSignature,
    candidates: SnapshotElement[],
  ): { element: SnapshotElement; confidence: number } | null {
    let bestMatch: SnapshotElement | null = null;
    let highestScore = 0;

    for (const candidate of candidates) {
      const score = this.calculateSimilarity(sig, candidate);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestMatch && highestScore > 0) {
      return { element: bestMatch, confidence: highestScore };
    }
    return null;
  }

  /**
   * Computes weighted multi-signal similarity score between [0, 1].
   * - Role weight: 0.25
   * - Text/Name similarity: 0.35
   * - Tag name weight: 0.15
   * - Context/Attributes weight: 0.25
   */
  public calculateSimilarity(sig: ElementSignature, candidate: SnapshotElement): number {
    let score = 0;

    // 1. Role match (0.25)
    if (sig.role && candidate.role) {
      if (sig.role.toLowerCase() === candidate.role.toLowerCase()) {
        score += 0.25;
      }
    }

    // 2. Text / Name similarity (up to 0.60)
    const targetText = (sig.text || sig.name || "").toLowerCase().trim();
    const candText = (candidate.name || candidate.text || candidate.value || "").toLowerCase().trim();

    if (targetText && candText) {
      if (targetText === candText) {
        score += 0.50;
      } else if (candText.includes(targetText) || targetText.includes(candText)) {
        score += 0.35;
      } else {
        const tokenSim = this.computeTokenSimilarity(targetText, candText);
        score += tokenSim * 0.30;
      }
    }

    // 3. Tag match (0.15)
    if (sig.tag && candidate.tag) {
      if (sig.tag.toLowerCase() === candidate.tag.toLowerCase()) {
        score += 0.15;
      }
    }

    // 4. Interactive element boost
    if (candidate.clickable || candidate.tag === "button" || candidate.tag === "a" || candidate.role === "button") {
      score += 0.15;
    }

    // 5. Selector / Attribute match (0.20)
    if (sig.selector && candidate.selector) {
      if (sig.selector.toLowerCase() === candidate.selector.toLowerCase()) {
        score += 0.20;
      } else if (candidate.selector.toLowerCase().includes(sig.selector.toLowerCase())) {
        score += 0.10;
      }
    } else if (sig.name && (candidate.name || candidate.selector)) {
      const nameKey = sig.name.toLowerCase();
      if (
        candidate.name.toLowerCase().includes(nameKey) ||
        (candidate.selector && candidate.selector.toLowerCase().includes(nameKey))
      ) {
        score += 0.10;
      }
    }

    return Math.min(1, score);
  }

  private computeTokenSimilarity(str1: string, str2: string): number {
    const tokens1 = new Set(str1.split(/[\s-_/:]+/).filter((t) => t.length > 1));
    const tokens2 = new Set(str2.split(/[\s-_/:]+/).filter((t) => t.length > 1));
    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    let overlap = 0;
    for (const t of tokens1) {
      if (tokens2.has(t)) overlap++;
    }

    const union = new Set([...tokens1, ...tokens2]).size;
    return union > 0 ? overlap / union : 0;
  }
}

let selfHealingMatcherInstance: SelfHealingMatcher | null = null;
export function getSelfHealingMatcher(): SelfHealingMatcher {
  if (!selfHealingMatcherInstance) {
    selfHealingMatcherInstance = new SelfHealingMatcher();
  }
  return selfHealingMatcherInstance;
}
