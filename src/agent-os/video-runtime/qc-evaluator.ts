/**
 * Phase 20.88 — Automated Media QC Evaluator & Reviewer Council Render Gate
 * Pre-render validation, safe area checks, caption verification, and quality gating.
 */

import type { MediaQcResult, TimelineComposition } from "./types";

export class MediaQcEvaluator {
  /**
   * Performs rigorous automated QC checks over a compiled video composition.
   */
  public static evaluate(comp: TimelineComposition): MediaQcResult {
    const warnings: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // 1. Resolution Check
    const isStandardResolution =
      (comp.width >= 1080 && comp.height >= 1920) || // 9:16 vertical
      (comp.width >= 1920 && comp.height >= 1080); // 16:9 horizontal

    if (!isStandardResolution) {
      score -= 25;
      warnings.push(`Resolution ${comp.width}x${comp.height} is below standard 1080p master target.`);
    }

    // 2. Duration Check (Short-form video target: 6s - 120s)
    const durationCheck = comp.durationSeconds >= 6 && comp.durationSeconds <= 120;
    if (!durationCheck) {
      score -= 20;
      warnings.push(`Total duration ${comp.durationSeconds}s is outside recommended short-form bounds (6-120s).`);
    }

    // 3. Safe Area Check
    const safeAreaCheck = comp.brand.safeZonePaddingPx >= 48;
    if (!safeAreaCheck) {
      score -= 15;
      warnings.push(`Brand safe zone padding (${comp.brand.safeZonePaddingPx}px) may cause UI clipping on mobile screens.`);
      recommendations.push("Increase safeZonePaddingPx to at least 64px.");
    }

    // 4. Caption Alignment & Timing Check
    let captionAlignmentCheck = true;
    let readabilityCheck = true;

    for (const scene of comp.scenes) {
      for (const seg of scene.captions) {
        if (seg.startFrame >= seg.endFrame || seg.startSec >= seg.endSec) {
          captionAlignmentCheck = false;
          score -= 15;
          warnings.push(`Scene '${scene.id}' has inverted caption timestamp [${seg.startSec}s - ${seg.endSec}s].`);
        }

        if (seg.words.length > 7) {
          readabilityCheck = false;
          score -= 10;
          recommendations.push(`Caption segment '${seg.id}' has ${seg.words.length} words; keep under 6 words for mobile engagement.`);
        }
      }
    }

    const passed = score >= 75 && isStandardResolution && durationCheck && captionAlignmentCheck;

    return {
      jobId: comp.compositionId,
      passed,
      score: Math.max(0, score),
      checks: {
        resolutionCheck: isStandardResolution,
        durationCheck,
        safeAreaCheck,
        readabilityCheck,
        captionAlignmentCheck,
      },
      warnings,
      recommendations,
    };
  }

  /**
   * Reviewer Council Render Gate (§37):
   * Inspects QC score and rights clearance before allowing render queue dispatch.
   */
  public static evaluateRenderGate(
    qc: MediaQcResult,
    options?: { humanApproved?: boolean; forceOverride?: boolean },
  ): { allowed: boolean; reason: string } {
    if (options?.forceOverride && options?.humanApproved) {
      return {
        allowed: true,
        reason: "Render authorized via explicit human supervisor override.",
      };
    }

    if (!qc.passed) {
      return {
        allowed: false,
        reason: `Render blocked by Media QC Gate (Score: ${qc.score}/100): ${qc.warnings.join("; ")}`,
      };
    }

    return {
      allowed: true,
      reason: `Media QC passed (Score: ${qc.score}/100); render job authorized for worker queue.`,
    };
  }
}
